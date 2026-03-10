/**
 * AgentServerRecovery — recovers agent state on agent server startup.
 *
 * Loads non-terminated agents from the roster and attempts to resume them.
 * For providers that support session resume (e.g. Copilot, Cursor, Claude SDK),
 * the stored sessionId is passed to the adapter to restore conversation context.
 * Providers without resume support have their agents marked as 'stale'.
 *
 * This runs ONCE on agent server startup, before accepting connections.
 *
 * Recovery flow:
 *   1. Load all non-terminated agents from AgentRosterRepository
 *   2. For each agent, check if its provider supports session resume
 *   3. If yes and sessionId exists → attempt resume via adapter factory
 *   4. If resume succeeds → report as 'resumed'
 *   5. If resume fails → mark as 'stale' and report
 *   6. If no resume support or no sessionId → mark as 'stale'
 *
 * Design: docs/design/agent-server-architecture.md
 */
import { logger } from '../utils/logger.js';
import { getPreset } from '../adapters/presets.js';
import { createAdapterForProvider, buildStartOptions } from '../adapters/AdapterFactory.js';
import type { AdapterConfig } from '../adapters/AdapterFactory.js';
import type { AgentServerPersistence } from '../agent-server-persistence.js';
import type { AgentRecord } from '../db/AgentRosterRepository.js';
import type { AgentAdapter } from '../adapters/types.js';

// ── Types ───────────────────────────────────────────────────────────

export interface RecoveryResult {
  agentId: string;
  role: string;
  model: string;
  status: 'resumed' | 'stale' | 'failed';
  sessionId?: string;
  adapter?: AgentAdapter;
  error?: string;
}

export interface RecoveryReport {
  total: number;
  resumed: RecoveryResult[];
  stale: RecoveryResult[];
  failed: RecoveryResult[];
}

export interface AgentServerRecoveryOptions {
  /** Adapter configuration for creating adapters during resume. */
  adapterConfig?: Partial<AdapterConfig>;
  /** Working directory for adapter start options (default: process.cwd()). */
  cwd?: string;
}

// ── AgentServerRecovery ─────────────────────────────────────────────

export class AgentServerRecovery {
  private readonly persistence: AgentServerPersistence;
  private readonly adapterConfig: Partial<AdapterConfig>;
  private readonly cwd: string;

  constructor(
    persistence: AgentServerPersistence,
    options: AgentServerRecoveryOptions = {},
  ) {
    this.persistence = persistence;
    this.adapterConfig = options.adapterConfig ?? {};
    this.cwd = options.cwd ?? process.cwd();
  }

  /**
   * Recover agents from persisted state.
   * Returns a report with resumed, stale, and failed agents.
   */
  async recover(): Promise<RecoveryReport> {
    const candidates = this.persistence.getActiveAgents();

    if (candidates.length === 0) {
      logger.info({ module: 'recovery', msg: 'No agents to recover' });
      return { total: 0, resumed: [], stale: [], failed: [] };
    }

    logger.info({ module: 'recovery', msg: `Recovering ${candidates.length} agent(s)` });

    const results = await Promise.allSettled(
      candidates.map((agent) => this.recoverAgent(agent)),
    );

    const report: RecoveryReport = { total: candidates.length, resumed: [], stale: [], failed: [] };

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        report[result.value.status === 'resumed' ? 'resumed' : result.value.status === 'stale' ? 'stale' : 'failed']
          .push(result.value);
      } else {
        // Unexpected rejection — should not happen since recoverAgent catches internally
        report.failed.push({
          agentId: candidates[i].agentId,
          role: candidates[i].role,
          model: candidates[i].model,
          status: 'failed',
          error: String(result.reason),
        });
      }
    }

    logger.info({
      module: 'recovery',
      msg: 'Recovery complete',
      total: report.total,
      resumed: report.resumed.length,
      stale: report.stale.length,
      failed: report.failed.length,
    });

    return report;
  }

  /**
   * Attempt to recover a single agent.
   */
  private async recoverAgent(record: AgentRecord): Promise<RecoveryResult> {
    const { agentId, role, model, sessionId } = record;
    const provider = this.adapterConfig.provider ?? 'copilot';

    // Check if provider supports session resume
    const preset = getPreset(provider);
    const canResume = preset?.supportsResume ?? false;

    if (!canResume || !sessionId) {
      const reason = !canResume
        ? `Provider '${provider}' does not support session resume`
        : 'No sessionId available for resume';

      logger.info({ module: 'recovery', msg: 'Marking agent as stale', agentId, reason });
      this.persistence.onStatusChanged(agentId, 'exited');

      return { agentId, role, model, status: 'stale', error: reason };
    }

    // Attempt resume with stored sessionId
    try {
      const config: AdapterConfig = {
        ...this.adapterConfig,
        provider,
        model,
      };

      const { adapter } = await createAdapterForProvider(config);
      const startOpts = buildStartOptions(config, { cwd: this.cwd, sessionId });

      const newSessionId = await adapter.start(startOpts);

      // Update persistence with new session state
      this.persistence.onSessionReady(agentId, newSessionId);
      this.persistence.onStatusChanged(agentId, 'running');

      logger.info({
        module: 'recovery',
        msg: 'Agent resumed successfully',
        agentId,
        sessionId: newSessionId,
      });

      return { agentId, role, model, status: 'resumed', sessionId: newSessionId, adapter };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      logger.warn({ module: 'recovery', msg: 'Agent resume failed', agentId, err: error });
      this.persistence.onStatusChanged(agentId, 'crashed');

      return { agentId, role, model, status: 'failed', error };
    }
  }
}
