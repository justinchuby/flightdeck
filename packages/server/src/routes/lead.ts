import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { validateBody, leadMessageSchema } from '../validation/schemas.js';
import { spawnLimiter, messageLimiter } from './context.js';
import type { AppContext } from './context.js';

export function leadRoutes(ctx: AppContext): Router {
  const { agentManager, roleRegistry, projectRegistry } = ctx;
  const router = Router();

  // --- Project Lead ---
  router.post('/lead/start', spawnLimiter, (req, res) => {
    const { task, name, model, cwd, sessionId: resumeSessionId, projectId } = req.body;
    const role = roleRegistry.get('lead');
    if (!role) return res.status(500).json({ error: 'Project Lead role not found' });

    let resolvedProjectId: string | undefined;
    let resumingProject = false;
    try {
      // Resolve project name and ID BEFORE spawn so both are included in the agent:spawned SSE event.
      // (Previously projectId was set after spawn, so agent:spawned had projectId=undefined,
      //  causing the web client's dedup filter to fail and show duplicate project entries.)
      const projectName = name || `Project ${new Date().toLocaleDateString()}`;
      let resolvedProjectName = projectName;

      if (projectRegistry) {
        let project;
        if (projectId) {
          project = projectRegistry.get(projectId);
          if (project) {
            resolvedProjectName = project.name;
            resumingProject = true;
          } else {
            logger.warn('lead', `Project ${projectId} not found — creating new`);
          }
        }
        if (!project) {
          project = projectRegistry.create(projectName, task ?? '', cwd);
        }
        resolvedProjectId = project.id;
      }

      const agent = agentManager.spawn(role, task, undefined, true, model, cwd, resumeSessionId, undefined, { projectName: resolvedProjectName, projectId: resolvedProjectId });
      logger.info('lead', `${resumeSessionId ? 'Resumed' : 'Started'} project "${agent.projectName}" (${agent.id.slice(0, 8)})`, {
        task: task?.slice(0, 80),
        model: model || role.model,
        cwd: cwd || process.cwd(),
        resumeSessionId,
      });

      // Start session and send briefing after spawn
      if (projectRegistry && resolvedProjectId) {
        projectRegistry.startSession(resolvedProjectId, agent.id, task);

        if (resumingProject) {
          const briefing = projectRegistry.buildBriefing(resolvedProjectId);
          if (briefing && briefing.sessions.length > 1) {
            const briefingText = projectRegistry.formatBriefing(briefing);
            setTimeout(() => {
              agent.sendMessage(`[System — Project Context]\n${briefingText}\n\nContinue from where the previous session left off.`);
            }, 3000);
          }
        }
      }

      if (task) {
        setTimeout(() => {
          logger.info('lead', `Sending initial task to ${agent.id.slice(0, 8)}: "${task.slice(0, 80)}"`);
          agent.sendMessage(task);
        }, 2000);
      }

      // Auto-spawn Secretary agent for DAG tracking and dependency analysis
      agentManager.autoSpawnSecretary(agent);

      res.status(201).json(agent.toJSON());
    } catch (err: any) {
      // Clean up orphan project row if spawn failed after project creation
      if (resolvedProjectId && projectRegistry && !resumingProject) {
        try { projectRegistry.delete(resolvedProjectId); } catch { /* best-effort */ }
      }
      logger.error('lead', `Failed to start project: ${err.message}`);
      res.status(429).json({ error: err.message });
    }
  });

  router.get('/lead', (_req, res) => {
    const leads = agentManager.getAll()
      .filter((a) => a.role.id === 'lead' && !a.parentId)
      .map((a) => a.toJSON());
    res.json(leads);
  });

  router.get('/lead/:id', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    res.json(agent.toJSON());
  });

  router.post('/lead/:id/message', messageLimiter, validateBody(leadMessageSchema), async (req, res) => {
    const { text, mode = 'interrupt' } = req.body;
    const agent = agentManager.get(req.params.id as string);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });

    agent.lastHumanMessageAt = new Date();
    agent.lastHumanMessageText = text.slice(0, 200);
    agent.humanMessageResponded = false;

    // Persist human message to conversation history
    agentManager.persistHumanMessage(agent.id, text);

    const formatted = `[USER MESSAGE — PRIORITY] The human user says:\n${text}\n\nPlease acknowledge and respond to this message. The user is waiting for your reply.`;

    if (mode === 'queue') {
      logger.info('lead', `Queued message → ${agent.projectName || agent.id.slice(0, 8)}: "${text.slice(0, 80)}"`);
      agent.queueMessage(formatted);
      res.json({ ok: true, mode: 'queue', pending: agent.pendingMessageCount });
    } else {
      logger.info('lead', `User message → ${agent.projectName || agent.id.slice(0, 8)}: "${text.slice(0, 80)}"`);
      agentManager.markHumanInterrupt(agent.id);
      await agent.interruptWithMessage(formatted);
      res.json({ ok: true, mode: 'interrupt' });
    }
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
    const leadId = req.params.id;
    const decisionLog = agentManager.getDecisionLog();
    const decisions = decisionLog.getByLeadId(leadId);
    // Enrich with human-readable role name from agents
    const enriched = decisions.map((d) => {
      const agent = agentManager.getAll().find((a) => a.id === d.agentId);
      return { ...d, agentRole: agent?.role?.name ?? d.agentRole };
    });
    res.json(enriched);
  });

  // --- Groups ---
  router.get('/lead/:id/groups', (req, res) => {
    const chatGroups = agentManager.getChatGroupRegistry();
    res.json(chatGroups.getGroups(req.params.id));
  });

  router.post('/lead/:id/groups', (req, res) => {
    const { name, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const chatGroups = agentManager.getChatGroupRegistry();
    const leadId = req.params.id;
    const members = Array.isArray(memberIds) ? memberIds : [];
    // Always include 'human' so the user can participate
    if (!members.includes('human')) members.push('human');
    try {
      const group = chatGroups.create(leadId, name, members);
      res.status(201).json(group);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/lead/:id/groups/:name/messages', (req, res) => {
    const chatGroups = agentManager.getChatGroupRegistry();
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(chatGroups.getMessages(req.params.name, req.params.id, limit));
  });

  router.post('/lead/:id/groups/:name/messages', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const chatGroups = agentManager.getChatGroupRegistry();
    const leadId = req.params.id;
    const groupName = req.params.name;
    if (!chatGroups.exists(groupName, leadId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    // Add human as member if not already (human can join any group)
    chatGroups.addMembers(leadId, groupName, ['human']);
    const message = chatGroups.sendMessage(groupName, leadId, 'human', 'Human User', content);
    if (!message) return res.status(500).json({ error: 'Failed to send message' });

    // Deliver to agent members and wake idle agents
    const members = chatGroups.getMembers(groupName, leadId).filter((id: string) => id !== 'human');
    for (const memberId of members) {
      const agent = agentManager.get(memberId);
      if (agent && (agent.status === 'running' || agent.status === 'idle')) {
        agent.sendMessage(`[Group "${groupName}" — Human]: ${content}`);
      }
    }

    res.status(201).json(message);
  });

  router.get('/lead/:id/delegations', (req, res) => {
    res.json(agentManager.getDelegations(req.params.id));
  });

  router.get('/lead/:id/dag', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    const status = agentManager.getTaskDAG().getStatus(agent.id);
    res.json(status);
  });

  // --- Cost tracking ---
  router.get('/costs/by-agent', (_req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    res.json(tracker.getAgentCosts());
  });

  router.get('/costs/by-task', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    const leadId = typeof req.query.leadId === 'string' ? req.query.leadId : undefined;
    res.json(tracker.getTaskCosts(leadId));
  });

  router.get('/costs/agent/:agentId', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    res.json(tracker.getAgentTaskCosts(req.params.agentId));
  });

  // --- Timers ---
  router.get('/timers', (_req, res) => {
    const registry = agentManager.getTimerRegistry();
    if (!registry) return res.json([]);
    const timers = registry.getAllTimers().map(t => ({
      id: t.id,
      agentId: t.agentId,
      label: t.label,
      message: t.message,
      fireAt: t.fireAt,
      createdAt: t.createdAt,
      fired: t.fired,
      repeat: t.repeat,
      intervalSeconds: t.intervalSeconds,
      remainingMs: t.fired ? 0 : Math.max(0, t.fireAt - Date.now()),
    }));
    res.json(timers);
  });

  router.get('/lead/:id/progress', (req, res) => {
    const leadId = req.params.id;
    const delegations = agentManager.getDelegations(leadId);
    const children = agentManager.getAll().filter((a) => a.parentId === leadId);

    const active = delegations.filter((d) => d.status === 'active').length;
    const completed = delegations.filter((d) => d.status === 'completed').length;
    const failed = delegations.filter((d) => d.status === 'failed').length;
    const total = delegations.length;

    const lead = agentManager.get(leadId);

    res.json({
      totalDelegations: total,
      active,
      completed,
      failed,
      completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      teamSize: children.length,
      leadTokens: lead ? { input: lead.inputTokens, output: lead.outputTokens } : null,
      teamAgents: children.map((a) => ({
        id: a.id,
        role: a.role,
        status: a.status,
        task: a.task,
        model: a.model || a.role.model,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        contextWindowSize: a.contextWindowSize,
        contextWindowUsed: a.contextWindowUsed,
      })),
      delegations,
    });
  });

  return router;
}
