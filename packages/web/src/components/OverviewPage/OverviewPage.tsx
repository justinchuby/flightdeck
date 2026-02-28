import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import type { ProgressSnapshot } from '../../stores/leadStore';
import type { Decision } from '../../types';
import { AlertTriangle, Check, X, MessageSquare, Send, Clock } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { MarkdownContent } from '../../utils/markdown';

interface Props {
  api: any;
  ws: any;
}

/** Format an ISO timestamp into a short human-readable string */
function fmtTime(ts: string | number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

// ── Detail Popup ────────────────────────────────────────────────────────

function DetailPopup({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-100 truncate">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none p-1">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-gray-200">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Pending Decision Card ───────────────────────────────────────────────

function PendingDecisionCard({
  decision,
  onApprove,
  onDeny,
  onRespond,
}: {
  decision: Decision;
  onApprove: (id: string, reason?: string) => void;
  onDeny: (id: string, reason?: string) => void;
  onRespond: (id: string, message: string) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setActing(true);
    await onRespond(decision.id, replyText.trim());
    setActing(false);
    setShowReply(false);
    setReplyText('');
  };

  return (
    <div className="bg-yellow-900/20 border border-yellow-500/40 rounded-lg p-3 animate-pulse-border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-yellow-200 truncate">{decision.title}</h4>
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{decision.rationale}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono text-gray-500 bg-gray-700/50 px-1 rounded">
              {decision.agentRole}
            </span>
            <span className="text-[10px] text-gray-500">
              <Clock className="w-3 h-3 inline mr-0.5" />
              {fmtTime(decision.timestamp)}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { setActing(true); onApprove(decision.id, reason.trim() || undefined); } }}
          placeholder="Add a comment (optional)..."
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-yellow-500 mb-2"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setActing(true); onApprove(decision.id, reason.trim() || undefined); }}
            disabled={acting}
            className="px-2 py-1 text-xs rounded bg-green-600/80 hover:bg-green-600 text-white transition-colors disabled:opacity-50"
            title="Approve"
          >
            <Check className="w-3.5 h-3.5 inline" /> Approve
          </button>
          <button
            onClick={() => { setActing(true); onDeny(decision.id, reason.trim() || undefined); }}
            disabled={acting}
            className="px-2 py-1 text-xs rounded bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
            title="Deny"
          >
            <X className="w-3.5 h-3.5 inline" /> Deny
          </button>
          <button
            onClick={() => setShowReply(!showReply)}
            disabled={acting}
            className="px-2 py-1 text-xs rounded bg-blue-600/80 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
            title="Reply with feedback"
          >
            <MessageSquare className="w-3.5 h-3.5 inline" /> Reply
          </button>
        </div>
      </div>
      {showReply && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') handleSendReply(); }}
            placeholder="Your feedback..."
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            autoFocus
          />
          <button
            onClick={handleSendReply}
            disabled={!replyText.trim() || acting}
            className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
          >
            <Send className="w-3 h-3 inline" /> Send
          </button>
        </div>
      )}
    </div>
  );
}

// ── Decision Timeline Item ──────────────────────────────────────────────

