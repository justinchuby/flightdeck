import { Router } from 'express';
import { shortAgentId } from '@flightdeck/shared';
import { eq, inArray, desc } from 'drizzle-orm';
import { readFileSync, readdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import { join, normalize, sep, extname, relative } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';
import { FLIGHTDECK_STATE_DIR } from '../config.js';
import type { AppContext } from './context.js';
import { spawnLimiter } from './context.js';
import { KNOWN_MODEL_IDS, DEFAULT_MODEL_CONFIG, validateModelConfig, validateModelConfigShape } from '../projects/ModelConfigDefaults.js';
import { getModelsByProvider } from '../adapters/ModelResolver.js';
import { dagTasks, projectSessions, chatGroups, chatGroupMessages, chatGroupMembers, conversations, messages } from '../db/schema.js';
import type { DagTask } from '../tasks/TaskDAG.js';
import { slugify } from '../utils/projectId.js';
import { parseIntBounded } from '../utils/validation.js';
import { ResumeError } from '../agents/SessionResumeManager.js';

const PROJECT_TITLE_MAX = 100;

/** Validate a project title. Returns an error string or null if valid. */
function validateProjectTitle(name: unknown): string | null {
  if (!name || typeof name !== 'string') return 'name is required';
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'name is required';
  if (trimmed.length > PROJECT_TITLE_MAX) return `name must be ${PROJECT_TITLE_MAX} characters or less`;
  // Ensure title produces a usable slug (not just the default "project" fallback)
  const slug = slugify(trimmed);
  if (slug === 'project' && !/project/i.test(trimmed)) {
    return 'name must contain at least one letter or number';
  }
  return null;
}

/** Allowed root directories for project CWD paths. */
const CWD_ALLOWED_ROOTS = [
  normalize(homedir()),
  normalize(process.cwd()),
];

/** Sensitive system paths that must never be used as project CWD. */
const CWD_BLOCKED_PATHS = process.platform === 'win32'
  ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData']
  : ['/etc', '/proc', '/sys', '/dev', '/boot', '/sbin', '/var/log', '/var/run', '/private/etc', '/private/var'];

/** Validate a project CWD path. Returns an error string or null if valid. */
function validateCwd(cwd: unknown): string | null {
  if (cwd === undefined || cwd === null) return null; // optional field
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return 'cwd must be a non-empty string';
  if (cwd.includes('\0')) return 'Invalid cwd: contains null bytes';

  const normalized = normalize(cwd);

  // Block sensitive system paths
  const normCheck = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  for (const blocked of CWD_BLOCKED_PATHS) {
    const blockedCheck = process.platform === 'win32' ? blocked.toLowerCase() : blocked;
    if (normCheck === blockedCheck || normCheck.startsWith(blockedCheck + sep)) {
      return 'Access denied: system directory';
    }
  }

  // Must be under an allowed root
  const underAllowedRoot = CWD_ALLOWED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(root + sep),
  );
  if (!underAllowedRoot) return 'Access denied: path outside allowed directories';

  // Must exist and be a directory
  try {
    if (!existsSync(normalized)) return 'Directory does not exist';
    const stat = statSync(normalized);
    if (!stat.isDirectory()) return 'Path is not a directory';
  } catch {
    return 'Cannot access path';
  }

  return null;
}

