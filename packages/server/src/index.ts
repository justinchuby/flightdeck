import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, updateConfig } from './config.js';
import { originValidation } from './middleware/originValidation.js';
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

// Resolve repo root reliably via __dirname (works regardless of process.cwd())
// __dirname = packages/server/dist/ → repo root is 3 levels up
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
import { TaskDAG } from './tasks/TaskDAG.js';
import { DeferredIssueRegistry } from './tasks/DeferredIssueRegistry.js';
import { TaskTemplateRegistry } from './tasks/TaskTemplates.js';
import { TaskDecomposer } from './tasks/TaskDecomposer.js';
import { ChatGroupRegistry } from './comms/ChatGroupRegistry.js';
import { ContextRefresher } from './coordination/ContextRefresher.js';
import { Scheduler } from './utils/Scheduler.js';
import { ProjectRegistry } from './projects/ProjectRegistry.js';
import { EagerScheduler } from './tasks/EagerScheduler.js';
import { FileDependencyGraph } from './coordination/FileDependencyGraph.js';
import { RetryManager } from './agents/RetryManager.js';
import { CrashForensics } from './agents/CrashForensics.js';
import { NotificationManager } from './coordination/NotificationManager.js';
import { EscalationManager } from './coordination/EscalationManager.js';
import { ModelSelector } from './agents/ModelSelector.js';
import { TokenBudgetOptimizer } from './agents/TokenBudgetOptimizer.js';
import { MeetingSummarizer } from './coordination/MeetingSummarizer.js';
import { ReportGenerator } from './coordination/ReportGenerator.js';
import { ProjectTemplateRegistry } from './coordination/ProjectTemplates.js';
import { KnowledgeTransfer } from './coordination/KnowledgeTransfer.js';

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

// Security headers (helmet sets X-Frame-Options, CSP, HSTS, etc.)
app.use(helmet());

// CSRF protection — reject requests from non-localhost origins
app.use(originValidation);

app.use(express.json({ limit: '10mb' }));

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
lockRegistry.startExpiryCheck(); // actively clean expired locks every 30s
const activityLedger = new ActivityLedger(db);

// Reactive event pipeline — auto-triggers on ActivityLedger events
import { EventPipeline, taskCompletedHandler, commitQualityGateHandler, delegationTracker } from './coordination/EventPipeline.js';
const eventPipeline = new EventPipeline();
eventPipeline.register(taskCompletedHandler);
eventPipeline.register(commitQualityGateHandler);
eventPipeline.register(delegationTracker);

eventPipeline.connectToLedger(activityLedger);

// Webhook manager — sends HTTP notifications to external services on key events
import { WebhookManager } from './coordination/WebhookManager.js';
const webhookManager = new WebhookManager();
eventPipeline.register({
  name: 'webhook-relay',
  eventTypes: '*',
  handle: (event) => {
    webhookManager.fire(event.entry.actionType, {
      agentId: event.entry.agentId,
      agentRole: event.entry.agentRole,
      summary: event.entry.summary,
      details: event.entry.details,
    });
  },
});

const roleRegistry = new RoleRegistry(db);
const messageBus = new MessageBus();
const decisionLog = new DecisionLog(db);
const agentMemory = new AgentMemory(db);
const chatGroupRegistry = new ChatGroupRegistry(db);
const taskDAG = new TaskDAG(db);
const deferredIssueRegistry = new DeferredIssueRegistry(db);
const taskTemplateRegistry = new TaskTemplateRegistry();
const taskDecomposer = new TaskDecomposer(taskTemplateRegistry);
const projectRegistry = new ProjectRegistry(db);

// File dependency graph — tracks import relationships for impact analysis
const fileDependencyGraph = new FileDependencyGraph(repoRoot);

// Auto-retry with exponential backoff — reschedules failed agent tasks
const retryManager = new RetryManager();
retryManager.start();

// Crash forensics — captures diagnostic snapshots when agents crash
const crashForensics = new CrashForensics();

// Notification manager — manages in-app notification preferences and delivery
const notificationManager = new NotificationManager();

// Escalation manager — auto-escalates stuck decisions and blocked tasks
const escalationManager = new EscalationManager(decisionLog, taskDAG);

// Automatic model selector — picks the best AI model based on task complexity
const modelSelector = new ModelSelector();

// Token budget optimizer — allocates context budget proportional to task importance
const tokenBudgetOptimizer = new TokenBudgetOptimizer();

