/**
 * Ambient module declaration for the Claude Agent SDK.
 *
 * Provides type-level declarations so TypeScript compiles without
 * the actual SDK package installed. At runtime the SDK is loaded
 * dynamically and will throw a clear error if missing.
 */
declare module '@anthropic-ai/claude-agent-sdk' {
  interface QueryOptions {
    cwd?: string;
    model?: string;
    abortController?: AbortController;
    resume?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
    maxTurns?: number;
    systemPrompt?: string;
    allowedTools?: string[];
  }

  interface SdkAssistantMessage {
    type: 'assistant';
    message: {
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'thinking'; thinking: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
    };
  }

  interface SdkUserMessage {
    type: 'user';
    message: {
      content: Array<
        | { type: 'tool_result'; tool_use_id: string; is_error?: boolean; content: string | unknown }
      >;
    };
  }

  interface SdkSystemMessage {
    type: 'system';
    subtype: string;
    session_id?: string;
  }

  interface SdkResultMessage {
    type: 'result';
    subtype: string;
    session_id?: string;
    usage?: { input_tokens: number; output_tokens: number };
  }

  type SdkMessage = SdkAssistantMessage | SdkUserMessage | SdkSystemMessage | SdkResultMessage;

  interface SdkQuery extends AsyncIterable<SdkMessage> {
    interrupt(): void;
    close(): void;
  }

  interface SdkSessionInfo {
    sessionId: string;
    summary: string;
    lastModified: number;
    fileSize?: number;
    customTitle?: string;
    firstPrompt?: string;
    gitBranch?: string;
    cwd?: string;
  }

  export function query(prompt: string, options: QueryOptions): SdkQuery;
  export function listSessions(opts: { dir: string; limit?: number }): Promise<SdkSessionInfo[]>;
}
