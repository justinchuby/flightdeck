import { EventEmitter } from 'events';
import type { Database } from '../db/database.js';
import type { FileLockRegistry } from './FileLockRegistry.js';
import type { DecisionLog } from './DecisionLog.js';
import type { HandoffBriefing } from './RecoveryService.js';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type HandoffTrigger =
  | 'crash'
  | 'manual_termination'
  | 'model_swap'
  | 'role_change'
  | 'context_compaction'
  | 'session_end';

export type HandoffStatus = 'draft' | 'reviewed' | 'delivered' | 'archived';

export interface QualityFactor {
  name: 'task_coverage' | 'message_recency' | 'file_context' | 'discovery_count';
  score: number;        // 0-100
  detail: string;
}

export interface HandoffRecord {
  id: string;
  sessionId: string;
  sourceAgentId: string;
  sourceRole: string;
  sourceModel: string;
  targetAgentId: string | null;
  targetRole: string | null;
  targetModel: string | null;
  trigger: HandoffTrigger;
  briefing: HandoffBriefing;
  qualityScore: number | null;
  qualityFactors: QualityFactor[];
  status: HandoffStatus;
  createdAt: string;
  deliveredAt: string | null;
  reviewedBy: 'system' | 'user' | null;
  userEdits: string | null;
}

const HANDOFFS_KEY = 'handoff_records';

// ── HandoffService ────────────────────────────────────────────────

export class HandoffService extends EventEmitter {
  private records: HandoffRecord[] = [];

  constructor(
    private db: Database,
    private lockRegistry: FileLockRegistry,
    private decisionLog: DecisionLog,
  ) {
    super();
    this.loadRecords();
  }

  // ── CRUD ──────────────────────────────────────────────────────

