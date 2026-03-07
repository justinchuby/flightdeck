import { Router } from 'express';
import type { AgentManager } from './agents/AgentManager.js';
import type { RoleRegistry } from './agents/RoleRegistry.js';
import type { ServerConfig } from './config.js';
import type { Database } from './db/database.js';
import type { FileLockRegistry } from './coordination/FileLockRegistry.js';
import type { ActivityLedger } from './coordination/ActivityLedger.js';
import type { DecisionLog } from './coordination/DecisionLog.js';
import type { FileDependencyGraph } from './coordination/FileDependencyGraph.js';
import type { AgentMatcher } from './coordination/AgentMatcher.js';
import type { RetryManager } from './agents/RetryManager.js';
import type { CrashForensics } from './agents/CrashForensics.js';
import type { WebhookManager } from './coordination/WebhookManager.js';
import type { SearchEngine } from './coordination/SearchEngine.js';
import type { DecisionRecordStore } from './coordination/DecisionRecords.js';
import type { ModelSelector } from './agents/ModelSelector.js';
import type { TokenBudgetOptimizer } from './agents/TokenBudgetOptimizer.js';
import type { ReportGenerator } from './coordination/ReportGenerator.js';
import type { AppContext } from './routes/context.js';
import { mountAllRoutes } from './routes/index.js';

export function apiRouter(
  agentManager: AgentManager,
  roleRegistry: RoleRegistry,
  config: ServerConfig,
  _db: Database,
  lockRegistry: FileLockRegistry,
  activityLedger: ActivityLedger,
  decisionLog: DecisionLog,
  projectRegistry?: import('./projects/ProjectRegistry.js').ProjectRegistry,
  alertEngine?: import('./coordination/AlertEngine.js').AlertEngine,
  capabilityRegistry?: import('./coordination/CapabilityRegistry.js').CapabilityRegistry,
  sessionRetro?: import('./coordination/SessionRetro.js').SessionRetro,
  sessionExporter?: import('./coordination/SessionExporter.js').SessionExporter,
  eagerScheduler?: import('./tasks/EagerScheduler.js').EagerScheduler,
  fileDependencyGraph?: FileDependencyGraph,
  agentMatcher?: AgentMatcher,
  retryManager?: RetryManager,
  crashForensics?: CrashForensics,
  webhookManager?: WebhookManager,
  taskTemplateRegistry?: import('./tasks/TaskTemplates.js').TaskTemplateRegistry,
  taskDecomposer?: import('./tasks/TaskDecomposer.js').TaskDecomposer,
  searchEngine?: SearchEngine,
  performanceTracker?: import('./coordination/PerformanceScorecard.js').PerformanceTracker,
  decisionRecordStore?: DecisionRecordStore,
  coverageTracker?: import('./coordination/CoverageTracker.js').CoverageTracker,
  complexityMonitor?: import('./coordination/ComplexityMonitor.js').ComplexityMonitor,
  dependencyScanner?: import('./coordination/DependencyScanner.js').DependencyScanner,
  notificationManager?: import('./coordination/NotificationManager.js').NotificationManager,
  escalationManager?: import('./coordination/EscalationManager.js').EscalationManager,
  modelSelector?: ModelSelector,
  tokenBudgetOptimizer?: TokenBudgetOptimizer,
  reportGenerator?: ReportGenerator,
  projectTemplateRegistry?: import('./coordination/ProjectTemplates.js').ProjectTemplateRegistry,
  knowledgeTransfer?: import('./coordination/KnowledgeTransfer.js').KnowledgeTransfer,
  eventPipeline?: import('./coordination/EventPipeline.js').EventPipeline,
): Router {
  const router = Router();

  const ctx: AppContext = {
    agentManager,
    roleRegistry,
    config,
    db: _db,
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
  };

  mountAllRoutes(router, ctx);


  return router;
}
