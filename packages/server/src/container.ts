// packages/server/src/container.ts
// DI Container — builds all services in dependency order with lifecycle management.
// Routes receive AppContext (unchanged). Only index.ts sees ServiceContainer.

import { createServer, type Server as HttpServer } from 'http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { ServerConfig } from './config.js';
import { updateConfig, getConfig } from './config.js';
import type { AppContext } from './routes/context.js';

// ── Imports: Tier 0 (Config/DB) ────────────────────────────
import { Database } from './db/database.js';
import { ConfigStore } from './config/ConfigStore.js';

// ── Imports: Tier 1 (Core Registries) ──────────────────────
import { FileLockRegistry } from './coordination/files/FileLockRegistry.js';
import { ActivityLedger } from './coordination/activity/ActivityLedger.js';
import { RoleRegistry } from './agents/RoleRegistry.js';
import { DecisionLog } from './coordination/decisions/DecisionLog.js';
import { AgentMemory } from './agents/AgentMemory.js';
import { ChatGroupRegistry } from './comms/ChatGroupRegistry.js';
import { TaskDAG } from './tasks/TaskDAG.js';
import { DeferredIssueRegistry } from './tasks/DeferredIssueRegistry.js';
import { ProjectRegistry } from './projects/ProjectRegistry.js';
import { TimerRegistry } from './coordination/scheduling/TimerRegistry.js';
import { CostTracker } from './agents/CostTracker.js';
import { MessageQueueStore } from './persistence/MessageQueueStore.js';
import { AgentRosterRepository } from './db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from './db/ActiveDelegationRepository.js';
import { StorageManager } from './storage/StorageManager.js';
import { KnowledgeStore } from './knowledge/KnowledgeStore.js';
import { HybridSearchEngine } from './knowledge/HybridSearchEngine.js';
import { MemoryCategoryManager } from './knowledge/MemoryCategoryManager.js';
import { TrainingCapture } from './knowledge/TrainingCapture.js';
import { KnowledgeInjector } from './knowledge/KnowledgeInjector.js';
import { SessionKnowledgeExtractor } from './knowledge/SessionKnowledgeExtractor.js';
import { CollectiveMemory } from './coordination/knowledge/CollectiveMemory.js';
import { SkillsLoader } from './knowledge/SkillsLoader.js';

import { randomUUID } from 'node:crypto';

// ── Imports: Agent Server Transport & Client ────────────────
import { ForkTransport } from './transport/ForkTransport.js';
import { AgentServerClient } from './agents/AgentServerClient.js';
import { AgentServerHealth } from './agents/AgentServerHealth.js';
import { MassFailureDetector } from './transport/MassFailureDetector.js';
import { AgentReconciliation } from './agents/AgentReconciliation.js';
import type { ExpectedAgent } from './agents/AgentReconciliation.js';

// ── Imports: Tier 2 (Stateless Services) ───────────────────
import { MessageBus } from './comms/MessageBus.js';
import { EventPipeline, taskCompletedHandler, commitQualityGateHandler, delegationTracker } from './coordination/events/EventPipeline.js';
import { TaskTemplateRegistry } from './tasks/TaskTemplates.js';
import { CapabilityInjector } from './agents/capabilities/CapabilityInjector.js';
import { RetryManager } from './agents/RetryManager.js';
import { CrashForensics } from './agents/CrashForensics.js';
import { NotificationManager } from './coordination/alerts/NotificationManager.js';
import { ModelSelector } from './agents/ModelSelector.js';
import { TokenBudgetOptimizer } from './agents/TokenBudgetOptimizer.js';
import { ReportGenerator } from './coordination/reporting/ReportGenerator.js';
import { ProjectTemplateRegistry } from './coordination/playbooks/ProjectTemplates.js';
import { KnowledgeTransfer } from './coordination/knowledge/KnowledgeTransfer.js';
import { DecisionRecordStore } from './coordination/decisions/DecisionRecords.js';
import { CoverageTracker } from './coordination/code-quality/CoverageTracker.js';
import { ComplexityMonitor } from './coordination/code-quality/ComplexityMonitor.js';
import { DependencyScanner } from './coordination/files/DependencyScanner.js';
import { WebhookManager } from './coordination/alerts/WebhookManager.js';

