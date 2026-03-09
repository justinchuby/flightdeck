/**
 * Copilot SDK Adapter.
 *
 * Direct in-process integration with @github/copilot-sdk.
 * Mirrors ClaudeSdkAdapter pattern: lazy import, two-layer session IDs,
 * event mapping, permission handling, and queue drain.
 *
 * Key feature over ACP: native SESSION RESUME via SDK's resumeSession().
 * The SDK spawns/connects to a Copilot CLI server and communicates via
 * JSON-RPC, but from our perspective it's an in-process call.
 *
 * Design: docs/design/copilot-sdk-adapter-design.md
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
  CopilotClientStub,
  CopilotSessionStub,
  CopilotClientOptions,
  CopilotSessionConfig,
  CopilotResumeSessionConfig,
  CopilotSessionEvent,
  CopilotPermissionHandler,
} from './copilot-sdk-types.js';

// ── SDK Import ──────────────────────────────────────────────

/** Wraps a promise with a timeout. Rejects with a descriptive error if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

const SDK_TIMEOUT_MS = 30_000;

// The Copilot SDK is loaded dynamically so the adapter compiles even
// when the SDK is not installed. At runtime, start() will throw a
// clear error if the SDK is missing.
let CopilotClientClass: (new (opts?: CopilotClientOptions) => CopilotClientStub) | null = null;
let approveAllFn: CopilotPermissionHandler | null = null;

async function loadSdk(): Promise<{
  CopilotClient: typeof CopilotClientClass;
  approveAll: CopilotPermissionHandler;
}> {
  if (CopilotClientClass) return { CopilotClient: CopilotClientClass, approveAll: approveAllFn! };
  try {
    const mod = await import('@github/copilot-sdk');
    CopilotClientClass = mod.CopilotClient as unknown as typeof CopilotClientClass;
    approveAllFn = mod.approveAll as unknown as CopilotPermissionHandler;
    return { CopilotClient: CopilotClientClass, approveAll: approveAllFn! };
  } catch {
    throw new Error(
      'Copilot SDK not installed. Run: npm install @github/copilot-sdk',
    );
  }
}

// ── CopilotSdkAdapter ──────────────────────────────────────

export class CopilotSdkAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'copilot-sdk';

  // Two-layer session ID: Flightdeck UUID returned immediately from start(),
  // SDK session ID captured asynchronously when createSession/resumeSession resolves.
  private flightdeckSessionId: string | null = null;
  private sdkSessionId: string | null = null;

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private client: CopilotClientStub | null = null;
  private session: CopilotSessionStub | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private cwd: string = process.cwd();
  private model: string;
  private autopilot: boolean;
  private maxTurns?: number;
  private systemPrompt?: string;
  private pendingPermissions = new Map<string, {
    resolve: (result: { allow: boolean }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private latestPermissionId: string | null = null;
  private abortController: AbortController | null = null;
  private sendTimeout: number;

  private promptQueue: PromptContent[] = [];
  private promptQueuePriorityCount = 0;
  /** Timestamp (epoch ms) when resumeSession() was called — events older than this are historical replay */
  private _resumeStartedAt: number | null = null;
  /** Dedup SDK event delivery bug (github/copilot-sdk#567): resumeSession() causes 2x+ delivery */
  private _seenEventIds = new Set<string>();

  constructor(opts?: { model?: string; autopilot?: boolean; sendTimeout?: number }) {
    super();
    this.model = opts?.model ?? 'gpt-4.1';
    this.autopilot = opts?.autopilot ?? false;
    this.sendTimeout = opts?.sendTimeout ?? 300_000; // 5 min default
  }

  // ── Getters ────────────────────────────────────────────────

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this.flightdeckSessionId; }
  get supportsImages(): boolean { return false; }

  /** The underlying SDK session ID (may differ from currentSessionId) */
  get sdkSession(): string | null { return this.sdkSessionId; }

  // ── Start / Resume ─────────────────────────────────────────

  async start(opts: AdapterStartOptions): Promise<string> {
    const { CopilotClient, approveAll } = await withTimeout(loadSdk(), SDK_TIMEOUT_MS, 'loadSdk');
    if (!CopilotClient) throw new Error('Copilot SDK not available');

    this.cwd = opts.cwd ?? process.cwd();
    this.abortController = new AbortController();

    if (opts.model) this.model = opts.model;
    if (opts.maxTurns) this.maxTurns = opts.maxTurns;
    if (opts.systemPrompt) this.systemPrompt = opts.systemPrompt;

    // Build client options
    const clientOpts: CopilotClientOptions = {
      cwd: this.cwd,
      useStdio: true,
      autoStart: true,
      autoRestart: false,
      logLevel: 'warning',
    };

    // Pass through CLI path override if provided
    if (opts.cliCommand && opts.cliCommand !== 'copilot') {
      clientOpts.cliPath = opts.cliCommand;
    }

    // Pass through extra CLI args
    if (opts.cliArgs?.length) {
      clientOpts.cliArgs = opts.cliArgs;
    }

    // Pass through env vars
    if (opts.env) {
      clientOpts.env = { ...process.env, ...opts.env } as Record<string, string | undefined>;
    }

    this.client = new CopilotClient(clientOpts);

    // Build permission handler
    const permissionHandler: CopilotPermissionHandler = this.autopilot
      ? approveAll
      : (request, invocation) => this.handlePermissionRequest(request, invocation);

    // Build session config
    const sessionConfig: CopilotSessionConfig = {
      model: this.model,
      onPermissionRequest: permissionHandler,
      ...(this.systemPrompt ? {
        systemMessage: { mode: 'append' as const, content: this.systemPrompt },
      } : {}),
    };

    if (opts.sessionId) {
      // Resume existing session
      this.flightdeckSessionId = opts.sessionId;
      try {
        this.session = await withTimeout(
          this.client.resumeSession(opts.sessionId, sessionConfig as CopilotResumeSessionConfig),
          SDK_TIMEOUT_MS, 'resumeSession',
        );
        this.sdkSessionId = this.session.sessionId;
        // Record resume timestamp — events with older timestamps are historical replay
        this._resumeStartedAt = Date.now();
        logger.info({
          module: 'copilot-sdk',
          msg: 'Resumed session via SDK',
          flightdeckId: this.flightdeckSessionId,
          sdkSessionId: this.sdkSessionId,
        });
      } catch (err) {
        // Resume failed — do NOT fall back to a new session.
        // Emit event for observability, then propagate the error.
        const message = (err as Error)?.message || String(err);
        logger.warn({
          module: 'copilot-sdk',
          msg: 'Session resume failed',
          requestedSessionId: opts.sessionId,
          error: message,
        });
        this.emit('session_resume_failed', {
          requestedSessionId: opts.sessionId,
          error: message,
        });
        throw new Error(`Session resume failed: ${message}`);
      }
    } else {
      // New session: generate Flightdeck UUID immediately.
      this.flightdeckSessionId = randomUUID();
      this.session = await withTimeout(
        this.client.createSession({ ...sessionConfig, sessionId: this.flightdeckSessionId }), SDK_TIMEOUT_MS, 'createSession',
      );
      this.sdkSessionId = this.session.sessionId;
    }

    // Subscribe to session events for translation
    this.unsubscribeEvents = this.session.on((event: CopilotSessionEvent) => {
      this.processEvent(event);
    });

    this.emit('session_mapped', {
      flightdeckSessionId: this.flightdeckSessionId,
      sdkSessionId: this.sdkSessionId,
    });

    this._isConnected = true;
    this.emit('connected', this.flightdeckSessionId);
    return this.flightdeckSessionId;
  }

  // ── Prompt ─────────────────────────────────────────────────

  async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
    if (!this._isConnected || !this.session) {
      throw new Error('Copilot SDK adapter not started');
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

    const promptText = typeof content === 'string'
      ? content
      : content.map((b) => b.text ?? '').join('\n');

    try {
      const response = await this.session.sendAndWait(
        { prompt: promptText },
        this.sendTimeout,
      );

      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);

      // Extract content from response
      const stopReason: StopReason = 'end_turn';
      const result: PromptResult = { stopReason };

      if (response?.data?.content) {
        this.emit('text', response.data.content as string);
      }

      this.emit('prompt_complete', stopReason);
      this.drainQueue();

      return result;
    } catch (err) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'error');
      this.drainQueue();
      throw err;
    }
  }

  // ── Event Processing ───────────────────────────────────────

  private processEvent(event: CopilotSessionEvent): void {
    // Dedup: SDK bug github/copilot-sdk#567 — resumeSession() causes the CLI
    // binary to deliver each event 2x+ (subscription leak). Exact copies share
    // the same event.id, arriving within 0-1ms. Safe to skip by ID.
    if (event.id && this._seenEventIds.has(event.id)) {
      return;
    }
    if (event.id) {
      this._seenEventIds.add(event.id);
      // Cap set size to prevent unbounded growth if session.idle never fires
      if (this._seenEventIds.size > 2000) this._seenEventIds.clear();
    }

    // Suppress historical event replay after resume: events with timestamps
    // older than resumeStartedAt are from the previous session.
    if (this._resumeStartedAt && event.type.startsWith('assistant.')) {
      const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
      if (isNaN(eventTime) || eventTime < this._resumeStartedAt) {
        return; // historical replay — suppress
      }
      // First current event received — hydration complete
      this._resumeStartedAt = null;
    }

    switch (event.type) {
      case 'assistant.message': {
        const content = (event.data as { content?: string }).content;
        if (content) {
          this.emit('text', content);
        }
        const toolCalls = (event.data as { toolCalls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }> }).toolCalls;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const info: ToolCallInfo = {
              toolCallId: tc.id,
              title: tc.function.name,
              kind: tc.function.name,
              status: 'running',
              content: tc.function.arguments,
            };
            this.emit('tool_call', info);
          }
        }
        break;
      }

      case 'assistant.streaming_delta': {
        const delta = (event.data as { content?: string }).content;
        if (delta) {
          this.emit('text', delta);
        }
        break;
      }

      case 'assistant.reasoning': {
        const reasoning = (event.data as { content?: string }).content;
        if (reasoning) {
          this.emit('thinking', reasoning);
        }
        break;
      }

      case 'tool.execution_start': {
        const data = event.data as { toolCallId?: string; toolName?: string; arguments?: unknown };
        if (data.toolName) {
          const info: ToolCallInfo = {
            toolCallId: data.toolCallId ?? `tool-${Date.now()}`,
            title: data.toolName,
            kind: data.toolName,
            status: 'running',
            content: data.arguments ? JSON.stringify(data.arguments) : undefined,
          };
          this.emit('tool_call', info);
        }
        break;
      }

      case 'tool.execution_complete': {
        const data = event.data as { toolCallId?: string; error?: string };
        const update: ToolUpdateInfo = {
          toolCallId: data.toolCallId ?? `tool-${Date.now()}`,
          status: data.error ? 'error' : 'completed',
          content: data.error,
        };
        this.emit('tool_call_update', update);
        break;
      }

      case 'session.error': {
        const message = (event.data as { message?: string }).message;
        logger.error({
          module: 'copilot-sdk',
          msg: `Session error: ${message}`,
          sessionId: this.sdkSessionId,
        });
        this.emit('error', new Error(`Copilot SDK session error: ${message ?? 'unknown'}`));
        break;
      }

      case 'session.idle': {
        // Session has finished processing — safe to clear dedup set between turns
        this._seenEventIds.clear();
        break;
      }

      case 'assistant.usage': {
        const data = event.data as {
          inputTokens?: number;
          outputTokens?: number;
          totalCostUsd?: number;
          durationMs?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
          model?: string;
        };
        if (data.inputTokens !== undefined || data.outputTokens !== undefined) {
          const usage: UsageInfo = {
            inputTokens: data.inputTokens ?? 0,
            outputTokens: data.outputTokens ?? 0,
            ...(data.totalCostUsd != null ? { costUsd: data.totalCostUsd } : {}),
            ...(data.durationMs != null ? { durationMs: data.durationMs } : {}),
            ...(data.cacheReadInputTokens != null ? { cacheReadTokens: data.cacheReadInputTokens } : {}),
            ...(data.cacheCreationInputTokens != null ? { cacheWriteTokens: data.cacheCreationInputTokens } : {}),
            ...(data.model ? { model: data.model } : {}),
          };
          this.emit('usage', usage);
        }
        break;
      }

      case 'session.usage_info': {
        const data = event.data as { currentTokens?: number; tokenLimit?: number };
        if (data.currentTokens != null || data.tokenLimit != null) {
          this.emit('usage_update', {
            size: data.tokenLimit ?? 0,
            used: data.currentTokens ?? 0,
            cost: null,
          });
        }
        break;
      }

      case 'session.compaction_complete': {
        const data = event.data as { preTokens?: number; postTokens?: number };
        this.emit('text', '\n[Context compacted — older history summarized]\n');
        if (data.preTokens != null && data.postTokens != null) {
          this.emit('context_compacted', {
            previousUsed: data.preTokens,
            currentUsed: data.postTokens,
            percentDrop: data.preTokens > 0
              ? Math.round(((data.preTokens - data.postTokens) / data.preTokens) * 100)
              : 0,
          });
        }
        break;
      }

      case 'session.truncation': {
        const data = event.data as { tokensRemoved?: number; messagesRemoved?: number };
        if (data.tokensRemoved) {
          logger.info({
            module: 'copilot-sdk',
            msg: 'Session truncated',
            tokensRemoved: data.tokensRemoved,
            messagesRemoved: data.messagesRemoved,
          });
        }
        break;
      }

      case 'session.shutdown': {
        const data = event.data as {
          totalInputTokens?: number;
          totalOutputTokens?: number;
          totalCostUsd?: number;
          totalRequests?: number;
          totalApiDurationMs?: number;
        };
        if (data.totalInputTokens != null) {
          logger.info({
            module: 'copilot-sdk',
            msg: 'Session totals',
            inputTokens: data.totalInputTokens,
            outputTokens: data.totalOutputTokens,
            costUsd: data.totalCostUsd,
            requests: data.totalRequests,
            apiDurationMs: data.totalApiDurationMs,
          });
        }
        break;
      }

      // Ignored events — known but no action needed
      case 'session.start':
      case 'session.resume':
      case 'session.title_changed':
      case 'session.info':
      case 'session.warning':
      case 'session.model_change':
      case 'user.message':
      case 'assistant.turn_start':
      case 'assistant.turn_end':
      case 'assistant.intent':
      case 'assistant.message_delta':
      case 'session.compaction_start':
      case 'session.task_complete':
      case 'permission.requested':
      case 'permission.completed':
      case 'abort':
        break;

      default:
        // Unknown events are silently ignored (forward compat)
        break;
    }
  }

  // ── Permission Handling ────────────────────────────────────

  resolvePermission(approved: boolean): void {
    const id = this.latestPermissionId;
    if (!id) return;
    const entry = this.pendingPermissions.get(id);
    if (!entry) return;
    this.pendingPermissions.delete(id);
    this.latestPermissionId = null;
    clearTimeout(entry.timeout);
    entry.resolve({ allow: approved });
  }

  /**
   * SDK permission callback — called by the SDK when a tool needs approval.
   * Emits 'permission_request' event and waits for resolvePermission().
   */
  private handlePermissionRequest(
    request: { kind: string; toolCallId?: string; [key: string]: unknown },
    invocation: { sessionId: string },
  ): Promise<'allow' | 'deny' | 'allow-always'> {
    return new Promise<'allow' | 'deny' | 'allow-always'>((resolve) => {
      const permId = request.toolCallId ?? `perm-${Date.now()}-${randomUUID().slice(0, 8)}`;

      const wrappedResolve = ({ allow }: { allow: boolean }) => {
        resolve(allow ? 'allow' : 'deny');
      };

      // Auto-deny after 60s timeout
      const timeout = setTimeout(() => {
        if (this.pendingPermissions.has(permId)) {
          this.pendingPermissions.delete(permId);
          if (this.latestPermissionId === permId) this.latestPermissionId = null;
          resolve('deny');
        }
      }, 60_000);

      this.pendingPermissions.set(permId, { resolve: wrappedResolve, timeout });
      this.latestPermissionId = permId;

      const permReq: PermissionRequest = {
        id: permId,
        toolName: request.kind,
        arguments: request as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      };
      this.emit('permission_request', permReq);
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async cancel(): Promise<void> {
    if (this.session) {
      try {
        await this.session.abort();
      } catch (err) {
        logger.warn({
          module: 'copilot-sdk',
          msg: `Abort failed: ${(err as Error)?.message || String(err)}`,
        });
      }
    }
  }

  async terminate(): Promise<void> {
    this.abortController?.abort();
    this._resumeStartedAt = null;
    this._seenEventIds.clear();

    // Unsubscribe from events
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }

    // Stop client first — flushes/saves session data to disk
    const clientRef = this.client;
    this.client = null;
    if (clientRef) {
      try {
        await Promise.race([
          clientRef.stop(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('client.stop() timed out')), 5000),
          ),
        ]);
      } catch (err: any) {
        logger.warn({ module: 'copilot-sdk', msg: `Client stop error: ${err?.message}` });
      }
    }

    // Disconnect session after client has flushed
    const sessionRef = this.session;
    this.session = null;
    if (sessionRef) {
      try {
        await Promise.race([
          sessionRef.disconnect(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('session.disconnect() timed out')), 5000),
          ),
        ]);
      } catch (err: any) {
        logger.warn({ module: 'copilot-sdk', msg: `Session disconnect error: ${err?.message}` });
      }
    }

    // Resolve all pending permissions as denied and clear timeouts
    for (const [id, entry] of this.pendingPermissions) {
      clearTimeout(entry.timeout);
      entry.resolve({ allow: false });
    }
    this.pendingPermissions.clear();
    this.latestPermissionId = null;
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('exit', 0);
  }

  // ── Session Management ─────────────────────────────────────

  /** List available sessions from the SDK */
  async listSdkSessions(): Promise<Array<{ sessionId: string; summary?: string }>> {
    if (!this.client) return [];
    try {
      const sessions = await this.client.listSessions();
      return sessions.map((s) => ({
        sessionId: s.sessionId,
        summary: s.summary,
      }));
    } catch {
      return [];
    }
  }

  // ── Queue Drain (matches ClaudeSdkAdapter pattern) ─────────

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
        logger.error({ module: 'copilot-sdk', msg: 'Drained prompt failed', err: err?.message || String(err) });
      });
    } else {
      this.emit('idle');
    }
  }
}