// Cost tracker — per-agent per-task token usage attribution
import { CostTracker } from './agents/CostTracker.js';
const costTracker = new CostTracker(db);

// Meeting summarizer — synthesizes group chat outcomes into structured meeting notes
const meetingSummarizer = new MeetingSummarizer();

// Report generator — produces HTML/Markdown session summary reports
const reportGenerator = new ReportGenerator();

// Project template registry — reusable templates for bootstrapping new projects
const projectTemplateRegistry = new ProjectTemplateRegistry();

// Knowledge transfer — cross-project knowledge sharing and pattern library
const knowledgeTransfer = new KnowledgeTransfer();

// Eager Scheduler — pre-assigns tasks that are 1 dep away from ready
const eagerScheduler = new EagerScheduler(taskDAG);
eagerScheduler.start();

// Timer system — agents can set named timers with custom messages
import { TimerRegistry } from './coordination/TimerRegistry.js';
const timerRegistry = new TimerRegistry(db.drizzle);
timerRegistry.start();

// Dynamic Role Morphing — agents acquire capabilities on demand
import { CapabilityInjector } from './agents/capabilities/CapabilityInjector.js';
const capabilityInjector = new CapabilityInjector();

// Git worktree isolation — each agent gets its own working copy
import { WorktreeManager } from './coordination/WorktreeManager.js';
const worktreeManager = new WorktreeManager(repoRoot, lockRegistry);
worktreeManager.cleanupOrphans().catch(err => {
  console.warn(`[worktree] Orphan cleanup failed on startup: ${err.message}`);
});

const agentManager = new AgentManager(config, roleRegistry, lockRegistry, activityLedger, messageBus, decisionLog, agentMemory, chatGroupRegistry, taskDAG, { db, deferredIssueRegistry, timerRegistry, capabilityInjector, taskTemplateRegistry, taskDecomposer, worktreeManager, costTracker });
agentManager.setProjectRegistry(projectRegistry);
const contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger);
const wsServer = new WebSocketServer(httpServer, agentManager, lockRegistry, activityLedger, decisionLog, chatGroupRegistry);

// CI runner — auto-builds and tests after commits, reports results to agents
import { CIRunner } from './coordination/CIRunner.js';
const ciRunner = new CIRunner({
  cwd: repoRoot,
  getAgent: (id) => agentManager.get(id),
  getAllAgents: () => agentManager.getAll(),
  activityLedger,
  taskDAG,
});
eventPipeline.register(ciRunner.createHandler());
ciRunner.on('ci:complete', (result: { success: boolean }) => {
  wsServer.broadcastEvent({ type: 'ci:complete', success: result.success });
  // CI events are global — no project scoping (they apply to the shared repo)
});

// Proactive alert engine — watches for stuck agents, context pressure, stale decisions
import { AlertEngine } from './coordination/AlertEngine.js';
const alertEngine = new AlertEngine(agentManager, lockRegistry, decisionLog, activityLedger, taskDAG);
alertEngine.start();
alertEngine.on('alert:new', (alert) => {
  wsServer.broadcastEvent({ type: 'alert:new', alert }, alert.projectId);
});

// Capability registry — tracks which agents have expertise on which files/technologies
import { CapabilityRegistry } from './coordination/CapabilityRegistry.js';
const capabilityRegistry = new CapabilityRegistry(db, lockRegistry, () => agentManager.getAll());
lockRegistry.on('lock:acquired', ({ agentId, agentRole, filePath }: { agentId: string; agentRole: string; filePath: string }) => {
  const agent = agentManager.get(agentId);
  const leadId = agent?.parentId ?? agentId;
  capabilityRegistry.recordFileTouch(agentId, agentRole, leadId, filePath);
});

// Agent matcher — scores and ranks agents for task delegation
import { AgentMatcher } from './coordination/AgentMatcher.js';
const agentMatcher = new AgentMatcher(agentManager, capabilityRegistry, activityLedger);

