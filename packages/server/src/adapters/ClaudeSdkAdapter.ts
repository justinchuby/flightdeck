/**
 * Claude SDK Adapter.
 *
 * Direct in-process integration with the Claude Agent SDK.
 * Unlike AcpAdapter (subprocess via stdio), this runs SDK calls in-process
 * for native session resume support and faster round-trips.
 *
 * Key differences from AcpAdapter:
 * - No subprocess — SDK runs in-process
 * - Native session resume via SDK session ID
 * - Two-layer session ID: Flightdeck UUID (immediate) + SDK session ID (async)
 * - Survives server restarts without daemon (in-process state)
 *
 * Design: docs/research/claude-adapter-design.md
 */
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type {
  AgentAdapter,
  AdapterStartOptions,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  UsageInfo,
  ToolCallInfo,
  ToolUpdateInfo,
  PermissionRequest,
  ContentBlock,
} from './types.js';
import type {
  SdkQuery,
  SdkMessage,
  SdkAssistantMessage,
  SdkUserMessage,
  QueryOptions,
  CanUseToolCallback,
  SdkSessionInfo,
} from './claude-sdk-types.js';

// ── SDK Import ──────────────────────────────────────────────

// The Claude Agent SDK is loaded dynamically so the adapter compiles
// even when the SDK is not installed. At runtime, start() will throw
// a clear error if the SDK is missing.
let sdkModule: {
  query: (prompt: string, options: QueryOptions) => SdkQuery;
  listSessions: (opts: { dir: string; limit?: number }) => Promise<SdkSessionInfo[]>;
} | null = null;

async function loadSdk(): Promise<typeof sdkModule> {
  if (sdkModule) return sdkModule;
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    sdkModule = mod as unknown as typeof sdkModule;
    return sdkModule;
  } catch {
    throw new Error(
      'Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk',
    );
  }
}

// ── ClaudeSdkAdapter ────────────────────────────────────────

