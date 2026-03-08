/**
 * ACP Adapter (R9).
 *
 * Wraps @agentclientprotocol/sdk behind the stable AgentAdapter interface.
 * This is the ONLY file in the server that imports from the ACP SDK.
 * When the SDK ships breaking changes, only this file needs updating.
 *
 * Refactored from acp/AcpConnection.ts — same battle-tested logic,
 * new interface boundary.
 */
import { EventEmitter } from 'events';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import type * as acp from '@agentclientprotocol/sdk';
import { logger } from '../utils/logger.js';
import type {
  AgentAdapter,
  AdapterStartOptions,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  ToolCallInfo,
  PlanEntry,
  ContentBlock,
} from './types.js';

// ── Lazy SDK Loading ────────────────────────────────────────────────
// The ACP SDK is loaded dynamically so the adapter module can be imported
// without triggering SDK loading. The SDK is loaded on first start().

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

let acpSdk: typeof import('@agentclientprotocol/sdk') | null = null;

async function loadAcpSdk(): Promise<typeof import('@agentclientprotocol/sdk')> {
  if (acpSdk) return acpSdk;
  try {
    acpSdk = await import('@agentclientprotocol/sdk');
    return acpSdk;
  } catch {
    throw new Error(
      'ACP SDK not installed. Run: npm install @agentclientprotocol/sdk',
    );
  }
}

/** Extract displayable text from ACP content (single item, array, or string) */
function extractContentText(content: unknown): string | undefined {
  if (!content) return undefined;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => {
      if (typeof c === 'string') return c;
      if (c?.type === 'text' && typeof c.text === 'string') return c.text;
      if (typeof c?.text === 'string') return c.text;
      if (c?.type === 'resource') return `📎 ${c.resource?.uri ?? ''}\n${c.resource?.text ?? ''}`;
      return JSON.stringify(c);
    }).join('\n');
  }
  if (typeof content === 'object' && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
    if (typeof obj.text === 'string') return obj.text;
    return JSON.stringify(content);
  }
  return String(content);
}

// ── SDK Type Translation ────────────────────────────────────────────

function translateStopReason(sdkReason: acp.StopReason): StopReason {
  const map: Record<string, StopReason> = {
    end_turn: 'end_turn',
    tool_use: 'tool_use',
    max_tokens: 'max_tokens',
    stop_sequence: 'stop_sequence',
  };
  return map[sdkReason as string] ?? 'end_turn';
}

function toSdkContentBlocks(content: PromptContent): acp.ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  // Internal ContentBlock → SDK ContentBlock (currently identical structure)
  return content as acp.ContentBlock[];
}

// ── AcpAdapter ──────────────────────────────────────────────────────

