import { EventEmitter } from 'events';
import type { Database } from '../../db/database.js';
import type { FileLockRegistry } from '../files/FileLockRegistry.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import type { DecisionLog } from '../decisions/DecisionLog.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type RecoveryTrigger = 'crash' | 'unresponsive' | 'context_exhaustion' | 'manual';
export type RecoveryStatus = 'detecting' | 'generating_briefing' | 'awaiting_review' | 'restarting' | 'recovered' | 'failed';

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

export interface RecoverySettings {
  autoRestart: boolean;
  reviewHandoffs: boolean;
  maxAttempts: number;
}

export interface RecoveryMetrics {
  totalCrashes: number;
  totalRecoveries: number;
  successRate: number;
  avgRecoveryTimeMs: number;
  tasksCompletedPostRecovery: number;
  recoveryEvents: Array<{ trigger: RecoveryTrigger; count: number }>;
}

const DEFAULT_SETTINGS: RecoverySettings = {
  autoRestart: true,
  reviewHandoffs: false,
  maxAttempts: 3,
};

const SETTINGS_KEY = 'recovery_settings';
const EVENTS_KEY = 'recovery_events';

// ── RecoveryService ───────────────────────────────────────────────

export class RecoveryService extends EventEmitter {
  private events: RecoveryEvent[] = [];
  private settings: RecoverySettings;

  constructor(
    private db: Database,
    private lockRegistry: FileLockRegistry,
    private activityLedger: ActivityLedger,
    private decisionLog: DecisionLog,
  ) {
    super();
    this.settings = this.loadSettings();
    this.loadEvents();
  }

  // ── Settings ──────────────────────────────────────────────────

