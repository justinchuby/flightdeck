import { eq, desc, and, isNotNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { projects, projectSessions, dagTasks, decisions, agentMemory } from '../db/schema.js';
import { randomUUID } from 'crypto';

export interface Project {
  id: string;
  name: string;
  description: string;
  cwd: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSession {
  id: number;
  projectId: string;
  leadId: string;
  sessionId: string | null;
  task: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export interface ProjectBriefing {
  project: Project;
  sessions: ProjectSession[];
  taskSummary: { total: number; done: number; failed: number; pending: number };
  recentDecisions: Array<{ title: string; rationale: string; status: string }>;
  memories: Array<{ key: string; value: string }>;
}

export class ProjectRegistry {
  constructor(private db: Database) {}

  /** Create a new project, return its ID */
  create(name: string, description?: string, cwd?: string): Project {
    const id = randomUUID();
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

  /** Record that a lead session started for this project */
  startSession(projectId: string, leadId: string, task?: string): void {
    this.db.drizzle.insert(projectSessions).values({
      projectId,
      leadId,
      task: task ?? null,
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
  endSession(leadId: string, status: 'completed' | 'crashed' = 'completed'): void {
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
    if (allLeadIds.length > 0) {
      const placeholders = allLeadIds.map(() => '?').join(',');
      const taskRows = this.db.all<{ dag_status: string; cnt: number }>(
        `SELECT dag_status, count(*) as cnt FROM dag_tasks WHERE lead_id IN (${placeholders}) GROUP BY dag_status`,
        allLeadIds,
      );
      for (const row of taskRows) {
        const count = Number(row.cnt);
        taskSummary.total += count;
        if (row.dag_status === 'done') taskSummary.done += count;
        else if (row.dag_status === 'failed') taskSummary.failed += count;
        else taskSummary.pending += count;
      }
    }

    // Recent decisions across all sessions
    let recentDecisions: Array<{ title: string; rationale: string; status: string }> = [];
    if (allLeadIds.length > 0) {
      const placeholders = allLeadIds.map(() => '?').join(',');
      recentDecisions = this.db.all<{ title: string; rationale: string; status: string }>(
        `SELECT title, COALESCE(rationale,'') as rationale, COALESCE(status,'recorded') as status FROM decisions WHERE lead_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 20`,
        allLeadIds,
      );
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
}
