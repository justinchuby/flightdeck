import { Router } from 'express';
import { readdirSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, normalize } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { AgentManager } from './agents/AgentManager.js';
import type { RoleRegistry } from './agents/RoleRegistry.js';
import type { ServerConfig } from './config.js';
import { updateConfig, getConfig } from './config.js';
import type { Database } from './db/database.js';
import { agentPlans, messages, conversations, chatGroupMessages, dagTasks, decisions, activityLog, agentMemory } from './db/schema.js';
import { eq, like, desc, or, sql } from 'drizzle-orm';
import type { FileLockRegistry } from './coordination/FileLockRegistry.js';
import type { ActivityLedger, ActionType } from './coordination/ActivityLedger.js';
import type { DecisionLog } from './coordination/DecisionLog.js';
import type { FileDependencyGraph } from './coordination/FileDependencyGraph.js';
import type { AgentMatcher } from './coordination/AgentMatcher.js';
import type { RetryManager } from './agents/RetryManager.js';
import type { CrashForensics } from './agents/CrashForensics.js';
import type { WebhookManager } from './coordination/WebhookManager.js';
import { SearchEngine, type SearchQuery } from './coordination/SearchEngine.js';
import type { DecisionRecordStore } from './coordination/DecisionRecords.js';
import type { ModelSelector } from './agents/ModelSelector.js';
import type { TokenBudgetOptimizer } from './agents/TokenBudgetOptimizer.js';
import { ReportGenerator } from './coordination/ReportGenerator.js';
import { logger } from './utils/logger.js';
import { ParallelAnalyzer } from './tasks/ParallelAnalyzer.js';
import { writeAgentFiles } from './agents/agentFiles.js';
import { rateLimit } from './middleware/rateLimit.js';
import {
  validateBody,
  spawnAgentSchema,
  sendMessageSchema,
  leadMessageSchema,
  configPatchSchema,
  registerRoleSchema,
  agentInputSchema,
  acquireLockSchema,
} from './validation/schemas.js';

// Rate limiters for expensive operations
const spawnLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many agent spawn requests' });
const messageLimiter = rateLimit({ windowMs: 10_000, max: 50, message: 'Too many messages' });

