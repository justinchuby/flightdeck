import { Router } from 'express';
import type { AppContext } from './context.js';
import { HandoffService } from '../coordination/recovery/HandoffService.js';

export function handoffRoutes(ctx: AppContext): Router {
  const { db, lockRegistry, decisionLog } = ctx;
  const service = new HandoffService(db, lockRegistry, decisionLog);
  const router = Router();

  // GET /api/handoffs — list all handoff records (newest first)
  router.get('/handoffs', (_req, res) => {
    try {
      res.json(service.getAll());
    } catch (err) {
      res.status(500).json({ error: 'Failed to list handoffs', detail: (err as Error).message });
    }
  });

  // GET /api/handoffs/:id — get single handoff with full briefing
  router.get('/handoffs/:id', (req, res) => {
    try {
      const record = service.getById(req.params.id);
      if (!record) return res.status(404).json({ error: 'Handoff not found' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get handoff', detail: (err as Error).message });
    }
  });

  // POST /api/handoffs/generate — generate a briefing for an agent
  router.post('/handoffs/generate', (req, res) => {
    try {
      const { agentId, agentRole, agentModel, trigger, sessionId, lastMessages, currentTask, contextUsage, discoveries, sections } = req.body ?? {};
      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      if (!agentRole) return res.status(400).json({ error: 'agentRole required' });
      const validTriggers = ['crash', 'manual_termination', 'model_swap', 'role_change', 'context_compaction', 'session_end'];
      if (!validTriggers.includes(trigger)) {
        return res.status(400).json({ error: `trigger must be one of: ${validTriggers.join(', ')}` });
      }
      const record = service.generateBriefing({ agentId, agentRole, agentModel, trigger, sessionId, lastMessages, currentTask, contextUsage, discoveries, sections });
      res.status(201).json(record);
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate briefing', detail: (err as Error).message });
    }
  });

  // PUT /api/handoffs/:id/briefing — edit briefing narrative
  router.put('/handoffs/:id/briefing', (req, res) => {
    try {
      const { narrative } = req.body ?? {};
      if (!narrative) return res.status(400).json({ error: 'narrative required' });
      const record = service.updateBriefing(req.params.id, narrative);
      if (!record) return res.status(404).json({ error: 'Handoff not found or not editable' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update briefing', detail: (err as Error).message });
    }
  });

  // POST /api/handoffs/:id/deliver — deliver briefing to target agent
  router.post('/handoffs/:id/deliver', (req, res) => {
    try {
      const { targetAgentId } = req.body ?? {};
      const record = service.deliver(req.params.id, targetAgentId);
      if (!record) return res.status(404).json({ error: 'Handoff not found or already delivered' });
      res.json({ status: 'ok', record });
    } catch (err) {
      res.status(500).json({ error: 'Failed to deliver briefing', detail: (err as Error).message });
    }
  });

  // POST /api/handoffs/archive-session — archive briefings for all active agents
  router.post('/handoffs/archive-session', (req, res) => {
    try {
      const { agents, sessionId } = req.body ?? {};
      if (!Array.isArray(agents) || agents.length === 0) {
        return res.status(400).json({ error: 'agents array required' });
      }
      const records = service.archiveSession(agents, sessionId);
      res.json({ archived: records.length, records });
    } catch (err) {
      res.status(500).json({ error: 'Failed to archive session', detail: (err as Error).message });
    }
  });

  // GET /api/handoffs/:id/quality — get quality score breakdown
  router.get('/handoffs/:id/quality', (req, res) => {
    try {
      const quality = service.getQuality(req.params.id);
      if (!quality) return res.status(404).json({ error: 'Handoff not found' });
      res.json(quality);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get quality', detail: (err as Error).message });
    }
  });

  return router;
}
