import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { getConfig } from './config.js';
import { WebSocketServer } from './comms/WebSocketServer.js';
import { AgentManager } from './agents/AgentManager.js';
import { RoleRegistry } from './agents/RoleRegistry.js';
import { TaskQueue } from './tasks/TaskQueue.js';
import { Database } from './db/database.js';
import { apiRouter } from './api.js';

const config = getConfig();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

// Initialize core services
const db = new Database(config.dbPath);
const roleRegistry = new RoleRegistry();
const agentManager = new AgentManager(config, roleRegistry);
const taskQueue = new TaskQueue(db, agentManager);
const wsServer = new WebSocketServer(httpServer, agentManager, taskQueue);

// Wire up API routes
app.use('/api', apiRouter(agentManager, taskQueue, roleRegistry, config, db));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agents: agentManager.getAll().length,
    queuedTasks: taskQueue.getPending().length,
  });
});

httpServer.listen(config.port, config.host, () => {
  console.log(`🚀 AI Crew server running on http://${config.host}:${config.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  agentManager.shutdownAll();
  db.close();
  httpServer.close();
});
