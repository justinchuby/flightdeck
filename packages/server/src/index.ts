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
import { authMiddleware } from './middleware/auth.js';
import { FileLockRegistry } from './coordination/FileLockRegistry.js';
import { ActivityLedger } from './coordination/ActivityLedger.js';
import { DecisionLog } from './coordination/DecisionLog.js';
import { AgentMemory } from './agents/AgentMemory.js';
import { TaskDAG } from './tasks/TaskDAG.js';
import { ChatGroupRegistry } from './comms/ChatGroupRegistry.js';
import { ContextRefresher } from './coordination/ContextRefresher.js';

let config = getConfig();

const app = express();
app.use(cors());
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
const agentManager = new AgentManager(config, roleRegistry, lockRegistry, activityLedger, messageBus, decisionLog, agentMemory, chatGroupRegistry, taskDAG);
const contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger);
const wsServer = new WebSocketServer(httpServer, agentManager, lockRegistry, activityLedger, decisionLog, chatGroupRegistry);

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
app.use('/api', apiRouter(agentManager, roleRegistry, config, db, lockRegistry, activityLedger, decisionLog));

httpServer.listen(config.port, config.host, () => {
  console.log(`🚀 AI Crew server running on http://${config.host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    console.warn('⚠️  WARNING: Server is binding to all interfaces (0.0.0.0). Set HOST=127.0.0.1 for local-only access.');
  }
  if (!process.env.SERVER_SECRET) {
    console.warn('⚠️  WARNING: No SERVER_SECRET set. API endpoints are unauthenticated.');
  }
  contextRefresher.start();
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  contextRefresher.stop();
  agentManager.shutdownAll();
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