export function projectsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, projectRegistry, db: _db, storageManager, agentRoster, sessionRetro: _sessionRetro, costTracker, sessionResumeManager } = ctx;
  const router = Router();

  // --- Projects (persistent) ---

  router.get('/projects', (_req, res) => {
    if (!projectRegistry) return res.json([]);
    const status = typeof _req.query.status === 'string' ? _req.query.status : undefined;
    const projects = projectRegistry.list(status);

    // Enrich with storage info and per-status agent counts
    const allAgents = agentManager.getAll();
    const projectCosts = costTracker ? new Map(costTracker.getProjectCosts().map((c) => [c.projectId, c])) : new Map();
    const enriched = projects.map((p) => {
      const projectAgents = allAgents.filter((a) => a.projectId === p.id);
      const runningCount = projectAgents.filter((a) => a.status === 'running').length;
      const idleCount = projectAgents.filter((a) => a.status === 'idle').length;
      const failedCount = projectAgents.filter((a) => a.status === 'failed').length;
      const costs = projectCosts.get(p.id);
      return {
        ...p,
        activeAgentCount: runningCount + idleCount,
        runningAgentCount: runningCount,
        idleAgentCount: idleCount,
        failedAgentCount: failedCount,
        storageMode: storageManager?.getStorageMode(p.id) ?? 'user',
        tokenUsage: costs ? { inputTokens: costs.totalInputTokens, outputTokens: costs.totalOutputTokens, costUsd: costs.totalCostUsd } : undefined,
      };
    });
    res.json(enriched);
  });

  router.get('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sessions = projectRegistry.getSessions(project.id);
    const activeLeadId = projectRegistry.getActiveLeadId(project.id);
    const allAgents = agentManager.getAll();
    const projectAgents = allAgents.filter((a) => a.projectId === project.id);
    const runningCount = projectAgents.filter((a) => a.status === 'running').length;
    const idleCount = projectAgents.filter((a) => a.status === 'idle').length;
    const failedCount = projectAgents.filter((a) => a.status === 'failed').length;
    res.json({
      ...project,
      sessions,
      activeLeadId,
      activeAgentCount: runningCount + idleCount,
      runningAgentCount: runningCount,
      idleAgentCount: idleCount,
      failedAgentCount: failedCount,
      storageMode: storageManager?.getStorageMode(project.id) ?? 'user',
    });
  });

  // Enriched session history for SessionHistory UI component
  router.get('/projects/:id/sessions/detail', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sessions = projectRegistry.getSessions(project.id);
    const taskDAG = agentManager.getTaskDAG();
    const rosterAgents = ctx.agentRoster?.getAllAgents() ?? [];

    const detailed = sessions.map((session: any) => {
      // Agent composition: filter roster by metadata.parentId === leadId OR agentId === leadId
      const agents = rosterAgents
        .filter(a => {
          if (a.agentId === session.leadId) return true;
          const meta = a.metadata ?? {};
          return meta.parentId === session.leadId;
        })
        .map(a => ({
          role: a.role,
          model: a.model || 'unknown',
          agentId: a.agentId,
          sessionId: a.sessionId || null,
          lastTaskSummary: a.lastTaskSummary || null,
          provider: a.provider || null,
        }));

      // Task summary from DAG
      const tasks = taskDAG.getTasks(session.leadId);
      const done = tasks.filter((t: any) => t.dagStatus === 'done').length;
      const failed = tasks.filter((t: any) => t.dagStatus === 'failed').length;

      // Retro check
      const hasRetro = (ctx.sessionRetro?.getRetros(session.leadId) ?? []).length > 0;

      const startMs = new Date(session.startedAt).getTime();
      const endMs = session.endedAt ? new Date(session.endedAt).getTime() : null;

      return {
        id: session.id,
        leadId: session.leadId,
        status: session.status,
        task: session.task || null,
        startedAt: session.startedAt,
        endedAt: session.endedAt || null,
        durationMs: endMs ? endMs - startMs : null,
        agents,
        taskSummary: { total: tasks.length, done, failed },
        hasRetro,
      };
    });

    res.json(detailed);
  });

  // Historical DAG tasks for a project (from database)
  router.get('/projects/:id/dag', (req, res) => {
    if (!_db) return res.json({ tasks: [], summary: {} });
    const projectId = req.params.id;
    const includeArchived = req.query.includeArchived === 'true';
    const taskDAG = agentManager.getTaskDAG();

    // Primary: SQL-level filtering via TaskDAG
    let tasks = taskDAG.getTasksByProject(projectId, { includeArchived });

    // Fallback: older tasks without project_id — join through projectSessions
    if (tasks.length === 0) {
      const leads = _db.drizzle
        .select({ leadId: projectSessions.leadId })
        .from(projectSessions)
        .where(eq(projectSessions.projectId, projectId))
        .all();
      if (leads.length > 0) {
        const leadIds = leads.map((l) => l.leadId);
        const rawTasks = _db.drizzle.select().from(dagTasks)
          .where(inArray(dagTasks.leadId, leadIds))
          .all();
        // Map raw rows and filter archived in-memory (fallback path only)
        const mapped = rawTasks.map((t) => ({
          id: t.id, leadId: t.leadId, projectId: t.projectId ?? undefined,
          role: t.role, title: t.title || undefined, description: t.description,
          files: JSON.parse(t.files ?? '[]'), dependsOn: JSON.parse(t.dependsOn ?? '[]'),
          dagStatus: t.dagStatus ?? 'pending', priority: t.priority ?? 0,
          model: t.model || undefined, assignedAgentId: t.assignedAgentId || undefined,
          failureReason: t.failureReason || undefined,
          createdAt: t.createdAt ?? '', startedAt: t.startedAt || undefined,
          completedAt: t.completedAt || undefined, archivedAt: t.archivedAt || undefined,
        })) as DagTask[];
        tasks = includeArchived ? mapped : mapped.filter(t => !t.archivedAt);
      }
    }

    // Build summary
    const summary: Record<string, number> = {};
    for (const t of tasks) {
      summary[t.dagStatus] = (summary[t.dagStatus] ?? 0) + 1;
    }
    res.json({ tasks, fileLockMap: {}, summary });
  });

  // ── Task mutation endpoints (for Kanban board drag-and-drop) ────────

  /**
   * Transition a task's status. Used by the KanbanBoard when dragging
   * tasks between columns.
   *
   * The endpoint maps status changes to the appropriate TaskDAG method
   * and validates the transition against the state machine.
   */
  router.patch('/projects/:id/tasks/:taskId/status', (req, res) => {
    const { id: projectId, taskId } = req.params;
    const { status } = req.body as { status?: string };

    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'status is required' });
    }

    const validStatuses = ['pending', 'ready', 'running', 'done', 'failed', 'blocked', 'paused', 'skipped'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const taskDAG = agentManager.getTaskDAG();

    // Find the task to get its leadId (TaskDAG methods require leadId)
    if (!_db) return res.status(500).json({ error: 'Database unavailable' });
    const task = _db.drizzle.select().from(dagTasks)
      .where(eq(dagTasks.id, taskId))
      .get();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.projectId && task.projectId !== projectId) {
      return res.status(404).json({ error: 'Task not found in this project' });
    }

    const leadId = task.leadId;
    const currentStatus = task.dagStatus ?? 'pending';

    // Map target status → TaskDAG method
    type TransitionResult = boolean | DagTask | DagTask[] | { skippedAgentId: string } | { oldAgentId: string } | null;
    let result: TransitionResult = null;
    let errorMsg: string | null = null;

    try {
      if (status === currentStatus) {
        return res.json({ ok: true, task: formatTask(task) });
      }

      switch (status) {
        case 'running':
          // Can't manually start a task without an agent assignment
          return res.status(400).json({ error: 'Cannot manually transition to running — tasks must be assigned to an agent' });
        case 'done':
          result = taskDAG.completeTask(leadId, taskId);
          break;
        case 'failed':
          result = taskDAG.failTask(leadId, taskId) || null;
          break;
        case 'in_review':
          result = taskDAG.reviewTask(leadId, taskId) || null;
          break;
        case 'paused':
          result = taskDAG.pauseTask(leadId, taskId) || null;
          break;
        case 'ready':
          if (currentStatus === 'paused') {
            result = taskDAG.resumeTask(leadId, taskId) || null;
          } else if (currentStatus === 'failed') {
            result = taskDAG.retryTask(leadId, taskId) || null;
          } else if (currentStatus === 'pending' || currentStatus === 'blocked') {
            result = taskDAG.forceReady(leadId, taskId);
          } else if (currentStatus === 'done') {
            result = taskDAG.reopenTask(leadId, taskId);
          } else {
            errorMsg = `Cannot transition from ${currentStatus} to ready`;
          }
          break;
        case 'pending':
          if (currentStatus === 'done') {
            result = taskDAG.reopenTask(leadId, taskId);
          } else {
            errorMsg = `Cannot transition from ${currentStatus} to pending`;
          }
          break;
        case 'skipped':
          result = taskDAG.skipTask(leadId, taskId);
          break;
        case 'blocked':
          errorMsg = 'Cannot manually transition to blocked — this status is set by dependency resolution';
          break;
        default:
          errorMsg = `Unsupported target status: ${status}`;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Transition failed: ${message}` });
    }

    if (errorMsg) {
      return res.status(400).json({ error: errorMsg, currentStatus });
    }
    if (result === null || result === false) {
      return res.status(409).json({
        error: `Invalid transition from '${currentStatus}' to '${status}'`,
        currentStatus,
        targetStatus: status,
      });
    }

    // Re-fetch the updated task
    const updated = _db.drizzle.select().from(dagTasks).where(eq(dagTasks.id, taskId)).get();
    return res.json({ ok: true, task: updated ? formatTask(updated) : null });
  });

  /** Update a task's priority. Used by KanbanBoard for reordering within columns. */
  router.patch('/projects/:id/tasks/:taskId/priority', (req, res) => {
    const { id: projectId, taskId } = req.params;
    const { priority } = req.body as { priority?: number };

    if (typeof priority !== 'number' || !Number.isFinite(priority)) {
      return res.status(400).json({ error: 'priority must be a finite number' });
    }

    const taskDAG = agentManager.getTaskDAG();

    if (!_db) return res.status(500).json({ error: 'Database unavailable' });
    const task = _db.drizzle.select().from(dagTasks).where(eq(dagTasks.id, taskId)).get();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.projectId && task.projectId !== projectId) {
      return res.status(404).json({ error: 'Task not found in this project' });
    }

    const result = taskDAG.updatePriority(task.leadId, taskId, priority);
    if (!result) return res.status(500).json({ error: 'Failed to update priority' });

    const updated = _db.drizzle.select().from(dagTasks).where(eq(dagTasks.id, taskId)).get();
    return res.json({ ok: true, task: updated ? formatTask(updated) : null });
  });

  /** Create a new task from the Kanban board. */
  router.post('/projects/:id/tasks', (req, res) => {
    const { id: projectId } = req.params;
    const { title, description, role, priority, dependsOn, files } = req.body as {
      title?: string;
      description?: string;
      role?: string;
      priority?: number;
      dependsOn?: string[];
      files?: string[];
    };

    if (!role || typeof role !== 'string') {
      return res.status(400).json({ error: 'role is required' });
    }
    if (!title && !description) {
      return res.status(400).json({ error: 'title or description is required' });
    }

    // Find an active lead for this project
    if (!_db) return res.status(500).json({ error: 'Database unavailable' });
    const session = _db.drizzle.select({ leadId: projectSessions.leadId })
      .from(projectSessions)
      .where(eq(projectSessions.projectId, projectId))
      .orderBy(desc(projectSessions.startedAt))
      .limit(1)
      .get();

    if (!session) {
      return res.status(400).json({ error: 'No active session for this project. Start a session first.' });
    }

    const taskDAG = agentManager.getTaskDAG();
    const taskId = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const result = taskDAG.declareTaskBatch(session.leadId, [{
        taskId,
        role,
        title: title || undefined,
        description: description || title || '',
        priority: priority ?? 0,
        dependsOn: dependsOn ?? [],
        files: files ?? [],
      }], projectId);

      return res.status(201).json({
        ok: true,
        taskId,
        tasks: result.tasks,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Failed to create task: ${message}` });
    }
  });

  // Helper to format a DB row as a DagTask response
  function formatTask(t: typeof dagTasks.$inferSelect) {
    return {
      id: t.id,
      leadId: t.leadId,
      projectId: t.projectId ?? null,
      role: t.role,
      title: t.title,
      description: t.description,
      files: JSON.parse(t.files ?? '[]'),
      dependsOn: JSON.parse(t.dependsOn ?? '[]'),
      dagStatus: t.dagStatus ?? 'pending',
      priority: t.priority,
      assignedAgentId: t.assignedAgentId,
      failureReason: t.failureReason ?? null,
      createdAt: t.createdAt ?? '',
      startedAt: t.startedAt ?? null,
      completedAt: t.completedAt ?? null,
    };
  }

  // Historical group chats for a project (from database)
  router.get('/projects/:id/groups', (req, res) => {
    if (!_db) return res.json([]);
    const leads = _db.drizzle
      .select({ leadId: projectSessions.leadId })
      .from(projectSessions)
      .where(eq(projectSessions.projectId, req.params.id))
      .all();
    if (leads.length === 0) return res.json([]);
    const leadIds = leads.map((l) => l.leadId);

    // Fetch all groups for those leads
    const groups = _db.drizzle.select().from(chatGroups)
      .where(inArray(chatGroups.leadId, leadIds))
      .all();

    // Fetch members and message counts for each group
    const result = groups.map((g) => {
      const members = _db.drizzle.select({ agentId: chatGroupMembers.agentId })
        .from(chatGroupMembers)
        .where(eq(chatGroupMembers.groupName, g.name))
        .all()
        .filter((_m) => leadIds.includes(g.leadId));
      const msgCount = _db.drizzle.select({ id: chatGroupMessages.id })
        .from(chatGroupMessages)
        .where(eq(chatGroupMessages.groupName, g.name))
        .all()
        .filter((_m) => true).length; // count via length
      return {
        name: g.name,
        leadId: g.leadId,
        memberIds: members.map((m) => m.agentId),
        messageCount: msgCount,
        createdAt: g.createdAt,
      };
    });
    res.json(result);
  });

  // Historical group chat messages for a specific group
  router.get('/projects/:id/groups/:name/messages', (req, res) => {
    if (!_db) return res.json([]);
    const leads = _db.drizzle
      .select({ leadId: projectSessions.leadId })
      .from(projectSessions)
      .where(eq(projectSessions.projectId, req.params.id))
      .all();
    if (leads.length === 0) return res.json([]);
    const leadIds = leads.map((l) => l.leadId);
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    const messages = _db.drizzle.select().from(chatGroupMessages)
      .where(eq(chatGroupMessages.groupName, req.params.name))
      .all()
      .filter((m) => leadIds.includes(m.leadId))
      .slice(-limit);

    res.json(messages.map((m) => ({
      id: m.id,
      groupName: m.groupName,
      leadId: m.leadId,
      fromAgentId: m.fromAgentId,
      fromRole: m.fromRole,
      content: m.content,
      reactions: JSON.parse(m.reactions ?? '{}'),
      timestamp: m.timestamp,
    })));
  });

  // Historical chat messages for a project (from lead conversations)
  router.get('/projects/:id/messages', (req, res) => {
    if (!_db) return res.json({ messages: [] });
    const limit = parseIntBounded(req.query.limit, 1, 1000, 200);
    // Find all lead IDs for this project
    const leads = _db.drizzle
      .select({ leadId: projectSessions.leadId })
      .from(projectSessions)
      .where(eq(projectSessions.projectId, req.params.id))
      .all();
    if (leads.length === 0) return res.json({ messages: [] });
    const leadIds = leads.map((l) => l.leadId);
    // Query messages from all lead conversations
    const rows = _db.drizzle
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        sender: messages.sender,
        content: messages.content,
        fromRole: messages.fromRole,
        timestamp: messages.timestamp,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(inArray(conversations.agentId, leadIds))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all()
      .reverse(); // chronological order
    res.json({ messages: rows });
  });

  router.post('/projects', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const { name, description, cwd } = req.body;
    const titleError = validateProjectTitle(name);
    if (titleError) return res.status(400).json({ error: titleError });
    const cwdError = validateCwd(cwd);
    if (cwdError) return res.status(400).json({ error: cwdError });
    const trimmedName = (name as string).trim();
    const project = projectRegistry.create(trimmedName, description, cwd);
    logger.info({ module: 'project', msg: 'Project created', projectId: project.id, name: trimmedName });
    res.status(201).json(project);
  });

  // ── POST /projects/import — import project from existing .flightdeck/ directory ──
  router.post('/projects/import', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });

    const { cwd, name } = req.body;
    if (!cwd || typeof cwd !== 'string') {
      return res.status(400).json({ error: 'cwd is required (path to project directory)' });
    }

    // Validate the CWD path
    const cwdError = validateCwd(cwd);
    if (cwdError) return res.status(400).json({ error: cwdError });

    const normalizedCwd = normalize(cwd);

    // Check for .flightdeck/ directory
    const flightdeckDir = join(normalizedCwd, '.flightdeck');
    if (!existsSync(flightdeckDir)) {
      return res.status(400).json({
        error: 'No .flightdeck/ directory found. This directory may not contain a Flightdeck project.',
      });
    }

    // Check it's actually a directory
    try {
      const stat = statSync(flightdeckDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: '.flightdeck exists but is not a directory' });
      }
    } catch {
      return res.status(400).json({ error: 'Cannot access .flightdeck/ directory' });
    }

    // Check if this CWD is already registered
    const existing = projectRegistry.list().find(p => p.cwd && normalize(p.cwd) === normalizedCwd);
    if (existing) {
      return res.status(409).json({
        error: `A project already exists for this directory: "${existing.name}" (${existing.id})`,
        existingProjectId: existing.id,
      });
    }

    // Derive project name: explicit name > flightdeck.config.yaml > directory basename
    let projectName = typeof name === 'string' && name.trim() ? name.trim() : null;

    if (!projectName) {
      // Try reading flightdeck.config.yaml for a project name
      const configPath = join(normalizedCwd, 'flightdeck.config.yaml');
      if (existsSync(configPath)) {
        try {
          const configContent = readFileSync(configPath, 'utf-8');
          const nameMatch = configContent.match(/^\s*(?:name|projectName)\s*:\s*["']?(.+?)["']?\s*$/m);
          if (nameMatch) projectName = nameMatch[1].trim();
        } catch { /* ignore config read errors */ }
      }
    }

    if (!projectName) {
      // Fall back to directory basename
      const parts = normalizedCwd.replace(/[/\\]+$/, '').split(/[/\\]/);
      projectName = parts[parts.length - 1] || null;
    }

    // Validate final project name — no blank titles allowed
    const titleError = validateProjectTitle(projectName);
    if (titleError) return res.status(400).json({ error: `Could not derive project name: ${titleError}. Provide an explicit name.` });

    // Gather metadata about existing artifacts
    const organizedArtifactDir = join(FLIGHTDECK_STATE_DIR, 'artifacts');
    const hasScreenshots = existsSync(join(flightdeckDir, 'screenshots'));
    let artifactSessionCount = 0;
    if (existsSync(organizedArtifactDir)) {
      try {
        // Count session dirs across all projects (informational only)
        const projectDirs = readdirSync(organizedArtifactDir, { withFileTypes: true }).filter(e => e.isDirectory());
        for (const pd of projectDirs) {
          const sessionsDir = join(organizedArtifactDir, pd.name, 'sessions');
          if (existsSync(sessionsDir)) {
            artifactSessionCount += readdirSync(sessionsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length;
          }
        }
      } catch { /* ignore */ }
    }

    const project = projectRegistry.create(projectName!, `Imported from ${normalizedCwd}`, normalizedCwd);
    logger.info({
      module: 'project',
      msg: 'Project imported from directory',
      projectId: project.id,
      name: projectName,
      cwd: normalizedCwd,
      artifactSessionCount,
    });

    res.status(201).json({
      ...project,
      imported: {
        hasScreenshots,
        artifactSessionCount,
      },
    });
  });

  router.patch('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, cwd, status, oversightLevel } = req.body;

    // Validate CWD if provided
    const cwdError = validateCwd(cwd);
    if (cwdError) return res.status(400).json({ error: cwdError });

    // Validate oversight level if provided
    if (oversightLevel !== undefined && oversightLevel !== null &&
        !['supervised', 'balanced', 'autonomous'].includes(oversightLevel)) {
      return res.status(400).json({ error: 'Invalid oversight level. Must be supervised, balanced, or autonomous.' });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (cwd !== undefined) updates.cwd = cwd;
    if (status !== undefined) updates.status = status;

    projectRegistry.update(req.params.id, updates as Partial<Pick<typeof project, 'name' | 'description' | 'cwd' | 'status'>>);

    // Set per-project oversight level separately (null clears override)
    if (oversightLevel !== undefined) {
      projectRegistry.setOversightLevel(req.params.id, oversightLevel);
    }

    logger.info({ module: 'project', msg: 'Project updated', projectId: project.id, name: project.name });
    res.json(projectRegistry.get(req.params.id));
  });

  router.get('/projects/:id/briefing', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const briefing = projectRegistry.buildBriefing(req.params.id);
    if (!briefing) return res.status(404).json({ error: 'Project not found' });
    res.json({ ...briefing, formatted: projectRegistry.formatBriefing(briefing) });
  });

  // Resume a project — resumes a specific session (or the latest) with optional team respawn
  router.post('/projects/:id/resume', spawnLimiter, (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(String(req.params.id));
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const activeLeadId = projectRegistry.getActiveLeadId(project.id);
    if (activeLeadId) {
      const agent = agentManager.get(activeLeadId);
      if (agent && (agent.status === 'running' || agent.status === 'idle')) {
        return res.status(409).json({ error: 'Project already has an active lead', leadId: activeLeadId });
      }
    }

    const { task: requestTask, model, freshStart, resumeAll, agents: agentIds, sessionId: targetSessionId } = req.body;
    try {
      // Find session to resume: use explicit sessionId if provided, otherwise latest
      const lastSessions = projectRegistry.getSessions(project.id);
      let lastSession = null;
      if (!freshStart) {
        if (targetSessionId != null) {
          // Resume a specific session selected by the user
          lastSession = lastSessions.find((s) => s.id === Number(targetSessionId)) ?? null;
          if (!lastSession) return res.status(404).json({ error: 'Specified session not found for this project' });
        } else {
          lastSession = lastSessions.length > 0 ? lastSessions[0] : null;
        }
        if (!lastSession) {
          return res.status(404).json({ error: 'No session found to resume. Use freshStart to create a new session.' });
        }
      }

      let agent: ReturnType<typeof agentManager.spawn>;
      let task: string | undefined;
      const isResume = !!lastSession;

      if (lastSession) {
        // Resume existing session via SessionResumeManager (atomic claim, spawn, reactivate)
        if (!sessionResumeManager || !projectRegistry) {
          return res.status(500).json({ error: 'Resume not available — missing session manager' });
        }
        const result = sessionResumeManager.resumeLeadSession(
          { session: lastSession, project, task: requestTask, model },
          projectRegistry,
        );
        agent = result.agent;
        task = result.task;
      } else {
        // Fresh start (explicitly requested) — create new lead + new session
        const role = roleRegistry.get('lead');
        if (!role) return res.status(500).json({ error: 'Project Lead role not found' });
        task = requestTask;
        agent = agentManager.spawn(role, task, undefined, model, project.cwd ?? undefined, undefined, undefined, { projectName: project.name, projectId: project.id });
        projectRegistry.startSession(project.id, agent.id, task);
      }

      // Send project briefing (fresh start only — resume gets full context from
      // loadSession() which replays conversation history).
      if (!isResume) {
        const briefing = projectRegistry.buildBriefing(project.id);
        if (briefing && briefing.sessions.length > 1) {
          const briefingText = projectRegistry.formatBriefing(briefing);
          agent.queueMessage(`[System — Project Context]\n${briefingText}\n\nContinue from where the previous session left off.`);
        }
      }

      if (!isResume && task) {
        // Queued after briefing — FIFO ordering guarantees briefing is delivered
        // first. The prompt_complete → _drainOneMessage pipeline auto-delivers
        // each message when the agent finishes its current prompt.
        agent.queueMessage(task!);
      }

      logger.info({ module: 'project', msg: 'Project resumed', projectId: project.id, name: project.name, agentId: agent.id });

      // Team respawn: bring back agents from last session (unless freshStart).
      let respawnedCount = 0;
      let secretaryResumed = false;
      if (!freshStart && lastSession && (resumeAll || agentIds) && sessionResumeManager) {
        const result = sessionResumeManager.resumeChildAgents({
          leadAgent: agent,
          project,
          resumeAll,
          agentIds,
        });
        respawnedCount = result.respawnedCount;
        secretaryResumed = result.secretaryResumed;
      }

      // Auto-spawn Secretary for DAG tracking.
      // Skip during resume — all agents should start idle. The lead will
      // auto-spawn a secretary when it begins real work.
      if (!secretaryResumed && !isResume) {
        agentManager.autoSpawnSecretary(agent);
      }

      res.status(201).json({ ...agent.toJSON(), respawning: respawnedCount });
    } catch (err: any) {
      if (err instanceof ResumeError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      logger.error({ module: 'project', msg: 'Failed to resume project', err: err.message });
      // Only expose rate-limit messages; sanitize all other errors
      const isRateLimit = err.message?.toLowerCase().includes('rate') || err.message?.toLowerCase().includes('limit');
      res.status(isRateLimit ? 429 : 500).json({
        error: isRateLimit ? err.message : 'Failed to resume project. Please try again.',
      });
    }
  });

  // Stop all running agents for a project
  router.post('/projects/:id/stop', async (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const agents = agentManager.getByProject(project.id);
    let terminated = 0;
    for (const agent of agents) {
      if (agent.status === 'running' || agent.status === 'idle') {
        try {
          await agentManager.terminate(agent.id);
          terminated++;
          // Belt-and-suspenders: explicitly end session for lead agents.
          // The terminate → exit event chain should handle this, but if the
          // adapter doesn't emit 'exit' the session stays 'active' forever.
          if (agent.role.id === 'lead' && !agent.parentId) {
            projectRegistry.endSession(agent.id, 'stopped');
          }
        } catch (err: any) {
          logger.warn({ module: 'project', msg: 'Failed to terminate agent', agentId: agent.id, err: err.message });
        }
      }
    }
    logger.info({ module: 'project', msg: 'Stopped project agents', projectId: project.id, terminated, total: agents.length });
    res.json({ ok: true, terminated, total: agents.length });
  });

  // Delete a project and all its sessions (archived projects only)
  router.delete('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id as string);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'archived') {
      return res.status(400).json({ error: 'Only archived projects can be deleted' });
    }

    // Cascade: remove all roster agents for this project
    const rosterDeleted = agentRoster?.deleteByProject(req.params.id as string) ?? 0;

    const deleted = projectRegistry.delete(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    logger.info({ module: 'project', msg: 'Project deleted', projectId: req.params.id, rosterDeleted });
    res.json({ ok: true, rosterDeleted });
  });

  // --- Model Config ---

  // List all known models and default config
  router.get('/models', (_req, res) => {
    const { providerManager } = ctx;
    res.json({
      models: KNOWN_MODEL_IDS,
      defaults: DEFAULT_MODEL_CONFIG,
      modelsByProvider: getModelsByProvider(),
      activeProvider: providerManager?.getActiveProviderId() ?? 'copilot',
    });
  });

  router.get('/projects/:id/model-config', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(projectRegistry.getModelConfig(req.params.id));
  });

  router.put('/projects/:id/model-config', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { config } = req.body;
    const shapeError = validateModelConfigShape(config);
    if (shapeError) return res.status(400).json({ error: shapeError });

    const unknownIds = validateModelConfig(config);
    if (unknownIds.length > 0) {
      return res.status(400).json({ error: `Unknown model IDs: ${unknownIds.join(', ')}` });
    }

    projectRegistry.setModelConfig(req.params.id, config);
    logger.info({ module: 'project', msg: 'Model config updated', projectId: project.id, name: project.name });
    res.json(projectRegistry.getModelConfig(req.params.id));
  });

  // ── Design tab: file tree + file contents ──────────────────────

  /**
   * Resolve a path with symlink resolution and verify it stays within root.
   * Uses realpathSync to follow symlinks before comparison — prevents
   * symlink-based escapes (e.g., symlink inside project dir → /etc/).
   * Returns { resolved, rootReal } on success, or null if path escapes.
   */
  function resolveAndValidate(root: string, subPath: string): { resolved: string; rootReal: string } | null {
    try {
      const rootReal = realpathSync(root);
      const candidate = join(rootReal, subPath);
      const resolved = realpathSync(candidate);
      const normRoot = normalize(rootReal) + sep;
      const normResolved = normalize(resolved);
      if (normResolved !== normalize(rootReal) && !normResolved.startsWith(normRoot)) {
        return null;
      }
      return { resolved, rootReal };
    } catch {
      return null; // Path doesn't exist or is inaccessible
    }
  }

  /**
   * GET /projects/:id/files?path=relative/dir
   * Returns directory listing for the project's CWD.
   */
  router.get('/projects/:id/files', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.cwd) return res.status(400).json({ error: 'Project has no working directory' });

    const subPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (subPath.includes('\0')) return res.status(400).json({ error: 'Invalid path' });

    const result = resolveAndValidate(project.cwd, subPath);
    if (!result) {
      return res.status(403).json({ error: 'Path outside project directory' });
    }

    try {
      const entries = readdirSync(result.resolved, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.') || e.name === '.flightdeck')
        .map((e) => ({
          name: e.name,
          path: relative(result.rootReal, join(result.resolved, e.name)),
          type: e.isDirectory() ? 'directory' as const : 'file' as const,
          ext: e.isFile() ? extname(e.name).slice(1) : undefined,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      res.json({ path: subPath || '.', items });
    } catch (err: any) {
      logger.warn({ module: 'project-files', msg: 'Cannot read directory', error: err.message, projectId: project.id });
      res.status(400).json({ error: 'Cannot read directory' });
    }
  });

  /**
   * GET /projects/:id/file-contents?path=relative/file.md
   * Returns file content (text only, max 512 KB).
   */
  router.get('/projects/:id/file-contents', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.cwd) return res.status(400).json({ error: 'Project has no working directory' });

    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) return res.status(400).json({ error: 'path query parameter required' });
    if (filePath.includes('\0')) return res.status(400).json({ error: 'Invalid path' });

    const result = resolveAndValidate(project.cwd, filePath);
    if (!result) {
      return res.status(403).json({ error: 'Path outside project directory' });
    }

    try {
      const stat = statSync(result.resolved);
      if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
      if (stat.size > 512 * 1024) return res.status(413).json({ error: 'File too large (max 512 KB)' });

      const content = readFileSync(result.resolved, 'utf-8');
      const ext = extname(filePath).slice(1);
      res.json({ path: filePath, content, size: stat.size, ext });
    } catch (err: any) {
      logger.warn({ module: 'project-files', msg: 'Cannot read file', error: err.message, projectId: project.id });
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(400).json({ error: 'Cannot read file' });
    }
  });

  /**
   * GET /projects/:id/artifacts
   * Returns markdown files from organized storage ($FLIGHTDECK_STATE_DIR/artifacts/),
   * grouped by agent directory and session.
   */
  router.get('/projects/:id/artifacts', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    type ArtifactFile = { name: string; path: string; ext: string; title: string; modifiedAt: string };
    type ArtifactSource = 'flightdeck' | 'copilot-session';
    type ArtifactGroup = { agentDir: string; role: string; agentId: string; sessionId?: string; source: ArtifactSource; files: ArtifactFile[] };

    function readAgentDir(dirPath: string, dirName: string, basePath: string, sessionId?: string): ArtifactGroup | null {
      const parts = dirName.split('-');
      const agentId = parts.pop() || '';
      const role = parts.join('-') || 'agent';
      let files: ArtifactFile[] = [];
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
          .filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')));
        files = entries.map(e => {
          const filePath = join(dirPath, e.name);
          const relPath = relative(basePath, filePath);
          const stat = statSync(filePath);
          let title = e.name.replace(/\.(md|mdx)$/, '');
          try {
            const content = readFileSync(filePath, 'utf-8');
            const headingMatch = content.match(/^#\s+(.+)$/m);
            if (headingMatch) title = headingMatch[1];
          } catch { /* use filename as title */ }
          return { name: e.name, path: relPath, ext: extname(e.name).slice(1), title, modifiedAt: stat.mtime.toISOString() };
        }).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      } catch { /* skip unreadable */ }
      if (files.length === 0) return null;
      return { agentDir: dirName, role, agentId, sessionId, source: 'flightdeck' as ArtifactSource, files };
    }

    const groups: ArtifactGroup[] = [];

    // Read from organized storage (FLIGHTDECK_STATE_DIR/artifacts/{projectId}/sessions/)
    const organizedDir = join(FLIGHTDECK_STATE_DIR, 'artifacts', req.params.id, 'sessions');
    if (existsSync(organizedDir)) {
      try {
        const sessionDirs = readdirSync(organizedDir, { withFileTypes: true }).filter(e => e.isDirectory());
        for (const sessionDir of sessionDirs) {
          const sessionPath = join(organizedDir, sessionDir.name);
          const agentDirs = readdirSync(sessionPath, { withFileTypes: true }).filter(e => e.isDirectory());
          for (const agentDir of agentDirs) {
            const group = readAgentDir(join(sessionPath, agentDir.name), agentDir.name, organizedDir, sessionDir.name);
            if (group) groups.push(group);
          }
        }
      } catch { /* ignore read errors */ }
    }

    // Read Copilot CLI session artifacts (plan.md, checkpoints/, files/, research/)
    const copilotStateDir = join(homedir(), '.copilot', 'session-state');
    const projectAgents = agentRoster?.getByProject(req.params.id) ?? [];
    const seenSessions = new Set<string>();

    for (const agent of projectAgents) {
      if (!agent.sessionId || seenSessions.has(agent.sessionId)) continue;
      seenSessions.add(agent.sessionId);

      const sessionDir = join(copilotStateDir, agent.sessionId);
      if (!existsSync(sessionDir)) continue;

      const shortId = shortAgentId(agent.agentId);
      const agentDir = `${agent.role}-${shortId}`;
      const sessionFiles: ArtifactFile[] = [];

      // plan.md
      const planPath = join(sessionDir, 'plan.md');
      try {
        if (existsSync(planPath)) {
          const stat = statSync(planPath);
          const content = readFileSync(planPath, 'utf-8');
          const headingMatch = content.match(/^#\s+(.+)$/m);
          const title = headingMatch ? headingMatch[1] : 'Plan';
          sessionFiles.push({
            name: 'plan.md', path: 'plan.md', ext: 'md',
            title, modifiedAt: stat.mtime.toISOString(),
          });
        }
      } catch { /* skip */ }

      // Scan allowed subdirectories: checkpoints/, files/, research/
      for (const subDir of ['checkpoints', 'files', 'research']) {
        const dirPath = join(sessionDir, subDir);
        try {
          if (!existsSync(dirPath)) continue;
          const entries = readdirSync(dirPath, { withFileTypes: true })
            .filter(e => e.isFile() && !e.name.startsWith('.'));
          for (const entry of entries) {
            const filePath = join(dirPath, entry.name);
            const stat = statSync(filePath);
            let title = entry.name.replace(/\.[^.]+$/, '');
            if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
              try {
                const content = readFileSync(filePath, 'utf-8');
                const headingMatch = content.match(/^#\s+(.+)$/m);
                if (headingMatch) title = headingMatch[1];
              } catch { /* use filename */ }
            }
            sessionFiles.push({
              name: entry.name, path: `${subDir}/${entry.name}`,
              ext: extname(entry.name).slice(1), title,
              modifiedAt: stat.mtime.toISOString(),
            });
          }
        } catch { /* skip */ }
      }

      if (sessionFiles.length > 0) {
        sessionFiles.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
        groups.push({
          agentDir, role: agent.role, agentId: agent.agentId,
          sessionId: agent.sessionId, source: 'copilot-session',
          files: sessionFiles,
        });
      }
    }

    groups.sort((a, b) => a.role.localeCompare(b.role));
    res.json({ groups, artifactBasePath: organizedDir });
  });

  /**
   * GET /projects/:id/artifact-contents?path=<sessionId>/<role>-<shortId>/file.md
   * Returns file content from organized artifact storage.
   * Separate from file-contents because artifacts live outside project.cwd.
   */
  router.get('/projects/:id/artifact-contents', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath || filePath.includes('\0') || filePath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const organizedDir = join(FLIGHTDECK_STATE_DIR, 'artifacts', req.params.id, 'sessions');
    const resolved = join(organizedDir, filePath);
    // Security: ensure resolved path stays within organizedDir
    if (!normalize(resolved).startsWith(normalize(organizedDir) + sep)) {
      return res.status(403).json({ error: 'Path outside artifact directory' });
    }

    try {
      const stat = statSync(resolved);
      if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
      if (stat.size > 512 * 1024) return res.status(413).json({ error: 'File too large' });
      const content = readFileSync(resolved, 'utf-8');
      res.json({ path: filePath, content, size: stat.size, ext: extname(filePath).slice(1) });
    } catch (err: any) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(400).json({ error: 'Cannot read file' });
    }
  });

  /**
   * GET /projects/:id/session-artifact?agentId=<id>&path=plan.md
   * Returns file content from agent's Copilot CLI session directory.
   * Security: only serves files matching the allowlist (plan.md, checkpoints/, files/, research/).
   */
  router.get('/projects/:id/session-artifact', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : '';
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';

    if (!agentId || !filePath) {
      return res.status(400).json({ error: 'Missing agentId or path parameter' });
    }
    if (filePath.includes('\0') || filePath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Look up agent's sessionId from roster
    const agent = agentRoster?.getAgent(agentId);
    if (!agent?.sessionId) return res.status(404).json({ error: 'Agent session not found' });

    // Validate project scoping — agent must belong to this project
    if (agent.projectId !== req.params.id) {
      return res.status(403).json({ error: 'Agent not in this project' });
    }

    // Allowlist: only serve known safe paths
    const ALLOWED_PREFIXES = ['plan.md', 'checkpoints/', 'files/', 'research/'];
    if (!ALLOWED_PREFIXES.some(prefix => filePath === prefix || filePath.startsWith(prefix))) {
      return res.status(403).json({ error: 'File not accessible' });
    }

    const sessionDir = join(homedir(), '.copilot', 'session-state', agent.sessionId);
    const resolved = join(sessionDir, filePath);

    // Security: ensure resolved path stays within session dir
    if (!normalize(resolved).startsWith(normalize(sessionDir) + sep)) {
      return res.status(403).json({ error: 'Path outside session directory' });
    }

    try {
      const stat = statSync(resolved);
      if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
      if (stat.size > 512 * 1024) return res.status(413).json({ error: 'File too large' });
      const content = readFileSync(resolved, 'utf-8');
      res.json({ path: filePath, content, size: stat.size, ext: extname(filePath).slice(1) });
    } catch (err: any) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(400).json({ error: 'Cannot read file' });
    }
  });

  return router;
}
