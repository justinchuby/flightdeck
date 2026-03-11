/**
 * Agent Adapter types (R9).
 *
 * Stable internal types that isolate the server from SDK-specific types.
 * Only AcpAdapter.ts should import from @agentclientprotocol/sdk —
 * everything else uses these types.
 */
import { EventEmitter } from 'events';

// ── Content Types ───────────────────────────────────────────────────

export interface ContentBlock {
  type: 'text' | 'image' | 'resource' | 'audio';
  text?: string;
  data?: string;
  uri?: string;
  mimeType?: string;
}

export type PromptContent = string | ContentBlock[];

// ── Result Types ────────────────────────────────────────────────────

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  durationMs?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextWindowSize?: number;
  contextWindowUsed?: number;
  model?: string;
}

export interface PromptResult {
  stopReason: StopReason;
  usage?: UsageInfo;
}

export interface PromptOptions {
  priority?: boolean;
}

// ── Tool & Plan Types ───────────────────────────────────────────────

export interface ToolCallInfo {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  content?: string;
}

export interface ToolUpdateInfo {
  toolCallId: string;
  status: string;
  content?: string;
}

export interface PlanEntry {
  content: string;
  priority: string;
  status: string;
}

// ── Adapter Capabilities ────────────────────────────────────────────

export interface AdapterCapabilities {
  supportsImages: boolean;
  supportsMcp: boolean;
  supportsPlans: boolean;
}

// ── Start Options ───────────────────────────────────────────────────

export interface AdapterStartOptions {
  cliCommand: string;
  /** Provider-specific base args (e.g., ['--acp', '--stdio'] for Copilot) */
  baseArgs?: string[];
  cliArgs?: string[];
  cwd?: string;
  /** Extra environment variables to pass to the spawned process */
  env?: Record<string, string>;
  /** Session ID for resume via session/load (if provider supports it) */
  sessionId?: string;
  /** Model name or tier alias (resolved by ModelResolver before use) */
  model?: string;
  /** Maximum turns before auto-stop */
  maxTurns?: number;
  /** System prompt to inject via provider-specific mechanism */
  systemPrompt?: string;
  /** Provider ID for provider-specific session setup */
  provider?: string;
}

// ── Core Interface ──────────────────────────────────────────────────

/**
 * AgentAdapter — the stable interface between the server and agent runtimes.
 *
 * Events emitted:
 *   'connected'       (sessionId: string)
 *   'text'            (text: string)
 *   'thinking'        (text: string)
 *   'content'         (block: object) — resource/image/audio content
 *   'tool_call'       (info: ToolCallInfo)
 *   'tool_call_update' (info: ToolUpdateInfo)
 *   'usage_update'    (usage: object)
 *   'plan'            (entries: PlanEntry[])
 *   'prompting'       (active: boolean)
 *   'prompt_complete'  (reason: string)
 *   'response_start'  ()
 *   'exit'            (code: number)
 *   'usage'           (usage: UsageInfo)
 */
export interface AgentAdapter extends EventEmitter {
  readonly type: string;
  readonly isConnected: boolean;
  readonly isPrompting: boolean;
  readonly promptingStartedAt: number | null;
  readonly currentSessionId: string | null;
  readonly supportsImages: boolean;

  start(opts: AdapterStartOptions): Promise<string>;
  prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult>;
  cancel(): Promise<void>;
  terminate(): void | Promise<void>;
}

// ── Factory Types ───────────────────────────────────────────────────

export interface AdapterFactoryOptions {
  type: 'acp' | 'mock';
  model?: string;
}

export type AdapterFactory = (opts: AdapterFactoryOptions) => AgentAdapter;
