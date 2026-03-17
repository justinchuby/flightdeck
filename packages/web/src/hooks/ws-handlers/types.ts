import type { AcpTextChunk } from '../../types';
import type { WsServerMessage, WsServerMessageOf } from '@flightdeck/shared';

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
}

/** A WS message handler processes a specific typed message */
export type WsMessageHandler<T extends WsServerMessage['type'] = WsServerMessage['type']> =
  (msg: WsServerMessageOf<T>, ctx: WsHandlerContext) => void;

export type { AcpTextChunk, WsServerMessage, WsServerMessageOf };
