import { eq, desc, and, isNotNull, ne, sql, inArray } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { projects, projectSessions, dagTasks, decisions, agentMemory } from '../db/schema.js';
import { generateProjectId } from '../utils/projectId.js';
import { DEFAULT_MODEL_CONFIG, type ProjectModelConfig } from './ModelConfigDefaults.js';

import type { Project, ProjectSession } from '@flightdeck/shared';
export type { Project, ProjectSession } from '@flightdeck/shared';

export interface ProjectBriefing {
  project: Project;
  sessions: ProjectSession[];
  taskSummary: { total: number; done: number; failed: number; pending: number };
  recentDecisions: Array<{ title: string; rationale: string; status: string }>;
  memories: Array<{ key: string; value: string }>;
}

export class ProjectRegistry {
  /** In-memory cache: projectId → merged model config. Invalidated on setModelConfig(). */
  private modelConfigCache = new Map<string, { config: ProjectModelConfig; defaults: ProjectModelConfig }>();

  constructor(private db: Database) {}

  /** Create a new project, return its ID */
  create(name: string, description?: string, cwd?: string): Project {
    const existingIds = (id: string) => !!this.get(id);
    const id = generateProjectId(name, existingIds);
    const now = new Date().toISOString();
    this.db.drizzle.insert(projects).values({
      id,
      name,
      description: description ?? '',
      cwd: cwd ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).run();
    return { id, name, description: description ?? '', cwd: cwd ?? null, status: 'active', createdAt: now, updatedAt: now };
  }

  /** Get a project by ID */
  get(id: string): Project | undefined {
    return this.db.drizzle.select().from(projects).where(eq(projects.id, id)).get() as Project | undefined;
  }

  /** List all projects, optionally filtered by status */
  list(status?: string): Project[] {
    if (status) {
      return this.db.drizzle.select().from(projects).where(eq(projects.status, status)).orderBy(desc(projects.updatedAt)).all() as Project[];
    }
    return this.db.drizzle.select().from(projects).orderBy(desc(projects.updatedAt)).all() as Project[];
  }

  /** Update a project */
  update(id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'cwd' | 'status'>>): void {
    this.db.drizzle.update(projects).set({
      ...updates,
      updatedAt: new Date().toISOString(),
    }).where(eq(projects.id, id)).run();
  }

  /**
   * Record that a lead session started for this project.
   * INVARIANT: leadId is immutable after this insert — it permanently identifies this session.
   * On resume, the same agent ID must be reused via spawn(id:).
   */
  startSession(projectId: string, leadId: string, task?: string, role?: string): void {
    this.db.drizzle.insert(projectSessions).values({
      projectId,
      leadId,
      task: task ?? null,
      role: role ?? 'lead',
      status: 'active',
    }).run();

    // Touch project updatedAt
    this.db.drizzle.update(projects).set({ updatedAt: new Date().toISOString() }).where(eq(projects.id, projectId)).run();
  }

  /** Update session with copilot session ID once available */
  setSessionId(leadId: string, sessionId: string): void {
    this.db.drizzle.update(projectSessions).set({
      sessionId,
    }).where(and(eq(projectSessions.leadId, leadId), eq(projectSessions.status, 'active'))).run();
  }

  /** Mark a lead session as ended */
  endSession(leadId: string, status: 'completed' | 'crashed' | 'stopped' = 'completed'): void {
    this.db.drizzle.update(projectSessions).set({
      status,
      endedAt: new Date().toISOString(),
    }).where(and(eq(projectSessions.leadId, leadId), eq(projectSessions.status, 'active'))).run();
  }

  /** Get all sessions for a project */
  getSessions(projectId: string): ProjectSession[] {
    return this.db.drizzle.select().from(projectSessions)
      .where(eq(projectSessions.projectId, projectId))
      .orderBy(desc(projectSessions.startedAt))
      .all() as ProjectSession[];
  }

  /** Find the project for a given lead ID */
  findProjectByLeadId(leadId: string): Project | undefined {
    const session = this.db.drizzle.select()
      .from(projectSessions)
      .where(eq(projectSessions.leadId, leadId))
      .get() as ProjectSession | undefined;
    if (!session) return undefined;
    return this.get(session.projectId);
  }

  /** Get the active lead ID for a project (if any) */
  getActiveLeadId(projectId: string): string | undefined {
    const session = this.db.drizzle.select()
      .from(projectSessions)
      .where(and(eq(projectSessions.projectId, projectId), eq(projectSessions.status, 'active')))
      .get() as ProjectSession | undefined;
    return session?.leadId;
  }

  /** Build a briefing for a new lead session resuming a project */
  buildBriefing(projectId: string): ProjectBriefing | undefined {
    const project = this.get(projectId);
    if (!project) return undefined;

    const sessions = this.getSessions(projectId);
    const allLeadIds = sessions.map(s => s.leadId);

    // Task summary across all sessions for this project
    let taskSummary = { total: 0, done: 0, failed: 0, pending: 0 };
    const taskRows = this.db.drizzle
      .select({
        dagStatus: dagTasks.dagStatus,
        cnt: sql<number>`count(*)`.as('cnt'),
      })
      .from(dagTasks)
      .where(eq(dagTasks.projectId, projectId))
      .groupBy(dagTasks.dagStatus)
      .all();
    for (const row of taskRows) {
      const count = Number(row.cnt);
      taskSummary.total += count;
      if (row.dagStatus === 'done') taskSummary.done += count;
      else if (row.dagStatus === 'failed') taskSummary.failed += count;
      else taskSummary.pending += count;
    }

    // Recent decisions across all sessions
    let recentDecisions: Array<{ title: string; rationale: string; status: string }> = [];
    if (allLeadIds.length > 0) {
      recentDecisions = this.db.drizzle
        .select({
          title: decisions.title,
          rationale: sql<string>`COALESCE(${decisions.rationale}, '')`.as('rationale'),
          status: sql<string>`COALESCE(${decisions.status}, 'recorded')`.as('status'),
        })
        .from(decisions)
        .where(inArray(decisions.leadId, allLeadIds))
        .orderBy(desc(decisions.createdAt))
        .limit(20)
        .all();
    }

    // Aggregate memories from the most recent session's lead
    const lastLeadId = sessions[0]?.leadId;
    const memories = lastLeadId
      ? this.db.drizzle.select({
          key: agentMemory.key,
          value: agentMemory.value,
        }).from(agentMemory)
          .where(eq(agentMemory.leadId, lastLeadId))
          .all()
      : [];

    return { project, sessions, taskSummary, recentDecisions, memories };
  }

  /** Format the briefing into a text block the new lead can consume */
  formatBriefing(briefing: ProjectBriefing): string {
    const lines: string[] = [
      `# Project Briefing: ${briefing.project.name}`,
      '',
      briefing.project.description ? `**Description:** ${briefing.project.description}` : '',
      briefing.project.cwd ? `**Working directory:** ${briefing.project.cwd}` : '',
      '',
      `## History`,
      `This project has had ${briefing.sessions.length} prior session(s).`,
      '',
      `## Task Summary`,
      `- Total: ${briefing.taskSummary.total}`,
      `- Done: ${briefing.taskSummary.done}`,
      `- Failed: ${briefing.taskSummary.failed}`,
      `- Remaining: ${briefing.taskSummary.pending}`,
    ];

    if (briefing.recentDecisions.length > 0) {
      lines.push('', '## Key Decisions');
      for (const d of briefing.recentDecisions.slice(0, 10)) {
        lines.push(`- **${d.title}** (${d.status}): ${d.rationale}`);
      }
    }

    if (briefing.memories.length > 0) {
      lines.push('', '## Team Knowledge');
      for (const m of briefing.memories) {
        lines.push(`- **${m.key}**: ${m.value}`);
      }
    }

    return lines.filter(l => l !== undefined).join('\n');
  }

  /** Get sessions that can be resumed (have a Copilot sessionId and are no longer active) */
  getResumableSessions(): (ProjectSession & { projectName: string })[] {
    const rows = this.db.drizzle
      .select({
        id: projectSessions.id,
        projectId: projectSessions.projectId,
        leadId: projectSessions.leadId,
        sessionId: projectSessions.sessionId,
        role: projectSessions.role,
        task: projectSessions.task,
        status: projectSessions.status,
        startedAt: projectSessions.startedAt,
        endedAt: projectSessions.endedAt,
        projectName: projects.name,
      })
      .from(projectSessions)
      .innerJoin(projects, eq(projectSessions.projectId, projects.id))
      .where(
        and(
          isNotNull(projectSessions.sessionId),
          ne(projectSessions.status, 'active'),
        ),
      )
      .orderBy(desc(projectSessions.startedAt))
      .all();

    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      leadId: r.leadId,
      sessionId: r.sessionId,
      role: r.role ?? 'lead',
      task: r.task,
      status: r.status ?? 'completed',
      startedAt: r.startedAt ?? new Date().toISOString(),
      endedAt: r.endedAt,
      projectName: r.projectName,
    }));
  }

  /** Get a single session by its row ID */
  getSessionById(sessionRowId: number): ProjectSession | undefined {
    return this.db.drizzle
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.id, sessionRowId))
      .get() as ProjectSession | undefined;
  }

  /** Get a single session by its Copilot session ID */
  getSessionByCopilotId(copilotSessionId: string): ProjectSession | undefined {
    return this.db.drizzle
      .select()
      .from(projectSessions)
      .where(eq(projectSessions.sessionId, copilotSessionId))
      .get() as ProjectSession | undefined;
  }

  /** Atomically claim a session for resume — returns true if this caller won the race */
  claimSessionForResume(sessionRowId: number): boolean {
    const result = this.db.drizzle
      .update(projectSessions)
      .set({ status: 'resuming' })
      .where(
        and(
          eq(projectSessions.id, sessionRowId),
          ne(projectSessions.status, 'active'),
          ne(projectSessions.status, 'resuming'),
        ),
      )
      .run();
    return result.changes > 0;
  }

  /**
   * Reactivate a previously-claimed session row instead of inserting a new one.
   * INVARIANT: leadId is NEVER updated — session ID + agent ID are a permanent pair.
   * The caller must spawn the new agent with the same ID as the original lead.
   */
  reactivateSession(sessionRowId: number, task?: string, role?: string): void {
    this.db.drizzle.update(projectSessions).set({
      task: task ?? null,
      role: role ?? 'lead',
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
    }).where(eq(projectSessions.id, sessionRowId)).run();

    // Touch project updatedAt
    const session = this.getSessionById(sessionRowId);
    if (session) {
      this.db.drizzle.update(projects).set({ updatedAt: new Date().toISOString() }).where(eq(projects.id, session.projectId)).run();
    }
  }

  /**
   * Get the model config for a project.
   * Returns the stored config merged over defaults — stored values take precedence.
   * Results are cached in-memory; cache is invalidated on setModelConfig().
   */
  getModelConfig(projectId: string): { config: ProjectModelConfig; defaults: ProjectModelConfig } {
    const cached = this.modelConfigCache.get(projectId);
    if (cached) return cached;

    const row = this.db.drizzle.select({ modelConfig: projects.modelConfig })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    let stored: ProjectModelConfig = {};
    if (row?.modelConfig) {
      try { stored = JSON.parse(row.modelConfig); } catch { stored = {}; }
    }
    // Merge: stored overrides defaults per-role
    const merged: ProjectModelConfig = { ...DEFAULT_MODEL_CONFIG, ...stored };
    const result = { config: merged, defaults: DEFAULT_MODEL_CONFIG };
    this.modelConfigCache.set(projectId, result);
    return result;
  }

  /**
   * Set the model config for a project.
   * Only stores the roles that differ from defaults (sparse storage).
   * Invalidates the in-memory cache for this project.
   */
  setModelConfig(projectId: string, config: ProjectModelConfig): void {
    const json = JSON.stringify(config);
    this.db.drizzle.update(projects).set({
      modelConfig: json,
      updatedAt: new Date().toISOString(),
    }).where(eq(projects.id, projectId)).run();
    this.modelConfigCache.delete(projectId);
  }

  /** Clear the entire model config cache (useful for testing). */
  clearModelConfigCache(): void {
    this.modelConfigCache.clear();
  }

  /** Delete a project and all associated sessions */
  delete(id: string): boolean {
    const project = this.get(id);
    if (!project) return false;
    this.db.drizzle.delete(projectSessions).where(eq(projectSessions.projectId, id)).run();
    this.db.drizzle.delete(projects).where(eq(projects.id, id)).run();
    return true;
  }

  /** Get the lead ID from the most recent session of a project */
  getLastLeadId(projectId: string): string | undefined {
    const sessions = this.getSessions(projectId);
    return sessions[0]?.leadId;
  }

  /**
   * Reconcile stale session states on server startup.
   * After a crash/restart, sessions may be stuck as 'active' or 'resuming'
   * with no running agent. This marks them as 'stopped' so resume works.
   *
   * @param isAgentAlive - callback to check if an agent is actually running
   * @returns count of sessions reconciled
   */
  reconcileStaleSessions(isAgentAlive: (leadId: string) => boolean): number {
    const now = new Date().toISOString();
    // Find all sessions that claim to be active or resuming
    const staleCandidates = this.db.drizzle.select().from(projectSessions)
      .where(sql`${projectSessions.status} IN ('active', 'resuming')`)
      .all() as ProjectSession[];

    let reconciled = 0;
    for (const session of staleCandidates) {
      if (!isAgentAlive(session.leadId)) {
        this.db.drizzle.update(projectSessions).set({
          status: 'stopped',
          endedAt: now,
        }).where(eq(projectSessions.id, session.id)).run();
        reconciled++;
      }
    }
    return reconciled;
  }
}
