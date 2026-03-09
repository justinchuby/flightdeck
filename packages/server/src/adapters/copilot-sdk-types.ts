/**
 * Type declarations for @github/copilot-sdk.
 *
 * Minimal subset of types needed by CopilotSdkAdapter. Mirrors the
 * claude-sdk-types.ts pattern: our adapter compiles against these stubs
 * and casts to the SDK's actual types at runtime via dynamic import().
 *
 * The real SDK ships its own .d.ts, but we keep these stubs so the
 * adapter compiles even when the SDK is not installed.
 */

// ── Connection State ────────────────────────────────────────

export type CopilotConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// ── Client Options ──────────────────────────────────────────

export interface CopilotClientOptions {
  cliPath?: string;
  cliArgs?: string[];
  cwd?: string;
  port?: number;
  useStdio?: boolean;
  cliUrl?: string;
  logLevel?: 'none' | 'error' | 'warning' | 'info' | 'debug' | 'all';
  autoStart?: boolean;
  autoRestart?: boolean;
  env?: Record<string, string | undefined>;
  githubToken?: string;
  useLoggedInUser?: boolean;
}

// ── Session Config ──────────────────────────────────────────

export interface CopilotSessionConfig {
  sessionId?: string;
  model?: string;
  systemMessage?: { mode?: 'append'; content?: string } | { mode: 'replace'; content: string };
  tools?: CopilotTool[];
  onPermissionRequest?: CopilotPermissionHandler;
  onUserInput?: CopilotUserInputHandler;
}

export interface CopilotResumeSessionConfig {
  model?: string;
  systemMessage?: { mode?: 'append'; content?: string } | { mode: 'replace'; content: string };
  tools?: CopilotTool[];
  onPermissionRequest?: CopilotPermissionHandler;
  onUserInput?: CopilotUserInputHandler;
}

// ── Permission Handling ─────────────────────────────────────

export interface CopilotPermissionRequest {
  kind: 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'custom-tool';
  toolCallId?: string;
  [key: string]: unknown;
}

export type CopilotPermissionResult = 'allow' | 'deny' | 'allow-always';

export type CopilotPermissionHandler = (
  request: CopilotPermissionRequest,
  invocation: { sessionId: string },
) => Promise<CopilotPermissionResult> | CopilotPermissionResult;

// ── User Input Handling ─────────────────────────────────────

export interface CopilotUserInputResponse {
  response: string;
}

export type CopilotUserInputHandler = (
  request: { question: string },
) => Promise<CopilotUserInputResponse> | CopilotUserInputResponse;

// ── Tools ───────────────────────────────────────────────────

export interface CopilotTool<TArgs = unknown> {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: (args: TArgs, invocation: { sessionId: string; toolCallId: string; toolName: string; arguments: unknown }) => Promise<unknown> | unknown;
  overridesBuiltInTool?: boolean;
}

// ── Session Events ──────────────────────────────────────────

export interface CopilotSessionEvent {
  id: string;
  timestamp: string;
  parentId: string | null;
  ephemeral?: boolean;
  type: string;
  data: Record<string, unknown>;
}

// ── Message Options ─────────────────────────────────────────

export interface CopilotMessageOptions {
  prompt: string;
  attachments?: Array<{
    type: 'file' | 'directory' | 'selection';
    path: string;
    displayName?: string;
  }>;
  mode?: 'enqueue' | 'immediate';
}

// ── Assistant Message Event ─────────────────────────────────

export interface CopilotAssistantMessageEvent {
  id: string;
  timestamp: string;
  parentId: string | null;
  type: 'assistant.message';
  data: {
    messageId: string;
    content: string;
    role: 'assistant';
    toolCalls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
}

// ── Session Metadata ────────────────────────────────────────

export interface CopilotSessionMetadata {
  sessionId: string;
  startTime: Date;
  modifiedTime: Date;
  summary?: string;
  isRemote: boolean;
  context?: {
    cwd: string;
    gitRoot?: string;
    repository?: string;
    branch?: string;
  };
}

// ── CopilotSession (minimal stub) ──────────────────────────

export interface CopilotSessionStub {
  readonly sessionId: string;
  readonly workspacePath?: string;
  send(options: CopilotMessageOptions): Promise<string>;
  sendAndWait(options: CopilotMessageOptions, timeout?: number): Promise<CopilotAssistantMessageEvent | undefined>;
  on(handler: (event: CopilotSessionEvent) => void): () => void;
  on<K extends string>(eventType: K, handler: (event: CopilotSessionEvent) => void): () => void;
  getMessages(): Promise<CopilotSessionEvent[]>;
  disconnect(): Promise<void>;
  abort(): Promise<void>;
  setModel(model: string): Promise<void>;
}

// ── CopilotClient (minimal stub) ───────────────────────────

export interface CopilotClientStub {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
  createSession(config: CopilotSessionConfig): Promise<CopilotSessionStub>;
  resumeSession(sessionId: string, config: CopilotResumeSessionConfig): Promise<CopilotSessionStub>;
  getState(): CopilotConnectionState;
  ping(message?: string): Promise<{ message: string; timestamp: number }>;
  listSessions(filter?: Record<string, string>): Promise<CopilotSessionMetadata[]>;
  getLastSessionId(): Promise<string | undefined>;
  deleteSession(sessionId: string): Promise<void>;
  on(handler: (event: unknown) => void): () => void;
}
