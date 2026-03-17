import { useState, useEffect } from 'react';
import { ChevronRight, AlertTriangle, Trash2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { sessionStatusDot } from '../../utils/statusColors';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { formatTokens } from '../../utils/format';
import { shortAgentId } from '../../utils/agentLabel';
import type { RosterAgent, CrewSummary, SessionDetail } from './types';
import { statusBadge, formatDuration } from './utils';

// ── Crew Group (collapsible) ──────────────────────────────

interface CrewGroupProps {
  leadId: string;
  agents: RosterAgent[];
  summary: CrewSummary | null;
  defaultExpanded?: boolean;
  onSelectAgent: (id: string) => void;
  selectedAgentId: string | null;
  onDeleteCrew: (leadId: string) => Promise<void>;
}

export function CrewGroup({ leadId, agents, summary, defaultExpanded = true, onSelectAgent, selectedAgentId, onDeleteCrew }: CrewGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lazy-load session details when expanded and project is known
  useEffect(() => {
    if (!expanded || sessionsLoaded || !summary?.projectId) return;
    setSessionsLoaded(true);
    apiFetch<SessionDetail[]>(`/projects/${summary.projectId}/sessions/detail`)
      .then(data => {
        // Filter to sessions belonging to this crew's lead
        const crewSessions = Array.isArray(data)
          ? data.filter(s => s.leadId === leadId)
          : [];
        setSessions(crewSessions);
      })
      .catch(() => { /* silently ignore — sessions section just won't show */ });
  }, [expanded, sessionsLoaded, summary?.projectId, leadId]);

  // Lead first, then sorted by role
  const sorted = [...agents].sort((a, b) => {
    if (a.agentId === leadId) return -1;
    if (b.agentId === leadId) return 1;
    const aIsLead = a.role === 'lead' ? 0 : 1;
    const bIsLead = b.role === 'lead' ? 0 : 1;
    if (aIsLead !== bIsLead) return aIsLead - bIsLead;
    return a.role.localeCompare(b.role);
  });

  const lead = sorted.find(a => a.agentId === leadId || a.role === 'lead');
  const activeCount = summary?.activeAgentCount ?? agents.filter(a =>
    a.liveStatus === 'running' || a.liveStatus === 'idle'
  ).length;
  const isActive = activeCount > 0;
  const latestActivity = summary?.lastActivity ??
    agents.reduce((latest, a) => a.updatedAt > latest ? a.updatedAt : latest, '');
  const displayName = summary?.projectName ?? (lead?.projectId ? `Project ${shortAgentId(lead.projectId)}` : `Crew ${shortAgentId(leadId)}`);

  const handleDeleteCrew = async () => {
    setDeleting(true);
    try {
      await onDeleteCrew(leadId);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <div className="border border-th-border rounded-lg overflow-hidden bg-surface-raised md:min-w-[280px]">
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-th-bg-alt/30 transition-colors">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <ChevronRight className={`w-4 h-4 text-th-text-muted shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-text text-sm">{displayName}</span>
              {activeCount > 0 ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                  {activeCount}/{agents.length} active
                </span>
              ) : (
                <span className="text-[10px] text-th-text-muted">
                  {agents.length} agent{agents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-th-text-muted mt-0.5">
              {lead && <span>🎖️ Lead: {shortAgentId(lead.agentId)}{lead.provider ? ` · ${lead.provider}` : ''} · {lead.model}</span>}
              {summary?.sessionCount ? <span>📋 {summary.sessionCount} session{summary.sessionCount !== 1 ? 's' : ''}</span> : null}
              {latestActivity && <span>{formatRelativeTime(latestActivity)}</span>}
            </div>
          </div>
        </button>
        {!isActive && (
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Delete crew"
            className="p-1.5 rounded text-th-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmingDelete && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-t border-red-500/20">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs text-red-600 dark:text-red-400 flex-1">
            Delete <strong>{displayName}</strong> and all {agents.length} agents? This cannot be undone.
          </span>
          <button
            onClick={handleDeleteCrew}
            disabled={deleting}
            className="px-2.5 py-1 text-xs bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={deleting}
            className="px-2.5 py-1 text-xs text-th-text-muted rounded hover:bg-th-bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Agent rows */}
      {expanded && (
        <div className="border-t border-th-border/50 divide-y divide-th-border/30">
          {sorted.map(agent => (
            <AgentRow
              key={agent.agentId}
              agent={agent}
              isLead={agent.agentId === leadId || agent.role === 'lead'}
              isSelected={selectedAgentId === agent.agentId}
              onSelect={() => onSelectAgent(agent.agentId)}
            />
          ))}
        </div>
      )}

      {/* Session history */}
      {expanded && sessions.length > 0 && (
        <div className="border-t border-th-border/50 px-3 py-2 bg-th-bg-alt/10">
          <div className="text-[10px] font-medium text-th-text-muted mb-1.5 uppercase tracking-wide">Sessions</div>
          <div className="space-y-1.5">
            {sessions.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${sessionStatusDot(s.status)}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-th-text truncate">{s.task ?? 'No task description'}</div>
                  <div className="flex items-center gap-2 text-[10px] text-th-text-muted">
                    <span>{formatRelativeTime(s.startedAt)}</span>
                    {s.durationMs != null && <span>{formatDuration(s.durationMs)}</span>}
                    {s.taskSummary.total > 0 && (
                      <span>
                        {s.taskSummary.done}/{s.taskSummary.total} tasks
                        {s.taskSummary.failed > 0 && ` · ${s.taskSummary.failed} failed`}
                      </span>
                    )}
                    {s.hasRetro && <span title="Session retro available">📝</span>}
                  </div>
                </div>
              </div>
            ))}
            {sessions.length > 5 && (
              <div className="text-[10px] text-th-text-muted">+ {sessions.length - 5} more session{sessions.length - 5 !== 1 ? 's' : ''}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent Row (compact, within crew group) ────────────────

function AgentRow({ agent, isLead, isSelected, onSelect }: {
  agent: RosterAgent; isLead?: boolean; isSelected: boolean; onSelect: () => void;
}) {
  const badge = statusBadge(agent.status, agent.liveStatus);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-th-bg-alt/30 transition-colors
        ${isSelected ? 'bg-th-bg-alt/40 border-l-2 border-blue-500' : ''}
        ${isLead ? 'font-medium' : ''}`}
    >
      <span className="w-4 text-center text-xs">{isLead ? '🎖️' : getRoleIcon(agent.role)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs capitalize">{agent.role}</span>
          <code className="text-[10px] text-th-text-muted">{shortAgentId(agent.agentId)}</code>
          {agent.sessionId && (
            <button
              className="text-[10px] font-mono text-th-text-muted bg-th-bg-alt/60 px-1 rounded hover:bg-th-bg-alt transition-colors truncate max-w-[120px]"
              title={`Session: ${agent.sessionId} — click to copy`}
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(agent.sessionId!); }}
            >
              {agent.sessionId}
            </button>
          )}
          {agent.provider && (
            <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1 py-px rounded">{agent.provider}</span>
          )}
          <span className="text-[10px] text-th-text-muted">{agent.model}</span>
        </div>
        {agent.lastTaskSummary && (
          <div className="text-[10px] text-th-text-muted truncate">{agent.lastTaskSummary}</div>
        )}
        {agent.task && (
          <div className="text-[10px] text-th-text-alt truncate">📋 {agent.task}</div>
        )}
        {(agent.inputTokens || agent.outputTokens) ? (
          <div className="flex items-center gap-2 text-[10px] text-th-text-muted">
            <span>↓{formatTokens(agent.inputTokens)}</span>
            <span>↑{formatTokens(agent.outputTokens)}</span>
            {agent.contextWindowSize && agent.contextWindowUsed ? (
              <span className={agent.contextWindowUsed / agent.contextWindowSize > 0.85 ? 'text-red-400' : agent.contextWindowUsed / agent.contextWindowSize > 0.6 ? 'text-yellow-400' : ''}>
                ctx {Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100)}%
              </span>
            ) : null}
          </div>
        ) : null}
        {agent.outputPreview && (
          <div className="text-[10px] text-th-text-muted font-mono truncate opacity-60">{agent.outputPreview.trim().split('\n').pop()}</div>
        )}
      </div>
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${badge.bg}`}>{badge.label}</span>
    </button>
  );
}