function DecisionTimelineItem({
  decision,
  projectName,
  onApprove,
  onDeny,
  onRespond,
  onClickDetail,
  onFeedback,
}: {
  decision: Decision;
  projectName?: string;
  onApprove: (id: string, reason?: string) => void;
  onDeny: (id: string, reason?: string) => void;
  onRespond: (id: string, message: string) => void;
  onClickDetail: (d: Decision) => void;
  onFeedback: (id: string) => void;
}) {
  const isPending = decision.needsConfirmation && decision.status === 'recorded';
  const isRecordedNonBlocking = !decision.needsConfirmation && decision.status === 'recorded';
  const showFeedback = !isPending; // Show feedback on any non-pending decision
  const statusColor =
    decision.status === 'confirmed'
      ? 'border-green-500/40 bg-green-900/10'
      : decision.status === 'rejected'
        ? 'border-red-500/40 bg-red-900/10'
        : isPending
          ? 'border-yellow-500/40 bg-yellow-900/10'
          : 'border-gray-700 bg-gray-800/50';

  const statusBadge =
    decision.status === 'confirmed' && decision.autoApproved ? (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-400">
        ⏱️ Auto-approved {decision.confirmedAt ? fmtTime(decision.confirmedAt) : ''}
      </span>
    ) : decision.status === 'confirmed' ? (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-600/30 text-green-400">
        ✅ Confirmed {decision.confirmedAt ? fmtTime(decision.confirmedAt) : ''}
      </span>
    ) : decision.status === 'rejected' ? (
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-600/30 text-red-400">
        ❌ Rejected {decision.confirmedAt ? fmtTime(decision.confirmedAt) : ''}
      </span>
    ) : null;

  return (
    <div
      className={`border rounded-lg p-3 cursor-pointer hover:brightness-110 transition-all ${statusColor}`}
      onClick={() => onClickDetail(decision)}
    >
      {isPending ? (
        <PendingDecisionCard
          decision={decision}
          onApprove={onApprove}
          onDeny={onDeny}
          onRespond={onRespond}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-gray-200 truncate">{decision.title}</h4>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{decision.rationale}</p>
            </div>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] font-mono text-gray-500 bg-gray-700/50 px-1 rounded">
              {decision.agentRole}
            </span>
            {projectName && (
              <span className="text-[10px] font-mono text-purple-400/70 bg-gray-700/50 px-1 rounded">
                {projectName}
              </span>
            )}
            {showFeedback && (
              <button
                onClick={(e) => { e.stopPropagation(); onFeedback(decision.id); }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition-colors"
                title="Give feedback on this decision"
              >
                <MessageSquare className="w-3 h-3 inline mr-0.5" /> Feedback
              </button>
            )}
            <span className="text-[10px] text-gray-500 ml-auto">
              <Clock className="w-3 h-3 inline mr-0.5" />
              {fmtTime(decision.timestamp)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Progress Card ───────────────────────────────────────────────────────

function ProjectProgressCard({
  leadId,
  projectName,
  teamSize,
  completionPct,
  latestSnapshot,
  onClick,
}: {
  leadId: string;
  projectName: string;
  teamSize: number;
  completionPct: number;
  latestSnapshot: ProgressSnapshot | null;
  onClick: () => void;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 cursor-pointer hover:border-gray-500 transition-colors" onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-100 truncate" title={projectName}>
          {projectName}
        </h3>
        <span className="text-xs text-gray-500 font-mono">{teamSize} agents</span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
        <div
          className="bg-accent h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(completionPct, 100)}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mb-2">{completionPct}% complete</p>

      {latestSnapshot && (
        <>
          {latestSnapshot.summary && (
            <p className="text-xs text-gray-300 mb-2 line-clamp-3">{latestSnapshot.summary}</p>
          )}
          <div className="space-y-1">
            {latestSnapshot.completed.length > 0 && (
              <div>
                <span className="text-[10px] text-green-400 font-semibold">✅ Completed</span>
                <ul className="ml-3">
                  {latestSnapshot.completed.slice(0, 5).map((item, i) => (
                    <li key={i} className="text-[11px] text-gray-400 truncate">
                      {item}
                    </li>
                  ))}
                  {latestSnapshot.completed.length > 5 && (
                    <li className="text-[10px] text-gray-500">
                      +{latestSnapshot.completed.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
            {latestSnapshot.inProgress.length > 0 && (
              <div>
                <span className="text-[10px] text-blue-400 font-semibold">🔄 In Progress</span>
                <ul className="ml-3">
                  {latestSnapshot.inProgress.slice(0, 5).map((item, i) => (
                    <li key={i} className="text-[11px] text-gray-400 truncate">
                      {item}
                    </li>
                  ))}
                  {latestSnapshot.inProgress.length > 5 && (
                    <li className="text-[10px] text-gray-500">
                      +{latestSnapshot.inProgress.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
            {latestSnapshot.blocked.length > 0 && (
              <div>
                <span className="text-[10px] text-red-400 font-semibold">🚫 Blocked</span>
                <ul className="ml-3">
                  {latestSnapshot.blocked.slice(0, 5).map((item, i) => (
                    <li key={i} className="text-[11px] text-gray-400 truncate">
                      {item}
                    </li>
                  ))}
                  {latestSnapshot.blocked.length > 5 && (
                    <li className="text-[10px] text-gray-500">
                      +{latestSnapshot.blocked.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────

export function OverviewPage({ api, ws }: Props) {
  const [allDecisions, setAllDecisions] = useState<Decision[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [selectedProject, setSelectedProject] = useState<{ leadId: string; projectName: string; teamSize: number; completionPct: number; latestSnapshot: ProgressSnapshot | null } | null>(null);
  const [feedbackDecisionId, setFeedbackDecisionId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const agents = useAppStore((s) => s.agents);
  const { projects } = useLeadStore();

  // Fetch all decisions on mount + poll every 5s
  const loadDecisions = useCallback(async () => {
    try {
      const data = await apiFetch<Decision[]>('/decisions');
      setAllDecisions(data);
    } catch {
      // ignore fetch errors during polling
    }
  }, []);

  useEffect(() => {
    loadDecisions();
    const interval = setInterval(loadDecisions, 5000);
    return () => clearInterval(interval);
  }, [loadDecisions]);

  // Actions
  const handleApprove = useCallback(
    async (id: string, reason?: string) => {
      // Optimistic update
      setAllDecisions((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: 'confirmed' as const, confirmedAt: new Date().toISOString() } : d,
        ),
      );
      await apiFetch(`/decisions/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      loadDecisions();
    },
    [loadDecisions],
  );

  const handleDeny = useCallback(
    async (id: string, reason?: string) => {
      setAllDecisions((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: 'rejected' as const, confirmedAt: new Date().toISOString() } : d,
        ),
      );
      await apiFetch(`/decisions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      loadDecisions();
    },
    [loadDecisions],
  );

  const handleRespond = useCallback(
    async (id: string, message: string) => {
      // Optimistic update
      setAllDecisions((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: 'confirmed' as const, confirmedAt: new Date().toISOString() } : d,
        ),
      );
      await apiFetch(`/decisions/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      loadDecisions();
    },
    [loadDecisions],
  );

  const handleFeedback = useCallback(
    async (message: string) => {
      if (!feedbackDecisionId || !message.trim()) return;
      await apiFetch(`/decisions/${feedbackDecisionId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ message: message.trim() }),
      });
      setFeedbackDecisionId(null);
      setFeedbackText('');
    },
    [feedbackDecisionId],
  );

  // Pending decisions (needs confirmation + still recorded)
  const pendingDecisions = allDecisions.filter(
    (d) => d.needsConfirmation && d.status === 'recorded',
  );

  // Build lead agents list
  const leadAgents = agents.filter((a) => a.role.id === 'lead' && !a.parentId);

  // Build a map of agentId → projectName for the timeline
  const agentProjectMap = new Map<string, string>();
  for (const agent of agents) {
    if (agent.projectName) {
      agentProjectMap.set(agent.id, agent.projectName);
      // Also map children to parent's projectName
      for (const childId of agent.childIds) {
        agentProjectMap.set(childId, agent.projectName);
      }
    }
  }

  // Build project progress data
  const projectCards = leadAgents.map((lead) => {
    const proj = projects[lead.id];
    const teamSize = lead.childIds.length;
    const completionPct = proj?.progress?.completionPct ?? 0;
    const latestSnapshot =
      proj?.progressHistory && proj.progressHistory.length > 0
        ? proj.progressHistory[proj.progressHistory.length - 1]
        : null;

    return {
      leadId: lead.id,
      projectName: lead.projectName || `Project ${lead.id.slice(0, 8)}`,
      teamSize,
      completionPct,
      latestSnapshot,
    };
  });

  // Timeline: all decisions, newest first
  const timelineDecisions = [...allDecisions].reverse();

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* A. Pending Decisions Banner */}
      {pendingDecisions.length > 0 && (
        <div className="bg-yellow-900/30 border-2 border-yellow-500/50 rounded-lg p-4 animate-pulse-slow">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <h2 className="text-base font-bold text-yellow-200">
              {pendingDecisions.length} Decision{pendingDecisions.length !== 1 ? 's' : ''} Pending
              Confirmation
            </h2>
          </div>
          <div className="space-y-3">
            {(() => {
              const grouped = new Map<string, Decision[]>();
              for (const d of pendingDecisions) {
                const proj = d.projectId
                  ? (agentProjectMap.get(d.projectId) ?? d.projectId.slice(0, 8))
                  : (agentProjectMap.get(d.agentId) ?? 'Unknown Project');
                if (!grouped.has(proj)) grouped.set(proj, []);
                grouped.get(proj)!.push(d);
              }
              return Array.from(grouped.entries()).map(([proj, decs]) => (
                <div key={proj}>
                  {grouped.size > 1 && (
                    <div className="text-[11px] font-mono font-semibold text-yellow-300/80 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      {proj}
                    </div>
                  )}
                  <div className="space-y-2">
                    {decs.map((d) => (
                      <PendingDecisionCard
                        key={d.id}
                        decision={d}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        onRespond={handleRespond}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* B. Progress Overview */}
      <div>
        <h2 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wide">
          Project Progress
        </h2>
        {projectCards.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500 font-mono">
              No active projects. Start a project from the Project Lead page.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {projectCards.map((card) => (
              <ProjectProgressCard key={card.leadId} {...card} onClick={() => setSelectedProject(card)} />
            ))}
          </div>
        )}
      </div>

      {/* C. All Decisions Timeline — grouped by project */}
      <div>
        <h2 className="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wide">
          Decisions Timeline
        </h2>
        {timelineDecisions.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500 font-mono">No decisions recorded yet.</p>
          </div>
        ) : (
          (() => {
            const grouped = new Map<string, Decision[]>();
            for (const d of timelineDecisions) {
              const proj = d.projectId
                ? (agentProjectMap.get(d.projectId) ?? d.projectId.slice(0, 8))
                : (agentProjectMap.get(d.agentId) ?? 'Unknown Project');
              if (!grouped.has(proj)) grouped.set(proj, []);
              grouped.get(proj)!.push(d);
            }
            return (
              <div className="space-y-4">
                {Array.from(grouped.entries()).map(([proj, decs]) => (
                  <div key={proj}>
                    <div className="text-xs font-mono font-semibold text-purple-300/80 uppercase tracking-wider mb-2 flex items-center gap-2 px-1">
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                      {proj}
                      <span className="text-gray-500 font-normal">({decs.length})</span>
                    </div>
                    <div className="space-y-2">
                      {decs.map((d) => (
                        <DecisionTimelineItem
                          key={d.id}
                          decision={d}
                          projectName={agentProjectMap.get(d.agentId)}
                          onApprove={handleApprove}
                          onDeny={handleDeny}
                          onRespond={handleRespond}
                          onClickDetail={setSelectedDecision}
                          onFeedback={(id) => { setFeedbackDecisionId(id); setFeedbackText(''); }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>

      {/* Decision detail popup */}
      {selectedDecision && (
        <DetailPopup title={selectedDecision.title} onClose={() => setSelectedDecision(null)}>
          <div className="space-y-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Status</span>
              <p className="text-sm mt-0.5">
                {selectedDecision.status === 'confirmed' && selectedDecision.autoApproved ? '⏱️ Auto-approved' : selectedDecision.status === 'confirmed' ? '✅ Confirmed' : selectedDecision.status === 'rejected' ? '❌ Rejected' : selectedDecision.needsConfirmation ? '⏳ Pending' : '📋 Recorded'}
                {selectedDecision.confirmedAt && <span className="text-gray-500 ml-2 text-xs">{fmtTime(selectedDecision.confirmedAt)}</span>}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Rationale</span>
              <div className="mt-1"><MarkdownContent text={selectedDecision.rationale || 'No rationale provided.'} /></div>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="font-mono bg-gray-700/50 px-1.5 rounded">{selectedDecision.agentRole}</span>
              <span>{fmtTime(selectedDecision.timestamp)}</span>
              <span className="font-mono text-gray-600">{selectedDecision.agentId?.slice(0, 8)}</span>
            </div>
            <button
              onClick={() => { setFeedbackDecisionId(selectedDecision.id); setFeedbackText(''); setSelectedDecision(null); }}
              className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Give Feedback
            </button>
          </div>
        </DetailPopup>
      )}

      {/* Project detail popup */}
      {selectedProject && (
        <DetailPopup title={selectedProject.projectName} onClose={() => setSelectedProject(null)}>
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">{selectedProject.teamSize} agents</span>
              <span className="text-accent font-semibold">{selectedProject.completionPct}% complete</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-accent h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(selectedProject.completionPct, 100)}%` }}
              />
            </div>
            {selectedProject.latestSnapshot && (
              <>
                {selectedProject.latestSnapshot.summary && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">Summary</span>
                    <div className="mt-1"><MarkdownContent text={selectedProject.latestSnapshot.summary} /></div>
                  </div>
                )}
                {selectedProject.latestSnapshot.completed.length > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-green-400 font-medium">✅ Completed ({selectedProject.latestSnapshot.completed.length})</span>
                    <ul className="mt-1 space-y-0.5">
                      {selectedProject.latestSnapshot.completed.map((item, i) => (
                        <li key={i} className="text-xs text-gray-300">• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedProject.latestSnapshot.inProgress.length > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-blue-400 font-medium">🔄 In Progress ({selectedProject.latestSnapshot.inProgress.length})</span>
                    <ul className="mt-1 space-y-0.5">
                      {selectedProject.latestSnapshot.inProgress.map((item, i) => (
                        <li key={i} className="text-xs text-gray-300">• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedProject.latestSnapshot.blocked.length > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-red-400 font-medium">🚫 Blocked ({selectedProject.latestSnapshot.blocked.length})</span>
                    <ul className="mt-1 space-y-0.5">
                      {selectedProject.latestSnapshot.blocked.map((item, i) => (
                        <li key={i} className="text-xs text-gray-300">• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </DetailPopup>
      )}

      {/* Feedback dialog */}
      {feedbackDecisionId && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setFeedbackDecisionId(null); }}
        >
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-full max-w-md">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-100">Feedback on Decision</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {allDecisions.find((d) => d.id === feedbackDecisionId)?.title}
              </p>
            </div>
            <div className="px-4 py-3">
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { handleFeedback(feedbackText); } }}
                placeholder="Tell the team what you'd like done differently..."
                rows={3}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 resize-y"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
              <button
                onClick={() => setFeedbackDecisionId(null)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleFeedback(feedbackText)}
                disabled={!feedbackText.trim()}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white font-semibold rounded"
              >
                <Send className="w-3 h-3 inline mr-1" /> Send Feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
