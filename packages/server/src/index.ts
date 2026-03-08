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

// ── Fork agent server (two-process architecture) ─────────────────
// The agent server runs in a detached child process that survives
// orchestrator restarts. connect() forks or reconnects via PID file.
if (container.agentServerClient) {
  container.agentServerClient.connect().then(() => {
    console.log('🔌 Agent server connected');
    container.agentServerHealth?.start();
  }).catch((err: Error) => {
    console.warn(`⚠️  Agent server connection failed: ${err.message}`);
    console.warn('   Orchestrator will operate without agent server. Retry with restart.');
  });
}

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
app.use(helmet());
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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: container.agentManager.getAll().length });
});
app.use('/api', authMiddleware);
app.use('/api', apiRouter(container));

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

  // Attempt to resume agents from previous session (async, non-blocking)
  container.internal.sessionResumeManager.resumeAll().then((result) => {
    if (result.total > 0) {
      console.log(`🔄 Agent resume: ${result.succeeded}/${result.total} resumed, ${result.failed} failed, ${result.skipped} skipped`);
    }
  }).catch((err) => {
    console.warn(`⚠️  Agent resume failed: ${err.message}`);
  });
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
  if (shuttingDown) return; // guard against double SIGINT
  shuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully...`);
  container.internal.contextRefresher.stop();
  wsServer.close();
  try {
    await container.shutdown();
  } catch (err) {
    console.warn('[shutdown] Container shutdown error:', err);
  }
  httpServer.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after 15s — enough for in-flight agent messages to drain
  // but prevents zombie process if httpServer.close() callback never fires
  setTimeout(() => process.exit(1), 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({ module: 'api', msg: 'Unhandled promise rejection', err: String(reason) });
  gracefulShutdown('unhandledRejection');
});
