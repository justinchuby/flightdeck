import type { AgentManager } from '../agents/AgentManager.js';
import type { RoleRegistry } from '../agents/RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { Database } from '../db/database.js';
import type { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import type { DecisionLog } from '../coordination/decisions/DecisionLog.js';
import type { FileDependencyGraph } from '../coordination/files/FileDependencyGraph.js';
import type { AgentMatcher } from '../coordination/agents/AgentMatcher.js';
import type { RetryManager } from '../agents/RetryManager.js';
import type { CrashForensics } from '../agents/CrashForensics.js';
import type { WebhookManager } from '../coordination/alerts/WebhookManager.js';
import type { SearchEngine } from '../coordination/knowledge/SearchEngine.js';
import type { DecisionRecordStore } from '../coordination/decisions/DecisionRecords.js';
import type { ModelSelector } from '../agents/ModelSelector.js';
import type { TokenBudgetOptimizer } from '../agents/TokenBudgetOptimizer.js';
import type { ReportGenerator } from '../coordination/reporting/ReportGenerator.js';
import type { StorageManager } from '../storage/StorageManager.js';
import type { KnowledgeStore } from '../knowledge/KnowledgeStore.js';
import type { HybridSearchEngine } from '../knowledge/HybridSearchEngine.js';
import type { MemoryCategoryManager } from '../knowledge/MemoryCategoryManager.js';
import type { TrainingCapture } from '../knowledge/TrainingCapture.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { execSync } from 'node:child_process';

export interface AppContext {
  agentManager: AgentManager;
  roleRegistry: RoleRegistry;
  config: ServerConfig;
  db: Database;
  lockRegistry: FileLockRegistry;
  activityLedger: ActivityLedger;
  decisionLog: DecisionLog;
  projectRegistry?: import('../projects/ProjectRegistry.js').ProjectRegistry;
  alertEngine?: import('../coordination/alerts/AlertEngine.js').AlertEngine;
  capabilityRegistry?: import('../coordination/agents/CapabilityRegistry.js').CapabilityRegistry;
  sessionRetro?: import('../coordination/sessions/SessionRetro.js').SessionRetro;
  sessionExporter?: import('../coordination/sessions/SessionExporter.js').SessionExporter;
  eagerScheduler?: import('../tasks/EagerScheduler.js').EagerScheduler;
  fileDependencyGraph?: FileDependencyGraph;
  agentMatcher?: AgentMatcher;
  retryManager?: RetryManager;
  crashForensics?: CrashForensics;
  webhookManager?: WebhookManager;
  taskTemplateRegistry?: import('../tasks/TaskTemplates.js').TaskTemplateRegistry;
  taskDecomposer?: import('../tasks/TaskDecomposer.js').TaskDecomposer;
  searchEngine?: SearchEngine;
  performanceTracker?: import('../coordination/reporting/PerformanceScorecard.js').PerformanceTracker;
  decisionRecordStore?: DecisionRecordStore;
  coverageTracker?: import('../coordination/code-quality/CoverageTracker.js').CoverageTracker;
  complexityMonitor?: import('../coordination/code-quality/ComplexityMonitor.js').ComplexityMonitor;
  dependencyScanner?: import('../coordination/files/DependencyScanner.js').DependencyScanner;
  notificationManager?: import('../coordination/alerts/NotificationManager.js').NotificationManager;
  escalationManager?: import('../coordination/alerts/EscalationManager.js').EscalationManager;
  modelSelector?: ModelSelector;
  tokenBudgetOptimizer?: TokenBudgetOptimizer;
  reportGenerator?: ReportGenerator;
  projectTemplateRegistry?: import('../coordination/playbooks/ProjectTemplates.js').ProjectTemplateRegistry;
  knowledgeTransfer?: import('../coordination/knowledge/KnowledgeTransfer.js').KnowledgeTransfer;
  eventPipeline?: import('../coordination/events/EventPipeline.js').EventPipeline;
  costTracker?: import('../agents/CostTracker.js').CostTracker;
  storageManager?: StorageManager;
  knowledgeStore?: KnowledgeStore;
  hybridSearchEngine?: HybridSearchEngine;
  memoryCategoryManager?: MemoryCategoryManager;
  trainingCapture?: TrainingCapture;
  sessionKnowledgeExtractor?: import('../knowledge/SessionKnowledgeExtractor.js').SessionKnowledgeExtractor;
  collectiveMemory?: import('../coordination/knowledge/CollectiveMemory.js').CollectiveMemory;
  agentRoster?: import('../db/AgentRosterRepository.js').AgentRosterRepository;
  integrationRouter?: import('../integrations/IntegrationRouter.js').IntegrationRouter;
  providerManager?: import('../providers/ProviderManager.js').ProviderManager;
  configStore?: import('../config/ConfigStore.js').ConfigStore;
}

// Rate limiters for expensive operations
export const spawnLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many agent spawn requests' });
export const messageLimiter = rateLimit({ windowMs: 10_000, max: 50, message: 'Too many messages' });

// ── Helper: recent git commits ─────────────────────────────────────────────
export function getRecentCommits(limit = 20): Array<{ hash: string; message: string }> {
  try {
    const raw = execSync(
      'git log --format="%H|%s" -' + limit,
      { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    if (!raw) return [];
    return raw.split('\n').map(line => {
      const idx = line.indexOf('|');
      return { hash: line.slice(0, idx), message: line.slice(idx + 1) };
    });
  } catch {
    return [];
  }
}