// ── Helper: recent git commits ─────────────────────────────────────────────
function getRecentCommits(limit = 20): Array<{ hash: string; message: string }> {
  try {
    const raw = execSync(
      `git log --format="%H|%s" -${limit} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5_000 },
    ).trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      const idx = line.indexOf('|');
      return { hash: line.slice(0, idx), message: line.slice(idx + 1) };
    });
  } catch {
    return [];
  }
}

export function apiRouter(
  agentManager: AgentManager,
  roleRegistry: RoleRegistry,
  config: ServerConfig,
  _db: Database,
  lockRegistry: FileLockRegistry,
  activityLedger: ActivityLedger,
  decisionLog: DecisionLog,
  projectRegistry?: import('./projects/ProjectRegistry.js').ProjectRegistry,
  alertEngine?: import('./coordination/AlertEngine.js').AlertEngine,
  capabilityRegistry?: import('./coordination/CapabilityRegistry.js').CapabilityRegistry,
  sessionRetro?: import('./coordination/SessionRetro.js').SessionRetro,
  sessionExporter?: import('./coordination/SessionExporter.js').SessionExporter,
  eagerScheduler?: import('./tasks/EagerScheduler.js').EagerScheduler,
  fileDependencyGraph?: FileDependencyGraph,
  agentMatcher?: AgentMatcher,
  retryManager?: RetryManager,
  crashForensics?: CrashForensics,
  webhookManager?: WebhookManager,
  taskTemplateRegistry?: import('./tasks/TaskTemplates.js').TaskTemplateRegistry,
  taskDecomposer?: import('./tasks/TaskDecomposer.js').TaskDecomposer,
  searchEngine?: SearchEngine,
  performanceTracker?: import('./coordination/PerformanceScorecard.js').PerformanceTracker,
  decisionRecordStore?: DecisionRecordStore,
  coverageTracker?: import('./coordination/CoverageTracker.js').CoverageTracker,
  complexityMonitor?: import('./coordination/ComplexityMonitor.js').ComplexityMonitor,
  dependencyScanner?: import('./coordination/DependencyScanner.js').DependencyScanner,
  notificationManager?: import('./coordination/NotificationManager.js').NotificationManager,
  escalationManager?: import('./coordination/EscalationManager.js').EscalationManager,
  modelSelector?: ModelSelector,
  tokenBudgetOptimizer?: TokenBudgetOptimizer,
  meetingSummarizer?: import('./coordination/MeetingSummarizer.js').MeetingSummarizer,
  reportGenerator?: ReportGenerator,
  projectTemplateRegistry?: import('./coordination/ProjectTemplates.js').ProjectTemplateRegistry,
  knowledgeTransfer?: import('./coordination/KnowledgeTransfer.js').KnowledgeTransfer,
  eventPipeline?: import('./coordination/EventPipeline.js').EventPipeline,
): Router {
  const router = Router();

  // --- Agents ---
  router.get('/agents', (_req, res) => {
    res.json(agentManager.getAll().map((a) => a.toJSON()));
  });

  router.post('/agents', spawnLimiter, validateBody(spawnAgentSchema), (req, res) => {
    const { roleId, task, mode, autopilot, model } = req.body;
    const role = roleRegistry.get(roleId);
    if (!role) {
      logger.warn('api', `POST /agents — unknown role: ${roleId}`);
      return res.status(400).json({ error: `Unknown role: ${roleId}` });
    }
    try {
      const agent = agentManager.spawn(role, task, undefined, mode, autopilot, model);
      logger.info('api', `POST /agents — spawned ${role.name} (${agent.id.slice(0, 8)})`, { model: model || role.model });
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
  router.post('/agents/:id/message', validateBody(sendMessageSchema), async (req, res) => {
    const { text, mode = 'queue' } = req.body;
    const agent = agentManager.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (agent.role.id === 'lead') {
      agent.lastHumanMessageAt = new Date();
      agent.lastHumanMessageText = text.slice(0, 200);
      agent.humanMessageResponded = false;
    }

    const prefix = `[USER MESSAGE] The human user says:\n`;
    const formatted = `${prefix}${text}\n\nPlease acknowledge and respond to this message.`;

    if (mode === 'interrupt') {
      logger.info('api', `Interrupt message → ${agent.role.name} (${req.params.id.slice(0, 8)}): "${text.slice(0, 80)}"`);
      agentManager.markHumanInterrupt(agent.id);
      await agent.interruptWithMessage(formatted);
      res.json({ ok: true, mode: 'interrupt', status: agent.status });
    } else {
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

  // --- Roles ---
  router.get('/roles', (_req, res) => {
    res.json(roleRegistry.getAll());
  });

  router.post('/roles', validateBody(registerRoleSchema), (req, res) => {
    const role = roleRegistry.register(req.body);
    writeAgentFiles([role]);
    res.status(201).json(role);
  });

  router.delete('/roles/:id', (req, res) => {
    const ok = roleRegistry.remove(req.params.id);
    res.json({ ok });
  });

  // --- Config ---
  router.get('/config', (_req, res) => {
    res.json(getConfig());
  });

  router.patch('/config', validateBody(configPatchSchema), (req, res) => {
    const sanitized: Partial<ServerConfig> = {};
    if (req.body.maxConcurrentAgents !== undefined) {
      sanitized.maxConcurrentAgents = req.body.maxConcurrentAgents;
    }
    if (req.body.host !== undefined) {
      sanitized.host = req.body.host;
    }
    const updated = updateConfig(sanitized);
    agentManager.setMaxConcurrent(updated.maxConcurrentAgents);
    // Persist maxConcurrentAgents to SQLite so it survives server restart
    if (sanitized.maxConcurrentAgents !== undefined) {
      _db.setSetting('maxConcurrentAgents', String(updated.maxConcurrentAgents));
    }
    res.json(updated);
  });

  // --- System pause/resume ---
  router.post('/system/pause', (_req, res) => {
    agentManager.pauseSystem();
    res.json({ paused: true });
  });

  router.post('/system/resume', (_req, res) => {
    agentManager.resumeSystem();
    res.json({ paused: false });
  });

  router.get('/system/status', (_req, res) => {
    res.json({ paused: agentManager.isSystemPaused });
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

  router.post('/coordination/locks', validateBody(acquireLockSchema), (req, res) => {
    const { agentId, filePath, reason } = req.body;
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
    const filePath = req.params.filePath;
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

  // ── Helper: build timeline data from activity events ──────────────────────
  function buildTimelineData(leadId?: string, since?: string) {
    let events = since ? activityLedger.getSince(since) : activityLedger.getRecent(10_000);

    // Filter synthetic id:0 events (emitted before DB flush assigns a real ID)
    events = events.filter(e => e.id !== 0);

    // Resolve team membership for leadId filtering
    const teamAgentIds = new Set<string>();
    if (leadId) {
      teamAgentIds.add(leadId);
      for (const agent of agentManager.getAll()) {
        if (agent.parentId === leadId || agent.id === leadId) {
          teamAgentIds.add(agent.id);
        }
      }
      events = events.filter(ev => teamAgentIds.has(ev.agentId));
    }

    // Sort chronologically (oldest first)
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Build agent status segments from status_change events
    const agentSegments = new Map<string, { status: string; startAt: string; taskLabel?: string }[]>();
    const agentMeta = new Map<string, { role: string; createdAt: string; endedAt?: string; model?: string }>();
    const agentCurrentTask = new Map<string, string>();

    for (const ev of events) {
      if (!agentSegments.has(ev.agentId)) {
        agentSegments.set(ev.agentId, []);
        const liveAgent = agentManager.get(ev.agentId);
        agentMeta.set(ev.agentId, {
          role: ev.agentRole,
          createdAt: ev.timestamp,
          model: liveAgent?.model || liveAgent?.role?.model,
        });
      }
      if (ev.actionType === 'delegated' && ev.details?.childId) {
        agentCurrentTask.set(ev.details.childId, ev.summary.slice(0, 120));
      }
      if (ev.actionType === 'status_change') {
        const segments = agentSegments.get(ev.agentId)!;
        const statusMatch = ev.summary.match(/^Status:\s*(.+)$/);
        const status = statusMatch ? statusMatch[1] : ev.summary;
        if (segments.length > 0) {
          const prev = segments[segments.length - 1] as { status: string; startAt: string; endAt?: string };
          prev.endAt = ev.timestamp;
        }
        const taskLabel = agentCurrentTask.get(ev.agentId);
        segments.push({ status, startAt: ev.timestamp, ...(taskLabel ? { taskLabel } : {}) });
        if (['completed', 'failed', 'terminated'].includes(status)) {
          agentMeta.get(ev.agentId)!.endedAt = ev.timestamp;
        }
      }
    }

    // Build communication links
    const communications: { type: string; fromAgentId: string; toAgentId: string | null; summary: string; timestamp: string; groupName?: string }[] = [];
    for (const ev of events) {
      if (ev.actionType === 'delegated' && ev.details?.childId) {
        communications.push({
          type: 'delegation',
          fromAgentId: ev.agentId,
          toAgentId: ev.details.childId,
          summary: ev.summary.slice(0, 120),
          timestamp: ev.timestamp,
        });
      } else if (ev.actionType === 'message_sent' && ev.details?.toAgentId) {
        const isBroadcast = ev.details.toRole === 'broadcast' || ev.details.toAgentId === 'all';
        communications.push({
          type: isBroadcast ? 'broadcast' : 'message',
          fromAgentId: ev.agentId,
          toAgentId: ev.details.toAgentId,
          summary: ev.summary.slice(0, 120),
          timestamp: ev.timestamp,
        });
      } else if (ev.actionType === 'group_message' && ev.details?.groupName) {
        communications.push({
          type: 'group_message',
          fromAgentId: ev.agentId,
          toAgentId: null as any,
          groupName: ev.details.groupName,
          summary: ev.summary.slice(0, 120),
          timestamp: ev.timestamp,
        });
      }
    }

    // Pair lock_acquired / lock_released into lock spans
    const openLocks = new Map<string, { agentId: string; filePath: string; acquiredAt: string }>();
    const locks: { agentId: string; filePath: string; acquiredAt: string; releasedAt?: string }[] = [];
    for (const ev of events) {
      const filePath = ev.details?.filePath as string | undefined;
      if (!filePath) continue;
      const key = `${ev.agentId}::${filePath}`;
      if (ev.actionType === 'lock_acquired') {
        openLocks.set(key, { agentId: ev.agentId, filePath, acquiredAt: ev.timestamp });
      } else if (ev.actionType === 'lock_released') {
        const open = openLocks.get(key);
        if (open) {
          locks.push({ ...open, releasedAt: ev.timestamp });
          openLocks.delete(key);
        } else {
          locks.push({ agentId: ev.agentId, filePath, acquiredAt: ev.timestamp, releasedAt: ev.timestamp });
        }
      }
    }
    for (const open of openLocks.values()) {
      locks.push(open);
    }

    // Build agents array
    const agents = [...agentSegments.entries()].map(([id, segs]) => {
      const meta = agentMeta.get(id)!;
      const segments = segs.map((s, i) => ({
        status: s.status,
        startAt: s.startAt,
        endAt: (s as any).endAt ?? (i === segs.length - 1 ? (meta.endedAt ?? new Date().toISOString()) : undefined),
        ...(s.taskLabel ? { taskLabel: s.taskLabel } : {}),
      }));
      return {
        id,
        shortId: id.slice(0, 8),
        role: meta.role,
        model: meta.model,
        createdAt: meta.createdAt,
        endedAt: meta.endedAt,
        segments,
      };
    });

    // Compute time range
    const allTimestamps = events.map(e => e.timestamp);
    const timeRange = {
      start: allTimestamps[0] ?? new Date().toISOString(),
      end: allTimestamps[allTimestamps.length - 1] ?? new Date().toISOString(),
    };

    // Find project context
    const resolvedLeadId = leadId || agentManager.getAll().find(a => a.role.id === 'lead' && !a.parentId)?.id;
    const leadAgent = resolvedLeadId ? agentManager.get(resolvedLeadId) : undefined;
    const project = leadAgent ? { projectId: leadAgent.projectId, projectName: leadAgent.projectName, leadId: leadAgent.id } : undefined;

    return { agents, communications, locks, timeRange, project, teamAgentIds, ledgerVersion: activityLedger.version, dropCount: eventPipeline?.dropCount ?? 0 };
  }

  router.get('/coordination/timeline', (req, res) => {
    const since = req.query.since as string | undefined;
    const leadId = req.query.leadId as string | undefined;
    const result = buildTimelineData(leadId, since);
    const { teamAgentIds: _ignored, ...payload } = result;
    res.json(payload);
  });

  // ── SSE: real-time timeline stream ──────────────────────────────────────────
  router.get('/coordination/timeline/stream', (req, res) => {
    const leadId = req.query.leadId as string | undefined;
    if (!leadId) {
      return res.status(400).json({ error: 'leadId query parameter is required' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let eventSequence = 0;

    function generateEventId(): string {
      return `${Date.now().toString(36)}-${(eventSequence++).toString(36)}`;
    }

    function writeSSE(eventType: string, data: any, id?: string): boolean {
      if (res.writableEnded) return false;
      const eventId = id ?? generateEventId();
      try {
        res.write(`id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch {
        return false;
      }
    }

    // Handle reconnection: check header (auto-reconnect) or query param (manual reconnect)
    const lastEventId = (req.headers['last-event-id'] as string | undefined)
      || (req.query.lastEventId as string | undefined);
    if (lastEventId) {
      // Extract timestamp from ID format: "<base36-timestamp>-<sequence>"
      const dashIndex = lastEventId.indexOf('-');
      if (dashIndex > 0) {
        const timestampBase36 = lastEventId.slice(0, dashIndex);
        const ts = parseInt(timestampBase36, 36);
        if (!isNaN(ts)) {
          const reconnectTimestamp = new Date(ts).toISOString();
          const missedData = buildTimelineData(leadId, reconnectTimestamp);
          const { teamAgentIds: _ignored, ...payload } = missedData;
          writeSSE('reconnect', payload);
        }
      }
    }

    // Send initial full timeline snapshot
    const initialData = buildTimelineData(leadId);
    const { teamAgentIds, ...initialPayload } = initialData;
    writeSSE('init', initialPayload);

    // Stream incremental activity events
    const onActivity = (entry: any) => {
      // Filter synthetic id:0 events
      if (entry.id === 0 && !entry.agentId) return;
      // Only send events for this lead's team
      if (teamAgentIds.size > 0 && !teamAgentIds.has(entry.agentId)) {
        // Check if this is a new agent spawned under the lead
        const agent = agentManager.get(entry.agentId);
        if (!agent || (agent.parentId !== leadId && agent.id !== leadId)) return;
        // New team member — add to tracked set
        teamAgentIds.add(entry.agentId);
      }
      writeSSE('activity', { entry });
    };

    const onLockAcquired = (data: any) => {
      if (teamAgentIds.size > 0 && !teamAgentIds.has(data.agentId)) return;
      writeSSE('lock', { type: 'acquired', ...data });
    };

    const onLockReleased = (data: any) => {
      if (teamAgentIds.size > 0 && !teamAgentIds.has(data.agentId)) return;
      writeSSE('lock', { type: 'released', ...data });
    };

    activityLedger.on('activity', onActivity);
    lockRegistry.on('lock:acquired', onLockAcquired);
    lockRegistry.on('lock:released', onLockReleased);

    // Keepalive every 30s to prevent proxy/load-balancer timeouts
    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 30_000);

    // Cleanup on client disconnect
    req.on('close', () => {
      activityLedger.off('activity', onActivity);
      lockRegistry.off('lock:acquired', onLockAcquired);
      lockRegistry.off('lock:released', onLockReleased);
      clearInterval(keepaliveTimer);
    });
  });

  // --- Project Lead ---
  router.post('/lead/start', spawnLimiter, (req, res) => {
    const { task, name, model, cwd, sessionId: resumeSessionId, projectId } = req.body;
    const role = roleRegistry.get('lead');
    if (!role) return res.status(500).json({ error: 'Project Lead role not found' });

    try {
      // Calculate project name BEFORE spawn so it's included in the agent:spawned event
      const projectName = name || `Project ${new Date().toLocaleDateString()}`;
      const agent = agentManager.spawn(role, task, undefined, true, model, cwd, resumeSessionId, undefined, { projectName });
      logger.info('lead', `${resumeSessionId ? 'Resumed' : 'Started'} project "${agent.projectName}" (${agent.id.slice(0, 8)})`, {
        task: task?.slice(0, 80),
        model: model || role.model,
        cwd: cwd || process.cwd(),
        resumeSessionId,
      });

      // Project persistence — create or resume
      if (projectRegistry) {
        let project;
        if (projectId) {
          // Resume an existing project — keep its original name
          project = projectRegistry.get(projectId);
          if (project) {
            agent.projectName = project.name;
          } else {
            logger.warn('lead', `Project ${projectId} not found — creating new`);
          }
        }
        if (!project) {
          // Create a new project
          project = projectRegistry.create(agent.projectName!, task ?? '', cwd);
        }
        agent.projectId = project.id;
        projectRegistry.startSession(project.id, agent.id, task);

        // If resuming, send project briefing to the lead after session starts
        if (projectId && project) {
          const briefing = projectRegistry.buildBriefing(project.id);
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
      res.status(201).json(agent.toJSON());
    } catch (err: any) {
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

  // --- Decisions ---
  router.get('/decisions', (req, res) => {
    const { needs_confirmation } = req.query;
    if (needs_confirmation === 'true') {
      res.json(decisionLog.getNeedingConfirmation());
    } else {
      res.json(decisionLog.getAll());
    }
  });

  router.post('/decisions/:id/confirm', (req, res) => {
    const decisionId = req.params.id as string;
    const { reason } = req.body ?? {};
    const decision = decisionLog.confirm(decisionId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });

    // Check for pending system actions tied to this decision
    const sysAction = agentManager.consumePendingSystemAction(decisionId);
    if (sysAction && sysAction.type === 'set_max_concurrent') {
      agentManager.setMaxConcurrent(sysAction.value);
      logger.info('api', `System action executed: max concurrent agents set to ${sysAction.value} (approved by user)`);
    }

    // Notify the lead agent about the approval
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      const extra = sysAction ? ` The agent limit has been changed to ${sysAction.value}.` : '';
      const reasonText = reason ? ` User comment: "${reason}"` : '';
      lead.sendMessage(`[Decision Approved] "${decision.title}" by ${decision.agentRole} has been approved by the user.${extra}${reasonText}`);
    }
    res.json(decision);
  });

  router.post('/decisions/:id/reject', (req, res) => {
    const decisionId = req.params.id as string;
    const { reason } = req.body ?? {};
    const decision = decisionLog.reject(decisionId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });

    // Discard any pending system action
    agentManager.consumePendingSystemAction(decisionId);

    // Notify the lead agent about the rejection
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      const reasonText = reason ? ` User comment: "${reason}"` : '';
      lead.sendMessage(`[Decision Rejected] "${decision.title}" by ${decision.agentRole} has been REJECTED by the user. Please revise your approach.${reasonText}`);
    }
    res.json(decision);
  });

  router.post('/decisions/:id/respond', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const decision = decisionLog.confirm(req.params.id);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    const agent = agentManager.get(decision.agentId);
    if (agent && (agent.status === 'running' || agent.status === 'idle')) {
      agent.sendMessage(`[User feedback on decision "${decision.title}"] ${message}`);
    }
    res.json(decision);
  });

  // User feedback on a non-confirmation decision (doesn't change status, just notifies the lead)
  router.post('/decisions/:id/feedback', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const decision = decisionLog.getById(req.params.id as string);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    // Send feedback to the lead agent
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      lead.sendMessage(`[User Feedback on Decision] "${decision.title}": ${message}\n\nPlease consider this feedback. If the user disagrees with this decision, revise your approach accordingly.`);
    }
    res.json({ ok: true, decision });
  });

  // --- Search ---
  router.get('/search', (req, res) => {
    const q = (req.query.q as string ?? '').trim();
    if (!q || q.length < 2) return res.status(400).json({ error: 'query must be at least 2 characters' });
    if (q.length > 200) return res.status(400).json({ error: 'query too long (max 200 chars)' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const pattern = `%${q}%`;

    // Search agent conversation messages
    const convResults = _db.drizzle
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        sender: messages.sender,
        content: messages.content,
        timestamp: messages.timestamp,
      })
      .from(messages)
      .where(like(messages.content, pattern))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();

    // Enrich with agent info from conversations table
    const enrichedConv = convResults.map((m) => {
      const conv = _db.drizzle
        .select({ agentId: conversations.agentId })
        .from(conversations)
        .where(eq(conversations.id, m.conversationId))
        .get();
      const agent = conv ? agentManager.get(conv.agentId) : null;
      return {
        source: 'conversation' as const,
        id: m.id,
        agentId: conv?.agentId ?? null,
        agentRole: agent?.role?.name ?? null,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
      };
    });

    // Search group chat messages
    const groupResults = _db.drizzle
      .select()
      .from(chatGroupMessages)
      .where(like(chatGroupMessages.content, pattern))
      .orderBy(desc(chatGroupMessages.timestamp))
      .limit(limit)
      .all();

    const enrichedGroup = groupResults.map((m) => ({
      source: 'group' as const,
      id: m.id,
      groupName: m.groupName,
      leadId: m.leadId,
      fromAgentId: m.fromAgentId,
      fromRole: m.fromRole,
      content: m.content,
      timestamp: m.timestamp,
    }));

    // Search DAG tasks (by id or description)
    const taskResults = _db.drizzle
      .select()
      .from(dagTasks)
      .where(or(like(dagTasks.id, pattern), like(dagTasks.description, pattern)))
      .orderBy(desc(dagTasks.createdAt))
      .limit(limit)
      .all();

    const enrichedTasks = taskResults.map((t) => ({
      source: 'task' as const,
      id: t.id,
      leadId: t.leadId,
      content: t.description,
      status: t.dagStatus,
      role: t.role,
      assignedAgentId: t.assignedAgentId,
      timestamp: t.createdAt,
    }));

    // Search decisions (by title or rationale)
    const decisionResults = _db.drizzle
      .select()
      .from(decisions)
      .where(or(like(decisions.title, pattern), like(decisions.rationale, pattern)))
      .orderBy(desc(decisions.createdAt))
      .limit(limit)
      .all();

    const enrichedDecisions = decisionResults.map((d) => ({
      source: 'decision' as const,
      id: d.id,
      agentId: d.agentId,
      agentRole: d.agentRole,
      leadId: d.leadId,
      content: d.title,
      rationale: d.rationale,
      status: d.status,
      needsConfirmation: d.needsConfirmation === 1,
      timestamp: d.createdAt,
    }));

    // Search activity log (by summary)
    const activityResults = _db.drizzle
      .select()
      .from(activityLog)
      .where(like(activityLog.summary, pattern))
      .orderBy(desc(activityLog.timestamp))
      .limit(limit)
      .all();

    const enrichedActivity = activityResults.map((a) => ({
      source: 'activity' as const,
      id: a.id,
      agentId: a.agentId,
      agentRole: a.agentRole,
      content: a.summary,
      actionType: a.actionType,
      timestamp: a.timestamp,
    }));

    // Merge and sort by timestamp descending
    const combined = [...enrichedConv, ...enrichedGroup, ...enrichedTasks, ...enrichedDecisions, ...enrichedActivity]
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, limit);

    res.json({ query: q, count: combined.length, results: combined });
  });

  // --- Filesystem Browse (for folder picker) ---
  // Security: restrict to user's home directory and server cwd to prevent
  // arbitrary filesystem traversal. Rejects null bytes, resolves symlinks,
  // and blocks known sensitive system paths.

  const BROWSE_ALLOWED_ROOTS = [
    normalize(homedir()),
    normalize(process.cwd()),
  ];

  // Sensitive directories that should never be browsable
  const BROWSE_BLOCKED_PATHS = [
    '/etc', '/proc', '/sys', '/dev', '/boot', '/sbin',
    '/var/log', '/var/run', '/private/etc', '/private/var',
  ];

  function isPathAllowed(targetPath: string): { allowed: boolean; reason?: string } {
    // Block null bytes (injection vector)
    if (targetPath.includes('\0')) {
      return { allowed: false, reason: 'Invalid path: contains null bytes' };
    }

    const normalized = normalize(targetPath);

    // Block sensitive system paths
    for (const blocked of BROWSE_BLOCKED_PATHS) {
      if (normalized === blocked || normalized.startsWith(blocked + '/')) {
        return { allowed: false, reason: 'Access denied: system directory' };
      }
    }

    // Must be under an allowed root
    const underAllowedRoot = BROWSE_ALLOWED_ROOTS.some(
      (root) => normalized === root || normalized.startsWith(root + '/'),
    );
    if (!underAllowedRoot) {
      return { allowed: false, reason: 'Access denied: path outside allowed directories' };
    }

    return { allowed: true };
  }

  router.get('/browse', (req, res) => {
    const dir = typeof req.query.path === 'string' ? req.query.path : process.cwd();

    // Reject null bytes before any path operations
    if (dir.includes('\0')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    let resolved: string;
    try {
      // Resolve symlinks to get the real path (prevents symlink-based escapes)
      resolved = realpathSync(resolve(dir));
    } catch {
      res.status(400).json({ error: 'Path does not exist' });
      return;
    }

    const check = isPathAllowed(resolved);
    if (!check.allowed) {
      res.status(403).json({ error: check.reason });
      return;
    }

    try {
      const entries = readdirSync(resolved, { withFileTypes: true });
      const folders = entries
        .filter((e) => {
          if (!e.isDirectory() || e.name.startsWith('.')) return false;
          // Pre-check child path is also allowed (filters out entries that
          // would lead to blocked areas if the current dir is near a boundary)
          const childPath = join(resolved, e.name);
          return isPathAllowed(childPath).allowed;
        })
        .map((e) => ({ name: e.name, path: join(resolved, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      // Only offer parent navigation if it's within allowed roots
      const parentDir = dirname(resolved);
      const parentAllowed = isPathAllowed(parentDir).allowed ? parentDir : null;
      res.json({ current: resolved, parent: parentAllowed, folders });
    } catch (err: any) {
      res.status(400).json({ error: `Cannot read directory: ${err.message}`, current: resolved });
    }
  });

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

  // --- Database Browser ---

  router.get('/db/memory', (_req, res) => {
    const rows = _db.drizzle.select().from(agentMemory).orderBy(desc(agentMemory.createdAt)).all();
    res.json(rows);
  });

  router.delete('/db/memory/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    _db.drizzle.delete(agentMemory).where(eq(agentMemory.id, id)).run();
    res.json({ ok: true });
  });

  router.get('/db/conversations', (_req, res) => {
    const rows = _db.drizzle.select().from(conversations).orderBy(desc(conversations.createdAt)).all();
    res.json(rows);
  });

  router.get('/db/conversations/:id/messages', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit) || '100', 10) || 100, 1000);
    const rows = _db.drizzle.select().from(messages)
      .where(eq(messages.conversationId, req.params.id as string))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();
    res.json(rows.reverse());
  });

  router.delete('/db/conversations/:id', (req, res) => {
    const cid = req.params.id as string;
    _db.drizzle.delete(messages).where(eq(messages.conversationId, cid)).run();
    _db.drizzle.delete(conversations).where(eq(conversations.id, cid)).run();
    res.json({ ok: true });
  });

  router.get('/db/decisions', (_req, res) => {
    const rows = _db.drizzle.select().from(decisions).orderBy(desc(decisions.createdAt)).all();
    res.json(rows);
  });

  router.delete('/db/decisions/:id', (req, res) => {
    _db.drizzle.delete(decisions).where(eq(decisions.id, req.params.id as string)).run();
    res.json({ ok: true });
  });

  router.get('/db/activity', (_req, res) => {
    const limit = Math.min(parseInt(String(_req.query.limit) || '200', 10) || 200, 2000);
    const rows = _db.drizzle.select().from(activityLog).orderBy(desc(activityLog.timestamp)).limit(limit).all();
    res.json(rows);
  });

  router.delete('/db/activity/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    _db.drizzle.delete(activityLog).where(eq(activityLog.id, id)).run();
    res.json({ ok: true });
  });

  router.get('/db/stats', (_req, res) => {
    const memoryCount = _db.drizzle.select({ count: sql`count(*)` }).from(agentMemory).get();
    const conversationCount = _db.drizzle.select({ count: sql`count(*)` }).from(conversations).get();
    const messageCount = _db.drizzle.select({ count: sql`count(*)` }).from(messages).get();
    const decisionCount = _db.drizzle.select({ count: sql`count(*)` }).from(decisions).get();
    const activityCount = _db.drizzle.select({ count: sql`count(*)` }).from(activityLog).get();
    const dagTaskCount = _db.drizzle.select({ count: sql`count(*)` }).from(dagTasks).get();
    res.json({
      memory: Number(memoryCount?.count ?? 0),
      conversations: Number(conversationCount?.count ?? 0),
      messages: Number(messageCount?.count ?? 0),
      decisions: Number(decisionCount?.count ?? 0),
      activity: Number(activityCount?.count ?? 0),
      dagTasks: Number(dagTaskCount?.count ?? 0),
    });
  });

  // --- Proactive Alerts ---
  router.get('/coordination/alerts', (_req, res) => {
    if (!alertEngine) {
      res.json([]);
      return;
    }
    res.json(alertEngine.getAlerts());
  });

  // --- Eager Scheduler ---
  router.get('/coordination/eager-schedule', (_req, res) => {
    if (!eagerScheduler) {
      res.json([]);
      return;
    }
    res.json(eagerScheduler.getPreAssignments());
  });

  // --- Capability Registry ---
  router.get('/coordination/capabilities', (req, res) => {
    if (!capabilityRegistry) {
      res.json([]);
      return;
    }
    const leadId = req.query.leadId as string | undefined;
    if (!leadId) {
      res.status(400).json({ error: 'leadId query parameter required' });
      return;
    }
    const query = {
      file: req.query.file as string | undefined,
      technology: req.query.technology as string | undefined,
      keyword: req.query.keyword as string | undefined,
      domain: req.query.domain as string | undefined,
      availableOnly: req.query.availableOnly === 'true',
    };
    res.json(capabilityRegistry.query(leadId, query));
  });

  // --- Agent Matcher ---
  router.get('/coordination/match-agent', (req, res) => {
    if (!agentMatcher) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    const query = {
      task: (req.query.task as string) || '',
      requiredRole: req.query.role as string | undefined,
      files: req.query.file ? [req.query.file as string] : undefined,
      technologies: req.query.tech ? [req.query.tech as string] : undefined,
      keywords: req.query.keyword ? (req.query.keyword as string).split(',') : undefined,
      preferIdle: req.query.preferIdle === 'true',
    };
    res.json(agentMatcher.match(leadId, query));
  });

  // --- Session Retrospectives ---
  router.get('/coordination/retros/:leadId', (req, res) => {
    if (!sessionRetro) {
      res.json([]);
      return;
    }
    res.json(sessionRetro.getRetros(req.params.leadId));
  });

  router.post('/coordination/retros/:leadId', (req, res) => {
    if (!sessionRetro) {
      res.status(503).json({ error: 'Session retro not available' });
      return;
    }
    const data = sessionRetro.generateRetro(req.params.leadId);
    res.json(data);
  });

  // --- Session Export ---
  router.get('/export/:leadId', (req, res) => {
    if (!sessionExporter) {
      res.status(503).json({ error: 'Session exporter not available' });
      return;
    }
    try {
      const outputDir = join(process.cwd(), '.ai-crew', 'exports');
      const result = sessionExporter.export(req.params.leadId, outputDir);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- File Dependency Graph ---
  router.get('/coordination/file-impact', (req, res) => {
    if (!fileDependencyGraph) {
      res.json({ directDependents: [], transitiveDependents: [], depth: 0 });
      return;
    }
    const file = req.query.file as string;
    if (!file) {
      res.status(400).json({ error: 'file query parameter required' });
      return;
    }
    res.json(fileDependencyGraph.getImpact(file));
  });

  // --- Auto-Retry ---
  router.get('/coordination/retries', (_req, res) => {
    if (!retryManager) { res.json([]); return; }
    res.json(retryManager.getRetries());
  });

  // --- Crash Forensics ---
  router.get('/coordination/crash-reports', (req, res) => {
    if (!crashForensics) { res.json([]); return; }
    const agentId = req.query.agentId as string | undefined;
    res.json(crashForensics.getReports(agentId));
  });

  // --- Webhooks ---
  router.get('/webhooks', (_req, res) => {
    if (!webhookManager) { res.json([]); return; }
    res.json(webhookManager.getWebhooks());
  });

  router.post('/webhooks', (req, res) => {
    if (!webhookManager) { res.status(503).json({ error: 'Webhooks not available' }); return; }
    const { url, events, secret, enabled } = req.body;
    if (!url || !events?.length) { res.status(400).json({ error: 'url and events[] required' }); return; }
    const webhook = webhookManager.register({ url, events, secret, enabled: enabled ?? true });
    res.status(201).json(webhook);
  });

  router.delete('/webhooks/:id', (req, res) => {
    if (!webhookManager) { res.status(503).json({ error: 'Webhooks not available' }); return; }
    const removed = webhookManager.unregister(req.params.id);
    res.json({ removed });
  });

  router.get('/webhooks/:id/deliveries', (req, res) => {
    if (!webhookManager) { res.json([]); return; }
    res.json(webhookManager.getDeliveries(req.params.id));
  });

  // --- Task Templates ---
  router.get('/coordination/templates', (_req, res) => {
    if (!taskTemplateRegistry) { res.json([]); return; }
    res.json(taskTemplateRegistry.getAll());
  });

  router.post('/coordination/decompose', (req, res) => {
    if (!taskDecomposer) { res.status(503).json({ error: 'Task decomposer not available' }); return; }
    const { task } = req.body;
    if (!task) { res.status(400).json({ error: 'task description required' }); return; }
    res.json(taskDecomposer.decompose(task));
  });

  // --- Performance Scorecards ---
  router.get('/coordination/scorecards', (req, res) => {
    if (!performanceTracker) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    res.json(performanceTracker.getTeamScorecards(leadId));
  });

  router.get('/coordination/scorecards/:agentId', (req, res) => {
    if (!performanceTracker) { res.json(null); return; }
    res.json(performanceTracker.getScorecard(req.params.agentId));
  });

  router.get('/coordination/leaderboard', (req, res) => {
    if (!performanceTracker) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    res.json(performanceTracker.getLeaderboard(leadId));
  });

  // --- Full-text Search ---
  router.get('/search', (req, res) => {
    if (!searchEngine) { res.json([]); return; }
    const query: SearchQuery = {
      query: (req.query.q as string) || '',
      types: req.query.types ? (req.query.types as string).split(',') as any : undefined,
      agentId: req.query.agentId as string,
      leadId: req.query.leadId as string,
      since: req.query.since as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    if (!query.query) { res.status(400).json({ error: 'q parameter required' }); return; }
    res.json(searchEngine.search(query));
  });

  // --- Decision Records (ADR-style) ---
  router.get('/coordination/decisions', (req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    const filter = {
      status: req.query.status as string | undefined,
      tag: req.query.tag as string | undefined,
      since: req.query.since as string | undefined,
    };
    res.json(decisionRecordStore.getAll(filter));
  });

  router.get('/coordination/decisions/tags', (_req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    res.json(decisionRecordStore.getTags());
  });

  router.get('/coordination/decisions/search', (req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'q parameter required' }); return; }
    res.json(decisionRecordStore.search(q));
  });

  router.get('/coordination/decisions/:id', (req, res) => {
    if (!decisionRecordStore) { res.status(404).json(null); return; }
    const record = decisionRecordStore.get(req.params.id);
    if (!record) { res.status(404).json({ error: 'not found' }); return; }
    res.json(record);
  });

  // ── Code Quality endpoints ──────────────────────────────────────────

  router.get('/coordination/coverage', (_req, res) => {
    if (!coverageTracker) { res.json({ history: [], latest: null, trend: { tests: [], durations: [] } }); return; }
    res.json({
      history: coverageTracker.getHistory(),
      latest: coverageTracker.getLatest() ?? null,
      trend: coverageTracker.getTrend(),
    });
  });

  router.get('/coordination/complexity', (_req, res) => {
    if (!complexityMonitor) { res.json({ alerts: [], files: [], highComplexity: [] }); return; }
    res.json({
      alerts: complexityMonitor.getAlerts(),
      files: complexityMonitor.getFiles(),
      highComplexity: complexityMonitor.getHighComplexity(),
    });
  });

  router.get('/coordination/dependencies', (_req, res) => {
    if (!dependencyScanner) { res.json({ workspaces: {}, counts: { production: 0, dev: 0, total: 0 } }); return; }
    res.json({
      workspaces: dependencyScanner.scanWorkspaces(),
      counts: dependencyScanner.getDependencyCount(),
    });
  });

  // ── Notifications ───────────────────────────────────────────────

  router.get('/notifications', (req, res) => {
    if (!notificationManager) { res.json({ notifications: [], unreadCount: 0 }); return; }
    const unreadOnly = req.query.unreadOnly === 'true';
    const category = req.query.category as import('./coordination/NotificationManager.js').NotificationCategory | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json({
      notifications: notificationManager.getNotifications({ unreadOnly, category, limit }),
      unreadCount: notificationManager.getUnreadCount(),
    });
  });

  router.put('/notifications/read-all', (_req, res) => {
    if (!notificationManager) { res.json({ ok: true }); return; }
    notificationManager.markAllRead();
    res.json({ ok: true });
  });

  router.put('/notifications/:id/read', (req, res) => {
    if (!notificationManager) { res.status(404).json({ error: 'Notification manager not available' }); return; }
    const ok = notificationManager.markRead(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.json({ ok: true });
  });

  router.get('/notifications/preferences', (req, res) => {
    if (!notificationManager) { res.json(null); return; }
    const userId = (req.query.userId as string) || 'default';
    res.json(notificationManager.getPreferences(userId) ?? null);
  });

  router.put('/notifications/preferences', (req, res) => {
    if (!notificationManager) { res.status(503).json({ error: 'Notification manager not available' }); return; }
    const userId = (req.body.userId as string) || 'default';
    const prefs = notificationManager.setPreferences(userId, req.body);
    res.json(prefs);
  });

  // ── Escalations ─────────────────────────────────────────────────

  router.get('/coordination/escalations', (req, res) => {
    if (!escalationManager) { res.json({ active: [], all: [], rules: [] }); return; }
    const all = req.query.all === 'true';
    res.json({
      escalations: all ? escalationManager.getAll() : escalationManager.getActive(),
      rules: escalationManager.getRules(),
    });
  });

  router.put('/coordination/escalations/:id/resolve', (req, res) => {
    if (!escalationManager) { res.status(404).json({ error: 'Escalation manager not available' }); return; }
    const ok = escalationManager.resolve(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Escalation not found' }); return; }
    res.json({ ok: true });
  });

  // ── Model Selector ──────────────────────────────────────────────────

  router.get('/coordination/model-selector', (_req, res) => {
    if (!modelSelector) {
      res.json({ models: [], overrides: {} });
      return;
    }
    res.json({
      models: modelSelector.getModels(),
      overrides: modelSelector.getRoleOverrides(),
    });
  });

  // ── Token Budget Optimizer ──────────────────────────────────────────

  router.get('/coordination/token-budgets', (_req, res) => {
    if (!tokenBudgetOptimizer) {
      res.json({ budgets: [], totalBudget: 0, totalUsed: 0, utilization: 0 });
      return;
    }
    res.json({
      budgets: tokenBudgetOptimizer.getAllBudgets(),
      totalBudget: tokenBudgetOptimizer.getTotalBudget(),
      totalUsed: tokenBudgetOptimizer.getTotalUsed(),
      utilization: tokenBudgetOptimizer.getUtilization(),
    });
  });

  // ── Parallel Execution Analyzer ─────────────────────────────────────

  router.get('/coordination/parallel-analysis', (_req, res) => {
    const analyzer = new ParallelAnalyzer(agentManager.getTaskDAG());
    res.json(analyzer.analyze());
  });

  // ── Meeting Summarizer ───────────────────────────────────────────────

  router.get('/coordination/meetings', (_req, res) => {
    if (!meetingSummarizer) { res.json([]); return; }
    res.json(meetingSummarizer.getSummaries());
  });

  router.post('/coordination/meetings/summarize', (req, res) => {
    if (!meetingSummarizer) {
      res.status(503).json({ error: 'Meeting summarizer not available' });
      return;
    }
    const { groupName, messages } = req.body as {
      groupName?: string;
      messages?: Array<{ from: string; content: string; timestamp: number }>;
    };
    if (!groupName || typeof groupName !== 'string') {
      res.status(400).json({ error: 'groupName is required' });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required and must not be empty' });
      return;
    }
    try {
      const summary = meetingSummarizer.summarize(groupName, messages);
      res.status(201).json(summary);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Session Report ---
  router.get('/reports/session', (req, res) => {
    const rg = reportGenerator ?? new ReportGenerator();
    const format = req.query.format === 'md' ? 'md' : 'html';

    // Optional leadId filter; defaults to first running lead
    const leadId = req.query.leadId as string | undefined;
    const allAgents = agentManager.getAll();
    const lead = leadId
      ? allAgents.find(a => a.id === leadId)
      : allAgents.find(a => a.role?.id === 'lead');

    // Collect agents for the session (lead + its children, or all agents)
    const teamAgents = lead
      ? allAgents.filter(a => a.id === lead.id || a.parentId === lead.id)
      : allAgents;

    // Determine session time bounds from agent creation times
    const createdAts = teamAgents.map(a => new Date(a.createdAt ?? Date.now()).getTime()).filter(t => !isNaN(t));
    const sessionStart = createdAts.length > 0 ? Math.min(...createdAts) : Date.now() - 3_600_000;
    const sessionEnd = Date.now();

    // Tasks from DAG
    const dagTasks = lead
      ? (req.app.locals?.taskDAG?.getTasks?.(lead.id) ?? [])
      : [];

    // Decisions
    const rawDecisions = lead
      ? decisionLog.getByLeadId(lead.id)
      : decisionLog.getAll();

    // Recent git commits
    const commits = getRecentCommits();

    const projectName = lead?.projectName ?? lead?.task?.slice(0, 60) ?? 'AI Crew Session';

    const data = {
      projectName,
      sessionStart,
      sessionEnd,
      agents: teamAgents.map(a => ({
        id: a.id,
        role: a.role?.name ?? a.role?.id ?? 'unknown',
        model: a.model ?? 'unknown',
        status: a.status,
        tokensUsed: (a.inputTokens ?? 0) + (a.outputTokens ?? 0),
      })),
      tasks: dagTasks.map((t: any) => ({
        id: t.id,
        description: t.description ?? t.id,
        status: t.dagStatus ?? t.status ?? 'pending',
        assignee: t.assignedTo ?? t.role,
      })),
      decisions: rawDecisions.map((d: any) => ({
        title: d.title,
        rationale: d.rationale,
        confirmedBy: d.confirmedBy,
      })),
      commits,
      testResults: undefined,
      highlights: [],
    };

    if (format === 'md') {
      res.type('text/markdown').send(rg.generateMarkdown(data));
    } else {
      res.type('text/html').send(rg.generateHTML(data));
    }
  });

  // --- Project Templates ---
  // NOTE: /search must be registered before /:id so Express does not match "search" as an ID.
  router.get('/coordination/project-templates/search', (req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    const keyword = (req.query.keyword as string ?? '').trim();
    if (!keyword) return res.status(400).json({ error: 'keyword query parameter required' });
    res.json(projectTemplateRegistry.findByKeyword(keyword));
  });

  router.get('/coordination/project-templates', (_req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    res.json(projectTemplateRegistry.getAll());
  });

  router.get('/coordination/project-templates/:id', (req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    const template = projectTemplateRegistry.get(req.params.id);
    if (!template) return res.status(404).json({ error: `Template '${req.params.id}' not found` });
    res.json(template);
  });

  // --- Knowledge Transfer ---
  router.get('/coordination/knowledge/search', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const q = (req.query.q as string ?? '').trim();
    if (!q) return res.status(400).json({ error: 'q query parameter required' });
    res.json(knowledgeTransfer.search(q));
  });

  router.get('/coordination/knowledge/popular', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    res.json(knowledgeTransfer.getPopular(limit));
  });

  router.get('/coordination/knowledge', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const { projectId, category, tag } = req.query;
    if (typeof projectId === 'string') return res.json(knowledgeTransfer.getByProject(projectId));
    if (typeof category === 'string') return res.json(knowledgeTransfer.getByCategory(category as import('./coordination/KnowledgeTransfer.js').KnowledgeCategory));
    if (typeof tag === 'string') return res.json(knowledgeTransfer.getByTag(tag));
    res.json(knowledgeTransfer.getAll());
  });

  router.post('/coordination/knowledge', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const { projectId, category, title, content, tags } = req.body as Record<string, unknown>;
    const validCategories = ['pattern', 'pitfall', 'tool', 'architecture', 'process'];
    if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'projectId required' });
    if (typeof category !== 'string' || !validCategories.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
    }
    if (typeof title !== 'string' || !title) return res.status(400).json({ error: 'title required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const entryTags = Array.isArray(tags) ? (tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    const entry = knowledgeTransfer.capture({
      projectId,
      category: category as import('./coordination/KnowledgeTransfer.js').KnowledgeCategory,
      title,
      content,
      tags: entryTags,
    });
    res.status(201).json(entry);
  });

  return router;
}
