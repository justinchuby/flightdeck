/**
 * SessionViewer — slide-over panel showing a session SUMMARY with
 * metadata, message count, and action buttons (Resume / View Full Session).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Clock, MessageSquare, Users, Play, Eye, ListChecks } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';

/** Minimal session info needed by the viewer */
export interface ViewableSession {
  leadId: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
  projectId?: string;
  status?: string;
  agentCount?: number;
  taskSummary?: { total: number; done: number; failed: number };
}

interface SessionViewerProps {
  session: ViewableSession;
  onClose: () => void;
  onResume?: () => void;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'ongoing';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function SessionViewer({ session, onClose, onResume }: SessionViewerProps) {
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Close on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Fetch message count only (lightweight)
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ messages: unknown[] }>(`/agents/${session.leadId}/messages?limit=1`)
      .then((data) => {
        if (!cancelled) {
          // The API returns up to limit messages; we use the array length as a minimum indicator
          setMessageCount(data.messages?.length ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.leadId]);

  const projectId = session.projectId;
  const isEnded = session.status !== 'active';

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="session-viewer">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md h-full flex flex-col bg-surface border-l border-th-border shadow-xl">
        {/* Header */}
        <div className="shrink-0 border-b border-th-border px-4 py-3 flex items-center gap-3">
          <MessageSquare size={16} className="text-th-text-muted" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-th-text truncate">
              Session Summary
            </h2>
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

        {/* Summary content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Task */}
          <div>
            <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1">Task</div>
            <div className="text-sm font-mono text-th-text">
              {session.task || 'No task description'}
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Session ID */}
            <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
              <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1">Session ID</div>
              <div
                className="text-xs font-mono text-th-text cursor-pointer hover:text-accent transition-colors"
                title="Click to copy full ID"
                onClick={() => navigator.clipboard.writeText(session.leadId)}
              >
                {session.leadId.slice(0, 12)}…
              </div>
            </div>

            {/* Status */}
            <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
              <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1">Status</div>
              <div className="text-xs font-mono flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  session.status === 'active' ? 'bg-blue-400 animate-pulse' :
                  session.status === 'completed' ? 'bg-green-400' :
                  session.status === 'crashed' ? 'bg-red-400' : 'bg-gray-400'
                }`} />
                <span className="text-th-text capitalize">{session.status || 'unknown'}</span>
              </div>
            </div>

            {/* Duration */}
            <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
              <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                <Clock size={10} />
                Duration
              </div>
              <div className="text-xs font-mono text-th-text">
                {formatDuration(session.startedAt, session.endedAt)}
              </div>
            </div>

            {/* Agents */}
            {session.agentCount != null && (
              <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
                <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Users size={10} />
                  Agents
                </div>
                <div className="text-xs font-mono text-th-text">{session.agentCount}</div>
              </div>
            )}

            {/* Tasks */}
            {session.taskSummary && (
              <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
                <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                  <ListChecks size={10} />
                  Tasks
                </div>
                <div className="text-xs font-mono text-th-text">
                  {session.taskSummary.done}/{session.taskSummary.total}
                  {session.taskSummary.failed > 0 && (
                    <span className="text-red-400 ml-1">({session.taskSummary.failed} failed)</span>
                  )}
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="bg-th-bg-alt/40 rounded-lg p-2.5">
              <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                <MessageSquare size={10} />
                Messages
              </div>
              <div className="text-xs font-mono text-th-text">
                {loading ? '…' : messageCount != null ? `${messageCount}+` : '—'}
              </div>
            </div>
          </div>

          {/* Timestamps */}
          <div className="space-y-1 text-xs text-th-text-muted">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider w-14">Started</span>
              <span className="font-mono">{formatDateTime(session.startedAt)}</span>
            </div>
            {session.endedAt && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider w-14">Ended</span>
                <span className="font-mono">{formatDateTime(session.endedAt)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 border-t border-th-border px-4 py-3 space-y-2">
          {/* View full conversation */}
          {projectId && (
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/projects/${projectId}/sessions/${session.leadId}`);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-th-bg-alt hover:bg-th-bg-muted text-th-text rounded-lg transition-colors font-medium"
              data-testid="session-viewer-view-full"
            >
              <Eye size={14} />
              View full conversation
            </button>
          )}

          {/* Resume */}
          {isEnded && onResume && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onResume();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-accent/20 hover:bg-accent/30 text-accent rounded-lg transition-colors font-medium"
              data-testid="session-viewer-resume"
            >
              <Play size={14} />
              Resume this session
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
