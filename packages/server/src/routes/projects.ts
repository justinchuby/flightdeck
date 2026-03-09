import { Router } from 'express';
import { eq, inArray, desc } from 'drizzle-orm';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, normalize, sep, extname, relative } from 'node:path';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import { KNOWN_MODEL_IDS, DEFAULT_MODEL_CONFIG, validateModelConfig, validateModelConfigShape } from '../projects/ModelConfigDefaults.js';
import { dagTasks, projectSessions, chatGroups, chatGroupMessages, chatGroupMembers, conversations, messages } from '../db/schema.js';
import type { DagTask } from '../tasks/TaskDAG.js';
import { slugify } from '../utils/projectId.js';

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

export function projectsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, projectRegistry, db: _db, storageManager } = ctx;
  const router = Router();

  // --- Projects (persistent) ---

  router.get('/projects', (_req, res) => {
    if (!projectRegistry) return res.json([]);
    const status = typeof _req.query.status === 'string' ? _req.query.status : undefined;
    const projects = projectRegistry.list(status);

    // Enrich with storage info and active agent counts
    const allAgents = agentManager.getAll();
    const enriched = projects.map((p) => {
      const activeAgents = allAgents.filter(
        (a) => a.projectId === p.id && (a.status === 'running' || a.status === 'idle')
      );
      return {
        ...p,
        activeAgentCount: activeAgents.length,
        storageMode: storageManager?.getStorageMode(p.id) ?? 'user',
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
    const activeAgents = allAgents.filter(
      (a) => a.projectId === project.id && (a.status === 'running' || a.status === 'idle')
    );
    res.json({
      ...project,
      sessions,
      activeLeadId,
      activeAgentCount: activeAgents.length,
      storageMode: storageManager?.getStorageMode(project.id) ?? 'user',
    });
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
        conflicts: result.conflicts,
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
        .filter((m) => leadIds.includes(g.leadId));
      const msgCount = _db.drizzle.select({ id: chatGroupMessages.id })
        .from(chatGroupMessages)
        .where(eq(chatGroupMessages.groupName, g.name))
        .all()
        .filter((m) => true).length; // count via length
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
    const limit = Math.min(parseInt(String(req.query.limit) || '200', 10) || 200, 1000);
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
    const trimmedName = (name as string).trim();
    const project = projectRegistry.create(trimmedName, description, cwd);
    logger.info({ module: 'project', msg: 'Project created', projectId: project.id, name: trimmedName });
    res.status(201).json(project);
  });

  router.patch('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, cwd, status } = req.body;
    projectRegistry.update(req.params.id, { name, description, cwd, status });
    logger.info({ module: 'project', msg: 'Project updated', projectId: project.id, name: project.name });
    res.json(projectRegistry.get(req.params.id));
  });

  router.get('/projects/:id/briefing', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const briefing = projectRegistry.buildBriefing(req.params.id);
    if (!briefing) return res.status(404).json({ error: 'Project not found' });
    res.json({ ...briefing, formatted: projectRegistry.formatBriefing(briefing) });
  });

  // Resume a project — starts a new lead session with project context + message history
  router.post('/projects/:id/resume', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const activeLeadId = projectRegistry.getActiveLeadId(project.id);
    if (activeLeadId) {
      const agent = agentManager.get(activeLeadId);
      if (agent && (agent.status === 'running' || agent.status === 'idle')) {
        return res.status(409).json({ error: 'Project already has an active lead', leadId: activeLeadId });
      }
    }

    const role = roleRegistry.get('lead');
    if (!role) return res.status(500).json({ error: 'Project Lead role not found' });

    const { task, model } = req.body;
    try {
      const agent = agentManager.spawn(role, task, undefined, true, model, project.cwd ?? undefined, undefined, undefined, { projectName: project.name, projectId: project.id });
      projectRegistry.startSession(project.id, agent.id, task);

      // Gather context from previous session
      const lastLeadId = projectRegistry.getLastLeadId(project.id);
      const briefing = projectRegistry.buildBriefing(project.id);

      // Send project briefing
      if (briefing && briefing.sessions.length > 1) {
        const briefingText = projectRegistry.formatBriefing(briefing);
        setTimeout(() => {
          agent.sendMessage(`[System — Project Context]\n${briefingText}\n\nContinue from where the previous session left off.`);
        }, 3000);
      }

      // Send condensed message history from previous lead so the new lead has conversation context
      if (lastLeadId && lastLeadId !== agent.id) {
        const prevMessages = agentManager.getMessageHistory(lastLeadId, 100);
        if (prevMessages.length > 0) {
          const historyLines = prevMessages.map((m) => {
            const role = m.sender === 'human' ? 'Human' : m.sender === 'agent' ? 'Lead' : 'System';
            const text = m.content.length > 500 ? m.content.slice(0, 500) + '...' : m.content;
            return `[${role}] ${text}`;
          });
          const historyText = historyLines.join('\n\n');
          setTimeout(() => {
            agent.sendMessage(`[System — Previous Session Conversation]\nHere is the conversation from the previous session for context:\n\n${historyText}`);
          }, 4000);
        }
      }

      if (task) {
        setTimeout(() => {
          agent.sendMessage(task);
        }, 5000);
      }

      logger.info({ module: 'project', msg: 'Project resumed', projectId: project.id, name: project.name, agentId: agent.id });

      // Auto-spawn Secretary for DAG tracking (skips if one exists)
      agentManager.autoSpawnSecretary(agent);

      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error({ module: 'project', msg: 'Failed to resume project', err: err.message });
      // Only expose rate-limit messages; sanitize all other errors
      const isRateLimit = err.message?.toLowerCase().includes('rate') || err.message?.toLowerCase().includes('limit');
      res.status(isRateLimit ? 429 : 500).json({
        error: isRateLimit ? err.message : 'Failed to resume project. Please try again.',
      });
    }
  });

  // Delete a project and all its sessions
  router.delete('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const deleted = projectRegistry.delete(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    logger.info({ module: 'project', msg: 'Project deleted', projectId: req.params.id });
    res.json({ ok: true });
  });

  // --- Model Config ---

  // List all known models and default config
  router.get('/models', (_req, res) => {
    res.json({
      models: KNOWN_MODEL_IDS,
      defaults: DEFAULT_MODEL_CONFIG,
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
   * Returns markdown files from .flightdeck/shared/ grouped by agent directory.
   * Each file includes its title (first # heading) and last-modified timestamp.
   */
  router.get('/projects/:id/artifacts', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.cwd) return res.status(400).json({ error: 'Project has no working directory' });

    const sharedDir = join(project.cwd, '.flightdeck', 'shared');
    const result = resolveAndValidate(project.cwd, '.flightdeck/shared');
    if (!result) {
      return res.json({ groups: [] }); // No .flightdeck/shared — not an error
    }

    try {
      const agentDirs = readdirSync(result.resolved, { withFileTypes: true })
        .filter(e => e.isDirectory());

      const groups = agentDirs.map(dir => {
        // Agent dirs follow pattern: role-agentIdPrefix (e.g. "architect-3973583e")
        const parts = dir.name.split('-');
        const agentId = parts.pop() || '';
        const role = parts.join('-') || 'agent';

        const dirPath = join(result.resolved, dir.name);
        let files: { name: string; path: string; ext: string; title: string; modifiedAt: string }[] = [];
        try {
          const entries = readdirSync(dirPath, { withFileTypes: true })
            .filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.mdx')));

          files = entries.map(e => {
            const filePath = join(dirPath, e.name);
            const relPath = relative(realpathSync(project.cwd!), filePath);
            const stat = statSync(filePath);
            let title = e.name.replace(/\.(md|mdx)$/, '');
            try {
              const content = readFileSync(filePath, 'utf-8');
              const headingMatch = content.match(/^#\s+(.+)$/m);
              if (headingMatch) title = headingMatch[1];
            } catch { /* use filename as title */ }

            return {
              name: e.name,
              path: relPath,
              ext: extname(e.name).slice(1),
              title,
              modifiedAt: stat.mtime.toISOString(),
            };
          }).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
        } catch { /* skip unreadable directories */ }

        return { agentDir: dir.name, role, agentId, files };
      }).filter(g => g.files.length > 0) // Only groups with artifacts
        .sort((a, b) => a.role.localeCompare(b.role));

      res.json({ groups });
    } catch (err: any) {
      logger.warn({ module: 'project-artifacts', msg: 'Cannot read artifacts', error: err.message, projectId: project.id });
      res.json({ groups: [] });
    }
  });

  return router;
}
