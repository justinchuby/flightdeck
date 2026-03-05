import { EventEmitter } from 'events';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import * as acp from '@agentclientprotocol/sdk';

export interface AcpConnectionOptions {
  cliCommand: string;
  cliArgs?: string[];
  cwd?: string;
}

export interface ToolCallInfo {
  toolCallId: string;
  title: string;
  kind?: acp.ToolKind;
  status?: acp.ToolCallStatus;
  content?: acp.ToolCallContent[];
}

export interface PlanEntry {
  content: string;
  priority: acp.PlanEntryPriority;
  status: acp.PlanEntryStatus;
}

import { logger } from '../utils/logger.js';

/** Extract displayable text from ACP content (single item, array, or string) */
function extractContentText(content: any): string | undefined {
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
  if (typeof content === 'object') {
    if (content.type === 'text' && typeof content.text === 'string') return content.text;
    if (typeof content.text === 'string') return content.text;
    return JSON.stringify(content);
  }
  return String(content);
}

export class AcpConnection extends EventEmitter {
  private process: ChildProcess | null = null;
  private connection: acp.ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private _isConnected = false;
  private _exited = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private promptQueue: string[] = [];
  private autopilot: boolean;
  private pendingPermission: {
    resolve: (result: acp.RequestPermissionResponse) => void;
    options: acp.PermissionOption[];
  } | null = null;

  constructor(opts?: { autopilot?: boolean }) {
    super();
    this.autopilot = opts?.autopilot ?? false;
  }

  get isConnected(): boolean { return this._isConnected; }
  get isPrompting(): boolean { return this._isPrompting; }
  get promptingStartedAt(): number | null { return this._promptingStartedAt; }
  get currentSessionId(): string | null { return this.sessionId; }

  async start(opts: AcpConnectionOptions): Promise<string> {
    await this.spawnAndConnect(opts);

    const sessionResult = await this.connection!.newSession({
      cwd: opts.cwd || process.cwd(),
      mcpServers: [],
    });

    const { sessionId } = sessionResult;
    this.sessionId = sessionId;
    this._isConnected = true;
    this.emit('connected', sessionId);

    return sessionId;
  }

  /**
   * Verify that the CLI binary exists in PATH before attempting to spawn.
   * Throws a descriptive error if the command is not found.
   */
  private validateCliCommand(command: string): void {
    try {
      // Use execFileSync (no shell) to avoid shell injection.
      // 'which' exists as /usr/bin/which on all Unix systems.
      // 'where' is the Windows equivalent.
      const checkCmd = process.platform === 'win32' ? 'where' : 'which';
      execFileSync(checkCmd, [command], { timeout: 3000, stdio: 'ignore' });
    } catch {
      throw new Error(
        `CLI binary "${command}" not found in PATH. ` +
        `Install it or set COPILOT_CLI_PATH to the full path of the binary.`,
      );
    }
  }

  private async spawnAndConnect(opts: AcpConnectionOptions): Promise<void> {
    this.validateCliCommand(opts.cliCommand);

    const args = ['--acp', '--stdio', ...(opts.cliArgs || [])];
    this.process = spawn(opts.cliCommand, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: opts.cwd || process.cwd(),
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error('Failed to start ACP process — stdin/stdout not available');
    }

    this._exited = false;

    this.process.on('error', (err) => {
      if (this._exited) return;
      this._exited = true;
      const errCode = (err as NodeJS.ErrnoException).code;
      logger.error('acp', `Spawn error for "${opts.cliCommand}": ${err.message}`, {
        code: errCode,
        command: opts.cliCommand,
      });
      this._isConnected = false;
      this.emit('exit', 1);
    });

    this.process.on('exit', (code, signal) => {
      if (this._exited) return;
      this._exited = true;
      this._isConnected = false;
      const exitCode = typeof code === 'number' ? code : 1;
      if (code === null && signal) {
        logger.warn('acp', `ACP process exited due to signal "${signal}", normalizing exit code to ${exitCode}`);
      }
      this.emit('exit', exitCode);
    });

    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(output, input);

    const client: acp.Client = {
      requestPermission: async (params) => {
        // Autopilot: immediately approve without user interaction
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
          this.pendingPermission = { resolve, options: params.options };
          this.emit('permission_request', {
            id: `perm-${Date.now()}`,
            toolName: params.title ?? params.description ?? 'Tool action',
            arguments: params.metadata ?? {},
            timestamp: new Date().toISOString(),
          });

          // After 60s without user response:
          // - Autopilot OFF → auto-deny (cancel) for safety, requiring explicit user approval
          // - Autopilot ON is handled above (immediate approve), so this path is always non-autopilot
          setTimeout(() => {
            if (this.pendingPermission?.resolve === resolve) {
              this.pendingPermission = null;
              resolve({ outcome: { outcome: 'cancelled' } });
            }
          }, 60_000);
        });
      },

      sessionUpdate: async (params) => {
        const update = params.update;

        switch (update.sessionUpdate) {
          case 'agent_message_chunk':
            if (update.content.type === 'text') {
              const text = update.content.text;
              this.emit('text', text);
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

    this.connection = new acp.ClientSideConnection((_agent) => client, stream);

    await this.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }

  async prompt(text: string): Promise<{ stopReason: acp.StopReason; usage?: { inputTokens: number; outputTokens: number } }> {
    if (!this.connection || !this.sessionId) {
      throw new Error('ACP connection not established');
    }

    // Queue if already prompting — will be sent when current prompt completes
    if (this._isPrompting) {
      this.promptQueue.push(text);
      return { stopReason: 'end_turn' as acp.StopReason };
    }

    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);

    try {
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }],
      });

      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);

      // Emit usage if available
      const usage = result.usage ?? undefined;
      if (usage) {
        this.emit('usage', { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      }

      this.emit('prompt_complete', result.stopReason);

      // Process queued messages
      this.drainQueue();

      return { stopReason: result.stopReason, usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined };
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
      const next = this.promptQueue.join('\n');
      this.promptQueue.length = 0;
      this.prompt(next).catch((err) => {
        logger.error('acp', `Drained prompt failed: ${err?.message || err}`);
      });
    }
  }

  resolvePermission(approved: boolean): void {
    if (this.pendingPermission) {
      const { resolve, options } = this.pendingPermission;
      this.pendingPermission = null;

      if (approved) {
        const allowOption = options.find((o) => o.kind === 'allow_once');
        resolve({
          outcome: allowOption
            ? { outcome: 'selected', optionId: allowOption.optionId }
            : { outcome: 'cancelled' },
        });
      } else {
        resolve({ outcome: { outcome: 'cancelled' } });
      }
    }
  }

  async cancel(): Promise<void> {
    if (this.connection && this.sessionId) {
      await this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  terminate(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
  }
}
