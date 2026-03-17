import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useGroupStore, groupKey } from '../stores/groupStore';
import { useTimerStore } from '../stores/timerStore';
import { useToastStore } from '../components/Toast';
import { useMessageStore } from '../stores/messageStore';
import type { AcpTextChunk, WsMessage } from '../types';
import { getAuthToken, apiFetch } from './useApi';
import { useSettingsStore } from '../stores/settingsStore';
import { shortAgentId } from '../utils/agentLabel';

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
          updateAgent(msg.agentId, { status: 'terminated' });
          break;
        case 'agent:exit': {
          // Don't overwrite 'terminated' with 'failed' — explicit termination takes precedence
          const exitPrev = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
          if (exitPrev?.status === 'terminated') break;
          updateAgent(msg.agentId, {
            status: msg.code === 0 ? 'completed' : 'failed',
            exitError: msg.error,
            exitCode: msg.code ?? null,
          });
          break;
        }
        case 'agent:status': {
          const prev = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
          const wasIdle = prev && (prev.status === 'idle' || prev.status === 'completed');
          updateAgent(msg.agentId, { status: msg.status });
          if (msg.status === 'running' && wasIdle) {
            const ms = useMessageStore.getState();
            const ch = ms.channels[msg.agentId];
            if (ch && ch.messages.length > 0) {
              const msgs = [...ch.messages];
              const last = msgs[msgs.length - 1];
              if (last?.sender === 'agent') {
                const separator: AcpTextChunk = { type: 'text', text: '---', sender: 'system' };
                if (last.timestamp && Date.now() - last.timestamp < 2000 && msgs.length >= 2) {
                  const prevMsg = msgs[msgs.length - 2];
                  if (prevMsg?.sender === 'agent' || prevMsg?.sender === undefined) {
                    msgs.splice(msgs.length - 1, 0, separator);
                  } else {
                    msgs.push(separator);
                  }
                } else {
                  msgs.push(separator);
                }
                ms.setMessages(msg.agentId, msgs);
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
        case 'agent:spawn_error': {
          const parentAgent = useAppStore.getState().agents.find((a) => a.id === msg.agentId);
          const label = parentAgent?.role?.name ?? shortAgentId(msg.agentId) ?? 'Agent';
          useToastStore.getState().add('error', `Spawn failed (${label}): ${msg.message}`);
          break;
        }
        case 'agent:model_fallback': {
          updateAgent(msg.agentId, {
            model: msg.resolved,
            modelResolution: {
              requested: msg.requested,
              resolved: msg.resolved,
              translated: true,
              reason: msg.reason,
            },
          });
          useToastStore.getState().add('info', `🔄 ${msg.agentRole}: ${msg.requested} → ${msg.resolved} (${msg.provider})`);
          break;
        }
        case 'agent:text': {
          const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
          const needsNewline = pendingNewlineRef.current.has(msg.agentId);
          if (needsNewline) pendingNewlineRef.current.delete(msg.agentId);
          const ms = useMessageStore.getState();
          ms.ensureChannel(msg.agentId);
          if (needsNewline) ms.setPendingNewline(msg.agentId, true);
          ms.appendToLastAgentMessage(msg.agentId, rawText);
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
          const tc = msg.toolCall;
          const prevTc = idx >= 0 ? calls[idx] : undefined;
          if (!prevTc || prevTc.status !== tc.status) {
            const ms = useMessageStore.getState();
            ms.ensureChannel(msg.agentId);
            const ch = ms.channels[msg.agentId];
            const msgs = [...(ch?.messages ?? [])];
            const statusIcon = tc.status === 'completed' ? '✓' : tc.status === 'cancelled' ? '✗' : '⟳';
            const title = typeof tc.title === 'string' ? tc.title : String(tc.title);
            const existingMsgIdx = msgs.findIndex(
              (m) => m.sender === 'tool' && m.toolCallId === tc.toolCallId,
            );
            if (existingMsgIdx >= 0) {
              msgs[existingMsgIdx] = { ...msgs[existingMsgIdx], text: `${statusIcon} ${title}`, toolStatus: tc.status };
            } else {
              msgs.push({ type: 'text', text: `${statusIcon} ${title}`, sender: 'tool', timestamp: Date.now(), toolCallId: tc.toolCallId, toolStatus: tc.status, toolKind: tc.kind });
            }
            ms.setMessages(msg.agentId, msgs);
          }
          updateAgent(msg.agentId, { toolCalls: updated });
          break;
        }
        case 'agent:response_start': {
          // Server signals a new LLM sampling turn is about to begin.
          // Set the pending newline flag so the next agent:text creates a new bubble.
          pendingNewlineRef.current.add(msg.agentId);
          break;
        }
        case 'agent:content': {
          const ms = useMessageStore.getState();
          ms.ensureChannel(msg.agentId);
          ms.addMessage(msg.agentId, {
            type: 'text', text: msg.content.text || '', sender: 'agent', timestamp: Date.now(),
            contentType: msg.content.contentType, mimeType: msg.content.mimeType, data: msg.content.data, uri: msg.content.uri,
          });
          break;
        }
        case 'agent:thinking': {
          const thinkText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
          if (!thinkText) break;
          const ms = useMessageStore.getState();
          ms.ensureChannel(msg.agentId);
          ms.appendToThinkingMessage(msg.agentId, thinkText);
          break;
        }
        case 'agent:plan':
          updateAgent(msg.agentId, { plan: msg.plan });
          break;

        case 'agent:session_ready':
          updateAgent(msg.agentId, { sessionId: msg.sessionId });
          break;
        case 'agent:usage':
          updateAgent(msg.agentId, {
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens,
            ...(msg.cacheReadTokens != null ? { cacheReadTokens: msg.cacheReadTokens } : {}),
            ...(msg.cacheWriteTokens != null ? { cacheWriteTokens: msg.cacheWriteTokens } : {}),
            ...(msg.contextWindowUsed != null ? { contextWindowUsed: msg.contextWindowUsed } : {}),
            ...(msg.contextWindowSize != null ? { contextWindowSize: msg.contextWindowSize } : {}),
          });
          break;
        case 'agent:message_sent': {
          const toId = msg.to;
          const fromId = msg.from;
          const isFromSystem = fromId === 'system';
          const senderLabel = msg.fromRole
            ? `${msg.fromRole} (${shortAgentId(fromId ?? '')})`
            : (fromId ? shortAgentId(fromId) : '') || 'System';
          const preview = (msg.content ?? '').slice(0, 2000);
          const ms = useMessageStore.getState();
          if (toId && toId !== 'system') {
            ms.ensureChannel(toId);
            ms.addMessage(toId, {
              type: 'text', text: isFromSystem ? `⚙️ [System] ${preview}` : `📨 [From ${senderLabel}] ${preview}`,
              sender: isFromSystem ? 'system' : 'user', timestamp: Date.now(),
            });
          }
          if (fromId && fromId !== 'system' && toId !== fromId) {
            const state = useAppStore.getState();
            const isBroadcast = toId === 'all';
            const recipientLabel = isBroadcast ? 'All' : (() => {
              const toAgent = state.agents.find((a) => a.id === toId);
              return toAgent?.role?.name ? `${toAgent.role.name} (${shortAgentId(toId ?? '')})` : shortAgentId(toId ?? '');
            })();
            ms.ensureChannel(fromId);
            ms.addMessage(fromId, {
              type: 'text', text: `📤 [To ${recipientLabel}] ${preview}`, sender: 'system', timestamp: Date.now(),
            });
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
            // Minimal oversight: auto-approve all decisions without user prompts
            const effectiveLevel = useSettingsStore.getState().getEffectiveLevel(msg.projectId ?? undefined);
            if (effectiveLevel === 'autonomous') {
              apiFetch(`/decisions/${msg.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
              break;
            }
            useAppStore.getState().addPendingDecision({
              id: msg.id,
              agentId: msg.agentId,
              agentRole: msg.agentRole || 'Unknown',
              leadId: msg.leadId ?? null,
              projectId: msg.projectId ?? null,
              title: msg.title || 'Untitled decision',
              rationale: msg.rationale || '',
              needsConfirmation: true,
              status: 'recorded',
              autoApproved: msg.autoApproved ?? false,
              confirmedAt: msg.confirmedAt ?? null,
              category: msg.category,
              timestamp: msg.timestamp || new Date().toISOString(),
            });
          }
          break;
        }
        case 'decision:confirmed':
        case 'decision:rejected':
        case 'decision:dismissed': {
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
        case 'attention:changed': {
          window.dispatchEvent(new CustomEvent('attention:changed'));
          break;
        }
        case 'agent:session_resume_failed': {
          const agentId = shortAgentId(msg.agentId ?? '');
          const error = msg.error ?? 'Unknown error';
          useToastStore.getState().add('error', `Session resume failed (agent ${agentId}): ${error}`);
          break;
        }
      }
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
