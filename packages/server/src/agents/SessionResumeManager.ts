/**
 * SessionResumeManager — orchestrates agent session resume on server startup.
 *
 * Subscribes to AgentManager lifecycle events to persist agent state into the
 * agentRoster table. On startup, reads the roster and attempts to resume all
 * non-terminated agents via their stored SDK session IDs.
 *
 * Resume flow:
 *   1. Read agentRoster for agents with status != 'terminated' and a sessionId
 *   2. For each, call agentManager.spawn() with resumeSessionId
 *   3. AcpAdapter calls connection.loadSession() (fallback: newSession)
 *   4. Agent resumes with full conversation context from disk
 *
 * Lifecycle persistence (write-on-mutation):
 *   - agent:spawned   → upsert into agentRoster
 *   - agent:session_ready → update sessionId
 *   - agent:status    → update status (running→busy, idle→idle)
 *   - agent:terminated → mark as terminated
 */
import { EventEmitter } from 'events';
import type { AgentManager } from './AgentManager.js';
import type { AgentRosterRepository, AgentStatus as RosterStatus } from '../db/AgentRosterRepository.js';
import type { ActiveDelegationRepository, DelegationRecord } from '../db/ActiveDelegationRepository.js';
import type { RoleRegistry } from './RoleRegistry.js';
import type { AgentJSON } from './Agent.js';
import type { ServerConfig } from '../config.js';
import { getPreset } from '../adapters/presets.js';
import { logger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ResumeResult {
  agentId: string;
  success: boolean;
  error?: string;
  newSessionId?: string;
}

export interface ResumeAllResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: ResumeResult[];
}

// ── Status mapping ──────────────────────────────────────────────────

function toRosterStatus(agentStatus: string): RosterStatus | null {
  switch (agentStatus) {
    case 'running': return 'busy';
    case 'idle': return 'idle';
    case 'completed':
    case 'failed':
    case 'terminated': return 'terminated';
    case 'creating': return null; // transient — don't persist yet
    default: return null;
  }
}

// ── SessionResumeManager ────────────────────────────────────────────

