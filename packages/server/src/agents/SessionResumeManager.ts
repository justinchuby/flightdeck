/**
 * SessionResumeManager — orchestrates agent session lifecycle persistence
 * and provides the core resume-a-lead-session logic for the HTTP endpoint.
 *
 * Subscribes to AgentManager lifecycle events to persist agent state into the
 * agentRoster table. Exposes `resumeLeadSession()` for the POST /projects/:id/resume
 * handler to call.
 *
 * Lifecycle persistence (write-on-mutation):
 *   - agent:spawned   → upsert into agentRoster
 *   - agent:session_ready → update sessionId
 *   - agent:status    → update status (running→running, idle→idle)
 *   - agent:terminated → mark as terminated
 */
import type { AgentManager } from './AgentManager.js';
import type { AgentRosterRepository, RosterAgentStatus as RosterStatus } from '../db/AgentRosterRepository.js';
import type { ActiveDelegationRepository, DelegationRecord } from '../db/ActiveDelegationRepository.js';
import type { RoleRegistry } from './RoleRegistry.js';
import type { AgentJSON, Agent } from './Agent.js';
import type { ServerConfig } from '../config.js';
import type { ProjectRegistry } from '../projects/ProjectRegistry.js';
import type { ProjectSession } from '@flightdeck/shared';
import { logger } from '../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ResumeSessionOptions {
  /** The session row to resume. */
  session: ProjectSession;
  /** The project owning this session. */
  project: { id: string; name: string; cwd?: string | null };
  /** Override task (falls back to session's stored task). */
  task?: string;
  /** Model override for the lead agent. */
  model?: string;
}

export interface ResumeSessionResult {
  agent: Agent;
  task: string | undefined;
}

/** Typed error with HTTP status code for resume failures. */
export class ResumeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ResumeError';
  }
}

// ── Status mapping ──────────────────────────────────────────────────

function toRosterStatus(agentStatus: string): RosterStatus | null {
  switch (agentStatus) {
    case 'running': return 'running';
    case 'idle': return 'idle';
    case 'completed':
    case 'terminated': return 'terminated';
    case 'failed': return 'failed';
    case 'creating': return null; // transient — don't persist yet
    default: return null;
  }
}

// ── SessionResumeManager ────────────────────────────────────────────

export class SessionResumeManager {
  private disposed = false;

  constructor(
    private agentManager: AgentManager,
    private agentRosterRepo: AgentRosterRepository,
    private activeDelegationRepo: ActiveDelegationRepository,
    private roleRegistry: RoleRegistry,
    private _config: ServerConfig,
  ) {
    this.bindLifecycleEvents();
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
        undefined,
        agentJson.provider,
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

  // ── Lead session resume ────────────────────────────────────────────

  /**
   * Resume a lead agent session.
   *
   * - Validates the session has a Copilot sessionId
   * - Atomically claims the session to prevent double-resume
   * - Spawns the lead agent with the same sessionId + leadId
   * - Reactivates the session row in the DB
   * - Enforces silence invariant: NO messages sent to the agent
   *
   * Throws ResumeError if session cannot be resumed.
   */
  resumeLeadSession(
    opts: ResumeSessionOptions,
    projectRegistry: ProjectRegistry,
  ): ResumeSessionResult {
    const { session, project, model } = opts;

    if (!session.sessionId) {
      throw new ResumeError('Session has no Copilot session ID — cannot resume', 400);
    }

    // Atomic claim prevents race condition: two concurrent resumes both passing status check
    if (!projectRegistry.claimSessionForResume(session.id)) {
      throw new ResumeError('Session is still active or already being resumed', 409);
    }

    // Use stored role from session, falling back to 'lead'
    const roleId = session.role ?? 'lead';
    const role = this.roleRegistry.get(roleId);
    if (!role) {
      throw new ResumeError(`Role "${roleId}" not found`, 500);
    }

    const task = opts.task || session.task || undefined;

    // Log diagnostic when resuming a crashed session
    if (session.status === 'crashed') {
      logger.warn({ module: 'resume', msg: 'Attempting resume of crashed session — SDK may or may not recover it', sessionId: session.sessionId, projectId: project.id });
    }

    const agent = this.agentManager.spawn(
      role,
      task,
      undefined,
      model,
      project.cwd ?? undefined,
      session.sessionId,
      session.leadId,
      { projectName: project.name, projectId: project.id },
    );

    // Verify invariant: spawn must reuse the same agent ID on resume
    if (agent.id !== session.leadId) {
      logger.warn({ module: 'resume', msg: 'Agent ID mismatch after resume spawn — invariant violation', expected: session.leadId, actual: agent.id, sessionId: session.id });
    }

    projectRegistry.reactivateSession(session.id, task, roleId);

    // Silence invariant: NO messages sent. Agent picks up context from restored ACP session.

    logger.info({ module: 'resume', msg: 'Session resumed', projectId: project.id, projectName: project.name, agentId: agent.id, sessionId: session.sessionId });

    return { agent, task };
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
