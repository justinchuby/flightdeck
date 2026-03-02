import type { AgentManager } from '../agents/AgentManager.js';
import type { RoleRegistry } from '../agents/RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { Database } from '../db/database.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { FileDependencyGraph } from '../coordination/FileDependencyGraph.js';
import type { AgentMatcher } from '../coordination/AgentMatcher.js';
import type { RetryManager } from '../agents/RetryManager.js';
import type { CrashForensics } from '../agents/CrashForensics.js';
import type { WebhookManager } from '../coordination/WebhookManager.js';
import type { SearchEngine } from '../coordination/SearchEngine.js';
import type { DecisionRecordStore } from '../coordination/DecisionRecords.js';
import type { ModelSelector } from '../agents/ModelSelector.js';
import type { TokenBudgetOptimizer } from '../agents/TokenBudgetOptimizer.js';
import type { ReportGenerator } from '../coordination/ReportGenerator.js';
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
  alertEngine?: import('../coordination/AlertEngine.js').AlertEngine;
  capabilityRegistry?: import('../coordination/CapabilityRegistry.js').CapabilityRegistry;
  sessionRetro?: import('../coordination/SessionRetro.js').SessionRetro;
  sessionExporter?: import('../coordination/SessionExporter.js').SessionExporter;
  eagerScheduler?: import('../tasks/EagerScheduler.js').EagerScheduler;
  fileDependencyGraph?: FileDependencyGraph;
  agentMatcher?: AgentMatcher;
  retryManager?: RetryManager;
  crashForensics?: CrashForensics;
  webhookManager?: WebhookManager;
  taskTemplateRegistry?: import('../tasks/TaskTemplates.js').TaskTemplateRegistry;
  taskDecomposer?: import('../tasks/TaskDecomposer.js').TaskDecomposer;
  searchEngine?: SearchEngine;
  performanceTracker?: import('../coordination/PerformanceScorecard.js').PerformanceTracker;
  decisionRecordStore?: DecisionRecordStore;
  coverageTracker?: import('../coordination/CoverageTracker.js').CoverageTracker;
  complexityMonitor?: import('../coordination/ComplexityMonitor.js').ComplexityMonitor;
  dependencyScanner?: import('../coordination/DependencyScanner.js').DependencyScanner;
  notificationManager?: import('../coordination/NotificationManager.js').NotificationManager;
  escalationManager?: import('../coordination/EscalationManager.js').EscalationManager;
  modelSelector?: ModelSelector;
  tokenBudgetOptimizer?: TokenBudgetOptimizer;
  meetingSummarizer?: import('../coordination/MeetingSummarizer.js').MeetingSummarizer;
  reportGenerator?: ReportGenerator;
  projectTemplateRegistry?: import('../coordination/ProjectTemplates.js').ProjectTemplateRegistry;
  knowledgeTransfer?: import('../coordination/KnowledgeTransfer.js').KnowledgeTransfer;
  eventPipeline?: import('../coordination/EventPipeline.js').EventPipeline;
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