export class SessionResumeManager {
  private disposed = false;
  private _resumeInProgress = false;
  private _resumeQueue: Array<{
    resolve: (result: ResumeAllResult) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(
    private agentManager: AgentManager,
    private agentRosterRepo: AgentRosterRepository,
    private activeDelegationRepo: ActiveDelegationRepository,
    private roleRegistry: RoleRegistry,
    private config: ServerConfig,
  ) {
    this.bindLifecycleEvents();
  }

  /** Check if the current CLI provider supports SDK session resume. */
  get providerSupportsResume(): boolean {
    const preset = getPreset(this.config.provider || 'copilot');
    return preset?.supportsResume ?? false;
  }

  // ── Lifecycle event handlers (persist on mutation) ────────────────

  private bindLifecycleEvents(): void {
    this.agentManager.on('agent:spawned', this.onAgentSpawned);
    this.agentManager.on('agent:session_ready', this.onSessionReady);
    this.agentManager.on('agent:status', this.onStatusChanged);
    this.agentManager.on('agent:terminated', this.onAgentTerminated);
    this.agentManager.on('agent:exit', this.onAgentExit);
  }

  private onAgentSpawned = (agentJson: AgentJSON): void => {
    try {
      const rosterStatus = toRosterStatus(agentJson.status) ?? 'idle';
      this.agentRosterRepo.upsertAgent(
        agentJson.id,
        agentJson.role.id,
        agentJson.model || 'default',
        rosterStatus,
        agentJson.sessionId ?? undefined,
        agentJson.projectId,
        {
          task: agentJson.task,
          parentId: agentJson.parentId,
          cwd: agentJson.cwd,
        },
      );
    } catch (err) {
      logger.error({ module: 'resume', msg: 'Failed to persist agent spawn', agentId: agentJson.id, err: String(err) });
    }
  };

  private onSessionReady = ({ agentId, sessionId }: { agentId: string; sessionId: string }): void => {
    try {
      this.agentRosterRepo.updateSessionId(agentId, sessionId);
    } catch (err) {
      logger.error({ module: 'resume', msg: 'Failed to persist sessionId', agentId, err: String(err) });
    }
  };

  private onStatusChanged = ({ agentId, status }: { agentId: string; status: string }): void => {
    try {
      const rosterStatus = toRosterStatus(status);
      if (rosterStatus) {
        this.agentRosterRepo.updateStatus(agentId, rosterStatus);
      }
    } catch (err) {
      logger.error({ module: 'resume', msg: 'Failed to persist status change', agentId, err: String(err) });
    }
  };

  private onAgentTerminated = (agentId: string): void => {
    try {
      this.agentRosterRepo.removeAgent(agentId);
    } catch (err) {
      logger.error({ module: 'resume', msg: 'Failed to mark agent terminated', agentId, err: String(err) });
    }
  };

  private onAgentExit = ({ agentId, code }: { agentId: string; code: number }): void => {
    try {
      if (code !== 0) {
        this.agentRosterRepo.updateStatus(agentId, 'terminated');
      }
    } catch (err) {
      logger.error({ module: 'resume', msg: 'Failed to persist agent exit', agentId, err: String(err) });
    }
  };

  // ── Resume operations ─────────────────────────────────────────────

  /** Resume all persisted agents that have valid session IDs. Serialized — concurrent calls wait. */
  async resumeAll(): Promise<ResumeAllResult> {
    if (this._resumeInProgress) {
      logger.info({ module: 'resume', msg: 'resumeAll already in progress — queueing' });
      return new Promise<ResumeAllResult>((resolve, reject) => {
        this._resumeQueue.push({ resolve, reject });
      });
    }

    this._resumeInProgress = true;
    try {
      const result = await this._doResumeAll();
      return result;
    } finally {
      this._resumeInProgress = false;
      this._drainQueue();
    }
  }

  /** Drain queued resumeAll() callers by running one more pass. */
  private _drainQueue(): void {
    if (this._resumeQueue.length === 0) return;
    const waiters = this._resumeQueue.splice(0);
    // Run a fresh pass for queued callers
    this.resumeAll().then(
      (result) => waiters.forEach((w) => w.resolve(result)),
      (err) => waiters.forEach((w) => w.reject(err)),
    );
  }

  /** Internal implementation of resumeAll — no mutex guard. */
  private async _doResumeAll(): Promise<ResumeAllResult> {
    const candidates = this.agentRosterRepo.getAllAgents()
      .filter((a) => a.status !== 'terminated');

    if (candidates.length === 0) {
      logger.info({ module: 'resume', msg: 'No agents to resume' });
      return { total: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
    }

    // Check if the current CLI provider supports session resume
    if (!this.providerSupportsResume) {
      const provider = this.config.provider || 'copilot';
      logger.info({
        module: 'resume',
        msg: `Provider '${provider}' does not support session resume — starting ${candidates.length} agent(s) fresh`,
      });

      // Start agents fresh (without resumeSessionId) so they get role + task context
      const results = await Promise.allSettled(
        candidates.map((agent) => this.startFresh(agent.agentId)),
      );

      const mapped = this.mapResults(results, candidates);
      return this.summarizeResults(candidates.length, mapped);
    }

    logger.info({ module: 'resume', msg: `Attempting to resume ${candidates.length} agent(s)` });

    const results = await Promise.allSettled(
      candidates.map((agent) => this.resumeAgent(agent.agentId)),
    );

    const mapped = this.mapResults(results, candidates);
    return this.summarizeResults(candidates.length, mapped);
  }

  /** Resume a single agent by its roster ID. */
  async resumeAgent(agentId: string): Promise<ResumeResult> {
    const record = this.agentRosterRepo.getAgent(agentId);
    if (!record) {
      return { agentId, success: false, error: 'Agent not found in roster' };
    }

    if (!record.sessionId) {
      return { agentId, success: false, error: 'No sessionId for resume' };
    }

    const role = this.roleRegistry.get(record.role);
    if (!role) {
      return { agentId, success: false, error: `Role '${record.role}' not found in registry` };
    }

    const metadata = record.metadata as Record<string, string> | undefined;

    try {
      const agent = this.agentManager.spawn(
        role,
        metadata?.task,
        metadata?.parentId,
        undefined,           // autopilot — use default
        record.model !== 'default' ? record.model : undefined,
        metadata?.cwd,
        record.sessionId,    // resumeSessionId — triggers resume flow
        agentId,             // reuse same agent ID
        { projectId: record.projectId },
      );

      return {
        agentId: agent.id,
        success: true,
        newSessionId: agent.sessionId ?? undefined,
      };
    } catch (err) {
      // Mark agent as terminated so it's not retried on next startup
      this.agentRosterRepo.updateStatus(agentId, 'terminated');
      logger.warn({ module: 'resume', msg: 'Agent resume failed', agentId, err: String(err) });
      return { agentId, success: false, error: String(err) };
    }
  }

  /** Start an agent fresh (no session resume) — used when provider doesn't support resume. */
  async startFresh(agentId: string): Promise<ResumeResult> {
    const record = this.agentRosterRepo.getAgent(agentId);
    if (!record) {
      return { agentId, success: false, error: 'Agent not found in roster' };
    }

    const role = this.roleRegistry.get(record.role);
    if (!role) {
      return { agentId, success: false, error: `Role '${record.role}' not found in registry` };
    }

    const metadata = record.metadata as Record<string, string> | undefined;

    try {
      const agent = this.agentManager.spawn(
        role,
        metadata?.task,
        metadata?.parentId,
        undefined,
        record.model !== 'default' ? record.model : undefined,
        metadata?.cwd,
        undefined,           // no resumeSessionId — fresh start
        agentId,
        { projectId: record.projectId },
      );

      return { agentId: agent.id, success: true };
    } catch (err) {
      this.agentRosterRepo.updateStatus(agentId, 'terminated');
      logger.warn({ module: 'resume', msg: 'Agent fresh start failed', agentId, err: String(err) });
      return { agentId, success: false, error: String(err) };
    }
  }

  // ── Recovery queries ──────────────────────────────────────────────

  /** Get all in-flight delegations (for recovery awareness). */
  getActiveDelegations(agentId?: string): DelegationRecord[] {
    return this.activeDelegationRepo.getActive(agentId);
  }

  /** Get the full persisted roster (for diagnostics/UI). */
  getPersistedRoster() {
    return this.agentRosterRepo.getAllAgents();
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  private mapResults(
    results: PromiseSettledResult<ResumeResult>[],
    candidates: { agentId: string }[],
  ): ResumeResult[] {
    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { agentId: candidates[i].agentId, success: false, error: String(r.reason) },
    );
  }

  private summarizeResults(total: number, mapped: ResumeResult[]): ResumeAllResult {
    const succeeded = mapped.filter((r) => r.success).length;
    const failed = mapped.filter((r) => !r.success && !r.error?.includes('No sessionId')).length;
    const skipped = mapped.filter((r) => r.error?.includes('No sessionId')).length;

    logger.info({
      module: 'resume',
      msg: `Resume complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (no sessionId)`,
    });

    return { total, succeeded, failed, skipped, results: mapped };
  }

  /** Remove all lifecycle event listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.agentManager.off('agent:spawned', this.onAgentSpawned);
    this.agentManager.off('agent:session_ready', this.onSessionReady);
    this.agentManager.off('agent:status', this.onStatusChanged);
    this.agentManager.off('agent:terminated', this.onAgentTerminated);
    this.agentManager.off('agent:exit', this.onAgentExit);
  }
}
