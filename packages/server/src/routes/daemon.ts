import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import { rateLimit } from '../middleware/rateLimit.js';

const daemonReadLimiter = rateLimit({ windowMs: 60_000, max: 120, message: 'Too many daemon status requests' });
const daemonWriteLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Too many daemon control requests' });

/** Extract a single string param (Express 5 may return string | string[]) */
function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] ?? '' : val ?? '';
}

export function daemonRoutes(ctx: AppContext): Router {
  const { daemonProcess, daemonClient, reconnectProtocol, massFailureDetector } = ctx;
  const router = Router();

  // --- Daemon Status ---

  /** Get daemon status overview */
  router.get('/daemon/status', daemonReadLimiter, (_req, res) => {
    const now = Date.now();

    // If DaemonProcess is running in-process, use it directly
    if (daemonProcess) {
      const agents = daemonProcess.listAgents();
      const startedAt = (daemonProcess as any)._startedAt as number | undefined;
      const uptimeMs = startedAt ? now - startedAt : 0;

      return res.json({
        running: true,
        mode: daemonProcess.mode,
        agentCount: agents.length,
        pid: process.pid,
        uptimeMs,
        uptimeFormatted: formatUptime(uptimeMs),
        spawningPaused: daemonProcess.isSpawningPaused,
        transport: {
          platform: (daemonProcess as any)._transport?.platform ?? process.platform,
          socketPath: daemonProcess.path,
        },
      });
    }

    // Fall back to DaemonClient (remote daemon)
    if (daemonClient) {
      return res.json({
        running: daemonClient.isConnected,
        mode: 'remote',
        agentCount: null,
        pid: null,
        uptimeMs: null,
        uptimeFormatted: null,
        spawningPaused: false,
        transport: {
          platform: process.platform,
          socketPath: null,
        },
        connection: {
          connected: daemonClient.isConnected,
        },
      });
    }

    res.json({
      running: false,
      mode: 'unavailable',
      agentCount: 0,
      pid: null,
      uptimeMs: null,
      uptimeFormatted: null,
      spawningPaused: false,
      transport: { platform: process.platform, socketPath: null },
    });
  });

  /** List agents running in the daemon */
  router.get('/daemon/agents', daemonReadLimiter, async (_req, res) => {
    // In-process daemon
    if (daemonProcess) {
      const agents = daemonProcess.listAgents().map(a => ({
        agentId: a.agentId,
        pid: a.pid,
        role: a.role,
        model: a.model,
        status: a.status,
        sessionId: a.sessionId,
        taskSummary: a.taskSummary,
        spawnedAt: a.spawnedAt,
        lastEventId: a.lastEventId,
      }));
      return res.json(agents);
    }

    // Remote daemon via client
    if (daemonClient?.isConnected) {
      try {
        const result = await daemonClient.listAgents();
        return res.json(result.agents ?? []);
      } catch (err: any) {
        logger.warn({ module: 'daemon', msg: 'Failed to list agents via client', err: err.message });
        return res.json([]);
      }
    }

    res.json([]);
  });

  /** Get reconnection protocol state */
  router.get('/daemon/reconnect', daemonReadLimiter, (_req, res) => {
    if (!reconnectProtocol) {
      return res.json({
        state: 'unavailable',
        attempt: 0,
        maxAttempts: 0,
        lastReconciliation: null,
      });
    }

    res.json({
      state: reconnectProtocol.state,
      expectedAgentCount: (reconnectProtocol as any)._expectedAgents?.size ?? 0,
    });
  });

  /** Get mass failure detector state */
  router.get('/daemon/mass-failure', daemonReadLimiter, (_req, res) => {
    if (!massFailureDetector) {
      return res.json({
        available: false,
        isPaused: false,
        lastFailure: null,
      });
    }

    res.json({
      available: true,
      isPaused: massFailureDetector.isPaused,
    });
  });

  // --- Daemon Controls ---

  /** Graceful shutdown of the daemon */
  router.post('/daemon/stop', daemonWriteLimiter, async (req, res) => {
    const persist = req.body?.persist ?? true;

    if (daemonProcess) {
      try {
        await daemonProcess.stop({ persist, reason: 'UI-triggered shutdown' });
        logger.info({ module: 'daemon', msg: 'Daemon stopped via UI' });
        return res.json({ acknowledged: true, message: 'Daemon stopping' });
      } catch (err: any) {
        logger.error({ module: 'daemon', msg: 'Failed to stop daemon', err: err.message });
        return res.status(500).json({ error: err.message });
      }
    }

    if (daemonClient?.isConnected) {
      try {
        const result = await daemonClient.shutdown({ persist });
        return res.json({ acknowledged: result.acknowledged, message: 'Shutdown request sent' });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    res.status(503).json({ error: 'Daemon not available' });
  });

  /** Switch daemon lifecycle mode */
  router.post('/daemon/mode', daemonWriteLimiter, (req, res) => {
    const { mode } = req.body ?? {};
    if (mode !== 'production' && mode !== 'development') {
      return res.status(400).json({ error: 'Mode must be "production" or "development"' });
    }

    if (!daemonProcess) {
      return res.status(503).json({ error: 'Daemon not available (in-process only)' });
    }

    try {
      daemonProcess.setMode(mode);
      logger.info({ module: 'daemon', msg: `Daemon mode set to ${mode} via UI` });
      res.json({ mode, message: `Mode set to ${mode}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Resume agent spawning after mass failure pause */
  router.post('/daemon/resume-spawning', daemonWriteLimiter, async (_req, res) => {
    if (massFailureDetector) {
      massFailureDetector.resume();
      logger.info({ module: 'daemon', msg: 'Spawning resumed via UI (MassFailureDetector)' });
    }

    if (daemonClient?.isConnected) {
      try {
        await daemonClient.resumeSpawning();
        return res.json({ resumed: true });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (massFailureDetector) {
      return res.json({ resumed: true });
    }

    res.status(503).json({ error: 'Daemon not available' });
  });

  /** Terminate a specific agent */
  router.post('/daemon/agents/:agentId/terminate', daemonWriteLimiter, async (req, res) => {
    const agentId = paramStr(req.params.agentId);
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    if (daemonClient?.isConnected) {
      try {
        const result = await daemonClient.terminateAgent(agentId);
        return res.json({ terminated: result.terminated });
      } catch (err: any) {
        return res.status(500).json({ error: err.message });
      }
    }

    res.status(503).json({ error: 'Daemon not available' });
  });

  return router;
}

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
