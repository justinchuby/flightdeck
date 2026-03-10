/**
 * Mock Adapter (R9).
 *
 * Programmable adapter for testing — no CLI process, no SDK dependency.
 * Enables fast integration tests without spawning real Copilot CLI processes.
 */
import { EventEmitter } from 'events';
import type {
  AgentAdapter,
  AdapterStartOptions,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  ToolCallInfo,
  ToolUpdateInfo,
  PlanEntry,
  UsageInfo,
} from './types.js';

export interface MockPromptResponse {
  text?: string;
  stopReason?: StopReason;
  usage?: UsageInfo;
  delay?: number;
}

export class MockAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'mock';

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private _sessionId: string | null = null;
  private responseQueue: MockPromptResponse[] = [];

  /** History of all prompts sent, for test assertions. */
  readonly promptHistory: PromptContent[] = [];

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this._sessionId; }
  get supportsImages(): boolean { return true; }

  async start(_opts: AdapterStartOptions): Promise<string> {
    this._sessionId = `mock-session-${Date.now()}`;
    this._isConnected = true;
    this.emit('connected', this._sessionId);
    return this._sessionId;
  }

  async prompt(content: PromptContent, _opts?: PromptOptions): Promise<PromptResult> {
    if (!this._isConnected) {
      throw new Error('Mock adapter not connected');
    }

    this.promptHistory.push(content);
    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    const response = this.responseQueue.shift() ?? { text: '', stopReason: 'end_turn' as StopReason };

    if (response.delay) {
      await new Promise(resolve => setTimeout(resolve, response.delay));
    }

    if (response.text) {
      this.emit('text', response.text);
    }

    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('prompting', false);

    const result: PromptResult = {
      stopReason: response.stopReason ?? 'end_turn',
      usage: response.usage,
    };

    if (response.usage) {
      this.emit('usage', response.usage);
    }

    this.emit('prompt_complete', result.stopReason);
    this.emit('idle');

    return result;
  }

  async cancel(): Promise<void> {
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('prompting', false);
  }

  terminate(): void {
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('exit', 0);
  }

  resolvePermission(_approved: boolean): void {
    // No-op for mock
  }

  resolveUserInput(_response: string): void {
    // No-op for mock
  }

  setAutopilot(_enabled: boolean): void {
    // No-op for mock
  }

  // ── Test Helpers ────────────────────────────────────────────────

  /** Queue a response for the next prompt() call. */
  queueResponse(response: MockPromptResponse): void {
    this.responseQueue.push(response);
  }

  /** Queue multiple responses for sequential prompt() calls. */
  queueResponses(responses: MockPromptResponse[]): void {
    this.responseQueue.push(...responses);
  }

  /** Simulate text output (as if the agent wrote it). */
  simulateText(text: string): void { this.emit('text', text); }

  /** Simulate a tool call event. */
  simulateToolCall(info: ToolCallInfo): void { this.emit('tool_call', info); }

  /** Simulate a tool call update event. */
  simulateToolUpdate(info: ToolUpdateInfo): void { this.emit('tool_call_update', info); }

  /** Simulate plan entries. */
  simulatePlan(entries: PlanEntry[]): void { this.emit('plan', entries); }

  /** Simulate thinking output. */
  simulateThinking(text: string): void { this.emit('thinking', text); }

  /** Simulate process exit. */
  simulateExit(code: number): void {
    this._isConnected = false;
    this.emit('exit', code);
  }

  /** Reset state for test isolation. */
  reset(): void {
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this._sessionId = null;
    this.responseQueue.length = 0;
    this.promptHistory.length = 0;
    this.removeAllListeners();
  }
}
