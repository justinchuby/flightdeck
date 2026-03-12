/**
 * Event listener registration and notification for Agent — extracted from Agent.ts.
 * Provides typed listener arrays and notification helpers used by AgentAcpBridge.
 */
import type { ToolCallInfo, PlanEntry } from '../adapters/types.js';

import type { AgentStatus } from './Agent.js';

/** Typed usage info emitted by onUsage listeners */
export interface UsageInfo {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  dagTaskId?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  durationMs?: number;
  model?: string;
  contextWindowSize?: number;
  contextWindowUsed?: number;
}

/** Info emitted when session resume fails */
export interface SessionResumeFailedInfo {
  requestedSessionId: string;
  error: string;
}

/** Typed compaction info emitted by onContextCompacted listeners */
export interface CompactionInfo {
  previousUsed: number;
  currentUsed: number;
  percentDrop: number;
}

/** Info emitted when a model was translated/resolved to a different model for the target provider */
export interface ModelFallbackInfo {
  requested: string;
  resolved: string;
  reason: string;
  provider: string;
}

/**
 * Manages all event listener arrays for Agent.
 * Instantiated inside Agent; methods are exposed via Agent's public API.
 */
export class AgentEventEmitter {
  private dataListeners: Array<(data: string) => void> = [];
  private contentListeners: Array<(content: any) => void> = [];
  private thinkingListeners: Array<(text: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private statusListeners: Array<(status: AgentStatus) => void> = [];
  private toolCallListeners: Array<(info: ToolCallInfo) => void> = [];
  private planListeners: Array<(entries: PlanEntry[]) => void> = [];
  private sessionReadyListeners: Array<(sessionId: string) => void> = [];
  private sessionResumeFailedListeners: Array<(info: SessionResumeFailedInfo) => void> = [];
  private contextCompactedListeners: Array<(info: CompactionInfo) => void> = [];
  private usageListeners: Array<(info: UsageInfo) => void> = [];
  private responseStartListeners: Array<() => void> = [];
  private modelFallbackListeners: Array<(info: ModelFallbackInfo) => void> = [];

  private _idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_DEBOUNCE_MS = 500;

  // ── Registration ────────────────────────────────────────────────────────

  onData(listener: (data: string) => void): void { this.dataListeners.push(listener); }
  onContent(listener: (content: any) => void): void { this.contentListeners.push(listener); }
  onThinking(listener: (text: string) => void): void { this.thinkingListeners.push(listener); }
  onExit(listener: (code: number) => void): void { this.exitListeners.push(listener); }
  onStatus(listener: (status: AgentStatus) => void): void { this.statusListeners.push(listener); }
  onToolCall(listener: (info: ToolCallInfo) => void): void { this.toolCallListeners.push(listener); }
  onPlan(listener: (entries: PlanEntry[]) => void): void { this.planListeners.push(listener); }
  onSessionReady(listener: (sessionId: string) => void): void { this.sessionReadyListeners.push(listener); }
  onSessionResumeFailed(listener: (info: SessionResumeFailedInfo) => void): void { this.sessionResumeFailedListeners.push(listener); }
  onContextCompacted(listener: (info: CompactionInfo) => void): void { this.contextCompactedListeners.push(listener); }
  onUsage(listener: (info: UsageInfo) => void): void { this.usageListeners.push(listener); }
  onResponseStart(listener: () => void): void { this.responseStartListeners.push(listener); }
  onModelFallback(listener: (info: ModelFallbackInfo) => void): void { this.modelFallbackListeners.push(listener); }

  // ── Notification (called by AgentAcpBridge and Agent internals) ─────────

  notifyData(data: string): void { for (const l of this.dataListeners) l(data); }
  notifyContent(content: any): void { for (const l of this.contentListeners) l(content); }
  notifyThinking(text: string): void { for (const l of this.thinkingListeners) l(text); }
  notifyExit(code: number): void { for (const l of this.exitListeners) l(code); }
  notifyToolCall(info: ToolCallInfo): void { for (const l of this.toolCallListeners) l(info); }
  notifyPlan(entries: PlanEntry[]): void { for (const l of this.planListeners) l(entries); }
  notifySessionReady(sessionId: string): void { for (const l of this.sessionReadyListeners) l(sessionId); }
  notifySessionResumeFailed(info: SessionResumeFailedInfo): void { for (const l of this.sessionResumeFailedListeners) l(info); }
  notifyContextCompacted(info: CompactionInfo): void { for (const l of this.contextCompactedListeners) l(info); }
  notifyUsage(info: UsageInfo): void { for (const l of this.usageListeners) l(info); }
  notifyResponseStart(): void { for (const l of this.responseStartListeners) l(); }
  notifyModelFallback(info: ModelFallbackInfo): void { for (const l of this.modelFallbackListeners) l(info); }

  /**
   * Debounced status notification. Idle transitions are delayed to avoid
   * rapid running→idle→running churn in the activity log.
   */
  notifyStatus(status: AgentStatus): void {
    if (this._idleDebounceTimer) {
      clearTimeout(this._idleDebounceTimer);
      this._idleDebounceTimer = null;
    }
    if (status === 'idle') {
      this._idleDebounceTimer = setTimeout(() => {
        this._idleDebounceTimer = null;
        for (const l of this.statusListeners) l(status);
      }, AgentEventEmitter.IDLE_DEBOUNCE_MS);
    } else {
      for (const l of this.statusListeners) l(status);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.dataListeners.length = 0;
    this.contentListeners.length = 0;
    this.exitListeners.length = 0;
    this.statusListeners.length = 0;
    this.toolCallListeners.length = 0;
    this.planListeners.length = 0;
    this.sessionReadyListeners.length = 0;
    this.sessionResumeFailedListeners.length = 0;
    this.contextCompactedListeners.length = 0;
    this.thinkingListeners.length = 0;
    this.usageListeners.length = 0;
    this.responseStartListeners.length = 0;
    this.modelFallbackListeners.length = 0;
    if (this._idleDebounceTimer) {
      clearTimeout(this._idleDebounceTimer);
      this._idleDebounceTimer = null;
    }
  }
}
