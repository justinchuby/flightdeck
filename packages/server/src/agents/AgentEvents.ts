/**
 * Event listener registration and notification for Agent — extracted from Agent.ts.
 * Provides typed listener arrays and notification helpers used by AgentAcpBridge.
 */
import type { ToolCallInfo, PlanEntry } from '../adapters/types.js';

/** Preamble appended to the system prompt when resuming a previous session */
export const RESUME_PREAMBLE =
  '[System] You are resuming from a previous session. Your conversation history has been restored, but the system prompt and crew roster above reflect the current state — agents, tasks, and files may have changed since your last session. When your history conflicts with the current system prompt, trust the system prompt.';
import type { AgentStatus } from './Agent.js';

/** Typed usage info emitted by onUsage listeners */
export interface UsageInfo {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  dagTaskId?: string;
}

/** Info emitted when session resume fails and falls back to a new session */
export interface SessionResumeFailedInfo {
  requestedSessionId: string;
  newSessionId: string;
  error: string;
}

/** Typed compaction info emitted by onContextCompacted listeners */
export interface CompactionInfo {
  previousUsed: number;
  currentUsed: number;
  percentDrop: number;
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
  private hungListeners: Array<(elapsedMs: number) => void> = [];
  private statusListeners: Array<(status: AgentStatus) => void> = [];
  private toolCallListeners: Array<(info: ToolCallInfo) => void> = [];
  private planListeners: Array<(entries: PlanEntry[]) => void> = [];
  private permissionRequestListeners: Array<(request: any) => void> = [];
  private sessionReadyListeners: Array<(sessionId: string) => void> = [];
  private sessionResumeFailedListeners: Array<(info: SessionResumeFailedInfo) => void> = [];
  private contextCompactedListeners: Array<(info: CompactionInfo) => void> = [];
  private usageListeners: Array<(info: UsageInfo) => void> = [];
  private responseStartListeners: Array<() => void> = [];

  private _idleDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly IDLE_DEBOUNCE_MS = 500;

  // ── Registration ────────────────────────────────────────────────────────

  onData(listener: (data: string) => void): void { this.dataListeners.push(listener); }
  onContent(listener: (content: any) => void): void { this.contentListeners.push(listener); }
  onThinking(listener: (text: string) => void): void { this.thinkingListeners.push(listener); }
  onExit(listener: (code: number) => void): void { this.exitListeners.push(listener); }
  onHung(listener: (elapsedMs: number) => void): void { this.hungListeners.push(listener); }
  onStatus(listener: (status: AgentStatus) => void): void { this.statusListeners.push(listener); }
  onToolCall(listener: (info: ToolCallInfo) => void): void { this.toolCallListeners.push(listener); }
  onPlan(listener: (entries: PlanEntry[]) => void): void { this.planListeners.push(listener); }
  onPermissionRequest(listener: (request: any) => void): void { this.permissionRequestListeners.push(listener); }
  onSessionReady(listener: (sessionId: string) => void): void { this.sessionReadyListeners.push(listener); }
  onSessionResumeFailed(listener: (info: SessionResumeFailedInfo) => void): void { this.sessionResumeFailedListeners.push(listener); }
  onContextCompacted(listener: (info: CompactionInfo) => void): void { this.contextCompactedListeners.push(listener); }
  onUsage(listener: (info: UsageInfo) => void): void { this.usageListeners.push(listener); }
  onResponseStart(listener: () => void): void { this.responseStartListeners.push(listener); }

  // ── Notification (called by AgentAcpBridge and Agent internals) ─────────

  notifyData(data: string): void { for (const l of this.dataListeners) l(data); }
  notifyContent(content: any): void { for (const l of this.contentListeners) l(content); }
  notifyThinking(text: string): void { for (const l of this.thinkingListeners) l(text); }
  notifyExit(code: number): void { for (const l of this.exitListeners) l(code); }
  notifyHung(elapsedMs: number): void { for (const l of this.hungListeners) l(elapsedMs); }
  notifyToolCall(info: ToolCallInfo): void { for (const l of this.toolCallListeners) l(info); }
  notifyPlan(entries: PlanEntry[]): void { for (const l of this.planListeners) l(entries); }
  notifyPermissionRequest(request: any): void { for (const l of this.permissionRequestListeners) l(request); }
  notifySessionReady(sessionId: string): void { for (const l of this.sessionReadyListeners) l(sessionId); }
  notifySessionResumeFailed(info: SessionResumeFailedInfo): void { for (const l of this.sessionResumeFailedListeners) l(info); }
  notifyContextCompacted(info: CompactionInfo): void { for (const l of this.contextCompactedListeners) l(info); }
  notifyUsage(info: UsageInfo): void { for (const l of this.usageListeners) l(info); }
  notifyResponseStart(): void { for (const l of this.responseStartListeners) l(); }

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
    this.hungListeners.length = 0;
    this.statusListeners.length = 0;
    this.toolCallListeners.length = 0;
    this.planListeners.length = 0;
    this.permissionRequestListeners.length = 0;
    this.sessionReadyListeners.length = 0;
    this.contextCompactedListeners.length = 0;
    this.thinkingListeners.length = 0;
    this.usageListeners.length = 0;
    this.responseStartListeners.length = 0;
    if (this._idleDebounceTimer) {
      clearTimeout(this._idleDebounceTimer);
      this._idleDebounceTimer = null;
    }
  }
}