// Wire timer events — inject reminder messages into agents + broadcast to UI
timerRegistry.on('timer:fired', (timer: { agentId: string; label: string; message: string }) => {
  const agent = agentManager.get(timer.agentId);
  // Deliver to any non-terminal agent — queueMessage handles both idle (immediate) and running (queued)
  if (agent && agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'terminated') {
    agent.queueMessage(`[System Timer "${timer.label}"] ${timer.message}`);
  }
  const timerProjectId = agentManager.getProjectIdForAgent(timer.agentId);
  wsServer.broadcastEvent({ type: 'timer:fired', timer }, timerProjectId);
});
timerRegistry.on('timer:created', (timer: { id: string; agentId: string; label: string }) => {
  const timerProjectId = agentManager.getProjectIdForAgent(timer.agentId);
  wsServer.broadcastEvent({ type: 'timer:created', timer }, timerProjectId);
});
timerRegistry.on('timer:cancelled', (timer: { id: string; agentId: string; label: string }) => {
  const timerProjectId = agentManager.getProjectIdForAgent(timer.agentId);
  wsServer.broadcastEvent({ type: 'timer:cancelled', timer }, timerProjectId);
});

// Wire dag:updated → eager scheduler re-evaluates immediately on any DAG change
taskDAG.on('dag:updated', () => eagerScheduler.evaluate());

// Wire eager scheduler task:ready → notify the running lead agent
eagerScheduler.on('task:ready', ({ taskId }: { taskId: string }) => {
  const lead = agentManager.getAll().find(a => a.role?.id === 'lead' && a.status === 'running');
  if (lead) {
    lead.sendMessage(
      `[System] ⚡ Eager Scheduler: task now ready: ${taskId.slice(0, 8)}`,
    );
  }
});

// Register scheduled background tasks
const scheduler = new Scheduler();
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

// Session retrospective data collection
import { SessionRetro } from './coordination/SessionRetro.js';
const sessionRetro = new SessionRetro(db, agentManager, activityLedger, decisionLog, taskDAG, lockRegistry);

// Session exporter
import { SessionExporter } from './coordination/SessionExporter.js';
const sessionExporter = new SessionExporter(agentManager, activityLedger, decisionLog, taskDAG, chatGroupRegistry);

// Search engine — full-text search across activities and decisions
import { SearchEngine } from './coordination/SearchEngine.js';
const searchEngine = new SearchEngine(activityLedger, decisionLog);

// Decision record store — structured ADR-style architecture decision log
import { DecisionRecordStore } from './coordination/DecisionRecords.js';
const decisionRecordStore = new DecisionRecordStore();
// Auto-sync new decisions into the record store as they are added
decisionLog.on('decision', (decision: import('./coordination/DecisionLog.js').Decision) => {
  decisionRecordStore.createFromDecision(decision);
});

// Performance scorecard tracker
import { PerformanceTracker } from './coordination/PerformanceScorecard.js';
const performanceTracker = new PerformanceTracker(activityLedger, agentManager);

// Code quality automation
import { CoverageTracker } from './coordination/CoverageTracker.js';
import { ComplexityMonitor } from './coordination/ComplexityMonitor.js';
import { DependencyScanner } from './coordination/DependencyScanner.js';
const coverageTracker = new CoverageTracker();
const complexityMonitor = new ComplexityMonitor(repoRoot);
const dependencyScanner = new DependencyScanner(repoRoot);

// Wire up API routes
app.use('/api', apiRouter(agentManager, roleRegistry, config, db, lockRegistry, activityLedger, decisionLog, projectRegistry, alertEngine, capabilityRegistry, sessionRetro, sessionExporter, eagerScheduler, fileDependencyGraph, agentMatcher, retryManager, crashForensics, webhookManager, taskTemplateRegistry, taskDecomposer, searchEngine, performanceTracker, decisionRecordStore, coverageTracker, complexityMonitor, dependencyScanner, notificationManager, escalationManager, modelSelector, tokenBudgetOptimizer, meetingSummarizer, reportGenerator, projectTemplateRegistry, knowledgeTransfer, eventPipeline));

// Serve built web frontend in production
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
      // Deliver token via HttpOnly cookie — never embed secrets in HTML
      res.cookie('flightdeck-token', secret, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });
    }
    res.type('html').send(indexHtml);
  });
}

httpServer.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}`;
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
  contextRefresher.start();
  escalationManager.start();
});

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  contextRefresher.stop();
  scheduler.stop();
  eagerScheduler.stop();
  retryManager.stop();
  escalationManager.stop();
  wsServer.close();
  agentManager.shutdownAll();
  activityLedger.stop();
  timerRegistry.stop();
  lockRegistry.stopExpiryCheck();
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
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled promise rejection:', reason);
  gracefulShutdown('unhandledRejection');
});
