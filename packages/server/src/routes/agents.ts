import { Router } from 'express';
import { agentPlans } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { validateBody, spawnAgentSchema, sendMessageSchema, agentInputSchema } from '../validation/schemas.js';
import { spawnLimiter, messageLimiter } from './context.js';
import type { AppContext } from './context.js';

export function agentsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, db: _db } = ctx;
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
    const { roleId, task, mode, autopilot, model, sessionId } = req.body;
    const role = roleRegistry.get(roleId);
    if (!role) {
      logger.warn('api', `POST /agents — unknown role: ${roleId}`);
      return res.status(400).json({ error: `Unknown role: ${roleId}` });
    }
    try {
      const agent = agentManager.spawn(role, task, undefined, mode, autopilot, model, sessionId || undefined);
      logger.info('api', `POST /agents — ${sessionId ? 'resumed' : 'spawned'} ${role.name} (${agent.id.slice(0, 8)})`, { model: model || role.model, sessionId });
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error('api', `POST /agents — ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    const ok = agentManager.terminate(req.params.id);
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
      logger.debug('api', 'Failed to interrupt agent', { error: (err as Error).message });
      res.json({ ok: false, error: 'Cancel not supported for this agent mode' });
    }
  });

  router.post('/agents/:id/restart', (req, res) => {
    const newAgent = agentManager.restart(req.params.id);
    if (!newAgent) return res.status(404).json({ error: 'Agent not found' });
    res.status(201).json(newAgent.toJSON());
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
    const messages = agentManager.getMessageHistory(req.params.id as string, limit);
    res.json({ agentId: req.params.id, messages });
  });

  router.post('/agents/:id/input', validateBody(agentInputSchema), (req, res) => {
    const { text } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    logger.info('api', `Input → ${agent.role.name} (${req.params.id.slice(0, 8)}): "${text.slice(0, 80)}"`);
    agent.write(text);
    res.json({ ok: true });
  });

  // Send a message to an agent: mode "queue" (default) waits for idle, "interrupt" cancels current work first
  router.post('/agents/:id/message', messageLimiter, validateBody(sendMessageSchema), async (req, res) => {
    const { text, mode = 'queue' } = req.body;
    const agent = agentManager.get(req.params.id as string);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (agent.role.id === 'lead') {
      agent.lastHumanMessageAt = new Date();
      agent.lastHumanMessageText = (text || '').slice(0, 200);
      agent.humanMessageResponded = false;
    }

    if (mode === 'interrupt') {
      agentManager.markHumanInterrupt(agent.id);
      if (text) {
        const prefix = `[USER MESSAGE] The human user says:\n`;
        const formatted = `${prefix}${text}\n\nPlease acknowledge and respond to this message.`;
        logger.info('api', `Interrupt message → ${agent.role.name} (${req.params.id.slice(0, 8)}): "${text.slice(0, 80)}"`);
        await agent.interruptWithMessage(formatted);
      } else {
        logger.info('api', `Interrupt (no message) → ${agent.role.name} (${req.params.id.slice(0, 8)})`);
        await agent.interrupt();
      }
      res.json({ ok: true, mode: 'interrupt', status: agent.status });
    } else {
      if (!text) return res.status(400).json({ error: 'text is required for queue mode' });
      const prefix = `[USER MESSAGE] The human user says:\n`;
      const formatted = `${prefix}${text}\n\nPlease acknowledge and respond to this message.`;
      logger.info('api', `Queued message → ${agent.role.name} (${req.params.id.slice(0, 8)}): "${text.slice(0, 80)}"`);
      agent.queueMessage(formatted);
      res.json({ ok: true, mode: 'queue', pending: agent.pendingMessageCount, status: agent.status });
    }
  });

  router.patch('/agents/:id', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { model } = req.body;
    if (model !== undefined) {
      agent.model = model;
      logger.info('api', `Updated model for ${agent.role.name} (${req.params.id.slice(0, 8)}): ${model}`);
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

  router.post('/agents/:id/permission', (req, res) => {
    const { approved } = req.body;
    const ok = agentManager.resolvePermission(req.params.id, approved);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ok: true });
  });

  return router;
}
