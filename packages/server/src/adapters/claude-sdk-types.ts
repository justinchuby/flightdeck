/**
 * Type declarations for @anthropic-ai/claude-agent-sdk.
 *
 * Minimal subset of types needed by ClaudeSdkAdapter. When the real SDK
 * is installed, these declarations ensure our adapter code compiles even
 * if the SDK's own types diverge slightly. The adapter uses these types
 * for its internal logic and casts to the SDK's actual types at runtime.
 */

/** Abort-compatible signal */
export interface AbortSignalLike {
  aborted: boolean;
  addEventListener(type: string, listener: () => void): void;
}

/** SDK query options */
export interface QueryOptions {
  cwd?: string;
  model?: string;
  abortController?: AbortController;
  resume?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  maxTurns?: number;
  systemPrompt?: string;
  allowedTools?: string[];
}

/** SDK message types emitted during query iteration */
export interface SdkAssistantMessage {
  type: 'assistant';
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
  };
}

export interface SdkUserMessage {
  type: 'user';
  message: {
    content: Array<
      | { type: 'tool_result'; tool_use_id: string; is_error?: boolean; content: string | unknown }
    >;
  };
}

export interface SdkSystemMessage {
  type: 'system';
  subtype: 'init' | 'compact_boundary' | string;
  session_id?: string;
}

export interface SdkResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_max_budget_usd' | string;
  session_id?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type SdkMessage =
  | SdkAssistantMessage
  | SdkUserMessage
  | SdkSystemMessage
  | SdkResultMessage;

/** Async iterable query handle returned by query() */
export interface SdkQuery extends AsyncIterable<SdkMessage> {
  /** Interrupt the current turn (like pressing Escape) */
  interrupt(): void;
  /** Fully close the query */
  close(): void;
}

/** Session info returned by listSessions() */
export interface SdkSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  fileSize?: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

/** Permission check callback */
export type CanUseToolCallback = (
  input: { tool_name: string; tool_input: Record<string, unknown> },
  toolUseId: string | undefined,
  context: { signal: AbortSignalLike },
) => Promise<{ result: 'allow' | 'deny'; reason?: string }>;
