import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import { KNOWN_MODEL_IDS, DEFAULT_MODEL_CONFIG, validateModelConfig, validateModelConfigShape } from '../projects/ModelConfigDefaults.js';

export function projectsRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, projectRegistry, db: _db } = ctx;
  const router = Router();

  // --- Projects (persistent) ---

  router.get('/projects', (_req, res) => {
    if (!projectRegistry) return res.json([]);
    const status = typeof _req.query.status === 'string' ? _req.query.status : undefined;
    res.json(projectRegistry.list(status));
  });

  router.get('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(404).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sessions = projectRegistry.getSessions(project.id);
    const activeLeadId = projectRegistry.getActiveLeadId(project.id);
    res.json({ ...project, sessions, activeLeadId });
  });

  router.post('/projects', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const { name, description, cwd } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const project = projectRegistry.create(name, description, cwd);
    logger.info('project', `Created project "${name}" (${project.id.slice(0, 8)})`);
    res.status(201).json(project);
  });

  router.patch('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const project = projectRegistry.get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, description, cwd, status } = req.body;
    projectRegistry.update(req.params.id, { name, description, cwd, status });
    logger.info('project', `Updated project "${project.name}" (${project.id.slice(0, 8)})`);
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

      logger.info('project', `Resumed project "${project.name}" with new lead (${agent.id.slice(0, 8)})`);

      // Auto-spawn Secretary for DAG tracking (skips if one exists)
      agentManager.autoSpawnSecretary(agent);

      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      logger.error('project', `Failed to resume project: ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  // Delete a project and all its sessions
  router.delete('/projects/:id', (req, res) => {
    if (!projectRegistry) return res.status(500).json({ error: 'Projects not available' });
    const deleted = projectRegistry.delete(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    logger.info('project', `Deleted project ${(req.params.id as string).slice(0, 8)}`);
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
    logger.info('project', `Updated model config for project "${project.name}" (${project.id.slice(0, 8)})`);
    res.json(projectRegistry.getModelConfig(req.params.id));
  });

  return router;
}