// ── Imports: Tier 3 (Composed) ─────────────────────────────
import { TaskDecomposer } from './tasks/TaskDecomposer.js';
import { FileDependencyGraph } from './coordination/files/FileDependencyGraph.js';
import { WorktreeManager } from './coordination/files/WorktreeManager.js';
import { EscalationManager } from './coordination/alerts/EscalationManager.js';
import { GovernancePipeline } from './governance/GovernancePipeline.js';
import { createPermissionHook, createRateLimitHook, createCommitMessageValidationHook, createFileWriteGuardHook, createShellCommandBlocklistHook, createApprovalGateHook } from './governance/hooks/index.js';
import { EagerScheduler } from './tasks/EagerScheduler.js';
import { SearchEngine } from './coordination/knowledge/SearchEngine.js';

// ── Imports: Tier 4-5 (AgentManager + dependents) ──────────
import { AgentManager } from './agents/AgentManager.js';
import { isTerminalStatus } from './agents/Agent.js';
import { ContextRefresher } from './coordination/agents/ContextRefresher.js';
import { CapabilityRegistry } from './coordination/agents/CapabilityRegistry.js';
import { AlertEngine } from './coordination/alerts/AlertEngine.js';
import { AgentMatcher } from './coordination/agents/AgentMatcher.js';
import { SessionRetro } from './coordination/sessions/SessionRetro.js';
import { SessionExporter } from './coordination/sessions/SessionExporter.js';
import { PerformanceTracker } from './coordination/reporting/PerformanceScorecard.js';
import { SessionResumeManager } from './agents/SessionResumeManager.js';
import { IntegrationRouter } from './integrations/IntegrationRouter.js';
import { NotificationBatcher } from './integrations/NotificationBatcher.js';

// ── Imports: Tier 6 (HTTP/WS) ──────────────────────────────
import { WebSocketServer } from './comms/WebSocketServer.js';
import { Scheduler } from './utils/Scheduler.js';
import { logger } from './utils/logger.js';
import { runWithAgentContext } from './middleware/requestContext.js';

// ── Types ──────────────────────────────────────────────────

export interface ContainerConfig {
  config: ServerConfig;
  repoRoot: string;
}

export interface ServiceContainer extends AppContext {
  /** Shuts down all services with lifecycle methods, in reverse registration order. */
  shutdown(): Promise<void>;

  /** The raw HTTP server instance. Null until wireHttpLayer() is called. */
  httpServer: HttpServer | null;

  /** Services needed for wiring but not exposed to routes. */
  internal: {
    messageBus: MessageBus;
    agentMemory: AgentMemory;
    chatGroupRegistry: ChatGroupRegistry;
    taskDAG: TaskDAG;
    deferredIssueRegistry: DeferredIssueRegistry;
    contextRefresher: ContextRefresher;
    scheduler: Scheduler;
    /** Null until wireHttpLayer() is called. */
    wsServer: WebSocketServer | null;
    worktreeManager: WorktreeManager;
    timerRegistry: TimerRegistry;
    costTracker: CostTracker;
    configStore: ConfigStore;
    messageQueueStore: MessageQueueStore;
    sessionResumeManager: SessionResumeManager;
  };
}

// ── Factory ────────────────────────────────────────────────

