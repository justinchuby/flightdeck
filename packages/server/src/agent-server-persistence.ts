/**
 * AgentServerPersistence — write-on-mutation persistence for the agent server.
 *
 * Hooks into AgentServer lifecycle to persist agent state into the agentRoster
 * and activeDelegations SQLite tables. The agent server is the SOLE writer to
 * these tables; the orchestration server only reads them.
 *
 * Lifecycle events persisted:
 *   - Agent spawned   → upsert into agentRoster (status='idle')
 *   - Session ready   → update sessionId
 *   - Status change   → update status
 *   - Agent exit      → update status to 'terminated' (crash) or keep (clean exit)
 *   - Agent terminate → mark as 'terminated'
 *   - Server stop     → mark all active agents as 'terminated'
 *
 * Pattern: See SessionResumeManager.ts for the same write-on-mutation approach.
 */
import { logger } from './utils/logger.js';
import type { AgentRosterRepository, AgentStatus as RosterStatus } from './db/AgentRosterRepository.js';
import type { ActiveDelegationRepository } from './db/ActiveDelegationRepository.js';
import type { ManagedAgent } from './agent-server.js';

// ── Types ───────────────────────────────────────────────────────────

export interface AgentServerPersistenceOptions {
  rosterRepo: AgentRosterRepository;
  delegationRepo: ActiveDelegationRepository;
  /** Project ID for scoping roster entries (optional). */
  projectId?: string;
}

/** Maps transport AgentStatus to roster AgentStatus. */
function toRosterStatus(status: string): RosterStatus | null {
  switch (status) {
    case 'starting': return 'idle';
    case 'running': return 'busy';
    case 'idle': return 'idle';
    case 'stopping': return 'busy'; // still active while stopping
    case 'exited': return 'terminated';
    case 'crashed': return 'terminated';
    default: return null;
  }
}

// ── AgentServerPersistence ──────────────────────────────────────────

export class AgentServerPersistence {
  private readonly rosterRepo: AgentRosterRepository;
  private readonly delegationRepo: ActiveDelegationRepository;
  private readonly projectId?: string;

  constructor(options: AgentServerPersistenceOptions) {
    this.rosterRepo = options.rosterRepo;
    this.delegationRepo = options.delegationRepo;
    this.projectId = options.projectId;
  }

  // ── Lifecycle event handlers ──────────────────────────────────

  /** Called when a new agent is spawned. Upserts the roster entry. */
  onAgentSpawned(agent: ManagedAgent): void {
    try {
      this.rosterRepo.upsertAgent(
        agent.id,
        agent.role,
        agent.model,
        'idle',
        agent.sessionId,
        this.projectId,
        {
          task: agent.task,
          pid: agent.pid,
          startedAt: agent.startedAt,
        },
      );

      logger.info({
        module: 'agent-server-persistence',
        msg: 'Persisted agent spawn',
        agentId: agent.id,
        role: agent.role,
      });
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to persist agent spawn',
        agentId: agent.id,
        err: String(err),
      });
    }
  }

  /** Called when a session ID becomes available (adapter started). */
  onSessionReady(agentId: string, sessionId: string): void {
    try {
      this.rosterRepo.updateSessionId(agentId, sessionId);

      logger.info({
        module: 'agent-server-persistence',
        msg: 'Persisted session ID',
        agentId,
        sessionId,
      });
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to persist session ID',
        agentId,
        err: String(err),
      });
    }
  }

  /** Called when an agent's status changes. */
  onStatusChanged(agentId: string, status: string): void {
    try {
      const rosterStatus = toRosterStatus(status);
      if (!rosterStatus) return; // transient status, skip

      this.rosterRepo.updateStatus(agentId, rosterStatus);

      logger.info({
        module: 'agent-server-persistence',
        msg: 'Persisted status change',
        agentId,
        status,
        rosterStatus,
      });
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to persist status change',
        agentId,
        err: String(err),
      });
    }
  }

  /** Called when an agent exits. */
  onAgentExited(agentId: string, exitCode: number): void {
    try {
      const status: RosterStatus = exitCode === 0 ? 'terminated' : 'terminated';
      this.rosterRepo.updateStatus(agentId, status);

      logger.info({
        module: 'agent-server-persistence',
        msg: 'Persisted agent exit',
        agentId,
        exitCode,
      });
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to persist agent exit',
        agentId,
        err: String(err),
      });
    }
  }

  /** Called when an agent is explicitly terminated. */
  onAgentTerminated(agentId: string): void {
    try {
      this.rosterRepo.removeAgent(agentId);

      // Cancel any active delegations for this agent
      this.cancelAgentDelegations(agentId);

      logger.info({
        module: 'agent-server-persistence',
        msg: 'Persisted agent termination',
        agentId,
      });
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to persist agent termination',
        agentId,
        err: String(err),
      });
    }
  }

  /** Called on server shutdown — mark all remaining agents as terminated. */
  onServerStop(agents: ManagedAgent[]): void {
    for (const agent of agents) {
      if (agent.status !== 'exited' && agent.status !== 'crashed') {
        try {
          this.rosterRepo.removeAgent(agent.id);
          this.cancelAgentDelegations(agent.id);
        } catch (err) {
          logger.error({
            module: 'agent-server-persistence',
            msg: 'Failed to persist shutdown termination',
            agentId: agent.id,
            err: String(err),
          });
        }
      }
    }

    logger.info({
      module: 'agent-server-persistence',
      msg: 'Persisted server shutdown',
      agentCount: agents.length,
    });
  }

  /** Get all non-terminated agents from the roster (for resume). */
  getActiveAgents() {
    return this.rosterRepo.getAllAgents().filter(a => a.status !== 'terminated');
  }

  // ── Delegation helpers ────────────────────────────────────────

  private cancelAgentDelegations(agentId: string): void {
    try {
      const activeDelegations = this.delegationRepo.getActive(agentId);
      for (const delegation of activeDelegations) {
        if (delegation.status === 'active') {
          this.delegationRepo.cancel(delegation.delegationId);
        }
      }
    } catch (err) {
      logger.error({
        module: 'agent-server-persistence',
        msg: 'Failed to cancel agent delegations',
        agentId,
        err: String(err),
      });
    }
  }
}
