import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { formatDateTime } from '../../utils/format';
import {
  ChevronRight,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  ListChecks,
  Eye,
} from 'lucide-react';
import { ResumeSessionDialog } from './ResumeSessionDialog';

export interface SessionAgent {
  role: string;
  model: string;
  agentId: string;
  sessionId: string | null;
}

export interface SessionDetail {
  id: number;
  leadId: string;
  status: string;
  task: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  agents: SessionAgent[];
  taskSummary: { total: number; done: number; failed: number };
  hasRetro: boolean;
}

interface SessionHistoryProps {
  projectId: string;
  hasActiveLead?: boolean;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return 'ongoing';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  active: { icon: AlertCircle, color: 'text-yellow-500', label: 'Active' },
  crashed: { icon: XCircle, color: 'text-red-500', label: 'Crashed' },
};

function StatusDot({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.completed;
  const Icon = config.icon;
  return <Icon size={14} className={config.color} aria-label={config.label} />;
}

export function SessionHistory({ projectId, hasActiveLead }: SessionHistoryProps) {
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resumeSession, setResumeSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchSessions = useCallback(async () => {
    try {
      const data = await apiFetch<SessionDetail[]>(`/projects/${projectId}/sessions/detail`);
      setSessions(data);
    } catch {
      // Silently ignore — sessions are supplementary
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <div className="space-y-2" data-testid="session-history">
      <h3 className="text-sm font-medium text-th-text flex items-center gap-1.5">
        <Clock size={14} />
        Session History
        {sessions.length > 0 && (
          <span className="text-th-text-muted font-normal">({sessions.length})</span>
        )}
      </h3>

      {loading && (
        <div className="text-xs text-th-text-muted">Loading sessions…</div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="text-xs text-th-text-muted">No previous sessions</div>
      )}

      {!loading && sessions.length > 0 && (
      <div className="space-y-1.5">
        {sessions.map(session => {
          const isExpanded = expandedId === session.id;
          return (
            <div
              key={session.id}
              className="border border-th-border rounded-lg bg-th-bg-alt/30"
              data-testid={`session-card-${session.id}`}
            >
              {/* Header row */}
              <button
                type="button"
                className="flex items-center gap-2 p-2 w-full text-left hover:bg-th-bg-hover/30 rounded-lg transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : session.id)}
              >
                <StatusDot status={session.status} />
                <span
                  className="text-[10px] font-mono text-th-text-muted bg-th-bg-alt/60 px-1 rounded hover:bg-th-bg-alt transition-colors shrink-0"
                  title={`Session: ${session.leadId} — click to copy`}
                  role="button"
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(session.leadId); }}
                >
                  {session.leadId.slice(0, 8)}
                </span>
                <span className="text-xs flex-1 truncate text-th-text">
                  {session.task || 'No task description'}
                </span>
                <span className="text-xs text-th-text-muted flex items-center gap-0.5" title="Agents">
                  <Users size={11} />
                  {session.agents.length}
                </span>
                <span className="text-xs text-th-text-muted flex items-center gap-0.5" title="Tasks">
                  <ListChecks size={11} />
                  {session.taskSummary.done}/{session.taskSummary.total}
                </span>
                <span className="text-xs text-th-text-muted">
                  {formatDuration(session.durationMs)}
                </span>
                <ChevronRight
                  size={14}
                  className={`text-th-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                />
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-th-border/50 p-2.5 space-y-2.5">
                  {/* Agent composition */}
                  {session.agents.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {session.agents.map(a => (
                        <span
                          key={a.agentId}
                          className="text-xs px-1.5 py-0.5 rounded bg-th-bg-muted/50 text-th-text-muted"
                          title={`${a.role} — ${a.model}${a.sessionId ? ' (resumable)' : ''}`}
                        >
                          {a.role}
                          <span className="opacity-60 ml-0.5">({a.model})</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Timestamps */}
                  <div className="text-xs text-th-text-muted">
                    Started: {formatDateTime(session.startedAt)}
                    {session.endedAt && ` · Ended: ${formatDateTime(session.endedAt)}`}
                    {session.hasRetro && (
                      <span className="ml-2 text-green-500" title="Session retrospective available">
                        ● retro
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${projectId}/sessions/${session.leadId}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-th-bg-muted/50 text-th-text-muted rounded-md hover:bg-th-bg-muted hover:text-th-text transition-colors font-medium"
                    >
                      <Eye size={12} />
                      View full session
                    </button>
                    {session.status !== 'active' && !hasActiveLead && (
                      <button
                        type="button"
                        onClick={() => setResumeSession(session)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors font-medium"
                      >
                        <Play size={12} />
                        Resume from this session
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {resumeSession && (
        <ResumeSessionDialog
          projectId={projectId}
          lastSession={resumeSession}
          onClose={() => setResumeSession(null)}
          onResume={() => {
            setResumeSession(null);
            fetchSessions();
          }}
        />
      )}
    </div>
  );
}