export async function createContainer(opts: ContainerConfig): Promise<ServiceContainer> {
  const { config, repoRoot } = opts;
  const stopList: Array<{ name: string; fn: () => void | Promise<void> }> = [];

  function onShutdown(name: string, fn: () => void | Promise<void>): void {
    stopList.push({ name, fn });
  }

  // ── Tier 0: Config & Database ──────────────────────────
  const db = new Database(config.dbPath);
  onShutdown('db', () => db.close());

  // ConfigStore: hot-reloadable config from YAML file (Tier 0 — no service deps)
  // Resolution order: FLIGHTDECK_CONFIG env → repo-level file → ~/.flightdeck/config.yaml
  const repoConfigPath = repoRoot ? join(repoRoot, 'flightdeck.config.yaml') : null;
  const configFilePath = process.env.FLIGHTDECK_CONFIG
    || (repoConfigPath && existsSync(repoConfigPath) ? repoConfigPath : null)
    || join(homedir(), '.flightdeck', 'config.yaml');
  const configStore = new ConfigStore(configFilePath);
  onShutdown('configStore', () => configStore.stop());

  // Apply maxConcurrentAgents from YAML config (single source of truth)
  const yamlMaxAgents = configStore.current.server.maxConcurrentAgents;
  if (yamlMaxAgents) {
    updateConfig({ maxConcurrentAgents: yamlMaxAgents });
  }
  // Re-read config so all services see restored values
  const effectiveConfig = getConfig();

  // ── Tier 1: Core Registries ────────────────────────────
  const lockRegistry = new FileLockRegistry(db);
  lockRegistry.startExpiryCheck();
  onShutdown('lockRegistry', () => {
    lockRegistry.stopExpiryCheck();
    lockRegistry.cleanExpired();
  });

  const activityLedger = new ActivityLedger(db);
  onShutdown('activityLedger', () => activityLedger.stop());

  const roleRegistry = new RoleRegistry(db);
  const decisionLog = new DecisionLog(db);
  const agentMemory = new AgentMemory(db);
  const chatGroupRegistry = new ChatGroupRegistry(db);
  const taskDAG = new TaskDAG(db);
  const deferredIssueRegistry = new DeferredIssueRegistry(db);
  const projectRegistry = new ProjectRegistry(db);
  const storageManager = new StorageManager();
  const knowledgeStore = new KnowledgeStore(db);
  const memoryCategoryManager = new MemoryCategoryManager(knowledgeStore);
  const hybridSearchEngine = new HybridSearchEngine(knowledgeStore);
  const trainingCapture = new TrainingCapture(knowledgeStore);
  const knowledgeInjector = new KnowledgeInjector(memoryCategoryManager, hybridSearchEngine);
  const sessionKnowledgeExtractor = new SessionKnowledgeExtractor(knowledgeStore);
  const collectiveMemory = new CollectiveMemory(db);

  // ── Agent Server Transport & Client ─────────────────────
  // In dev mode (tsx), fork the TypeScript source directly using tsx loader.
  // In production, fork the compiled JS entry point.
  // Detection: tsx sets its loader in process.execArgv, not process.argv.
  const isTsx = process.execArgv.some(a => a.includes('tsx')) || !!process.env.TSX;
  const agentServerScript = isTsx
    ? `${repoRoot}/packages/server/src/agent-server-entry.ts`
    : `${repoRoot}/packages/server/dist/agent-server-entry.js`;
  const agentServerExecArgv = isTsx ? ['--import', 'tsx'] : [];

  const forkTransport = new ForkTransport({
    serverScript: agentServerScript,
    execArgv: agentServerExecArgv,
    stateDir: process.env.FLIGHTDECK_STATE_DIR,
  });
  const agentServerClient = new AgentServerClient(
    forkTransport,
    { projectId: (effectiveConfig as any).projectId ?? 'default', teamId: (effectiveConfig as any).teamId ?? 'default' },
  );
  const agentServerHealth = new AgentServerHealth(
    () => {
      const id = randomUUID();
      // Fire ping and wire the pong response back to health monitor
      agentServerClient.ping()
        .then(() => agentServerHealth.recordPong(id))
        .catch(() => { /* missed pong — health monitor handles via tick */ });
      return id;
    },
  );
  onShutdown('agentServerHealth', () => agentServerHealth.stop());
  onShutdown('agentServerClient', () => { agentServerClient.dispose(); });
  const massFailureDetector = new MassFailureDetector();
  const timerRegistry = new TimerRegistry(db.drizzle);
  const costTracker = new CostTracker(db);
  const messageQueueStore = new MessageQueueStore(db);
  const agentRosterRepository = new AgentRosterRepository(db);
  const activeDelegationRepository = new ActiveDelegationRepository(db);

  // ── Tier 2: Stateless Services ─────────────────────────
  const messageBus = new MessageBus();
  const eventPipeline = new EventPipeline();
  const taskTemplateRegistry = new TaskTemplateRegistry();
  const capabilityInjector = new CapabilityInjector();

  const retryManager = new RetryManager();
  retryManager.start();
  onShutdown('retryManager', () => retryManager.stop());

  const crashForensics = new CrashForensics();
  const notificationManager = new NotificationManager();
  const modelSelector = new ModelSelector();
  const tokenBudgetOptimizer = new TokenBudgetOptimizer();
  const reportGenerator = new ReportGenerator();
  const projectTemplateRegistry = new ProjectTemplateRegistry();
  const knowledgeTransfer = new KnowledgeTransfer();
  const decisionRecordStore = new DecisionRecordStore();
  const coverageTracker = new CoverageTracker();
  const complexityMonitor = new ComplexityMonitor(repoRoot);
  const dependencyScanner = new DependencyScanner(repoRoot);
  const webhookManager = new WebhookManager();

  // ── Tier 3: Composed Services ──────────────────────────
  const taskDecomposer = new TaskDecomposer(taskTemplateRegistry);
  const fileDependencyGraph = new FileDependencyGraph(repoRoot);
  const worktreeManager = new WorktreeManager(repoRoot, lockRegistry);
  worktreeManager.cleanupOrphans().catch(err => {
    console.warn(`[container] Orphan cleanup failed: ${err.message}`);
  });

  const escalationManager = new EscalationManager(decisionLog, taskDAG);

  const eagerScheduler = new EagerScheduler(taskDAG);
  eagerScheduler.start();
  onShutdown('eagerScheduler', () => eagerScheduler.stop());

  const searchEngine = new SearchEngine(activityLedger, decisionLog);

  // GovernancePipeline (Tier 3 — depends on config, not on AgentManager)
  const governancePipeline = new GovernancePipeline({ enabled: true });
  // Register built-in hooks with sensible defaults
  governancePipeline.registerPreHook(createShellCommandBlocklistHook());
  governancePipeline.registerPreHook(createPermissionHook({
    hasCapability: (agentId, cmd) => capabilityInjector.hasCommand(agentId, cmd),
  }));
  governancePipeline.registerPreHook(createCommitMessageValidationHook());
  governancePipeline.registerPreHook(createRateLimitHook());
  governancePipeline.registerPreHook(createFileWriteGuardHook());
  governancePipeline.registerPreHook(createApprovalGateHook({
    onGate: (action, reason) => {
      decisionLog.add(
        action.agent.id,
        action.agent.roleName,
        `Governance gate: ${action.commandName}`,
        reason,
        true, // needsConfirmation
      );
    },
  }));

  // ── Tier 4: AgentManager ───────────────────────────────
  const agentManager = new AgentManager(
    effectiveConfig, roleRegistry, lockRegistry, activityLedger,
    messageBus, decisionLog, agentMemory, chatGroupRegistry,
    taskDAG, {
      db, deferredIssueRegistry, timerRegistry, capabilityInjector,
      taskTemplateRegistry, taskDecomposer, worktreeManager, costTracker,
      governancePipeline, messageQueueStore, agentRosterRepository, activeDelegationRepository,
      agentServerClient, knowledgeInjector,
    },
  );
  agentManager.setProjectRegistry(projectRegistry);
  agentManager.setSessionKnowledgeExtractor(sessionKnowledgeExtractor);
  agentManager.setCollectiveMemory(collectiveMemory);
  agentManager.setConfigStore(configStore);
  const skillsLoader = new SkillsLoader(join(repoRoot, '.github/skills'));
  skillsLoader.loadAll();
  skillsLoader.startWatching();
  agentManager.setSkillsLoader(skillsLoader);
  onShutdown('skillsLoader', () => skillsLoader.stopWatching());
  onShutdown('agentManager', () => agentManager.shutdownAll());

  // SessionResumeManager: persists agent roster on lifecycle events, handles resume on startup
  const sessionResumeManager = new SessionResumeManager(agentManager, agentRosterRepository, activeDelegationRepository, roleRegistry, effectiveConfig);
  onShutdown('sessionResumeManager', () => sessionResumeManager.dispose());

  // ── Tier 5: AgentManager-dependent services ────────────
  const contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger);
  const capabilityRegistry = new CapabilityRegistry(db, lockRegistry, () => agentManager.getAll());
  const alertEngine = new AlertEngine(agentManager, lockRegistry, decisionLog, activityLedger, taskDAG);
  alertEngine.start();
  onShutdown('alertEngine', () => alertEngine.stop());

  const agentMatcher = new AgentMatcher(agentManager, capabilityRegistry, activityLedger);
  const sessionRetro = new SessionRetro(db, agentManager, activityLedger, decisionLog, taskDAG, lockRegistry);
  const sessionExporter = new SessionExporter(agentManager, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
  const performanceTracker = new PerformanceTracker(activityLedger, agentManager);

  // ── Integration Agent (Telegram/Slack messaging) ────────
  const notificationBatcher = new NotificationBatcher();
  const integrationRouter = new IntegrationRouter(
    agentManager,
    projectRegistry,
    configStore,
    notificationBatcher,
  );
  // Start asynchronously — don't block container creation
  integrationRouter.start().catch(err => {
    logger.warn({ module: 'container', msg: 'IntegrationRouter failed to start', error: (err as Error).message });
  });
  // Wire IntegrationRouter into CommandDispatcher for TELEGRAM_REPLY
  agentManager.setIntegrationRouter(integrationRouter);
  onShutdown('integrationRouter', () => integrationRouter.stop());

  // ── Timers & Scheduler ─────────────────────────────────
  timerRegistry.start();
  onShutdown('timerRegistry', () => timerRegistry.stop());

  const scheduler = new Scheduler();
  scheduler.register({
    id: 'activity-log-prune',
    interval: 3_600_000,
    run: () => {
      activityLedger.pruneByAge(7); // Remove entries older than 7 days
      activityLedger.prune(50_000); // Then cap at 50k entries
    },
  });
  scheduler.register({
    id: 'stale-delegation-cleanup',
    interval: 300_000,
    run: () => { agentManager.cleanupStaleDelegations(); },
  });
  scheduler.register({
    id: 'wal-size-monitor',
    interval: 1_800_000, // 30 minutes
    run: () => {
      const { warning } = db.checkWalSize(100 * 1024 * 1024); // 100MB threshold
      if (warning) {
        db.walCheckpoint('PASSIVE');
      }
    },
  });
  scheduler.register({
    id: 'message-queue-cleanup',
    interval: 3_600_000, // 1 hour
    run: () => {
      messageQueueStore.cleanup(7);   // Remove delivered messages older than 7 days
      messageQueueStore.expireStale(3); // Expire queued messages older than 3 days
    },
  });
  scheduler.register({
    id: 'collective-memory-prune',
    interval: 86_400_000, // 24 hours
    run: () => { collectiveMemory.prune(90); }, // Remove memories unused for 90 days
  });
  onShutdown('scheduler', () => scheduler.stop());

  onShutdown('escalationManager', () => escalationManager.stop());

  // ── Build the container object ─────────────────────────
  const container: ServiceContainer = {
    // AppContext fields (used by routes)
    agentManager,
    roleRegistry,
    config: effectiveConfig,
    db,
    lockRegistry,
    activityLedger,
    decisionLog,
    projectRegistry,
    alertEngine,
    capabilityRegistry,
    sessionRetro,
    sessionExporter,
    eagerScheduler,
    fileDependencyGraph,
    agentMatcher,
    retryManager,
    crashForensics,
    webhookManager,
    taskTemplateRegistry,
    taskDecomposer,
    searchEngine,
    performanceTracker,
    decisionRecordStore,
    coverageTracker,
    complexityMonitor,
    dependencyScanner,
    notificationManager,
    escalationManager,
    modelSelector,
    tokenBudgetOptimizer,
    reportGenerator,
    projectTemplateRegistry,
    knowledgeTransfer,
    eventPipeline,
    costTracker,
    storageManager,
    knowledgeStore,
    hybridSearchEngine,
    memoryCategoryManager,
    trainingCapture,
    sessionKnowledgeExtractor,
    collectiveMemory,
    agentServerClient,
    agentServerHealth,
    massFailureDetector,
    agentRoster: agentRosterRepository,
    integrationRouter,
    configStore,

    // Lifecycle
    async shutdown() {
      for (const { name, fn } of [...stopList].reverse()) {
        try { await Promise.resolve(fn()); } catch (err) {
          console.warn(`[container] ${name} shutdown failed:`, err);
        }
      }
    },

    // HTTP server and WS server — set via wireHttpLayer() after Express app creation
    httpServer: null,

    // Internal services (not exposed to routes)
    internal: {
      messageBus,
      agentMemory,
      chatGroupRegistry,
      taskDAG,
      deferredIssueRegistry,
      contextRefresher,
      scheduler,
      wsServer: null,
      worktreeManager,
      timerRegistry,
      costTracker,
      configStore,
      messageQueueStore,
      sessionResumeManager,
    },
  };

  // ── Wire cross-service events ──────────────────────────
  wireEvents(container);

  // Register reconciliation listener cleanup for shutdown (H-12)
  if (container.agentServerClient) {
    const unsubReconciliation = wireReconciliationOnReconnect(
      container.agentServerClient, container.agentManager, container.internal.wsServer,
    );
    onShutdown('reconciliationListener', unsubReconciliation);
  }

  return container;
}

