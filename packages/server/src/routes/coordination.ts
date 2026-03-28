import { Router } from 'express';
import { shortAgentId } from '@flightdeck/shared';
import { normalize, isAbsolute } from 'node:path';
import type { ActionType } from '../coordination/activity/ActivityLedger.js';
import { validateBody, acquireLockSchema } from '../validation/schemas.js';
import { extractCommFromActivity } from '../coordination/events/CommEventExtractor.js';
import type { AppContext } from './context.js';

/** Reject paths with traversal sequences or absolute paths. */
function isTraversalPath(p: string): boolean {
  if (isAbsolute(p)) return true;
  const normalized = normalize(p).replace(/\\/g, '/');
  return normalized.startsWith('../') || normalized === '..' || normalized.includes('/../') || p.includes('\0');
}

export function coordinationRoutes(ctx: AppContext): Router {
  const { agentManager, lockRegistry, activityLedger, eventPipeline } = ctx;
  const router = Router();

  // --- Coordination ---
  router.get('/coordination/status', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    const agents = projectId
      ? agentManager.getByProject(projectId)
      : agentManager.getAll();
    res.json({
      agents: agents.map((a) => a.toJSON()),
      locks: projectId ? lockRegistry.getByProject(projectId) : lockRegistry.getAll(),
      recentActivity: activityLedger.getRecent(20, projectId),
    });
  });

  router.get('/coordination/locks', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    res.json(projectId ? lockRegistry.getByProject(projectId) : lockRegistry.getAll());
  });

  router.post('/coordination/locks', validateBody(acquireLockSchema), (req, res) => {
    const { agentId, filePath, reason } = req.body;
    if (isTraversalPath(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    const agent = agentManager.get(agentId);
    const agentRole = agent?.role?.id ?? 'unknown';
    const projectId = agent ? agentManager.getProjectIdForAgent(agentId) ?? '' : '';
    const result = lockRegistry.acquire(agentId, agentRole, filePath, reason, 300, projectId);
    if (result.ok) {
      res.status(201).json({ ok: true });
    } else {
      res.status(409).json({ ok: false, holder: result.holder });
    }
  });

  router.delete('/coordination/locks/:filePath', (req, res) => {
    const filePath = String(req.params.filePath);
    if (isTraversalPath(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    const agentId = (req.query.agentId as string) ?? req.body?.agentId;
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    const ok = lockRegistry.release(agentId, filePath);
    res.json({ ok });
  });

  router.get('/coordination/activity', (req, res) => {
    const { agentId, type, limit, since, projectId } = req.query;
    const limitNum = Math.min(limit ? Number(limit) : 50, 1000);
    const pid = projectId as string | undefined;
    let activities;
    if (since) {
      activities = activityLedger.getSince(since as string, pid);
    } else if (agentId) {
      activities = activityLedger.getByAgent(agentId as string, limitNum, pid);
    } else if (type) {
      activities = activityLedger.getByType(type as ActionType, limitNum, pid);
    } else {
      activities = activityLedger.getRecent(limitNum, pid);
    }
    res.json(activities);
  });

  router.get('/coordination/summary', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    res.json(activityLedger.getSummary(projectId));
  });

  // ── Helper: build timeline data from activity events ──────────────────────
  // 5s TTL cache to avoid re-computing on rapid polling
  let _timelineCache: { key: string; data: any; ts: number } | null = null;
  const TIMELINE_CACHE_TTL = 5_000;

  function buildTimelineData(leadId?: string, since?: string) {
    const cacheKey = `${leadId ?? ''}:${since ?? ''}`;
    const now = Date.now();
    if (_timelineCache && _timelineCache.key === cacheKey && now - _timelineCache.ts < TIMELINE_CACHE_TTL) {
      return _timelineCache.data;
    }

    let events = since ? activityLedger.getSince(since) : activityLedger.getRecent(10_000);

    // Filter synthetic id:0 events (emitted before DB flush assigns a real ID)
    events = events.filter(e => e.id !== 0);

    // Resolve crew membership for leadId filtering
    const crewAgentIds = new Set<string>();
    if (leadId) {
      crewAgentIds.add(leadId);
      for (const agent of agentManager.getAll()) {
        if (agent.parentId === leadId || agent.id === leadId || agent.projectId === leadId) {
          crewAgentIds.add(agent.id);
        }
      }

      // Historical fallback: when no live agents match, treat leadId as projectId
      // and discover crew members from the events themselves
      const hasLiveCrew = crewAgentIds.size > 1 || events.some(ev => ev.agentId === leadId);
      if (!hasLiveCrew) {
        const projectEvents = events.filter(ev => ev.projectId === leadId);
        if (projectEvents.length > 0) {
          events = projectEvents;
          for (const ev of projectEvents) crewAgentIds.add(ev.agentId);
        }
      }

      if (crewAgentIds.size > 1) {
        events = events.filter(ev => crewAgentIds.has(ev.agentId) || ev.projectId === leadId);
      }
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
        shortId: shortAgentId(id),
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
    // Find project context (live agent first, then infer from events)
    const resolvedLeadId = leadId || agentManager.getAll().find(a => a.role.id === 'lead' && !a.parentId)?.id;
    const leadAgent = resolvedLeadId ? agentManager.get(resolvedLeadId) : undefined;
    const project = leadAgent
      ? { projectId: leadAgent.projectId, projectName: leadAgent.projectName, leadId: leadAgent.id }
      : leadId ? { projectId: leadId, leadId } : undefined;

    const result = { agents, communications, locks, timeRange, project, crewAgentIds, ledgerVersion: activityLedger.version, dropCount: eventPipeline?.dropCount ?? 0 };
    _timelineCache = { key: cacheKey, data: result, ts: Date.now() };
    return result;
  }

  router.get('/coordination/timeline', (req, res) => {
    const since = req.query.since as string | undefined;
    const leadId = req.query.leadId as string | undefined;
    const result = buildTimelineData(leadId, since);
    const { crewAgentIds: _ignored, ...payload } = result;
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
          const { crewAgentIds: _ignored, ...payload } = missedData;
          writeSSE('reconnect', payload);
        }
      }
    }

    // Send initial full timeline snapshot
    const initialData = buildTimelineData(leadId);
    const { crewAgentIds, ...initialPayload } = initialData;
    writeSSE('init', initialPayload);

    // Stream incremental activity events
    const onActivity = (entry: any) => {
      // Filter synthetic id:0 events
      if (entry.id === 0 && !entry.agentId) return;
      // Only send events for this lead's crew
      if (crewAgentIds.size > 0 && !crewAgentIds.has(entry.agentId)) {
        // Check if this is a new agent spawned under the lead
        const agent = agentManager.get(entry.agentId);
        if (!agent || (agent.parentId !== leadId && agent.id !== leadId && agent.projectId !== leadId)) return;
        // New crew member — add to tracked set
        crewAgentIds.add(entry.agentId);
      }
      writeSSE('activity', { entry });

      // Emit dedicated comm:update for communication-related events
      const comm = extractCommFromActivity(entry);
      if (comm) {
        writeSSE('comm:update', { comm });
      }
    };

    const onLockAcquired = (data: any) => {
      if (crewAgentIds.size > 0 && !crewAgentIds.has(data.agentId)) return;
      writeSSE('lock', { type: 'acquired', ...data });
    };

    const onLockReleased = (data: any) => {
      if (crewAgentIds.size > 0 && !crewAgentIds.has(data.agentId)) return;
      writeSSE('lock', { type: 'released', ...data });
    };

    const onLockExpired = (data: any) => {
      if (crewAgentIds.size > 0 && !crewAgentIds.has(data.agentId)) return;
      writeSSE('lock', { type: 'expired', ...data });
    };

    activityLedger.on('activity', onActivity);
    lockRegistry.on('lock:acquired', onLockAcquired);
    lockRegistry.on('lock:released', onLockReleased);
    lockRegistry.on('lock:expired', onLockExpired);

    // Keepalive every 30s to prevent proxy/load-balancer timeouts
    const keepaliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        try {
          res.write(': keepalive\n\n');
        } catch {
          clearInterval(keepaliveTimer);
        }
      }
    }, 30_000);

    const cleanup = () => {
      activityLedger.off('activity', onActivity);
      lockRegistry.off('lock:acquired', onLockAcquired);
      lockRegistry.off('lock:released', onLockReleased);
      lockRegistry.off('lock:expired', onLockExpired);
      clearInterval(keepaliveTimer);
    };

    // Handle broken connections — cleanup before 'close' fires
    res.on('error', cleanup);

    // Cleanup on client disconnect
    req.on('close', cleanup);
  });

  return router;
}
