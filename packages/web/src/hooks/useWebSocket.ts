import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useMessageStore } from '../stores/messageStore';
import type { WsMessage } from '../types';
import { getAuthToken } from './useApi';
import { createMessageDispatcher, type WsHandlerContext } from './ws-handlers';

// Singleton WebSocket reference — the app maintains exactly ONE server connection.
// Module-level so sendWsMessage() can be called from any component (e.g., timer
// pause from ApprovalSlideOver) without threading the WS ref through props/context.
// Updated in connect() and nulled on close; safe because useWebSocket() is called
// once in App.tsx and manages the full lifecycle.
let globalWs: WebSocket | null = null;

/** Send a WS message from any component (best-effort, no-op if not connected) */
export function sendWsMessage(msg: Record<string, unknown>): void {
  if (globalWs?.readyState === WebSocket.OPEN) {
    globalWs.send(JSON.stringify(msg));
  }
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  // Track agents that had a tool call or response_start since their last text — next append needs a newline separator
  const pendingNewlineRef = useRef<Set<string>>(new Set());
  const setConnected = useAppStore((s) => s.setConnected);
  const setAgents = useAppStore((s) => s.setAgents);
  const addAgent = useAppStore((s) => s.addAgent);
  const updateAgent = useAppStore((s) => s.updateAgent);

  const connect = useCallback(() => {
    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    // Build dispatcher — always read fresh store state via getState() to avoid stale closures
    const ctx: WsHandlerContext = {
      setAgents: (...args) => useAppStore.getState().setAgents(...args),
      addAgent: (...args) => useAppStore.getState().addAgent(...args),
      updateAgent: (...args) => useAppStore.getState().updateAgent(...args),
      getAppState: () => useAppStore.getState(),
      pendingNewlineRef,
      messageStore: {
        ensureChannel: (id) => useMessageStore.getState().ensureChannel(id),
        addMessage: (id, msg) => useMessageStore.getState().addMessage(id, msg),
        setMessages: (id, msgs) => useMessageStore.getState().setMessages(id, msgs),
        appendToLastAgentMessage: (id, text) => useMessageStore.getState().appendToLastAgentMessage(id, text),
        appendToThinkingMessage: (id, text) => useMessageStore.getState().appendToThinkingMessage(id, text),
        setPendingNewline: (id, v) => useMessageStore.getState().setPendingNewline(id, v),
        getMessages: (id) => useMessageStore.getState().channels[id]?.messages ?? [],
      },
    };
    const dispatch = createMessageDispatcher(ctx);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAuthToken();
    const wsUrl = token
      ? `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    globalWs = ws;

    ws.onopen = () => {
      setConnected(true);
      // Subscribe to ALL agent events ('*') — the UI is a monitoring dashboard that
      // needs visibility into every agent's output for panel rendering. Project-scoping
      // is handled server-side (subscribedProject filter), not via agent-level subscriptions.
      ws.send(JSON.stringify({ type: 'subscribe', agentId: '*' }));
    };
    ws.onclose = () => {
      setConnected(false);
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onmessage = (event) => {
      // Dispatch raw message for terminal components
      window.dispatchEvent(new MessageEvent('ws-message', { data: event.data }));

      try {
        const msg: WsMessage = JSON.parse(event.data);
        dispatch(msg);
      } catch (err) {
        console.error('[useWebSocket] Failed to parse message:', err);
      }
    };
  }, [setConnected, setAgents, addAgent, updateAgent]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
        globalWs = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback(
    (agentId: string) => {
      send({ type: 'subscribe', agentId });
    },
    [send],
  );

  const unsubscribe = useCallback(
    (agentId: string) => {
      send({ type: 'unsubscribe', agentId });
    },
    [send],
  );

  const subscribeProject = useCallback(
    (projectId: string | null) => {
      send({ type: 'subscribe-project', projectId });
    },
    [send],
  );

  const sendInput = useCallback(
    (agentId: string, text: string) => {
      send({ type: 'input', agentId, text });
    },
    [send],
  );

  const resizeAgent = useCallback(
    (agentId: string, cols: number, rows: number) => {
      send({ type: 'resize', agentId, cols, rows });
    },
    [send],
  );

  const broadcastInput = useCallback(
    (text: string) => {
      const allAgents = useAppStore.getState().agents;
      const running = allAgents.filter((a) => a.status === 'running');
      running.forEach((a) => sendInput(a.id, text));
    },
    [sendInput],
  );

  return useMemo(
    () => ({ send, subscribe, unsubscribe, subscribeProject, sendInput, resizeAgent, broadcastInput }),
    [send, subscribe, unsubscribe, subscribeProject, sendInput, resizeAgent, broadcastInput],
  );
}
