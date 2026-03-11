import { Router } from 'express';
import { agentPlans, dagTasks } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { validateBody, spawnAgentSchema, sendMessageSchema, agentInputSchema } from '../validation/schemas.js';
import { spawnLimiter, messageLimiter } from './context.js';
import type { AppContext } from './context.js';
import type { ContentBlock } from '../adapters/types.js';

/** Build ContentBlock array from text + optional attachments */
function buildContentBlocks(text: string, attachments?: Array<{ name: string; mimeType: string; data: string }>, supportsImages = true): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  for (const att of attachments ?? []) {
    if (att.mimeType.startsWith('image/')) {
      if (supportsImages) {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType });
      } else {
        blocks[0] = { type: 'text', text: (blocks[0] as { text: string }).text + `\n[Attached image: ${att.name}]` };
      }
    }
  }
  return blocks;
}

import { DiffService } from '../coordination/files/DiffService.js';

export function agentsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, db: _db, lockRegistry, decisionLog, activityLedger } = ctx;
  const diffService = lockRegistry ? new DiffService(lockRegistry, process.cwd()) : null;
  const router = Router();

  // --- Agents ---
  router.get('/agents', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    const agents = projectId
      ? agentManager.getByProject(projectId)
      : agentManager.getAll();
    res.json(agents.map((a) => a.toJSON()));
  });

  router.post('/agents', spawnLimiter, validateBody(spawnAgentSchema), (req, res) => {
    const { roleId, task, model, sessionId } = req.body;
    const role = roleRegistry.get(roleId);
    if (!role) {
      logger.warn({ module: 'api', msg: 'POST /agents — unknown role', roleId });
      return res.status(400).json({ error: `Unknown role: ${roleId}` });
    }
    try {
      // Auto-create a project for lead agents so they always have a projectId.
      // Without this, the entire delegation tree inherits undefined and
      // activities log with projectId: '', breaking scoped queries.
      let options: { projectName?: string; projectId?: string } | undefined;
      if (role.id === 'lead' && ctx.projectRegistry) {
        const projectName = `Project ${new Date().toLocaleDateString()}`;
        const project = ctx.projectRegistry.create(projectName, task ?? '');
        options = { projectName: project.name, projectId: project.id };
      }

      const agent = agentManager.spawn(role, task, undefined, model, undefined, sessionId || undefined, undefined, options);

      // Record the session so it appears in the Sessions tab
      if (role.id === 'lead' && options?.projectId && ctx.projectRegistry) {
        ctx.projectRegistry.startSession(options.projectId, agent.id, task);
      }

      logger.info({ module: 'api', msg: `POST /agents — ${sessionId ? 'resumed' : 'spawned'}`, agentId: agent.id, roleName: role.name, model: model || role.model, sessionId });
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error({ module: 'api', msg: 'POST /agents failed', err: err.message });
      res.status(429).json({ error: err.message });
    }
  });

  router.delete('/agents/:id', async (req, res) => {
    const ok = await agentManager.terminate(req.params.id);
    res.json({ ok });
  });

  router.post('/agents/:id/interrupt', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    try {
      await agent.interrupt();
      agentManager.markHumanInterrupt(agent.id);
      res.json({ ok: true });
    } catch (err) {
      logger.debug({ module: 'api', msg: 'Failed to interrupt agent', err: (err as Error).message });
      res.json({ ok: false, error: 'Cancel not supported for this agent mode' });
    }
  });

  router.post('/agents/:id/restart', async (req, res) => {
    const newAgent = await agentManager.restart(req.params.id);
    if (!newAgent) return res.status(404).json({ error: 'Agent not found' });
    res.status(201).json(newAgent.toJSON());
  });

  router.post('/agents/:id/compact', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    // Compact = restart with context handoff (same as restart but semantically different)
    const newAgent = await agentManager.restart(req.params.id);
    if (!newAgent) return res.status(500).json({ error: 'Failed to compact agent context' });
    res.status(201).json({ compacted: true, agent: newAgent.toJSON() });
  });

  router.get('/agents/:id/plan', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (agent) {
      return res.json({ agentId: agent.id, plan: agent.plan });
    }
    const row = _db.drizzle
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.agentId, req.params.id))
      .get();
    if (row) {
      return res.json({ agentId: row.agentId, plan: JSON.parse(row.planJson) });
    }
    res.status(404).json({ error: 'Agent not found' });
  });

  // Get message history for an agent (persisted across refreshes)
  router.get('/agents/:id/messages', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit) || '200', 10) || 200, 1000);
    const includeSystem = req.query.includeSystem === 'true';
    const agentId = req.params.id as string;

    // Get messages for this agent
    let messages = agentManager.getMessageHistory(agentId, limit);
    let fromPriorSession = false;

    // For resumed sessions: also include messages from prior sessions of the same project
    if (messages.length === 0 && ctx.projectRegistry) {
      const agent = agentManager.get(agentId);
      const projectId = agent?.projectId;
      if (projectId) {
        const sessions = ctx.projectRegistry.getSessions(projectId);
        // Sessions are ordered by recency (newest first from getSessions)
        const priorLeadIds = sessions
          .map(s => s.leadId)
          .filter(id => id !== agentId);
        for (const leadId of priorLeadIds) {
          const prior = agentManager.getMessageHistory(leadId, limit);
          if (prior.length > 0) {
            messages = prior;
            fromPriorSession = true;
            break;
          }
        }
      }
    }

    // Filter out system messages by default (they contain internal prompts/context)
    if (!includeSystem) {
      messages = messages.filter(m => m.sender !== 'system');
    }

    res.json({ agentId, messages, fromPriorSession });
  });

  router.post('/agents/:id/input', validateBody(agentInputSchema), (req, res) => {
    const { text } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    logger.info({ module: 'api', msg: 'Input received', agentId: req.params.id, roleName: agent.role.name, textPreview: text.slice(0, 80) });
    agent.write(text);
    res.json({ ok: true });
  });

  // Send a message to an agent: mode "queue" (default) waits for idle, "interrupt" cancels current work first
  router.post('/agents/:id/message', messageLimiter, validateBody(sendMessageSchema), async (req, res) => {
    const { text, mode = 'queue', attachments } = req.body;
    const agent = agentManager.get(req.params.id as string);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (agent.role.id === 'lead') {
      agent.lastHumanMessageAt = new Date();
      agent.lastHumanMessageText = text.slice(0, 200);
      agent.humanMessageResponded = false;
    }

    const prefix = `[USER MESSAGE] The human user says:\n`;
    const formatted = `${prefix}${text}\n\nPlease acknowledge and respond to this message. Start your response with @user on its own line.`;
    const content = buildContentBlocks(formatted, attachments, agent.supportsImages);

    if (mode === 'interrupt') {
      logger.info({ module: 'api', msg: 'Interrupt message', agentId: req.params.id, roleName: agent.role.name, textPreview: text.slice(0, 80), attachments: attachments?.length || 0 });
      agentManager.markHumanInterrupt(agent.id);
      await agent.interruptWithMessage(content);
      res.json({ ok: true, mode: 'interrupt', status: agent.status });
    } else {
      logger.info({ module: 'api', msg: 'Queued message', agentId: req.params.id, roleName: agent.role.name, textPreview: text.slice(0, 80), attachments: attachments?.length || 0 });
      agent.queueMessage(content);
      res.json({ ok: true, mode: 'queue', pending: agent.pendingMessageCount, status: agent.status });
    }
  });

  router.patch('/agents/:id', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { model } = req.body;
    if (model !== undefined) {
      agent.model = model;
      logger.info({ module: 'api', msg: 'Model updated', agentId: req.params.id, roleName: agent.role.name, model });
    }
    res.json(agent.toJSON());
  });

  // --- Pending message queue management ---
  router.get('/agents/:id/queue', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agentId: agent.id, queue: agent.getPendingMessageSummaries() });
  });

  router.delete('/agents/:id/queue/:index', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index)) return res.status(400).json({ error: 'Invalid index' });
    const ok = agent.removePendingMessage(index);
    if (!ok) return res.status(404).json({ error: 'Index out of range' });
    res.json({ ok: true, queue: agent.getPendingMessageSummaries() });
  });

  router.post('/agents/:id/queue/reorder', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { from, to } = req.body;
    if (typeof from !== 'number' || typeof to !== 'number') return res.status(400).json({ error: 'from and to must be numbers' });
    const ok = agent.reorderPendingMessage(from, to);
    if (!ok) return res.status(400).json({ error: 'Invalid indices' });
    res.json({ ok: true, queue: agent.getPendingMessageSummaries() });
  });

  router.post('/agents/:id/user-input', (req, res) => {
    const { response } = req.body;
    if (typeof response !== 'string') return res.status(400).json({ error: 'response is required' });
    const ok = agentManager.resolveUserInput(req.params.id, response);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ok: true });
  });

  // --- Focus Mode: aggregated single-agent view ---

  router.get('/agents/:id/focus', async (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const activityLimit = Math.min(Number(req.query.activityLimit) || 50, 200);
    const outputLimit = Number(req.query.outputLimit) || 8000;

    // Aggregate all agent data in parallel
    const [fileLocks, decisions, diff] = await Promise.all([
      Promise.resolve(lockRegistry.getByAgent(agent.id)),
      Promise.resolve(decisionLog.getByAgent(agent.id)),
      diffService?.getDiff(agent.id).catch(() => null) ?? Promise.resolve(null),
    ]);

    const activities = activityLedger.getByAgent(agent.id, activityLimit);

    res.json({
      agent: agent.toJSON(),
      recentOutput: agent.getRecentOutput(outputLimit),
      activities,
      decisions,
      fileLocks,
      diff,
    });
  });

  // ── GET /agents/:id/tasks — Task history for an agent ─────────────

  router.get('/agents/:id/tasks', (req, res) => {
    const agentId = req.params.id as string;
    try {
      const tasks = _db.drizzle
        .select()
        .from(dagTasks)
        .where(eq(dagTasks.assignedAgentId, agentId))
        .orderBy(desc(dagTasks.createdAt))
        .all();

      res.json(tasks.map(t => ({
        id: t.id,
        leadId: t.leadId,
        title: t.title,
        description: t.description,
        dagStatus: t.dagStatus,
        role: t.role,
        priority: t.priority,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        failureReason: t.failureReason,
      })));
    } catch (err: any) {
      logger.error({ module: 'agents', msg: 'Failed to get agent tasks', agentId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
