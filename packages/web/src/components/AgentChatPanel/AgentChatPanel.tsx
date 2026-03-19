import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, AlertCircle, Loader2, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useMessageStore, EMPTY_MESSAGES } from '../../stores/messageStore';
import { useToastStore } from '../Toast';
import { apiFetch } from '../../hooks/useApi';
import { AgentIdBadge } from '../../utils/markdown';
import { Markdown } from '../ui/Markdown';
import { splitToolOutput, CollapsibleToolOutput } from '../Shared/toolOutput';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import type { AcpTextChunk, AgentInfo } from '../../types';

/** Message from the API endpoint (server shape) */
interface ApiMessage {
  content: string;
  sender?: string;
  timestamp: string;
}

export interface AgentChatPanelProps {
  agentId: string;
  /** When true, hides the input box (for terminated/historical agents) */
  readOnly?: boolean;
  /** Max height of the message list. Defaults to 100% of parent. */
  maxHeight?: string;
  /** Compact mode for panel context — reduces padding and font size */
  compact?: boolean;
  /** When true, auto-focuses the input on mount (e.g., Message button → Chat tab) */
  autoFocusInput?: boolean;
}

/** Sender label and styling for chat bubbles */
const SENDER_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  agent: { label: 'Agent', bg: 'bg-th-bg-muted', text: 'text-th-text' },
  user: { label: 'You', bg: 'bg-accent/10', text: 'text-accent' },
  system: { label: 'System', bg: 'bg-yellow-500/10', text: 'text-yellow-600 dark:text-yellow-400' },
  thinking: { label: 'Thinking', bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400' },
  external: { label: 'External', bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400' },
  tool: { label: 'Tool', bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400' },
};

function getSenderStyle(sender?: string) {
  return SENDER_STYLES[sender ?? 'agent'] ?? SENDER_STYLES.agent;
}

/** Convert API messages to AcpTextChunk format */
function apiMessageToChunk(msg: ApiMessage): AcpTextChunk {
  return {
    type: 'text',
    text: msg.content,
    sender: (msg.sender || 'agent') as AcpTextChunk['sender'],
    timestamp: new Date(msg.timestamp).getTime(),
  };
}

/**
 * Compact chat panel for viewing an agent's conversation history.
 * Works for both live agents (real-time via store) and historical agents (fetched from API).
 * Designed for use in the unified crew page profile panel.
 */
export function AgentChatPanel({ agentId, readOnly, maxHeight, compact, autoFocusInput }: AgentChatPanelProps) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const storeMessages = useMessageStore((s) => s.channels[agentId]?.messages ?? EMPTY_MESSAGES);

  const [fetchedMessages, setFetchedMessages] = useState<AcpTextChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Use store messages if available (live agent), otherwise use fetched messages
  const messages = storeMessages.length > 0 ? storeMessages : fetchedMessages;

  // Determine if agent is active (can receive messages)
  const isActive = agent?.status === 'running' || agent?.status === 'idle';
  const showInput = !readOnly && isActive;

  // Fetch message history from API when store has no messages
  useEffect(() => {
    if (storeMessages.length > 0 || !agentId) return;

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    apiFetch<{ messages: ApiMessage[] }>(`/agents/${agentId}/messages?limit=200`)
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setFetchedMessages(data.messages.map(apiMessageToChunk));
          // Also populate the message store so other components benefit
          useMessageStore.getState().mergeHistory(agentId, data.messages.map(apiMessageToChunk));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [agentId, storeMessages.length]);

  // Auto-scroll to bottom when new messages arrive
  const prevCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView();
  }, [agentId]);

  // Auto-focus input when requested (e.g., Message button → Chat tab)
  useEffect(() => {
    if (autoFocusInput && showInput) {
      inputRef.current?.focus();
    }
  }, [autoFocusInput, showInput]);

  // Send message to agent
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !agentId) return;

    setSending(true);

    // Optimistic update — add user message to store immediately
    const existing = useAppStore.getState().agents.find((a) => a.id === agentId);
    const isAgentBusy = existing?.status === 'running';
    const userMsg: AcpTextChunk = {
      type: 'text',
      text,
      sender: 'user',
      timestamp: Date.now(),
      ...(isAgentBusy ? { queued: true } : {}),
    };
    useMessageStore.getState().addMessage(agentId, userMsg);
    setInputText('');

    try {
      await apiFetch(`/agents/${agentId}/message`, {
        method: 'POST',
        body: JSON.stringify({ text, mode: 'queue' }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      useToastStore.getState().add('error', msg);
    } finally {
      setSending(false);
    }
  }, [agentId, inputText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filter out empty/whitespace-only messages and outgoing DM notifications
  const visibleMessages = messages.filter((m) => {
    const text = typeof m.text === 'string' ? m.text : '';
    if (!text.trim()) return false;
    if (text.startsWith('📤')) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full" style={maxHeight ? { maxHeight } : undefined}>
      {/* Message list */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto min-h-0 ${compact ? 'px-2 py-1.5 space-y-2' : 'px-3 py-2 space-y-3'}`}
        data-testid="agent-chat-messages"
      >
        {loading && (
          <div className="flex items-center justify-center py-8 text-th-text-muted">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading messages…
          </div>
        )}

        {fetchError && (
          <div className="flex items-center gap-2 py-4 text-red-500 text-sm">
            <AlertCircle size={14} />
            {fetchError}
          </div>
        )}

        {!loading && !fetchError && visibleMessages.length === 0 && (
          <div className="text-center text-th-text-muted text-sm py-8">
            No messages yet
          </div>
        )}

        {visibleMessages.map((msg, i) => (
          <ChatBubble key={i} msg={msg} agent={agent} compact={compact} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {showInput && (
        <div className={`border-t border-th-border ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent?.role.name ?? 'agent'}…`}
              rows={1}
              className={`flex-1 resize-none rounded-md border border-th-border bg-th-bg px-3 py-1.5 text-th-text placeholder-th-text-muted focus:outline-none focus:ring-1 focus:ring-accent ${compact ? 'text-xs' : 'text-sm'}`}
              disabled={sending}
              data-testid="agent-chat-input"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
              className="p-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Send message"
              data-testid="agent-chat-send"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] text-th-text-muted mt-1">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      )}

      {/* Read-only indicator */}
      {readOnly && (
        <div className="border-t border-th-border px-3 py-2 text-center text-xs text-th-text-muted">
          Read-only — agent is no longer active
        </div>
      )}

      {/* Inactive but not explicitly read-only */}
      {!readOnly && !isActive && agent && (
        <div className="border-t border-th-border px-3 py-2 text-center text-xs text-th-text-muted">
          Agent is {agent.status} — messages cannot be sent
        </div>
      )}
    </div>
  );
}

/** Individual chat message bubble */
function ChatBubble({ msg, agent, compact }: { msg: AcpTextChunk; agent?: AgentInfo; compact?: boolean }) {
  const sender = msg.sender ?? 'agent';
  const style = getSenderStyle(sender);
  const isUser = sender === 'user';
  const isSystem = sender === 'system';
  const isThinking = sender === 'thinking';

  // System messages render as compact inline labels
  if (isSystem) {
    const text = typeof msg.text === 'string' ? msg.text : '';
    if (text === '---') {
      return <div className="border-t border-th-border/50 my-2" />;
    }
    return (
      <div className="text-[11px] text-th-text-muted text-center py-0.5">
        {text.slice(0, 200)}
      </div>
    );
  }

  // Thinking messages render as collapsed summary
  if (isThinking) {
    const text = typeof msg.text === 'string' ? msg.text : '';
    return (
      <div className="text-[11px] text-purple-500 dark:text-purple-400 italic pl-3 border-l-2 border-purple-400/30 py-0.5">
        💭 {text.slice(0, 300)}{text.length > 300 ? '…' : ''}
      </div>
    );
  }

  // Tool call messages render via dedicated component (hooks must be unconditional)
  if (sender === 'tool') {
    return <ToolMessageBubble msg={msg} agentId={agent?.id ?? ''} />;
  }

  const text = typeof msg.text === 'string' ? msg.text : '';

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Sender label + timestamp */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {!isUser && sender === 'agent' && agent && (
          <AgentIdBadge id={agent.id} className="text-[10px]" />
        )}
        <span className={`text-[10px] font-medium ${style.text}`}>
          {sender === 'external' && msg.fromRole ? msg.fromRole : style.label}
        </span>
        {msg.timestamp && (
          <span className="text-[10px] text-th-text-muted">
            {formatRelativeTime(new Date(msg.timestamp).toISOString())}
          </span>
        )}
        {msg.queued && (
          <span className="text-[10px] text-amber-500 font-medium">queued</span>
        )}
      </div>

      {/* Message content */}
      <div
        className={`rounded-lg max-w-[90%] ${style.bg} ${
          isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
        } ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}
      >
        <AgentTextWithToolOutput text={text} />
      </div>
    </div>
  );
}

/** Tool call message bubble — extracted so hooks are called unconditionally */
function ToolMessageBubble({ msg, agentId }: { msg: AcpTextChunk; agentId: string }) {
  const text = typeof msg.text === 'string' ? msg.text : '';
  const status = msg.toolStatus ?? 'in_progress';
  const statusColors: Record<string, string> = {
    pending: 'text-yellow-500',
    in_progress: 'text-blue-400',
    completed: 'text-emerald-500',
    cancelled: 'text-gray-400',
  };
  const color = statusColors[status] || 'text-sky-400';

  // Narrow lookup to the current agent's toolCalls (O(1) agent + O(toolCalls))
  const toolCalls = useAppStore((s) => s.agents.find((a) => a.id === agentId)?.toolCalls);
  const content = useMemo(() => {
    if (!msg.toolCallId || !toolCalls) return undefined;
    return toolCalls.find((t) => t.toolCallId === msg.toolCallId)?.content;
  }, [toolCalls, msg.toolCallId]);

  const badge = (
    <span className="flex items-center gap-1.5 py-0.5">
      {content && <ChevronRight className="w-3 h-3 shrink-0 text-th-text-muted group-open:rotate-90 transition-transform" />}
      <span className={`text-[10px] ${color} truncate`}>
        🔧 {text.slice(0, 200)}
      </span>
      {msg.toolKind && (
        <span className="text-[9px] text-th-text-muted bg-th-bg-alt px-1 rounded">{msg.toolKind}</span>
      )}
      {msg.timestamp && (
        <span className="text-[10px] text-th-text-muted shrink-0">
          {formatRelativeTime(new Date(msg.timestamp).toISOString())}
        </span>
      )}
    </span>
  );

  if (!content) return badge;

  return (
    <details className="group text-[11px]">
      <summary className="cursor-pointer select-none list-none">{badge}</summary>
      <pre className="ml-5 mt-0.5 mb-1 text-[10px] text-th-text-muted font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
        {content.length > 2000 ? content.slice(0, 2000) + '…' : content}
      </pre>
    </details>
  );
}

/** Renders agent text with Info:/path lines collapsed, regular text via Markdown */
function AgentTextWithToolOutput({ text }: { text: string }) {
  const parts = splitToolOutput(text);
  // If no tool output detected, render directly (fast path)
  if (parts.length === 1 && parts[0].type === 'text') {
    return <Markdown text={text} monospace />;
  }
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'tool-output'
          ? <CollapsibleToolOutput key={i} lines={part.lines} />
          : <Markdown key={i} text={part.text} monospace />
      )}
    </>
  );
}

export default AgentChatPanel;
