import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { ContentBlock } from '../adapters/types.js';
import { logger } from '../utils/logger.js';
import { validateBody, leadMessageSchema } from '../validation/schemas.js';
import { spawnLimiter, messageLimiter } from './context.js';
import type { AppContext } from './context.js';

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
      } else {
        // No project registry available — still ensure a valid project ID
        // so activities and agents are always scoped to a project.
        resolvedProjectId = randomUUID();
        logger.warn('lead', `ProjectRegistry unavailable — generated fallback projectId ${resolvedProjectId.slice(0, 8)}`);
      }

      const agent = agentManager.spawn(role, task, undefined, model, cwd, resumeSessionId, undefined, { projectName: resolvedProjectName, projectId: resolvedProjectId });
      logger.info('lead', `${resumeSessionId ? 'Resumed' : 'Started'} project "${agent.projectName}" (${agent.id.slice(0, 8)})`, {
        task: task?.slice(0, 80),
        model: model || role.model,
        cwd: cwd || process.cwd(),
        resumeSessionId,
      });

      // Start session and send briefing after spawn
      if (projectRegistry && resolvedProjectId) {
        projectRegistry.startSession(resolvedProjectId, agent.id, task);

        // Briefing suppressed during resume — agent picks up context from ACP session
      }

      // Task message suppressed during resume — clean slate, no system messages.
      // Use queueMessage instead of setTimeout: the message is queued while the
      // agent initializes and auto-delivered once the initial prompt completes
      // (via the prompt_complete → _drainOneMessage pipeline).
      if (!resumingProject && task) {
        logger.info('lead', `Queuing initial task for ${agent.id.slice(0, 8)}: "${task.slice(0, 80)}"`);
        agentManager.persistHumanMessage(agent.id, task);
        agent.queueMessage(task);
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

  router.get('/lead', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    const allAgents = projectId
      ? agentManager.getByProject(projectId)
      : agentManager.getAll();
    const leads = allAgents
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
    const { text, mode = 'interrupt', attachments } = req.body;
    const agent = agentManager.get(req.params.id as string);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });

    agent.lastHumanMessageAt = new Date();
    agent.lastHumanMessageText = text.slice(0, 200);
    agent.humanMessageResponded = false;

    // Persist human message to conversation history
    agentManager.persistHumanMessage(agent.id, text);

    const formatted = `[USER MESSAGE — PRIORITY] The human user says:\n${text}\n\nPlease acknowledge and respond to this message. Start your response with @user on its own line. The user is waiting for your reply.`;
    const content = buildContentBlocks(formatted, attachments, agent.supportsImages);

    if (mode === 'queue') {
      logger.info('lead', `Queued message → ${agent.projectName || agent.id.slice(0, 8)}: "${text.slice(0, 80)}"${attachments?.length ? ` +${attachments.length} attachment(s)` : ''}`);
      agent.queueMessage(content);
      res.json({ ok: true, mode: 'queue', pending: agent.pendingMessageCount });
    } else {
      logger.info('lead', `User message → ${agent.projectName || agent.id.slice(0, 8)}: "${text.slice(0, 80)}"${attachments?.length ? ` +${attachments.length} attachment(s)` : ''}`);
      agentManager.markHumanInterrupt(agent.id);
      await agent.interruptWithMessage(content);
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

  // --- Reactions ---
  router.post('/lead/:id/groups/:name/messages/:messageId/reactions', (req, res) => {
    const { emoji } = req.body;
    if (!emoji || typeof emoji !== 'string' || emoji.length > 8) return res.status(400).json({ error: 'emoji required (max 8 chars)' });
    const chatGroups = agentManager.getChatGroupRegistry();
    const success = chatGroups.addReaction(req.params.messageId, 'human', emoji);
    res.json({ success });
  });

  router.delete('/lead/:id/groups/:name/messages/:messageId/reactions/:emoji', (req, res) => {
    const chatGroups = agentManager.getChatGroupRegistry();
    const success = chatGroups.removeReaction(req.params.messageId, 'human', decodeURIComponent(req.params.emoji));
    res.json({ success });
  });

  router.get('/lead/:id/delegations', (req, res) => {
    res.json(agentManager.getDelegations(req.params.id));
  });

  router.get('/lead/:id/dag', (req, res) => {
    const agent = agentManager.get(req.params.id);
    if (!agent || agent.role.id !== 'lead') return res.status(404).json({ error: 'Lead not found' });
    const includeArchived = req.query.includeArchived === 'true';
    const status = agentManager.getTaskDAG().getStatus(agent.id, undefined, { includeArchived });
    res.json(status);
  });

  // --- Cost tracking ---
  router.get('/costs/by-agent', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      res.json(tracker.getAgentCosts(projectId));
    } catch (err) {
      logger.error({ module: 'costs', msg: 'Failed to get agent costs', err: (err as Error).message });
      res.status(500).json({ error: 'Failed to retrieve agent cost data' });
    }
  });

  router.get('/costs/by-task', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    try {
      const leadId = typeof req.query.leadId === 'string' ? req.query.leadId : undefined;
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      res.json(tracker.getTaskCosts(leadId, projectId));
    } catch (err) {
      logger.error({ module: 'costs', msg: 'Failed to get task costs', err: (err as Error).message });
      res.status(500).json({ error: 'Failed to retrieve task cost data' });
    }
  });

  router.get('/costs/agent/:agentId', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    try {
      res.json(tracker.getAgentTaskCosts(req.params.agentId));
    } catch (err) {
      logger.error({ module: 'costs', msg: 'Failed to get agent task costs', agentId: req.params.agentId, err: (err as Error).message });
      res.status(500).json({ error: 'Failed to retrieve agent task cost data' });
    }
  });

  router.get('/costs/by-project', (_req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    try {
      res.json(tracker.getProjectCosts());
    } catch (err) {
      logger.error({ module: 'costs', msg: 'Failed to get project costs', err: (err as Error).message });
      res.status(500).json({ error: 'Failed to retrieve project cost data' });
    }
  });

  router.get('/costs/by-session', (req, res) => {
    const tracker = agentManager.getCostTracker();
    if (!tracker) return res.json([]);
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (!projectId) return res.status(400).json({ error: 'projectId query parameter is required' });
    try {
      res.json(tracker.getSessionCosts(projectId));
    } catch (err) {
      logger.error({ module: 'costs', msg: 'Failed to get session costs', projectId, err: (err as Error).message });
      res.status(500).json({ error: 'Failed to retrieve session cost data' });
    }
  });

  // --- Timers ---
  router.get('/timers', (_req, res) => {
    const registry = agentManager.getTimerRegistry();
    if (!registry) return res.json([]);
    const timers = registry.getAllTimers().map(t => ({
      id: t.id,
      agentId: t.agentId,
      agentRole: t.agentRole,
      label: t.label,
      message: t.message,
      fireAt: t.fireAt,
      createdAt: t.createdAt,
      status: t.status,
      repeat: t.repeat,
      delaySeconds: t.delaySeconds,
      remainingMs: t.status === 'pending' ? Math.max(0, t.fireAt - Date.now()) : 0,
    }));
    res.json(timers);
  });

  router.post('/timers', (req, res) => {
    const registry = agentManager.getTimerRegistry();
    if (!registry) return res.status(503).json({ error: 'Timer system not available' });

    const { agentId, label, message, delaySeconds, repeat } = req.body;
    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({ error: 'agentId is required' });
    }
    if (!label || typeof label !== 'string') {
      return res.status(400).json({ error: 'label is required' });
    }
    if (typeof delaySeconds !== 'number' || delaySeconds <= 0 || delaySeconds > 86400) {
      return res.status(400).json({ error: 'delaySeconds must be a number between 1 and 86400' });
    }

    const agent = agentManager.get(agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const timer = registry.create(
      agentId,
      { label, message: message || '', delaySeconds, repeat: !!repeat },
      agent.role.id,
      agent.parentId ?? null,
    );
    if (!timer) {
      return res.status(429).json({ error: 'Timer limit reached for this agent (max 20)' });
    }

    res.status(201).json({
      id: timer.id,
      agentId: timer.agentId,
      agentRole: timer.agentRole,
      label: timer.label,
      message: timer.message,
      fireAt: timer.fireAt,
      createdAt: timer.createdAt,
      status: timer.status,
      repeat: timer.repeat,
      delaySeconds: timer.delaySeconds,
      remainingMs: Math.max(0, timer.fireAt - Date.now()),
    });
  });

  router.delete('/timers/:timerId', (req, res) => {
    const registry = agentManager.getTimerRegistry();
    if (!registry) return res.status(404).json({ error: 'Timer system not available' });

    const timer = registry.getAllTimers().find(t => t.id === req.params.timerId);
    if (!timer) return res.status(404).json({ error: 'Timer not found' });
    if (timer.status !== 'pending') return res.status(409).json({ error: `Timer already ${timer.status}` });

    // Web user (operator) can cancel any timer — use the timer's own agentId
    const ok = registry.cancel(timer.id, timer.agentId);
    if (!ok) return res.status(500).json({ error: 'Cancel failed' });
    res.json({ success: true });
  });

  router.get('/lead/:id/progress', (req, res) => {
    const leadId = req.params.id;
    const delegations = agentManager.getDelegations(leadId);

    interface ProgressAgent {
      id: string;
      role: { id: string; name: string; model?: string } | string;
      status: string;
      task?: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      contextWindowSize?: number;
      contextWindowUsed?: number;
    }

    let children: ProgressAgent[] = agentManager.getAll()
      .filter((a) => a.parentId === leadId)
      .map((a) => ({
        id: a.id,
        role: a.role,
        status: a.status,
        task: a.task,
        model: a.model || a.role.model || 'unknown',
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        contextWindowSize: a.contextWindowSize,
        contextWindowUsed: a.contextWindowUsed,
      }));

    // DB fallback: when lead is no longer in memory (historical session),
    // query agentRoster for crew members linked via metadata.parentId
    if (children.length === 0 && ctx.agentRoster) {
      const rosterAgents = ctx.agentRoster.getAllAgents();
      const rosterChildren = rosterAgents.filter((a) => {
        const meta = a.metadata ?? {};
        return meta.parentId === leadId && a.agentId !== leadId;
      });
      if (rosterChildren.length > 0) {
        // Pull real token data from CostTracker if available
        const costTracker = agentManager.getCostTracker();
        const agentCosts = costTracker?.getAgentCosts() ?? [];
        const costMap = new Map(agentCosts.map((c) => [c.agentId, c]));

        children = rosterChildren.map((a) => {
          const cost = costMap.get(a.agentId);
          return {
            id: a.agentId,
            role: typeof a.role === 'string' ? { id: a.role, name: a.role } : a.role,
            status: a.status,
            task: a.lastTaskSummary ?? undefined,
            model: a.model,
            inputTokens: cost?.totalInputTokens ?? 0,
            outputTokens: cost?.totalOutputTokens ?? 0,
            contextWindowSize: undefined,
            contextWindowUsed: undefined,
          };
        });
      }
    }

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
        model: a.model || (typeof a.role === 'object' ? a.role.model : undefined),
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