export class ClaudeSdkAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'claude-sdk';

  // Two-layer session ID: Flightdeck UUID returned immediately from start(),
  // SDK session ID captured asynchronously during first prompt().
  private flightdeckSessionId: string | null = null;
  private sdkSessionId: string | null = null;

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private activeQuery: SdkQuery | null = null;
  private abortController: AbortController | null = null;
  private cwd: string = process.cwd();
  private model: string;
  private autopilot: boolean;
  private maxTurns?: number;
  private systemPrompt?: string;
  private pendingPermission: {
    resolve: (result: { allow: boolean }) => void;
  } | null = null;
  private permissionTimeout: ReturnType<typeof setTimeout> | null = null;

  private promptQueue: PromptContent[] = [];
  private promptQueuePriorityCount = 0;

  constructor(opts?: { model?: string; autopilot?: boolean }) {
    super();
    this.model = opts?.model ?? 'claude-sonnet-4-6';
    this.autopilot = opts?.autopilot ?? false;
  }

  // ── Getters ────────────────────────────────────────────────

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this.flightdeckSessionId; }
  get supportsImages(): boolean { return false; } // Images not yet supported in prompt()

  /** The underlying SDK session ID (may differ from currentSessionId) */
  get sdkSession(): string | null { return this.sdkSessionId; }

  // ── Start / Resume ─────────────────────────────────────────

  async start(opts: AdapterStartOptions): Promise<string> {
    await loadSdk();

    this.cwd = opts.cwd ?? process.cwd();
    this.abortController = new AbortController();

    if (opts.model) this.model = opts.model;
    if (opts.maxTurns) this.maxTurns = opts.maxTurns;
    if (opts.systemPrompt) this.systemPrompt = opts.systemPrompt;

    if (opts.sessionId) {
      // Resume existing session
      this.flightdeckSessionId = opts.sessionId;
      this.sdkSessionId = opts.sessionId;
      logger.info({
        module: 'claude-sdk',
        msg: 'Resuming session',
        sessionId: opts.sessionId,
      });
    } else {
      // New session: generate Flightdeck UUID immediately.
      // SDK session ID captured during first prompt().
      this.flightdeckSessionId = randomUUID();
      this.sdkSessionId = null;
    }

    this._isConnected = true;
    this.emit('connected', this.flightdeckSessionId);
    return this.flightdeckSessionId;
  }

  // ── Prompt ─────────────────────────────────────────────────

  async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
    if (!this._isConnected) {
      throw new Error('Claude SDK adapter not started');
    }

    if (this._isPrompting) {
      if (opts?.priority) {
        this.promptQueue.splice(this.promptQueuePriorityCount, 0, content);
        this.promptQueuePriorityCount++;
      } else {
        this.promptQueue.push(content);
      }
      return { stopReason: 'end_turn' };
    }

    // Set prompting BEFORE any async gap to prevent race conditions
    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    const sdk = await loadSdk();
    if (!sdk) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      throw new Error('Claude SDK not available');
    }

    const promptText = typeof content === 'string'
      ? content
      : content.map((b) => b.text ?? '').join('\n');

    const queryOptions: QueryOptions = {
      cwd: this.cwd,
      model: this.model,
      abortController: this.abortController!,
      permissionMode: this.autopilot ? 'acceptEdits' : 'default',
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : {}),
      ...(this.maxTurns ? { maxTurns: this.maxTurns } : {}),
      ...(this.systemPrompt ? { systemPrompt: this.systemPrompt } : {}),
    };

    try {
      this.activeQuery = sdk.query(promptText, queryOptions);
      let lastUsage: UsageInfo | undefined;
      let stopReason: string = 'end_turn';

      for await (const message of this.activeQuery) {
        this.processMessage(message);

        // Capture SDK session ID from init message
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          this.sdkSessionId = message.session_id;
          this.emit('session_mapped', {
            flightdeckSessionId: this.flightdeckSessionId,
            sdkSessionId: this.sdkSessionId,
          });
        }

        // Capture result
        if (message.type === 'result') {
          stopReason = message.subtype;
          if (message.usage) {
            lastUsage = {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            };
          }
          if (message.session_id) {
            this.sdkSessionId = message.session_id;
          }
        }
      }

      this.activeQuery = null;
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);

      const translated = this.translateStopReason(stopReason);
      const result: PromptResult = { stopReason: translated, usage: lastUsage };

      if (lastUsage) this.emit('usage', lastUsage);
      this.emit('prompt_complete', translated);
      this.drainQueue();

      return result;
    } catch (err) {
      this.activeQuery = null;
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'error');
      this.drainQueue();
      throw err;
    }
  }

  // ── Event Processing ───────────────────────────────────────

  private processMessage(message: SdkMessage): void {
    switch (message.type) {
      case 'assistant': {
        const assistantMsg = message as SdkAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            this.emit('text', block.text);
          } else if (block.type === 'thinking') {
            this.emit('thinking', block.thinking);
          } else if (block.type === 'tool_use') {
            const info: ToolCallInfo = {
              toolCallId: block.id,
              title: block.name,
              kind: block.name,
              status: 'running',
              content: JSON.stringify(block.input),
            };
            this.emit('tool_call', info);
          }
        }
        break;
      }
      case 'user': {
        const userMsg = message as SdkUserMessage;
        for (const block of userMsg.message.content) {
          if (block.type === 'tool_result') {
            const update: ToolUpdateInfo = {
              toolCallId: block.tool_use_id,
              status: block.is_error ? 'error' : 'completed',
              content: typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            };
            this.emit('tool_call_update', update);
          }
        }
        break;
      }
      case 'system': {
        if (message.subtype === 'compact_boundary') {
          this.emit('text', '\n[Context compacted — older history summarized]\n');
        }
        break;
      }
    }
  }

  // ── Permission Handling ────────────────────────────────────

  resolvePermission(approved: boolean): void {
    if (this.pendingPermission) {
      const { resolve } = this.pendingPermission;
      this.pendingPermission = null;
      if (this.permissionTimeout) {
        clearTimeout(this.permissionTimeout);
        this.permissionTimeout = null;
      }
      resolve({ allow: approved });
    }
  }

  /**
   * SDK permission callback — called by the SDK when a tool needs approval.
   * Emits 'permission_request' event and waits for resolvePermission().
   */
  readonly handlePermission: CanUseToolCallback = async (input, toolUseId) => {
    if (this.autopilot) {
      return { result: 'allow' };
    }

    return new Promise<{ result: 'allow' | 'deny'; reason?: string }>((resolve) => {
      this.pendingPermission = {
        resolve: ({ allow }) => {
          this.permissionTimeout = null;
          resolve({
            result: allow ? 'allow' : 'deny',
            reason: allow ? undefined : 'User denied',
          });
        },
      };

      this.emit('permission_request', {
        id: toolUseId ?? `perm-${Date.now()}`,
        toolName: input.tool_name,
        arguments: input.tool_input,
        timestamp: new Date().toISOString(),
      } satisfies PermissionRequest);

      // Auto-deny after 60s timeout (ref stored for cleanup on terminate)
      this.permissionTimeout = setTimeout(() => {
        if (this.pendingPermission) {
          this.pendingPermission = null;
          this.permissionTimeout = null;
          resolve({ result: 'deny', reason: 'Permission timeout' });
        }
      }, 60_000);
    });
  };

  // ── Lifecycle ──────────────────────────────────────────────

  async cancel(): Promise<void> {
    if (this.activeQuery) {
      this.activeQuery.interrupt();
    }
  }

  terminate(): void {
    this.abortController?.abort();
    if (this.activeQuery) {
      this.activeQuery.close();
      this.activeQuery = null;
    }
    if (this.permissionTimeout) {
      clearTimeout(this.permissionTimeout);
      this.permissionTimeout = null;
    }
    this.pendingPermission = null;
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('exit', 0);
  }

  // ── Session Management ─────────────────────────────────────

  /** List available sessions in the current working directory */
  async listSdkSessions(): Promise<SdkSessionInfo[]> {
    const sdk = await loadSdk();
    if (!sdk) return [];
    return sdk.listSessions({ dir: this.cwd });
  }

  // ── Queue Drain (matches AcpAdapter pattern) ───────────────

  private drainQueue(): void {
    if (this.promptQueue.length > 0) {
      const items = this.promptQueue.splice(0);
      this.promptQueuePriorityCount = 0;
      const merged: ContentBlock[] = [];
      const textParts: string[] = [];
      const flushText = () => {
        if (textParts.length > 0) {
          merged.push({ type: 'text', text: textParts.join('\n') });
          textParts.length = 0;
        }
      };
      for (const item of items) {
        if (typeof item === 'string') {
          textParts.push(item);
        } else {
          flushText();
          merged.push(...item);
        }
      }
      flushText();
      this.prompt(merged).catch((err: Error) => {
        logger.error({ module: 'claude-sdk', msg: 'Drained prompt failed', err: err?.message || String(err) });
      });
    } else {
      this.emit('idle');
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private translateStopReason(subtype: string): StopReason {
    switch (subtype) {
      case 'success':
      case 'end_turn':
        return 'end_turn';
      case 'error_max_turns':
      case 'error_max_budget_usd':
        return 'max_tokens';
      case 'tool_use':
        return 'tool_use';
      default:
        return 'error';
    }
  }
}
