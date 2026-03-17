import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getConfig, updateConfig } from './config.js';
import { logger } from './utils/logger.js';
import { originValidation } from './middleware/originValidation.js';
import { authMiddleware, initAuth, getAuthSecret } from './middleware/auth.js';
import { requestContextMiddleware } from './middleware/requestContext.js';
import { httpLoggerMiddleware } from './middleware/httpLogger.js';
import { createContainer, wireHttpLayer } from './container.js';
import { apiRouter } from './api.js';
import { WebSocketServer } from './comms/WebSocketServer.js';

// __dirname = packages/server/dist/ → repo root is 3 levels up
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const authToken = initAuth();
const config = getConfig();

// ── Build service container (restores persisted settings internally) ──
const container = await createContainer({ config, repoRoot });

// ── Express app ────────────────────────────────────────────
const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(allowed ? null : new Error('CORS: origin not allowed'), allowed);
  },
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: false,  // Vite-bundled frontend uses patterns blocked by default CSP
}));
app.use(originValidation);
app.use(express.json({ limit: '10mb' }));
app.use(requestContextMiddleware);
app.use(httpLoggerMiddleware);

const httpServer = createServer(app);

// Wire HTTP layer (WebSocket server + alert→WS bridge)
const wsServer = new WebSocketServer(
  httpServer, container.agentManager, container.lockRegistry,
  container.activityLedger, container.decisionLog, container.internal.chatGroupRegistry,
);
wireHttpLayer(container, httpServer, wsServer);

// Read server version from package.json for /version endpoint
const serverPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
const SERVER_VERSION: string = serverPkg.version ?? '0.0.0';
const API_VERSION = 1; // Bump when breaking API changes happen

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: container.agentManager.getAll().length });
});
app.get('/version', (_req, res) => {
  res.json({ version: SERVER_VERSION, apiVersion: API_VERSION });
});
app.use('/api', authMiddleware);
app.use('/api', apiRouter(container));

// Global error handler — catches unhandled route/middleware errors so they
// return a 500 instead of crashing the process.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ module: 'api', msg: 'Unhandled route error', err: err.message, stack: err.stack });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve built web frontend in production
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  const indexHtml = fs.readFileSync(path.join(webDistPath, 'index.html'), 'utf-8');
  app.get('/{*path}', (_req, res) => {
    const secret = getAuthSecret();
    if (secret) {
      res.cookie('flightdeck-token', secret, { httpOnly: true, sameSite: 'strict', path: '/' });
    }
    res.type('html').send(indexHtml);
  });
}

// ── Start ──────────────────────────────────────────────────
const MAX_PORT_ATTEMPTS = 10;

async function listenWithRetry(basePort: number, host: string, maxAttempts = MAX_PORT_ATTEMPTS): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = basePort + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    } catch (err: any) {
      if (err.code !== 'EADDRINUSE') throw err;
      console.warn(`⚠️  Port ${port} in use, trying ${port + 1}...`);
    }
  }
  throw new Error(`No available port found in range ${basePort}–${basePort + maxAttempts - 1}`);
}

listenWithRetry(config.port, config.host).then((actualPort) => {
  if (actualPort !== config.port) updateConfig({ port: actualPort });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`\n❌ HTTP server error: ${err.message}`);
    process.exit(1);
  });

  const url = `http://${config.host}:${actualPort}`;
  console.log(`FLIGHTDECK_PORT=${actualPort}`);
  console.log(`🚀 Flightdeck server running on ${url}`);
  if (authToken) {
    console.log(`🔑 Auth token: ${authToken}`);
    console.log(`   (set SERVER_SECRET env var to use a fixed token, or AUTH=none to disable)`);
  } else {
    console.log(`⚠️  Auth disabled (AUTH=none)`);
  }
  if (config.host === '0.0.0.0') {
    console.warn('⚠️  WARNING: Server is binding to all interfaces (0.0.0.0). Set HOST=127.0.0.1 for local-only access.');
  }
  container.internal.contextRefresher.start();
  container.escalationManager!.start();

  // Reconcile stale state from previous server run.
  // At fresh startup no agents are alive in memory, so all DB entries
  // still showing 'running'/'idle'/'active' are stale and must be cleaned up.
  const isAgentAlive = (agentId: string) => {
    const agent = container.agentManager.get(agentId);
    return !!agent && (agent.status === 'running' || agent.status === 'idle');
  };

  let staleSessions = 0;
  let staleAgents = 0;

  if (container.projectRegistry) {
    staleSessions = container.projectRegistry.reconcileStaleSessions(isAgentAlive);
  }
  if (container.agentRoster) {
    staleAgents = container.agentRoster.reconcileStaleAgents(isAgentAlive);
  }

  if (staleSessions > 0 || staleAgents > 0) {
    console.log(`🔧 Reconciled ${staleSessions} stale session(s), ${staleAgents} stale agent(s)`);
  }
}).catch((err) => {
  console.error(`❌ Failed to start server: ${err.message}`);
  if (err.message.includes('No available port')) {
    console.error(`   All ports ${config.port}–${config.port + MAX_PORT_ATTEMPTS - 1} are in use. Kill existing instances with: lsof -ti:${config.port} | xargs kill`);
  }
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    // Second signal — force exit immediately
    console.log(`\n${signal} received again. Forcing exit.`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n[shutdown] Graceful shutdown started (${signal})`);
  container.internal.contextRefresher.stop();
  wsServer.close();
  try {
    await container.shutdown();
    console.log('[shutdown] All agents terminated, services stopped.');
  } catch (err) {
    console.warn('[shutdown] Container shutdown error:', err);
  }
  httpServer.close(() => {
    console.log('[shutdown] Server closed. Exiting.');
    process.exit(0);
  });
  // Force exit after 15s — enough for in-flight agent messages to drain
  // but prevents zombie process if httpServer.close() callback never fires
  setTimeout(() => {
    console.warn('[shutdown] Timed out after 15s, forcing exit.');
    process.exit(1);
  }, 15000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log unhandled rejections but do NOT crash — the server can continue serving.
// Before this fix, any stray unhandled rejection (e.g. a network hiccup in an
// agent adapter) would kill the entire process, leaving Vite with ECONNREFUSED.
process.on('unhandledRejection', (reason: unknown) => {
  const msg = String(reason);
  // Telegram 409 is transient — old getUpdates lingers ~30s after restart
  if (msg.includes('409') && msg.includes('getUpdates')) {
    logger.warn({ module: 'api', msg: 'Telegram polling conflict (transient)', err: msg });
    return;
  }
  logger.error({ module: 'api', msg: 'Unhandled promise rejection (non-fatal)', err: msg });
});

// Synchronous exceptions in timer callbacks / event handlers are truly fatal —
// state may be corrupted, so we must shut down.
process.on('uncaughtException', (err: Error) => {
  logger.error({ module: 'api', msg: 'Uncaught exception', err: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});