/**
 * Two-stage construction: wires the HTTP server and WebSocket server into
 * the container after Express app creation. This avoids scattering the
 * HTTP-layer setup across index.ts by providing a single call site.
 */
export function wireHttpLayer(
  container: ServiceContainer,
  httpServer: HttpServer,
  wsServer: WebSocketServer,
): void {
  container.httpServer = httpServer;
  container.internal.wsServer = wsServer;

  // Wire alert → WS broadcast (deferred from createContainer because
  // wsServer needs httpServer which needs the Express app)
  container.alertEngine?.on('alert:new', (alert: any) => {
    wsServer.broadcastEvent({ type: 'alert:new', alert }, alert.projectId);
  });

  // Wire agent server health → WS broadcast for UI status banner (AS17)
  if (container.agentServerHealth) {
    wsServer.wireAgentServerHealth(container.agentServerHealth);
  }
}

// ── Event Wiring ───────────────────────────────────────────

function wireEvents(c: ServiceContainer): void {
  const {
    eventPipeline, activityLedger, lockRegistry, decisionLog,
    alertEngine, eagerScheduler, agentManager, webhookManager,
    capabilityRegistry, decisionRecordStore, agentServerClient,
  } = c;
  const { taskDAG, timerRegistry, configStore } = c.internal;

  // EventPipeline handlers
  eventPipeline!.register(taskCompletedHandler);
  eventPipeline!.register(commitQualityGateHandler);
  eventPipeline!.register(delegationTracker);
  eventPipeline!.connectToLedger(activityLedger);

  // Webhook relay
  eventPipeline!.register({
    name: 'webhook-relay',
    eventTypes: '*',
    handle: (event: any) => {
      webhookManager?.fire(event.entry.actionType, {
        agentId: event.entry.agentId,
        agentRole: event.entry.agentRole,
        summary: event.entry.summary,
        details: event.entry.details,
      });
    },
  });

  // Timer events → agent message delivery + WS broadcast
  timerRegistry.on('timer:fired', (timer: { agentId: string; label: string; message: string }) => {
    const agent = agentManager.get(timer.agentId);
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    runWithAgentContext(timer.agentId, agent?.role.name ?? 'unknown', projectId, () => {
      if (agent && agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'terminated') {
        agent.queueMessage(`[System Timer "${timer.label}"] ${timer.message}`);
      }
      c.internal.wsServer?.broadcastEvent({ type: 'timer:fired', timer }, projectId);
    });
  });
  timerRegistry.on('timer:created', (timer: { id: string; agentId: string; label: string }) => {
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    c.internal.wsServer?.broadcastEvent({ type: 'timer:created', timer }, projectId);
  });
  timerRegistry.on('timer:cancelled', (timer: { id: string; agentId: string; label: string }) => {
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    c.internal.wsServer?.broadcastEvent({ type: 'timer:cancelled', timer }, projectId);
  });

  // DAG → Eager scheduler re-evaluation
  taskDAG.on('dag:updated', () => eagerScheduler!.evaluate());

  // Eager scheduler → Lead notification
  eagerScheduler!.on('task:ready', ({ taskId }: { taskId: string }) => {
    const lead = agentManager.getAll().find(a => a.role?.id === 'lead' && a.status === 'running');
    if (lead) {
      lead.sendMessage(`[System] ⚡ Eager Scheduler: task now ready: ${taskId.slice(0, 8)}`);
    }
  });

  // Lock events → Capability registry
  lockRegistry.on('lock:acquired', ({ agentId, agentRole, filePath }: { agentId: string; agentRole: string; filePath: string }) => {
    const agent = agentManager.get(agentId);
    const leadId = agent?.parentId ?? agentId;
    capabilityRegistry!.recordFileTouch(agentId, agentRole, leadId, filePath);
  });

  // Decision log → Decision record store
  decisionLog.on('decision', (decision: any) => {
    decisionRecordStore!.createFromDecision(decision);
  });

  // ── ConfigStore hot-reload consumers ───────────────────
  configStore.on('config:server:changed', ({ config: serverCfg }: any) => {
    if (serverCfg.maxConcurrentAgents != null) {
      agentManager.setMaxConcurrent(serverCfg.maxConcurrentAgents);
      updateConfig({ maxConcurrentAgents: serverCfg.maxConcurrentAgents });
    }
  });

  configStore.on('config:reloaded', () => {
    c.internal.wsServer?.broadcastEvent({ type: 'config:reloaded' });
  });

  // Start the watcher (safe to call here — watcher uses polling + fs.watch)
  configStore.start();

  // Alert engine → WS broadcast is wired in wireHttpLayer() after HTTP server creation
}