export class AcpAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'acp';

  private process: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private _isConnected = false;
  private _exited = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private promptQueue: PromptContent[] = [];
  private promptQueuePriorityCount = 0;
  private autopilot: boolean;
  private agentCapabilities: acp.AgentCapabilities | null = null;
  private pendingPermissions = new Map<string, {
    resolve: (result: acp.RequestPermissionResponse) => void;
    options: acp.PermissionOption[];
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private latestPermissionId: string | null = null;

  constructor(opts?: { autopilot?: boolean }) {
    super();
    this.autopilot = opts?.autopilot ?? false;
  }

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this.sessionId; }
  get supportsImages(): boolean { return this.agentCapabilities?.promptCapabilities?.image ?? false; }

  async start(opts: AdapterStartOptions): Promise<string> {
    await withTimeout(this.spawnAndConnect(opts), SDK_TIMEOUT_MS, 'spawnAndConnect');

    let sessionId: string;

    if (opts.sessionId) {
      // Try to resume an existing session (supported by some providers)
      try {
        const loadResult = await withTimeout(
          this.connection!.loadSession({ sessionId: opts.sessionId }),
          SDK_TIMEOUT_MS, 'loadSession',
        );
        sessionId = loadResult.sessionId;
      } catch {
        // Fallback to new session if session/load is not supported
        const newResult = await withTimeout(
          this.connection!.newSession({
            cwd: opts.cwd || process.cwd(),
            mcpServers: [],
          }),
          SDK_TIMEOUT_MS, 'newSession (fallback)',
        );
        sessionId = newResult.sessionId;
      }
    } else {
      const sessionResult = await withTimeout(
        this.connection!.newSession({
          cwd: opts.cwd || process.cwd(),
          mcpServers: [],
        }),
        SDK_TIMEOUT_MS, 'newSession',
      );
      sessionId = sessionResult.sessionId;
    }

    this.sessionId = sessionId;
    this._isConnected = true;
    this.emit('connected', sessionId);

    return sessionId;
  }

  private validateCliCommand(command: string): void {
    try {
      const checkCmd = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(checkCmd, [command], { timeout: 3000, stdio: 'ignore' });
    } catch {
      throw new Error(
        `CLI binary "${command}" not found in PATH. ` +
        `Install the provider CLI or set the binary path in your config.`,
      );
    }
  }

  private async spawnAndConnect(opts: AdapterStartOptions): Promise<void> {
    const sdk = await loadAcpSdk();
    this.validateCliCommand(opts.cliCommand);

    const args = [...(opts.baseArgs || ['--acp', '--stdio']), ...(opts.cliArgs || [])];
    this.process = spawn(opts.cliCommand, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: opts.cwd || process.cwd(),
      ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });

    if (!this.process.stdin || !this.process.stdout) {
      this.process.kill();
      this.process = null;
      throw new Error('Failed to start ACP process — stdin/stdout not available');
    }

    this._exited = false;

    this.process.on('error', (err) => {
      if (this._exited) return;
      this._exited = true;
      const errCode = (err as NodeJS.ErrnoException).code;
      logger.error({ module: 'acp', msg: 'Spawn error', err: err.message, code: errCode, cliCommand: opts.cliCommand });
      this._isConnected = false;
      this.emit('exit', 1);
    });

    this.process.on('exit', (code, signal) => {
      if (this._exited) return;
      this._exited = true;
      this._isConnected = false;
      const exitCode = typeof code === 'number' ? code : 1;
      if (code === null && signal) {
        logger.warn({ module: 'acp', msg: 'Process exited via signal', signal, exitCode });
      }
      this.emit('exit', exitCode);
    });

    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = sdk.ndJsonStream(output, input);

    const client: acp.Client = {
      requestPermission: async (params) => {
        if (this.autopilot) {
          const allowOption = params.options.find(
            (o: acp.PermissionOption) => o.kind === 'allow_once'
          );
          return {
            outcome: allowOption
              ? { outcome: 'selected', optionId: allowOption.optionId }
              : { outcome: 'cancelled' },
          };
        }

        return new Promise<acp.RequestPermissionResponse>((resolve) => {
          const permId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

          const timeout = setTimeout(() => {
            if (this.pendingPermissions.has(permId)) {
              this.pendingPermissions.delete(permId);
              if (this.latestPermissionId === permId) this.latestPermissionId = null;
              resolve({ outcome: { outcome: 'cancelled' } });
            }
          }, 60_000);

          this.pendingPermissions.set(permId, { resolve, options: params.options, timeout });
          this.latestPermissionId = permId;

          this.emit('permission_request', {
            id: permId,
            toolName: params.title ?? params.description ?? 'Tool action',
            arguments: params.metadata ?? {},
            timestamp: new Date().toISOString(),
          });
        });
      },

      sessionUpdate: async (params) => {
        const update = params.update;

        switch (update.sessionUpdate) {
          case 'agent_message_chunk':
            if (update.content.type === 'text') {
              this.emit('text', update.content.text);
            } else if (update.content.type === 'resource') {
              const res = update.content.resource;
              this.emit('content', {
                contentType: 'resource',
                text: res?.text ?? '',
                uri: res?.uri ?? '',
                mimeType: res?.mimeType,
              });
            } else if (update.content.type === 'image') {
              this.emit('content', {
                contentType: 'image',
                data: update.content.data,
                mimeType: update.content.mimeType ?? 'image/png',
                uri: update.content.uri,
              });
            } else if (update.content.type === 'audio') {
              this.emit('content', {
                contentType: 'audio',
                data: update.content.data,
                mimeType: update.content.mimeType ?? 'audio/wav',
              });
            } else {
              this.emit('text', `\n[${update.content.type} content]\n`);
            }
            break;

          case 'agent_thought_chunk':
            if (update.content.type === 'text') {
              this.emit('thinking', update.content.text);
            }
            break;

          case 'tool_call':
            this.emit('tool_call', {
              toolCallId: update.toolCallId,
              title: typeof update.title === 'string' ? update.title : update.title?.text ?? String(update.title),
              kind: typeof update.kind === 'string' ? update.kind : update.kind?.text ?? String(update.kind),
              status: update.status,
              content: extractContentText(update.content),
            } as ToolCallInfo);
            break;

          case 'tool_call_update':
            this.emit('tool_call_update', {
              toolCallId: update.toolCallId,
              status: update.status,
              content: extractContentText(update.content),
            });
            break;

          case 'plan':
            this.emit('plan', update.entries as PlanEntry[]);
            break;

          case 'usage_update':
            this.emit('usage_update', {
              size: update.size,
              used: update.used,
              cost: update.cost ?? null,
            });
            break;
        }
      },
    };

    this.connection = new sdk.ClientSideConnection((_agent) => client, stream);

    const initResult = await this.connection.initialize({
      protocolVersion: sdk.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    this.agentCapabilities = initResult.agentCapabilities ?? null;
  }

  async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
    if (!this.connection || !this.sessionId) {
      throw new Error('ACP connection not established');
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

    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    const blocks = toSdkContentBlocks(content);

    try {
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: blocks,
      });

      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);

      const usage = result.usage ?? undefined;
      if (usage) {
        this.emit('usage', { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      }

      this.emit('prompt_complete', translateStopReason(result.stopReason));
      this.drainQueue();

      const translated = translateStopReason(result.stopReason);
      return {
        stopReason: translated,
        usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
      };
    } catch (err) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'error');
      this.drainQueue();
      throw err;
    }
  }

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
        logger.error({ module: 'acp', msg: 'Drained prompt failed', err: err?.message || String(err) });
      });
    } else {
      this.emit('idle');
    }
  }

  resolvePermission(approved: boolean): void {
    const id = this.latestPermissionId;
    if (!id) return;
    const entry = this.pendingPermissions.get(id);
    if (!entry) return;
    this.pendingPermissions.delete(id);
    this.latestPermissionId = null;
    clearTimeout(entry.timeout);

    if (approved) {
      const allowOption = entry.options.find((o) => o.kind === 'allow_once');
      entry.resolve({
        outcome: allowOption
          ? { outcome: 'selected', optionId: allowOption.optionId }
          : { outcome: 'cancelled' },
      });
    } else {
      entry.resolve({ outcome: { outcome: 'cancelled' } });
    }
  }

  async cancel(): Promise<void> {
    if (this.connection && this.sessionId) {
      await this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  terminate(): void {
    // Resolve all pending permissions as cancelled and clear timeouts
    for (const [id, entry] of this.pendingPermissions) {
      clearTimeout(entry.timeout);
      entry.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.pendingPermissions.clear();
    this.latestPermissionId = null;

    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('exit', 0);
  }
}
