import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useToastStore } from '../components/Toast';
import type { WsMessage } from '../types';
import { getAuthToken } from './useApi';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  // Track agents that had a tool call since their last text — next append needs a newline separator
  const pendingNewlineRef = useRef<Set<string>>(new Set());
  const { setConnected, setAgents, addAgent, updateAgent, removeAgent } =
    useAppStore();

  const connect = useCallback(() => {
    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAuthToken();
    const wsUrl = token
      ? `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onmessage = (event) => {
      // Dispatch raw message for terminal components
      window.dispatchEvent(new MessageEvent('ws-message', { data: event.data }));

      const msg: WsMessage = JSON.parse(event.data);
      switch (msg.type) {
        case 'init':
          setAgents(msg.agents);
          useAppStore.getState().setLoading(false);
          break;
        case 'agent:spawned':
          addAgent(msg.agent);
          break;
        case 'agent:killed':
          removeAgent(msg.agentId);
          break;
        case 'agent:exit':
          updateAgent(msg.agentId, {
            status: msg.code === 0 ? 'completed' : 'failed',
          });
          break;
        case 'agent:status': {
          const prev = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
          const wasIdle = prev && (prev.status === 'idle' || prev.status === 'completed');
          updateAgent(msg.agentId, { status: msg.status });
          // When agent transitions from idle back to running, it received new input.
          // Insert a separator so next agent:text creates a new bubble.
          if (msg.status === 'running' && wasIdle) {
            const existing = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
            if (existing?.messages?.length) {
              const last = existing.messages[existing.messages.length - 1];
              if (last?.sender === 'agent') {
                updateAgent(msg.agentId, {
                  messages: [...existing.messages, { type: 'text', text: '---', sender: 'system' as any }],
                });
              }
            }
          }
          break;
        }
        case 'agent:sub_spawned':
          addAgent(msg.child);
          updateAgent(msg.parentId, {
            childIds: [
              ...(useAppStore.getState().agents.find((a) => a.id === msg.parentId)?.childIds || []),
              msg.child.id,
            ],
          });
          break;
        case 'agent:text': {
          const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
          const state = useAppStore.getState();
          const existing = state.agents.find((a) => a.id === msg.agentId);
          const msgs = [...(existing?.messages ?? [])];
          const last = msgs[msgs.length - 1];
          const needsNewline = pendingNewlineRef.current.has(msg.agentId);
          if (needsNewline) pendingNewlineRef.current.delete(msg.agentId);
          // If the last message has an unclosed [[[ block, always append to keep commands intact
          const lastText = last?.text ?? '';
          const hasUnclosedCommand = lastText.lastIndexOf('[[[') > lastText.lastIndexOf(']]]');
          if (last && (last.sender ?? 'agent') === 'agent' && (!needsNewline || hasUnclosedCommand)) {
            msgs[msgs.length - 1] = { ...last, text: lastText + rawText, timestamp: last.timestamp || Date.now() };
          } else {
            msgs.push({ type: 'text', text: rawText, sender: 'agent', timestamp: Date.now() });
          }
          updateAgent(msg.agentId, { messages: msgs });
          break;
        }
        case 'agent:tool_call': {
          pendingNewlineRef.current.add(msg.agentId);
          const state = useAppStore.getState();
          const existing = state.agents.find((a) => a.id === msg.agentId);
          const calls = existing?.toolCalls ?? [];
          const idx = calls.findIndex((tc) => tc.toolCallId === msg.toolCall.toolCallId);
          const updated = idx >= 0
            ? calls.map((tc, i) => (i === idx ? msg.toolCall : tc))
            : [...calls, msg.toolCall];
          updateAgent(msg.agentId, { toolCalls: updated });
          break;
        }
        case 'agent:content': {
          const state = useAppStore.getState();
          const existing = state.agents.find((a) => a.id === msg.agentId);
          const msgs = [...(existing?.messages ?? [])];
          msgs.push({
            type: 'text',
            text: msg.content.text || '',
            sender: 'agent',
            timestamp: Date.now(),
            contentType: msg.content.contentType,
            mimeType: msg.content.mimeType,
            data: msg.content.data,
            uri: msg.content.uri,
          });
          updateAgent(msg.agentId, { messages: msgs });
          break;
        }
        case 'agent:thinking': {
          const state = useAppStore.getState();
          const existing = state.agents.find((a) => a.id === msg.agentId);
          const msgs = [...(existing?.messages ?? [])];
          const last = msgs[msgs.length - 1];
          // Append to existing thinking message or create new one
          if (last && last.sender === 'thinking') {
            msgs[msgs.length - 1] = { ...last, text: (last.text || '') + msg.text, timestamp: last.timestamp || Date.now() };
          } else {
            msgs.push({ type: 'text', text: msg.text, sender: 'thinking', timestamp: Date.now() });
          }
          updateAgent(msg.agentId, { messages: msgs });
          break;
        }
        case 'agent:plan':
          updateAgent(msg.agentId, { plan: msg.plan });
          break;
        case 'agent:permission_request':
          updateAgent(msg.agentId, { pendingPermission: msg.request });
          {
            const agent = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
            const roleName = agent?.role?.name ?? msg.agentId.slice(0, 8);
            useToastStore.getState().add('info', `🛡️ Agent ${roleName} requests permission`);
          }
          break;
        case 'agent:session_ready':
          updateAgent(msg.agentId, { sessionId: msg.sessionId });
          break;
      }
    };
  }, [setConnected, setAgents, addAgent, updateAgent, removeAgent]);

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
    () => ({ send, subscribe, unsubscribe, sendInput, resizeAgent, broadcastInput }),
    [send, subscribe, unsubscribe, sendInput, resizeAgent, broadcastInput],
  );
}
