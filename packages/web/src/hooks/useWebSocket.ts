import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useGroupStore, groupKey } from '../stores/groupStore';
import { useTimerStore } from '../stores/timerStore';
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
      switch (msg.type) {
        case 'init':
          setAgents(msg.agents);
          useAppStore.getState().setLoading(false);
          if (msg.systemPaused !== undefined) {
            useAppStore.getState().setSystemPaused(msg.systemPaused);
          }
          break;
        case 'agent:spawned':
          addAgent(msg.agent);
          break;
        case 'agent:terminated':
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
          const needsNewline = pendingNewlineRef.current.has(msg.agentId);
          if (needsNewline) pendingNewlineRef.current.delete(msg.agentId);

          // Find the last agent message, skipping over interleaved DM/group notifications.
          // This prevents system notifications (📨, 📤, 🗣️) from fragmenting a streaming response.
          let appendIdx = -1;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            const sender = m.sender ?? 'agent';
            if (sender === 'agent') {
              appendIdx = i;
              break;
            }
            // User messages, separators, and thinking blocks break the append chain
            if (sender === 'user' || sender === 'thinking' || m.text === '---') break;
            // System messages that are DM/group notifications are transparent — keep searching
          }

          const appendTarget = appendIdx >= 0 ? msgs[appendIdx] : null;
          const appendText = appendTarget?.text ?? '';
          const hasUnclosedCommand = appendText.lastIndexOf('⟦') > appendText.lastIndexOf('⟧');
          if (appendTarget && (!needsNewline || hasUnclosedCommand)) {
            msgs[appendIdx] = { ...appendTarget, text: appendText + rawText, timestamp: appendTarget.timestamp || Date.now() };
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
        case 'agent:message_sent': {
          // Show incoming messages in the recipient agent's chat panel
          const toId = msg.to;
          const fromId = msg.from;
          const isFromSystem = fromId === 'system';
          const senderLabel = msg.fromRole
            ? `${msg.fromRole} (${(fromId ?? '').slice(0, 8)})`
            : fromId?.slice(0, 8) || 'System';
          const preview = (msg.content ?? '').slice(0, 2000);

          // Show in recipient's panel
          if (toId && toId !== 'system') {
            const state = useAppStore.getState();
            const recipient = state.agents.find((a) => a.id === toId);
            if (recipient) {
              const msgs = [...(recipient.messages ?? [])];
              msgs.push({
                type: 'text',
                text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
                sender: isFromSystem ? 'system' as any : 'user' as any,
                timestamp: Date.now(),
              });
              updateAgent(toId, { messages: msgs });
            }
          }

          // Also show in sender's panel so both sides see the DM
          if (fromId && fromId !== 'system' && toId !== fromId) {
            const state = useAppStore.getState();
            const sender = state.agents.find((a) => a.id === fromId);
            if (sender) {
              const isBroadcast = toId === 'all';
              const recipientLabel = isBroadcast
                ? 'All'
                : (() => {
                    const toAgent = state.agents.find((a) => a.id === toId);
                    return toAgent?.role?.name
                      ? `${toAgent.role.name} (${(toId ?? '').slice(0, 8)})`
                      : (toId ?? '').slice(0, 8);
                  })();
              const msgs = [...(sender.messages ?? [])];
              msgs.push({
                type: 'text',
                text: `📤 [To ${recipientLabel}] ${preview}`,
                sender: 'system' as any,
                timestamp: Date.now(),
              });
              updateAgent(fromId, { messages: msgs });
            }
          }
          break;
        }
        case 'group:created': {
          const gs = useGroupStore.getState();
          gs.addGroup({
            name: msg.name,
            leadId: msg.leadId,
            memberIds: msg.memberIds ?? [],
            createdAt: msg.createdAt ?? new Date().toISOString(),
          });
          break;
        }
        case 'group:message': {
          const gs = useGroupStore.getState();
          if (msg.message) {
            const key = groupKey(msg.message.leadId, msg.message.groupName);
            gs.addMessage(key, msg.message);
          }
          break;
        }
        case 'group:member_added': {
          const gs = useGroupStore.getState();
          if (msg.group && msg.agentId) {
            gs.addMember(msg.leadId, msg.group, msg.agentId);
          }
          break;
        }
        case 'group:member_removed': {
          const gs = useGroupStore.getState();
          if (msg.group && msg.agentId) {
            gs.removeMember(msg.leadId, msg.group, msg.agentId);
          }
          break;
        }
        case 'group:reaction': {
          const gs = useGroupStore.getState();
          if (msg.messageId && msg.emoji && msg.agentId) {
            const key = groupKey(msg.leadId, msg.groupName);
            if (msg.action === 'remove') {
              gs.removeReaction(key, msg.messageId, msg.emoji, msg.agentId);
            } else {
              gs.addReaction(key, msg.messageId, msg.emoji, msg.agentId);
            }
          }
          break;
        }
        case 'system:paused':
          useAppStore.getState().setSystemPaused(msg.paused);
          break;
        case 'timer:created': {
          const ts = useTimerStore.getState();
          if (msg.timer) ts.addTimer(msg.timer);
          break;
        }
        case 'timer:fired': {
          const ts = useTimerStore.getState();
          const timerId = msg.timerId ?? msg.timer?.id;
          if (timerId) {
            ts.fireTimer(timerId);
            ts.scheduleFireRemoval(timerId);
          }
          break;
        }
        case 'timer:cancelled': {
          const ts = useTimerStore.getState();
          const timerId = msg.timerId ?? msg.timer?.id;
          if (timerId) ts.removeTimer(timerId);
          break;
        }
        // Track pending decisions globally for the approval queue badge
        case 'lead:decision': {
          if (msg.needsConfirmation && msg.id) {
            useAppStore.getState().addPendingDecision({
              id: msg.id,
              agentId: msg.agentId,
              agentRole: msg.agentRole || 'Unknown',
              projectId: msg.projectId,
              title: msg.title || 'Untitled decision',
              rationale: msg.rationale || '',
              needsConfirmation: true,
              status: 'recorded',
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          }
          break;
        }
        case 'decision:confirmed':
        case 'decision:rejected': {
          const decisionId = msg.decisionId ?? msg.id;
          if (decisionId) {
            useAppStore.getState().removePendingDecision(decisionId);
          }
          break;
        }
        case 'decisions:batch': {
          // Batch resolve — remove all resolved decisions
          const decisions = msg.decisions ?? [];
          for (const d of decisions) {
            if (d.id) useAppStore.getState().removePendingDecision(d.id);
          }
          break;
        }
      }
      } catch (err) {
        console.error('[useWebSocket] Failed to parse message:', err);
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