  getSettings(): RecoverySettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<RecoverySettings>): RecoverySettings {
    if (updates.autoRestart !== undefined) this.settings.autoRestart = updates.autoRestart;
    if (updates.reviewHandoffs !== undefined) this.settings.reviewHandoffs = updates.reviewHandoffs;
    if (updates.maxAttempts !== undefined) {
      this.settings.maxAttempts = Math.max(1, Math.min(10, updates.maxAttempts));
    }
    this.saveSettings();
    return { ...this.settings };
  }

  // ── Recovery Events ───────────────────────────────────────────

  getEvents(): RecoveryEvent[] {
    return [...this.events];
  }

  getEvent(id: string): RecoveryEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  /** Initiate recovery for a crashed/unresponsive agent */
  startRecovery(params: {
    originalAgentId: string;
    trigger: RecoveryTrigger;
    sessionId?: string;
    lastMessages?: Array<{ role: string; content: string }>;
    currentTask?: { id: string; title: string; progress: string } | null;
    contextUsage?: number;
    budgetExhausted?: boolean;
  }): RecoveryEvent | null {
    // Dedup: skip if an active recovery already exists for this agent
    const activeRecovery = this.events.find(
      e => e.originalAgentId === params.originalAgentId &&
           (e.status !== 'recovered' && e.status !== 'failed'),
    );
    if (activeRecovery) {
      logger.info({ module: 'coordination', msg: 'Skipping duplicate recovery', agentId: params.originalAgentId, activeRecoveryId: activeRecovery.id });
      return null;
    }

    // Budget gate: don't auto-restart if budget is exhausted
    if (params.budgetExhausted && this.settings.autoRestart) {
      logger.warn({ module: 'coordination', msg: 'Skipping auto-restart, budget exhausted', agentId: params.originalAgentId });
      const id = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const failedEvent: RecoveryEvent = {
        id,
        sessionId: params.sessionId ?? 'default',
        originalAgentId: params.originalAgentId,
        replacementAgentId: null,
        trigger: params.trigger,
        status: 'failed',
        briefing: null,
        attempts: 0,
        startedAt: new Date().toISOString(),
        recoveredAt: null,
        failedAt: new Date().toISOString(),
        preservedFiles: [],
        transferredLocks: [],
      };
      this.events.push(failedEvent);
      this.saveEvents();
      this.emit('recovery:failed', { recoveryId: id, reason: 'Budget exhausted' });
      return failedEvent;
    }

    const id = `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = params.sessionId ?? 'default';

    // Gather file locks held by the crashed agent
    const agentLocks = this.lockRegistry.getByAgent(params.originalAgentId);
    const preservedFiles = agentLocks.map(l => l.filePath);

    // Generate briefing
    const briefing = this.generateBriefing({
      agentId: params.originalAgentId,
      lastMessages: params.lastMessages ?? [],
      currentTask: params.currentTask ?? null,
      contextUsage: params.contextUsage ?? 0,
      preservedFiles,
    });

    const event: RecoveryEvent = {
      id,
      sessionId,
      originalAgentId: params.originalAgentId,
      replacementAgentId: null,
      trigger: params.trigger,
      status: this.settings.reviewHandoffs ? 'awaiting_review' : 'generating_briefing',
      briefing,
      attempts: 1,
      startedAt: new Date().toISOString(),
      recoveredAt: null,
      failedAt: null,
      preservedFiles,
      transferredLocks: [],
    };

    this.events.push(event);
    this.saveEvents();
    this.emit('recovery:started', { recoveryId: id, agentId: params.originalAgentId, trigger: params.trigger });
    this.emit('recovery:briefing', { recoveryId: id, briefing });

    logger.info({ module: 'coordination', msg: 'Recovery started', agentId: params.originalAgentId, trigger: params.trigger });
    return event;
  }

  /** Approve a handoff briefing and proceed with restart */
  approveRecovery(id: string): RecoveryEvent | null {
    const event = this.events.find(e => e.id === id);
    if (!event || (event.status !== 'awaiting_review' && event.status !== 'generating_briefing')) {
      return null;
    }

    event.status = 'restarting';
    this.saveEvents();
    this.emit('recovery:progress', { recoveryId: id, status: 'restarting', attempt: event.attempts });
    return event;
  }

  /** Mark recovery as completed */
  completeRecovery(id: string, replacementAgentId?: string): RecoveryEvent | null {
    const event = this.events.find(e => e.id === id);
    if (!event) return null;

    event.status = 'recovered';
    event.recoveredAt = new Date().toISOString();
    if (replacementAgentId) event.replacementAgentId = replacementAgentId;

    // Transfer locks to replacement
    if (replacementAgentId && event.preservedFiles.length > 0) {
      event.transferredLocks = [...event.preservedFiles];
    }

    this.saveEvents();
    this.emit('recovery:completed', {
      recoveryId: id,
      originalAgentId: event.originalAgentId,
      replacementAgentId: event.replacementAgentId,
    });

    logger.info({ module: 'coordination', msg: 'Recovery completed', agentId: event.originalAgentId, replacementAgentId: replacementAgentId ?? 'same agent' });
    return event;
  }

  /** Mark recovery as failed */
  failRecovery(id: string, reason: string): RecoveryEvent | null {
    const event = this.events.find(e => e.id === id);
    if (!event) return null;

    if (event.attempts < this.settings.maxAttempts) {
      event.attempts++;
      event.status = 'generating_briefing';
      this.saveEvents();
      this.emit('recovery:progress', { recoveryId: id, status: 'generating_briefing', attempt: event.attempts });
      return event;
    }

    event.status = 'failed';
    event.failedAt = new Date().toISOString();
    this.saveEvents();
    this.emit('recovery:failed', { recoveryId: id, reason });

    logger.warn({ module: 'coordination', msg: 'Recovery failed', agentId: event.originalAgentId, attempts: event.attempts, reason });
    return event;
  }

  /** Cancel a pending recovery */
  cancelRecovery(id: string): RecoveryEvent | null {
    const event = this.events.find(e => e.id === id);
    if (!event || event.status === 'recovered' || event.status === 'failed') {
      return null;
    }

    event.status = 'failed';
    event.failedAt = new Date().toISOString();
    this.saveEvents();
    this.emit('recovery:failed', { recoveryId: id, reason: 'Cancelled by user' });
    return event;
  }

  /** Update the briefing for a pending recovery */
  updateBriefing(id: string, updates: { narrative?: string; sections?: Record<string, boolean> }): RecoveryEvent | null {
    const event = this.events.find(e => e.id === id);
    if (!event?.briefing || event.status === 'recovered' || event.status === 'failed') {
      return null;
    }

    if (updates.narrative !== undefined) {
      event.briefing.narrative = updates.narrative;
    }

    // Toggle sections off/on
    if (updates.sections) {
      if (updates.sections.lastMessages === false) event.briefing.lastMessages = [];
      if (updates.sections.uncommittedChanges === false) event.briefing.uncommittedChanges = [];
      if (updates.sections.discoveries === false) event.briefing.discoveries = [];
      if (updates.sections.activeIntentRules === false) event.briefing.activeIntentRules = [];
    }

    this.saveEvents();
    return event;
  }

  // ── Metrics ───────────────────────────────────────────────────

  getMetrics(): RecoveryMetrics {
    const total = this.events.length;
    const recovered = this.events.filter(e => e.status === 'recovered');
    const failed = this.events.filter(e => e.status === 'failed');

    // Calculate average recovery time
    let totalRecoveryMs = 0;
    for (const e of recovered) {
      if (e.recoveredAt) {
        totalRecoveryMs += new Date(e.recoveredAt).getTime() - new Date(e.startedAt).getTime();
      }
    }

    // Count triggers
    const triggerCounts = new Map<RecoveryTrigger, number>();
    for (const e of this.events) {
      triggerCounts.set(e.trigger, (triggerCounts.get(e.trigger) ?? 0) + 1);
    }

    return {
      totalCrashes: total,
      totalRecoveries: recovered.length,
      successRate: total > 0 ? Math.round((recovered.length / total) * 100) : 0,
      avgRecoveryTimeMs: recovered.length > 0 ? Math.round(totalRecoveryMs / recovered.length) : 0,
      tasksCompletedPostRecovery: 0, // Tracked externally by task DAG
      recoveryEvents: [...triggerCounts.entries()].map(([trigger, count]) => ({ trigger, count })),
    };
  }

  // ── Briefing Generation ───────────────────────────────────────

  private generateBriefing(params: {
    agentId: string;
    lastMessages: Array<{ role: string; content: string }>;
    currentTask: { id: string; title: string; progress: string } | null;
    contextUsage: number;
    preservedFiles: string[];
  }): HandoffBriefing {
    const id = `briefing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Get active intent rules for this agent's role context
    const intentRules = this.decisionLog.getIntentRules()
      .filter(r => r.enabled)
      .map(r => r.name)
      .slice(0, 5);

    // Build narrative
    const taskPart = params.currentTask
      ? `Working on "${params.currentTask.title}" (${params.currentTask.progress}).`
      : 'No active task.';
    const filesPart = params.preservedFiles.length > 0
      ? `${params.preservedFiles.length} file(s) with uncommitted changes.`
      : 'No uncommitted file changes.';
    const contextPart = params.contextUsage > 0
      ? `Context usage at ${params.contextUsage}% when recovery triggered.`
      : '';

    const narrative = [taskPart, filesPart, contextPart].filter(Boolean).join(' ');

    return {
      id,
      narrative,
      lastMessages: params.lastMessages.slice(-10),
      currentTask: params.currentTask,
      uncommittedChanges: params.preservedFiles.map(f => ({ file: f, additions: 0, deletions: 0 })),
      activeIntentRules: intentRules,
      discoveries: [],
      contextUsageAtCrash: params.contextUsage,
    };
  }

  // ── Persistence ───────────────────────────────────────────────

  private loadSettings(): RecoverySettings {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* use defaults */ }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(): void {
    this.db.setSetting(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  private loadEvents(): void {
    try {
      const raw = this.db.getSetting(EVENTS_KEY);
      if (raw) this.events = JSON.parse(raw);
    } catch {
      this.events = [];
    }
  }

  private saveEvents(): void {
    // Keep last 100 events
    if (this.events.length > 100) {
      this.events = this.events.slice(-100);
    }
    this.db.setSetting(EVENTS_KEY, JSON.stringify(this.events));
  }
}
