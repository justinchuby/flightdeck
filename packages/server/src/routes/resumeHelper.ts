/**
 * Shared session resume logic used by both:
 *   POST /projects/:id/resume  (projects.ts)
 *   POST /sessions/:id/resume  (sessions.ts)
 *
 * Encapsulates the core resume bootstrap:
 *   1. Atomic claim (prevents race conditions)
 *   2. Spawn lead with resumeSessionId + leadId
 *   3. Reactivate session row
 */

import type { AgentManager } from '../agents/AgentManager.js';
import type { RoleRegistry } from '../agents/RoleRegistry.js';
import type { ProjectRegistry } from '../projects/ProjectRegistry.js';
import type { ProjectSession } from '@flightdeck/shared';
import type { Agent } from '../agents/Agent.js';
import { logger } from '../utils/logger.js';

export interface ResumeContext {
  agentManager: AgentManager;
  roleRegistry: RoleRegistry;
  projectRegistry: ProjectRegistry;
}

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

/**
 * Resume a lead agent session.
 *
 * - Validates the session has a Copilot sessionId
 * - Atomically claims the session to prevent double-resume
 * - Spawns the lead agent with the same sessionId + leadId
 * - Reactivates the session row in the DB
 * - Enforces silence invariant: NO messages sent to the agent
 *
 * Throws if session cannot be resumed (no sessionId, already active, spawn failure).
 */
export function resumeLeadSession(
  opts: ResumeSessionOptions,
  ctx: ResumeContext,
): ResumeSessionResult {
  const { session, project, model } = opts;
  const { agentManager, roleRegistry, projectRegistry } = ctx;

  if (!session.sessionId) {
    throw new ResumeError('Session has no Copilot session ID — cannot resume', 400);
  }

  // Atomic claim prevents race condition: two concurrent resumes both passing status check
  if (!projectRegistry.claimSessionForResume(session.id)) {
    throw new ResumeError('Session is still active or already being resumed', 409);
  }

  // Use stored role from session, falling back to 'lead'
  const roleId = session.role ?? 'lead';
  const role = roleRegistry.get(roleId);
  if (!role) {
    throw new ResumeError(`Role "${roleId}" not found`, 500);
  }

  const task = opts.task || session.task || undefined;

  // Log diagnostic when resuming a crashed session
  if (session.status === 'crashed') {
    logger.warn({ module: 'resume', msg: 'Attempting resume of crashed session — SDK may or may not recover it', sessionId: session.sessionId, projectId: project.id });
  }

  const agent = agentManager.spawn(
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

/** Typed error with HTTP status code for resume failures. */
export class ResumeError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ResumeError';
  }
}
