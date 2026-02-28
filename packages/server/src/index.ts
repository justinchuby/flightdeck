import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { getConfig, updateConfig } from './config.js';
import { WebSocketServer } from './comms/WebSocketServer.js';
import { MessageBus } from './comms/MessageBus.js';
import { AgentManager } from './agents/AgentManager.js';
import { RoleRegistry } from './agents/RoleRegistry.js';
import { Database } from './db/database.js';
import { apiRouter } from './api.js';
import { authMiddleware, initAuth, getAuthSecret } from './middleware/auth.js';
import { FileLockRegistry } from './coordination/FileLockRegistry.js';
import { ActivityLedger } from './coordination/ActivityLedger.js';
import { DecisionLog } from './coordination/DecisionLog.js';
import { AgentMemory } from './agents/AgentMemory.js';
import { TaskDAG } from './tasks/TaskDAG.js';
import { DeferredIssueRegistry } from './tasks/DeferredIssueRegistry.js';
import { ChatGroupRegistry } from './comms/ChatGroupRegistry.js';
import { ContextRefresher } from './coordination/ContextRefresher.js';
import { Scheduler } from './utils/Scheduler.js';
import { ProjectRegistry } from './projects/ProjectRegistry.js';

// Initialize auth (auto-generates token if not set)
const authToken = initAuth();

let config = getConfig();

const app = express();

// CORS — restrict to localhost origins in production
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server, same-origin)
    if (!origin) return cb(null, true);
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(allowed ? null : new Error('CORS: origin not allowed'), allowed);
  },
  credentials: true,
}));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // modern browsers use CSP instead
  next();
});

app.use(express.json({ limit: '1mb' }));

const httpServer = createServer(app);

// Initialize core services
const db = new Database(config.dbPath);

// Restore persisted maxConcurrentAgents from SQLite settings (survives server restart)
const persistedMaxAgents = db.getSetting('maxConcurrentAgents');
if (persistedMaxAgents) {
  const parsed = parseInt(persistedMaxAgents, 10);
  if (!isNaN(parsed) && parsed > 0) {
    updateConfig({ maxConcurrentAgents: parsed });
  }
}

// Re-read config AFTER restoring persisted settings so all services see the correct values
config = getConfig();

const lockRegistry = new FileLockRegistry(db);
const activityLedger = new ActivityLedger(db);
const roleRegistry = new RoleRegistry(db);
const messageBus = new MessageBus();
const decisionLog = new DecisionLog(db);
const agentMemory = new AgentMemory(db);
const chatGroupRegistry = new ChatGroupRegistry(db);
const taskDAG = new TaskDAG(db);
const deferredIssueRegistry = new DeferredIssueRegistry(db);
const projectRegistry = new ProjectRegistry(db);
const agentManager = new AgentManager(config, roleRegistry, lockRegistry, activityLedger, messageBus, decisionLog, agentMemory, chatGroupRegistry, taskDAG, { db, deferredIssueRegistry });
agentManager.setProjectRegistry(projectRegistry);
const contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger);
const wsServer = new WebSocketServer(httpServer, agentManager, lockRegistry, activityLedger, decisionLog, chatGroupRegistry);

// Register scheduled background tasks
const scheduler = new Scheduler();
scheduler.register({
  id: 'expired-lock-cleanup',
  interval: 60_000, // every minute
  run: () => { lockRegistry.cleanExpired(); },
});
scheduler.register({
  id: 'activity-log-prune',
  interval: 3_600_000, // every hour
  run: () => activityLedger.prune(50_000),
});
scheduler.register({
  id: 'stale-delegation-cleanup',
  interval: 300_000, // every 5 minutes
  run: () => { agentManager.cleanupStaleDelegations(); },
});

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agents: agentManager.getAll().length,
  });
});

// Auth middleware for API routes
app.use('/api', authMiddleware);

// Wire up API routes
app.use('/api', apiRouter(agentManager, roleRegistry, config, db, lockRegistry, activityLedger, decisionLog, projectRegistry));

// Serve built web frontend in production
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistPath = path.resolve(__dirname, '../../web/dist');

import fs from 'fs';
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA fallback — serve index.html for any non-API route
  // Inject auth token into HTML so frontend can authenticate seamlessly
  const indexHtml = fs.readFileSync(path.join(webDistPath, 'index.html'), 'utf-8');
  app.get('/{*path}', (_req, res) => {
    const secret = getAuthSecret();
    if (secret) {
      const injected = indexHtml.replace(
        '</head>',
        `<script>window.__AI_CREW_TOKEN__=${JSON.stringify(secret)}</script></head>`,
      );
      res.type('html').send(injected);
    } else {
      res.type('html').send(indexHtml);
    }
  });
}

httpServer.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}`;
  console.log(`🚀 AI Crew server running on ${url}`);
  if (authToken) {
    console.log(`🔑 Auth token: ${authToken}`);
    console.log(`   (set SERVER_SECRET env var to use a fixed token, or AUTH=none to disable)`);
  } else {
    console.log(`⚠️  Auth disabled (AUTH=none)`);
  }
  if (config.host === '0.0.0.0') {
    console.warn('⚠️  WARNING: Server is binding to all interfaces (0.0.0.0). Set HOST=127.0.0.1 for local-only access.');
  }
  contextRefresher.start();
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  contextRefresher.stop();
  scheduler.stop();
  agentManager.shutdownAll();
  activityLedger.stop();
  lockRegistry.cleanExpired();
  db.close();
  httpServer.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
