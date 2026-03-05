// Self-Healing Crews types — aligned with backend RecoveryService

export interface HandoffBriefing {
  id: string;
  narrative: string;
  lastMessages: Array<{ role: string; content: string }>;
  currentTask: { id: string; title: string; progress: string } | null;
  uncommittedChanges: Array<{ file: string; additions: number; deletions: number }>;
  activeIntentRules: string[];
  discoveries: string[];
  contextUsageAtCrash: number;
}

export type RecoveryTrigger = 'crash' | 'unresponsive' | 'context_exhaustion' | 'manual';
export type RecoveryStatus = 'detecting' | 'generating_briefing' | 'awaiting_review' | 'restarting' | 'recovered' | 'failed';

export interface RecoveryEvent {
  id: string;
  sessionId: string;
  originalAgentId: string;
  replacementAgentId: string | null;
  trigger: RecoveryTrigger;
  status: RecoveryStatus;
  briefing: HandoffBriefing | null;
  attempts: number;
  startedAt: string;
  recoveredAt: string | null;
  failedAt: string | null;
  preservedFiles: string[];
  transferredLocks: string[];
}

export interface RecoveryMetrics {
  sessionId: string;
  totalCrashes: number;
  totalRecoveries: number;
  successRate: number;
  avgRecoveryTimeMs: number;
  tasksCompletedPostRecovery: number;
  tasksAssignedPostRecovery: number;
}

export interface RecoverySettings {
  autoRestart: boolean;
  reviewHandoffs: boolean;
  autoCompact: boolean;
  maxAttempts: number;
}

// ── Display helpers ────────────────────────────────────────────────

export const TRIGGER_LABELS: Record<RecoveryTrigger, string> = {
  crash: 'Crash',
  unresponsive: 'Unresponsive',
  context_exhaustion: 'Context exhaustion',
  manual: 'Manual',
};

export const STATUS_DISPLAY: Record<RecoveryStatus, { label: string; icon: string; color: string }> = {
  detecting: { label: 'Detecting...', icon: '⚠', color: 'text-yellow-500' },
  generating_briefing: { label: 'Recovering...', icon: '🔄', color: 'text-blue-400' },
  awaiting_review: { label: 'Handoff ready', icon: '🔄', color: 'text-amber-400' },
  restarting: { label: 'Restarting...', icon: '🔄', color: 'text-blue-400' },
  recovered: { label: 'Recovered', icon: '✅', color: 'text-green-500' },
  failed: { label: 'Recovery failed', icon: '❌', color: 'text-red-500' },
};
