import { Router } from 'express';
import type { AgentManager } from './agents/AgentManager.js';
import type { TaskQueue } from './tasks/TaskQueue.js';
import type { RoleRegistry } from './agents/RoleRegistry.js';
import type { ServerConfig } from './config.js';
import { updateConfig } from './config.js';
import type { Database } from './db/database.js';
import type { FileLockRegistry } from './coordination/FileLockRegistry.js';
import type { ActivityLedger, ActionType } from './coordination/ActivityLedger.js';
import { logger } from './utils/logger.js';

export function apiRouter(
  agentManager: AgentManager,
  taskQueue: TaskQueue,
  roleRegistry: RoleRegistry,
  config: ServerConfig,
  _db: Database,
  lockRegistry: FileLockRegistry,
  activityLedger: ActivityLedger,
): Router {
  const router = Router();

  // --- Agents ---
  router.get('/agents', (_req, res) => {
    res.json(agentManager.getAll().map((a) => a.toJSON()));
  });

  router.post('/agents', (req, res) => {
    const { roleId, taskId, mode, autopilot, model } = req.body;
    const role = roleRegistry.get(roleId);
    if (!role) {
      logger.warn('api', `POST /agents — unknown role: ${roleId}`);
      return res.status(400).json({ error: `Unknown role: ${roleId}` });
    }
    try {
      const agent = agentManager.spawn(role, taskId, undefined, mode, autopilot, model);
      logger.info('api', `POST /agents — spawned ${role.name} (${agent.id.slice(0, 8)})`, { model: model || role.model });
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error('api', `POST /agents — ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    const ok = agentManager.kill(req.params.id);
    res.json({ ok });
  });

  router.post('/agents/:id/restart', (req, res) => {
    const newAgent = agentManager.restart(req.params.id);
    if (!newAgent) return res.status(404).json({ error: 'Agent not found' });
    res.status(201).json(newAgent.toJSON());
  });

  router.post('/agents/:id/input', (req, res) => {
    const { text } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    logger.info('api', `Input → ${agent.role.name} (${req.params.id.slice(0, 8)}): "${text.slice(0, 80)}"`);
    agent.write(text);
    res.json({ ok: true });
  });

  router.post('/agents/:id/permission', (req, res) => {
    const { approved } = req.body;
    const ok = agentManager.resolvePermission(req.params.id, approved);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ok: true });
  });

  // --- Tasks ---
  router.get('/tasks', (_req, res) => {
    res.json(taskQueue.getAll());
  });

  router.post('/tasks', (req, res) => {
    const task = taskQueue.enqueue(req.body);
    res.status(201).json(task);
  });

  router.patch('/tasks/:id', (req, res) => {
    const task = taskQueue.update(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  router.delete('/tasks/:id', (req, res) => {
    const ok = taskQueue.remove(req.params.id);
    res.json({ ok });
  });

  // --- Roles ---
  router.get('/roles', (_req, res) => {
    res.json(roleRegistry.getAll());
  });

  router.post('/roles', (req, res) => {
    const role = roleRegistry.register(req.body);
    res.status(201).json(role);
  });

  router.delete('/roles/:id', (req, res) => {
    const ok = roleRegistry.remove(req.params.id);
    res.json({ ok });
  });

  // --- Config ---
  router.get('/config', (_req, res) => {
    res.json(config);
  });

  router.patch('/config', (req, res) => {
    const updated = updateConfig(req.body);
    agentManager.setMaxConcurrent(updated.maxConcurrentAgents);
    res.json(updated);
  });

  // --- Coordination ---
  router.get('/coordination/status', (_req, res) => {
    res.json({
      agents: agentManager.getAll().map((a) => a.toJSON()),
      locks: lockRegistry.getAll(),
      recentActivity: activityLedger.getRecent(20),
    });
  });

  router.get('/coordination/locks', (_req, res) => {
    res.json(lockRegistry.getAll());
  });

  router.post('/coordination/locks', (req, res) => {
    const { agentId, filePath, reason } = req.body;
    if (!agentId || !filePath) {
      return res.status(400).json({ error: 'agentId and filePath are required' });
    }
    const agent = agentManager.get(agentId);
    const agentRole = agent?.role?.id ?? 'unknown';
    const result = lockRegistry.acquire(agentId, agentRole, filePath, reason);
    if (result.ok) {
      res.status(201).json({ ok: true });
    } else {
      res.status(409).json({ ok: false, holder: result.holder });
    }
  });

  router.delete('/coordination/locks/:filePath', (req, res) => {
    const filePath = decodeURIComponent(req.params.filePath);
    const agentId = (req.query.agentId as string) ?? req.body?.agentId;
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    const ok = lockRegistry.release(agentId, filePath);
    res.json({ ok });
  });

  router.get('/coordination/activity', (req, res) => {
    const { agentId, type, limit, since } = req.query;
    const limitNum = limit ? Number(limit) : 50;
    if (since) {
      res.json(activityLedger.getSince(since as string));
    } else if (agentId) {
      res.json(activityLedger.getByAgent(agentId as string, limitNum));
    } else if (type) {
      res.json(activityLedger.getByType(type as ActionType, limitNum));
    } else {
      res.json(activityLedger.getRecent(limitNum));
    }
  });

  router.get('/coordination/summary', (_req, res) => {
    res.json(activityLedger.getSummary());
  });

  // --- Project Lead ---
  router.post('/lead/start', (req, res) => {
    const { task, name, model, cwd } = req.body;
    const role = roleRegistry.get('lead');
    if (!role) return res.status(500).json({ error: 'Project Lead role not found' });

    try {
      const agent = agentManager.spawn(role, task, undefined, 'acp', true, model, cwd);
      agent.projectName = name || task?.slice(0, 60) || `Project ${new Date().toLocaleDateString()}`;
      logger.info('lead', `Started project "${agent.projectName}" (${agent.id.slice(0, 8)})`, {
        task: task?.slice(0, 80),
        model: model || role.model,
        cwd: cwd || process.cwd(),
      });
      if (task) {
        setTimeout(() => {
          logger.info('lead', `Sending initial task to ${agent.id.slice(0, 8)}: "${task.slice(0, 80)}"`);
          agent.sendMessage(task);
        }, 2000);
      }
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error('lead', `Failed to start project: ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  router.get('/lead', (_req, res) => {
    const leads = agentManager.getAll()
      .filter((a) => a.role.id === 'lead')
      .map((a) => a.toJSON());
    res.json(leads);
  });

  router.get('/lead/:id', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    res.json(agent.toJSON());
  });

  router.post('/lead/:id/message', (req, res) => {
    const { text } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    logger.info('lead', `User message → ${agent.projectName || agent.id.slice(0, 8)}: "${text.slice(0, 80)}"`);
    agent.sendMessage(`[USER MESSAGE — PRIORITY] The human user says:\n${text}\n\nPlease acknowledge and respond to this message. The user is waiting for your reply.`);
    res.json({ ok: true });
  });

  router.patch('/lead/:id', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    const { cwd, projectName } = req.body;
    if (cwd !== undefined) {
      agent.cwd = cwd;
      logger.info('lead', `Updated cwd for ${agent.projectName || agent.id.slice(0, 8)}: ${cwd}`);
    }
    if (projectName !== undefined) {
      agent.projectName = projectName;
    }
    res.json(agent.toJSON());
  });

  router.get('/lead/:id/decisions', (req, res) => {
    const decisionLog = agentManager.getDecisionLog();
    res.json(decisionLog.getByAgent(req.params.id));
  });

  router.get('/lead/:id/delegations', (req, res) => {
    res.json(agentManager.getDelegations(req.params.id));
  });

  router.get('/lead/:id/progress', (req, res) => {
    const leadId = req.params.id;
    const delegations = agentManager.getDelegations(leadId);
    const children = agentManager.getAll().filter((a) => a.parentId === leadId);

    const active = delegations.filter((d) => d.status === 'active').length;
    const completed = delegations.filter((d) => d.status === 'completed').length;
    const failed = delegations.filter((d) => d.status === 'failed').length;
    const total = delegations.length;

    res.json({
      totalDelegations: total,
      active,
      completed,
      failed,
      completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      teamSize: children.length,
      teamAgents: children.map((a) => ({
        id: a.id,
        role: a.role,
        status: a.status,
        taskId: a.taskId,
      })),
      delegations,
    });
  });

  return router;
}
