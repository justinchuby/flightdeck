import type { AcpTextChunk } from '../../types';

/**
 * Shared context passed to all WS message handlers.
 * Keeps handler modules decoupled from React hooks and store imports.
 */
export interface WsHandlerContext {
  /** Replace the full agent list (used by init) */
  setAgents: (agents: any[]) => void;
  /** Add a single new agent */
  addAgent: (agent: any) => void;
  /** Partial-update an existing agent by ID */
  updateAgent: (agentId: string, updates: Record<string, any>) => void;
  /** Read current app state snapshot */
  getAppState: () => {
    agents: any[];
    setLoading: (v: boolean) => void;
    setSystemPaused: (v: boolean) => void;
    addPendingDecision: (d: any) => void;
    removePendingDecision: (id: string) => void;
  };
  /** Mutable ref tracking agents needing a newline before next text append */
  pendingNewlineRef: { current: Set<string> };
  /** Message store operations for per-agent message channels */
  messageStore: {
    ensureChannel: (agentId: string) => void;
    addMessage: (agentId: string, msg: AcpTextChunk) => void;
    setMessages: (agentId: string, msgs: AcpTextChunk[]) => void;
    appendToLastAgentMessage: (agentId: string, text: string) => void;
    appendToThinkingMessage: (agentId: string, text: string) => void;
    setPendingNewline: (agentId: string, value: boolean) => void;
    getMessages: (agentId: string) => AcpTextChunk[];
  };
}

/** A WS message handler processes one or more message types */
export type WsMessageHandler = (msg: any, ctx: WsHandlerContext) => void;

export type { AcpTextChunk };
