import { Router } from 'express';
import type { AgentManager } from './agents/AgentManager.js';
import type { TaskQueue } from './tasks/TaskQueue.js';
import type { RoleRegistry } from './agents/RoleRegistry.js';
import type { ServerConfig } from './config.js';
import { updateConfig } from './config.js';
import type { Database } from './db/database.js';

export function apiRouter(
  agentManager: AgentManager,
  taskQueue: TaskQueue,
  roleRegistry: RoleRegistry,
  config: ServerConfig,
  _db: Database,
): Router {
  const router = Router();

  // --- Agents ---
  router.get('/agents', (_req, res) => {
    res.json(agentManager.getAll().map((a) => a.toJSON()));
  });

  router.post('/agents', (req, res) => {
    const { roleId, taskId } = req.body;
    const role = roleRegistry.get(roleId);
    if (!role) return res.status(400).json({ error: `Unknown role: ${roleId}` });
    try {
      const agent = agentManager.spawn(role, taskId);
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      res.status(429).json({ error: err.message });
    }
  });

  router.delete('/agents/:id', (req, res) => {
    const ok = agentManager.kill(req.params.id);
    res.json({ ok });
  });

  router.post('/agents/:id/input', (req, res) => {
    const { text } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    agent.write(text);
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

  return router;
}
