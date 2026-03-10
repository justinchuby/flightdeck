import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import type { AgentInfo } from '../transport/types.js';
import { rateLimit } from '../middleware/rateLimit.js';

const readLimiter = rateLimit({ windowMs: 60_000, max: 120, message: 'Too many agent-server status requests' });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Too many agent-server control requests' });

/** Extract a single string param (Express 5 may return string | string[]) */
function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] ?? '' : val ?? '';
}

/** Validate agentId format — UUID-like hex with dashes, prevents log injection */
const AGENT_ID_RE = /^[a-f0-9\-]{8,64}$/i;

export function agentServerRoutes(ctx: AppContext): Router {
  const { agentServerClient } = ctx;
  const router = Router();

  // --- Status ---

  /** Get agent-server status overview */
  router.get('/agent-server/status', readLimiter, async (_req, res) => {
    if (!agentServerClient) {
      return res.json({
        running: false,
        connected: false,
        agentCount: 0,
        latencyMs: null,
      });
    }

    const connected = agentServerClient.isConnected;
    let agentCount = 0;
    let latencyMs: number | null = null;

    if (connected) {
      try {
        const before = Date.now();
        await agentServerClient.ping();
        latencyMs = Date.now() - before;
      } catch {
        // Ping failed — server may be degraded
      }

      try {
        const agents = await agentServerClient.list();
        agentCount = agents.length;
      } catch {
        // List failed
      }
    }

    res.json({
      running: connected,
      connected,
      state: agentServerClient.state,
      agentCount,
      latencyMs,
      pendingRequests: agentServerClient.pendingCount,
      trackedAgents: agentServerClient.trackedAgentCount,
    });
  });

  // --- Agents ---

  /** List agents on the agent server (safe subset only) */
  router.get('/agent-server/agents', readLimiter, async (_req, res) => {
    if (!agentServerClient?.isConnected) {
      return res.json([]);
    }

    try {
      const agents = await agentServerClient.list();
      // Return safe subset — no sessionId
      return res.json(agents.map((a: AgentInfo) => ({
        agentId: a.agentId,
        role: a.role,
        model: a.model,
        status: a.status,
        task: a.task ?? null,
        spawnedAt: a.spawnedAt,
      })));
    } catch (err: any) {
      logger.warn({ module: 'agent-server', msg: 'Failed to list agents', err: err.message });
      return res.json([]);
    }
  });

  // --- Controls ---

  /** Graceful shutdown — terminate all agents, disconnect client */
  router.post('/agent-server/stop', writeLimiter, async (_req, res) => {
    if (!agentServerClient?.isConnected) {
      return res.status(503).json({ error: 'Agent server not connected' });
    }

    try {
      // Terminate all running agents first
      const agents = await agentServerClient.list();
      const running = agents.filter((a: AgentInfo) => a.status === 'running' || a.status === 'starting');
      for (const agent of running) {
        try {
          await agentServerClient.terminate(agent.agentId, 'UI-triggered shutdown');
        } catch {
          // Best-effort — agent may already be exiting
        }
      }

      // Disconnect the client; the server will self-terminate via orphan timeout
      await agentServerClient.disconnect();

      logger.info({ module: 'agent-server', msg: 'Agent server stopped via UI', terminatedCount: running.length });
      res.json({ acknowledged: true, message: 'Agents terminated, server disconnecting', terminatedCount: running.length });
    } catch (err: any) {
      logger.error({ module: 'agent-server', msg: 'Failed to stop agent server', err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Switch lifecycle mode (not yet available via agent server protocol) */
  router.post('/agent-server/mode', writeLimiter, (_req, res) => {
    // Mode configuration is DaemonProcess-specific. The agent server protocol
    // does not yet support a configure/mode message. Return 501 until AS protocol
    // adds a configure message type.
    res.status(501).json({
      error: 'Mode configuration not available via agent server protocol',
      hint: 'Use the daemon routes for in-process mode changes',
    });
  });

  /** Terminate a specific agent */
  router.post('/agent-server/terminate/:agentId', writeLimiter, async (req, res) => {
    const agentId = paramStr(req.params.agentId);
    if (!agentId || !AGENT_ID_RE.test(agentId)) {
      return res.status(400).json({ error: 'Invalid agentId format' });
    }

    if (!agentServerClient?.isConnected) {
      return res.status(503).json({ error: 'Agent server not connected' });
    }

    try {
      await agentServerClient.terminate(agentId, 'UI-triggered termination');
      res.json({ terminated: true, agentId });
    } catch (err: any) {
      logger.error({ module: 'agent-server', msg: 'Failed to terminate agent', agentId, err: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