  getAll(): HandoffRecord[] {
    return [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getById(id: string): HandoffRecord | undefined {
    return this.records.find(r => r.id === id);
  }

  // ── Briefing Generation ───────────────────────────────────────

  generateBriefing(params: {
    agentId: string;
    agentRole: string;
    agentModel?: string;
    trigger: HandoffTrigger;
    sessionId?: string;
    lastMessages?: Array<{ role: string; content: string }>;
    currentTask?: { id: string; title: string; progress: string } | null;
    contextUsage?: number;
    discoveries?: string[];
    sections?: {
      lastMessages?: boolean;
      tasks?: boolean;
      files?: boolean;
      discoveries?: boolean;
    };
  }): HandoffRecord {
    const id = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Gather file locks
    const agentLocks = this.lockRegistry.getByAgent(params.agentId);
    const files = agentLocks.map(l => l.filePath);

    // Get active intent rules
    const intentRules = this.decisionLog.getIntentRules()
      .filter(r => r.enabled)
      .map(r => r.name)
      .slice(0, 5);

    // Build narrative
    const taskPart = params.currentTask
      ? `Working on "${params.currentTask.title}" (${params.currentTask.progress}).`
      : 'No active task.';
    const filesPart = files.length > 0
      ? `${files.length} file(s) with uncommitted changes: ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}.`
      : 'No uncommitted file changes.';
    const contextPart = params.contextUsage
      ? `Context usage at ${params.contextUsage}% when ${params.trigger.replace('_', ' ')} triggered.`
      : '';
    const discoveryPart = params.discoveries && params.discoveries.length > 0
      ? `${params.discoveries.length} key discovery(ies) captured.`
      : '';

    const narrative = [taskPart, filesPart, contextPart, discoveryPart].filter(Boolean).join(' ');

    // Apply section filtering
    const sections = params.sections ?? {};
    const lastMessages = sections.lastMessages !== false ? (params.lastMessages ?? []).slice(-10) : [];
    const discoveries = sections.discoveries !== false ? (params.discoveries ?? []) : [];

    const briefing: HandoffBriefing = {
      id: `briefing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      narrative,
      lastMessages,
      currentTask: sections.tasks !== false ? (params.currentTask ?? null) : null,
      uncommittedChanges: sections.files !== false ? files.map(f => ({ file: f, additions: 0, deletions: 0 })) : [],
      activeIntentRules: intentRules,
      discoveries,
      contextUsageAtCrash: params.contextUsage ?? 0,
    };

    // Compute quality score
    const qualityFactors = this.computeQuality(briefing, params);
    const qualityScore = qualityFactors.length > 0
      ? Math.round(qualityFactors.reduce((sum, f) => sum + f.score, 0) / qualityFactors.length)
      : null;

    const record: HandoffRecord = {
      id,
      sessionId: params.sessionId ?? 'default',
      sourceAgentId: params.agentId,
      sourceRole: params.agentRole,
      sourceModel: params.agentModel ?? 'unknown',
      targetAgentId: null,
      targetRole: null,
      targetModel: null,
      trigger: params.trigger,
      briefing,
      qualityScore,
      qualityFactors,
      status: 'draft',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      reviewedBy: null,
      userEdits: null,
    };

    this.records.push(record);
    this.saveRecords();
    this.emit('handoff:started', { handoffId: id, sourceAgentId: params.agentId, trigger: params.trigger });
    this.emit('handoff:generated', { handoffId: id, qualityScore, tokenCount: narrative.length });

    logger.info('handoff', `Briefing generated for ${params.agentId.slice(0, 8)} (trigger: ${params.trigger}, quality: ${qualityScore ?? 'N/A'})`);
    return record;
  }

  // ── Edit Briefing ─────────────────────────────────────────────

  updateBriefing(id: string, narrative: string): HandoffRecord | null {
    const record = this.records.find(r => r.id === id);
    if (!record || record.status === 'delivered' || record.status === 'archived') return null;

    const oldNarrative = record.briefing.narrative;
    record.briefing.narrative = narrative;
    record.userEdits = `Changed narrative from "${oldNarrative.slice(0, 50)}..." to "${narrative.slice(0, 50)}..."`;
    record.reviewedBy = 'user';
    record.status = 'reviewed';
    this.saveRecords();
    return record;
  }

  // ── Deliver ───────────────────────────────────────────────────

  deliver(id: string, targetAgentId?: string): HandoffRecord | null {
    const record = this.records.find(r => r.id === id);
    if (!record || record.status === 'delivered' || record.status === 'archived') return null;

    record.status = 'delivered';
    record.deliveredAt = new Date().toISOString();
    if (targetAgentId) record.targetAgentId = targetAgentId;
    this.saveRecords();
    this.emit('handoff:delivered', { handoffId: id, targetAgentId: targetAgentId ?? null });

    logger.info('handoff', `Briefing delivered for ${record.sourceAgentId.slice(0, 8)} → ${(targetAgentId ?? 'none').slice(0, 8)}`);
    return record;
  }

  // ── Archive Session ───────────────────────────────────────────

  archiveSession(agents: Array<{
    agentId: string;
    agentRole: string;
    agentModel?: string;
    lastMessages?: Array<{ role: string; content: string }>;
    currentTask?: { id: string; title: string; progress: string } | null;
    contextUsage?: number;
    discoveries?: string[];
  }>, sessionId?: string): HandoffRecord[] {
    const records: HandoffRecord[] = [];
    for (const agent of agents) {
      const record = this.generateBriefing({
        ...agent,
        trigger: 'session_end',
        sessionId,
      });
      record.status = 'archived';
      records.push(record);
    }
    this.saveRecords();
    return records;
  }

  // ── Quality Scoring ───────────────────────────────────────────

  getQuality(id: string): { score: number; factors: QualityFactor[] } | null {
    const record = this.records.find(r => r.id === id);
    if (!record) return null;
    return { score: record.qualityScore ?? 0, factors: record.qualityFactors };
  }

  private computeQuality(briefing: HandoffBriefing, params: {
    lastMessages?: Array<{ role: string; content: string }>;
    currentTask?: { id: string; title: string; progress: string } | null;
  }): QualityFactor[] {
    const factors: QualityFactor[] = [];

    // Task coverage
    if (params.currentTask) {
      factors.push({
        name: 'task_coverage',
        score: briefing.currentTask ? 100 : 0,
        detail: briefing.currentTask ? `Task "${briefing.currentTask.title}" included with progress` : 'No task information',
      });
    } else {
      factors.push({ name: 'task_coverage', score: 50, detail: 'No active task at handoff time' });
    }

    // Message recency
    const msgCount = briefing.lastMessages.length;
    const msgScore = msgCount >= 10 ? 100 : msgCount >= 5 ? 80 : msgCount >= 1 ? 50 : 0;
    factors.push({
      name: 'message_recency',
      score: msgScore,
      detail: msgCount > 0 ? `Last ${msgCount} messages included` : 'No recent messages',
    });

    // File context
    const fileCount = briefing.uncommittedChanges.length;
    const fileScore = fileCount >= 3 ? 100 : fileCount >= 1 ? 70 : 0;
    factors.push({
      name: 'file_context',
      score: fileScore,
      detail: fileCount > 0 ? `${fileCount} file(s) with changes included` : 'No file changes',
    });

    // Discoveries
    const discCount = briefing.discoveries.length;
    const discScore = discCount >= 3 ? 100 : discCount >= 1 ? 60 : 0;
    factors.push({
      name: 'discovery_count',
      score: discScore,
      detail: discCount > 0 ? `${discCount} discovery(ies) captured` : 'No discoveries',
    });

    return factors;
  }

  // ── Persistence ───────────────────────────────────────────────

  private loadRecords(): void {
    try {
      const raw = this.db.getSetting(HANDOFFS_KEY);
      if (raw) this.records = JSON.parse(raw);
    } catch {
      this.records = [];
    }
  }

  private saveRecords(): void {
    if (this.records.length > 200) {
      this.records = this.records.slice(-200);
    }
    this.db.setSetting(HANDOFFS_KEY, JSON.stringify(this.records));
  }
}
