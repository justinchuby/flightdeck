/**
 * SessionViewer — read-only slide-over panel showing a past session's
 * full conversation log. Fetched from GET /api/agents/:leadId/messages.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Clock, MessageSquare, User, Bot, Terminal } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';
import { MarkdownContent } from '../../utils/markdown';
/** Minimal session info needed by the viewer */
export interface ViewableSession {
  leadId: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
}

interface ThreadMessage {
  id: number;
  conversationId: string;
  sender: string; // 'user' | 'agent' | 'system'
  content: string;
  timestamp: string;
}

interface SessionViewerProps {
  session: ViewableSession;
  onClose: () => void;
}

function SenderIcon({ sender }: { sender: string }) {
  switch (sender) {
    case 'user':
      return <User size={12} className="text-blue-400" />;
    case 'agent':
      return <Bot size={12} className="text-emerald-400" />;
    case 'system':
      return <Terminal size={12} className="text-amber-400" />;
    default:
      return <MessageSquare size={12} className="text-th-text-muted" />;
  }
}

function senderLabel(sender: string): string {
  switch (sender) {
    case 'user': return 'You';
    case 'agent': return 'Agent';
    case 'system': return 'System';
    default: return sender;
  }
}

function senderBubbleClass(sender: string): string {
  switch (sender) {
    case 'user':
      return 'bg-blue-600 text-white ml-auto';
    case 'system':
      return 'bg-th-bg-muted/50 text-th-text-muted mx-auto text-center';
    default:
      return 'bg-th-bg-alt text-th-text';
  }
}

const MESSAGE_FETCH_LIMIT = 1000;

export function SessionViewer({ session, onClose }: SessionViewerProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<{ messages: ThreadMessage[] }>(
          `/agents/${session.leadId}/messages?limit=${MESSAGE_FETCH_LIMIT}`,
        );
        if (!cancelled) {
          setMessages(data.messages);
          setLoading(false);
          requestAnimationFrame(() => {
            if (!cancelled) scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [session.leadId]);

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="session-viewer">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl h-full flex flex-col bg-surface border-l border-th-border shadow-xl">
        {/* Header */}
        <div className="shrink-0 border-b border-th-border px-4 py-3 flex items-center gap-3">
          <MessageSquare size={16} className="text-th-text-muted" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-th-text truncate">
                {session.task || 'Session conversation'}
              </h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-medium shrink-0">
                Read-only
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-th-text-muted mt-0.5">
              <Clock size={10} />
              <span>{formatDateTime(session.startedAt)}</span>
              {session.endedAt && (
                <>
                  <span>→</span>
                  <span>{formatDateTime(session.endedAt)}</span>
                </>
              )}
              <span className="font-mono opacity-70">({session.leadId.slice(0, 8)})</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-th-bg-alt text-th-text-muted transition-colors"
            aria-label="Close session viewer"
            data-testid="session-viewer-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Read-only banner */}
        <div className="shrink-0 bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <Clock size={12} />
          Viewing past session — {messages.length} messages
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="text-sm text-th-text-muted text-center py-8">Loading conversation…</div>
          )}
          {error && (
            <div className="text-sm text-red-400 text-center py-8">{error}</div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div className="text-sm text-th-text-muted text-center py-8">No messages recorded for this session</div>
          )}
          {messages.map((msg) => {
            const ts = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            const isUser = msg.sender === 'user';
            const isSystem = msg.sender === 'system';
            return (
              <div
                key={msg.id}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${isSystem ? 'justify-center' : ''}`}
              >
                <div className={`max-w-[85%] rounded-lg px-3 py-2 ${senderBubbleClass(msg.sender)}`}>
                  {/* Sender label + timestamp */}
                  <div className={`flex items-center gap-1.5 mb-1 text-[10px] ${isUser ? 'text-blue-200' : 'text-th-text-muted'}`}>
                    <SenderIcon sender={msg.sender} />
                    <span className="font-medium">{senderLabel(msg.sender)}</span>
                    <span className="opacity-60">{ts}</span>
                  </div>
                  {/* Content */}
                  <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                    <MarkdownContent text={msg.content} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Disabled input placeholder */}
        <div className="shrink-0 border-t border-th-border px-4 py-3 bg-th-bg-alt/50">
          <div className="rounded-lg border border-th-border/50 bg-th-bg-muted/30 px-3 py-2 text-xs text-th-text-muted opacity-50 cursor-not-allowed">
            This is a read-only view of a past session
          </div>
        </div>
      </div>
    </div>
  );
}