// ── Test Helper ────────────────────────────────────────────

// ── Reconciliation Wiring ──────────────────────────────────

/**
 * Wire AgentReconciliation to auto-run when the agent server client reconnects.
 * Skips the initial connect (no agents to reconcile) and only runs on
 * subsequent reconnects when there are non-terminal agents to verify.
 */
export function wireReconciliationOnReconnect(
  agentServerClient: AgentServerClient,
  agentManager: AgentManager,
  wsServer?: { broadcastEvent: (event: any, projectId?: string) => void } | null,
): () => void {
  const reconciliation = new AgentReconciliation(agentServerClient);
  let hasConnectedBefore = false;
  let isReconciling = false;

  const handler = () => {
    if (!hasConnectedBefore) {
      hasConnectedBefore = true;
      return; // Skip reconciliation on initial connect
    }

    if (isReconciling) return; // Prevent concurrent reconciliation on rapid reconnects

    const nonTerminalAgents = agentManager.getAll().filter(
      a => !isTerminalStatus(a.status),
    );
    if (nonTerminalAgents.length === 0) return;

    const expectedAgents: ExpectedAgent[] = nonTerminalAgents.map(a => ({
      agentId: a.id,
      role: a.role?.id ?? 'unknown',
      model: a.model ?? 'unknown',
      lastSeenEventId: agentServerClient.getLastSeenEventId(a.id),
    }));

    isReconciling = true;
    reconciliation.reconcile(expectedAgents)
      .then(report => {
        logger.info({
          module: 'reconciliation',
          msg: 'Agent reconciliation completed after reconnect',
          reconnected: report.reconnected.length,
          lost: report.lost.length,
          discovered: report.discovered.length,
        });
        wsServer?.broadcastEvent({
          type: 'reconciliation:complete',
          report,
        });
      })
      .catch(err => {
        logger.warn({
          module: 'reconciliation',
          msg: 'Agent reconciliation failed after reconnect',
          error: err.message,
        });
      })
      .finally(() => {
        isReconciling = false;
      });
  };

  agentServerClient.on('connected', handler);

  // Return unsubscribe function for shutdown cleanup
  return () => { agentServerClient.removeListener('connected', handler); };
}

/**
 * Creates a container with an in-memory database for testing.
 * Returns a fully-wired ServiceContainer that should be shut down after use.
 * Useful for integration tests that need real services without file I/O.
 */
export async function createTestContainer(
  overrides: Partial<ContainerConfig> = {},
): Promise<ServiceContainer> {
  const testConfig: ContainerConfig = {
    config: {
      port: 0,
      host: '127.0.0.1',
      cliCommand: 'copilot',
      cliArgs: [],
      provider: 'copilot',
      maxConcurrentAgents: 10,
      dbPath: ':memory:',
      ...overrides.config,
    } as ServerConfig,
    repoRoot: overrides.repoRoot ?? process.cwd(),
  };
  return createContainer(testConfig);
}
