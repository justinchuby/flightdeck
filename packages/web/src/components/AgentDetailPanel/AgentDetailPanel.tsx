/**
 * AgentDetailPanel — Unified agent detail component.
 *
 * Renders as either an inline side panel or a centered modal popup.
 * Merges all features from the former AgentDetailModal and ProfilePanel.
 *
 * Tabs:
 *   Details  — metadata, task, tokens, context window, output, errors
 *   Chat     — full message history + send input
 *   Settings — editable model, provider info
 */
import { useState, useEffect } from 'react';
import {
  Zap,
  Square,
  Send,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  MessageSquare,
  Settings,
  Info,
  Activity,
  X,
  ArrowLeft,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import type { AgentComm, ActivityEvent } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { agentStatusText } from '../../utils/statusColors';
import { formatTokens } from '../../utils/format';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { MentionText } from '../../utils/markdown';
import { buildFeedbackUrl } from '../ProvideFeedback';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { AgentChatPanel } from '../AgentChatPanel';
import { AgentReportBlock } from '../LeadDashboard/AgentReportBlock';
import { getProviderColors } from '../../utils/providerColors';
import { useModels, deriveModelName } from '../../hooks/useModels';
import { shortAgentId } from '../../utils/agentLabel';

// ── Types ────────────────────────────────────────────────────

export interface AgentDetailPanelProps {
  agentId: string;
  /** If present, fetches richer profile data from the teams API */
  teamId?: string;
  /** 'inline' renders as a side panel; 'modal' renders as a centered overlay */
  mode: 'inline' | 'modal';
  onClose: () => void;
}

type DetailTab = 'details' | 'chat' | 'settings';

/** Profile data returned from /teams/:teamId/agents/:agentId/profile */
interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: string;
  liveStatus: string | null;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
    sessionId: string | null;
    provider: string | null;
    backend: string | null;
    exitError: string | null;
  } | null;
}

// ── Tab definitions ──────────────────────────────────────────

const TABS: TabItem[] = [
  { id: 'details', label: 'Details', icon: <Info className="w-3.5 h-3.5" /> },
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
];

// ── Main exported component ──────────────────────────────────

export function AgentDetailPanel({ agentId, teamId, mode, onClose }: AgentDetailPanelProps) {
  const agentExists = useAppStore((s) => s.agents.some((a) => a.id === agentId));

  // Close modal on Escape key
  useEffect(() => {
    if (mode !== 'modal') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, onClose]);

  // If no agent in store and no teamId to fetch profile from, render nothing
  if (!agentExists && !teamId) return null;

  if (mode === 'modal') {
    return (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
          <AgentDetailPanelContent agentId={agentId} teamId={teamId} mode={mode} onClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-th-bg-alt rounded-lg border border-th-border w-full h-full flex flex-col">
      <AgentDetailPanelContent agentId={agentId} teamId={teamId} mode={mode} onClose={onClose} />
    </div>
  );
}

// ── Inner content (shared between modal and inline) ──────────

function AgentDetailPanelContent({ agentId, teamId, mode, onClose }: AgentDetailPanelProps) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const addToast = useToastStore((s) => s.add);

  // Pull communications and activity from leadStore for the current project
  const leadId = useLeadStore((s) => s.selectedLeadId);
  const comms = useLeadStore((s) => leadId ? s.projects[leadId]?.comms : undefined);
  const activity = useLeadStore((s) => leadId ? s.projects[leadId]?.activity : undefined);
  const agentComms = (comms ?? []).filter((c) => c.fromId === agentId || c.toId === agentId);
  const agentActivity = (activity ?? []).filter((e) => e.agentId === agentId);

  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch profile data when teamId is available
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    setProfileLoading(true);
    apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`)
      .then((data) => { if (!cancelled) setProfile(data); })
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [agentId, teamId]);

  if (!agent && !profile) {
    if (profileLoading) {
      return (
        <div className="flex items-center justify-center h-48 text-th-text-alt">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />Loading…
        </div>
      );
    }
    return null;
  }

  // Merge live agent data (from store) with profile data (from API)
  const roleName = agent?.role?.name ?? profile?.role ?? 'Unknown';
  const roleIcon = agent?.role?.icon ?? getRoleIcon(profile?.role ?? '');
  const status = agent?.status ?? profile?.liveStatus ?? profile?.status ?? 'unknown';
  const provider = agent?.provider ?? profile?.live?.provider ?? null;
  const model = agent?.model ?? profile?.live?.model ?? profile?.model ?? '';
  const sessionId = agent?.sessionId ?? profile?.live?.sessionId ?? null;
  const task = agent?.task ?? profile?.live?.task ?? null;
  const outputPreview = agent?.outputPreview ?? profile?.live?.outputPreview ?? null;
  const exitError = agent?.exitError ?? profile?.live?.exitError ?? null;
  const exitCode = agent?.exitCode;
  const modelTranslated = agent?.modelResolution?.translated ?? false;
  const requestedModel = agent?.modelResolution?.requested ?? null;
  const resolvedModel = agent?.modelResolution?.resolved ?? null;
  const modelResolutionReason = agent?.modelResolution?.reason ?? null;
  const isAgentFailed = status === 'failed' || status === 'terminated';
  const isAlive = status === 'running' || status === 'creating' || status === 'idle';

  const totalTokens = (agent?.inputTokens ?? 0) + (agent?.outputTokens ?? 0)
    + (agent?.cacheReadTokens ?? 0) + (agent?.cacheWriteTokens ?? 0);

  const handleAction = async (action: string, endpoint: string, method = 'POST', body?: string) => {
    setActionLoading(action);
    try {
      await apiFetch(endpoint, { method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}) });
      if (action === 'stop') {
        addToast('success', 'Agent terminated');
        setConfirmStop(false);
        if (teamId) {
          const data = await apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`);
          setProfile(data);
        }
      } else if (action === 'interrupt') {
        addToast('success', 'Interrupt sent');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addToast('error', `Failed: ${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const openGitHubIssue = () => {
    const title = `Agent failure: ${roleName} ${provider ?? 'unknown'} ${model} - exit code ${exitCode ?? 'unknown'}`;
    const errorParts: string[] = [];
    errorParts.push(`Agent: ${roleName} (${agentId})`);
    errorParts.push(`Provider: ${provider ?? 'N/A'}, Model: ${model}`);
    errorParts.push(`Exit Code: ${exitCode ?? 'N/A'}, Session: ${sessionId ?? 'N/A'}`);
    if (task) errorParts.push(`Task: ${task}`);
    if (exitError) {
      const truncated = exitError.length > 1000 ? exitError.slice(0, 1000) + '\n… (truncated)' : exitError;
      errorParts.push(`Error:\n${truncated}`);
    }
    const url = buildFeedbackUrl({ title, errorMessage: errorParts.join('\n') });
    window.open(url, '_blank');
  };

  return (
    <>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-th-border shrink-0">
        {mode === 'inline' && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-th-bg-muted text-th-text-muted md:hidden"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <span className="text-2xl">{roleIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-th-text">{roleName}</span>
            <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${agentStatusText(status)} bg-th-bg-muted`}>
              {status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-th-text-muted font-mono flex-wrap">
            <span title={agentId}>{shortAgentId(agentId)}</span>
            {provider && (() => {
              const pc = getProviderColors(provider);
              return <span className={`${pc.bg} ${pc.text} px-1.5 rounded`}>{provider}</span>;
            })()}
            {model && (
              modelTranslated && requestedModel ? (
                <span className="bg-th-bg-muted/50 px-1.5 rounded" title={modelResolutionReason ?? undefined}>
                  <span className="line-through text-th-text-muted/60">{requestedModel}</span>
                  {' → '}
                  <span className="text-yellow-400">{resolvedModel ?? model}</span>
                </span>
              ) : (
                <span className="bg-th-bg-muted/50 px-1.5 rounded">{model}</span>
              )
            )}
            {sessionId && (
              <button
                className="bg-th-bg-muted/50 px-1.5 rounded hover:bg-th-bg-muted transition-colors text-[10px]"
                title={`Click to copy session ID: ${sessionId}`}
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(sessionId); }}
              >
                sess:{sessionId}
              </button>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {isAlive && (
          <div className="flex items-center gap-1 mr-2 shrink-0">
            <button
              onClick={() => handleAction('interrupt', `/agents/${agentId}/interrupt`)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/40 transition-colors disabled:opacity-50"
              title="Interrupt agent"
            >
              {actionLoading === 'interrupt' ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />} Interrupt
            </button>
            <button
              onClick={() => setConfirmStop(true)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors disabled:opacity-50"
              title="Stop agent"
            >
              <Square size={12} /> Stop
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="text-th-text-muted hover:text-th-text text-lg leading-none p-1 shrink-0"
        >
          ×
        </button>
      </div>

      {/* Stop confirmation */}
      {confirmStop && (
        <div className="mx-4 mt-2 p-3 rounded bg-red-500/10 border border-red-500/30 shrink-0">
          <p className="text-xs text-red-300 mb-2">Terminate this agent? This cannot be undone.</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleAction('stop', `/agents/${agentId}/terminate`)}
              disabled={actionLoading === 'stop'}
              className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {actionLoading === 'stop' ? 'Stopping…' : 'Confirm'}
            </button>
            <button onClick={() => setConfirmStop(false)} className="px-3 py-1 text-xs rounded bg-th-bg-muted text-th-text-muted hover:bg-th-border transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as DetailTab)} className="px-4 shrink-0" />

      {/* ── Tab content ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'details' && (
          <DetailsTab
            agent={agent ?? null}
            agentId={agentId}
            profile={profile}
            provider={provider}
            model={model}
            task={task}
            outputPreview={outputPreview}
            exitError={exitError}
            exitCode={exitCode}
            isAgentFailed={isAgentFailed}
            totalTokens={totalTokens}
            openGitHubIssue={openGitHubIssue}
            agentComms={agentComms}
            agentActivity={agentActivity}
          />
        )}
        {activeTab === 'chat' && (
          <div className="p-4" style={{ minHeight: 200 }}>
            <AgentChatPanel agentId={agentId} readOnly={!isAlive} maxHeight="400px" autoFocusInput />
          </div>
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            agentId={agentId}
            profile={profile}
            isAlive={isAlive}
            model={model}
            provider={provider}
            setProfile={setProfile}
          />
        )}
      </div>
    </>
  );
}

// ── Details Tab ──────────────────────────────────────────────

interface DetailsTabProps {
  agent: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; contextWindowSize?: number; contextWindowUsed?: number } | null;
  agentId: string;
  profile: AgentProfile | null;
  provider: string | null;
  model: string;
  task: string | null;
  outputPreview: string | null;
  exitError: string | null;
  exitCode: number | undefined;
  isAgentFailed: boolean;
  totalTokens: number;
  openGitHubIssue: () => void;
  agentComms: AgentComm[];
  agentActivity: ActivityEvent[];
}

function DetailsTab({ agent, agentId, profile, task, outputPreview, exitError, exitCode, provider, model, isAgentFailed, totalTokens, openGitHubIssue, agentComms, agentActivity }: DetailsTabProps) {
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  const hasContent = task || totalTokens > 0 || outputPreview || exitError || profile || agentComms.length > 0 || agentActivity.length > 0;

  return (
    <div className="space-y-0">
      {/* Agent Failed banner */}
      {isAgentFailed && (exitError || exitCode !== undefined) && (
        <div className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 overflow-hidden">
          <div className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-red-400">Agent Failed</h4>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-red-300/80">
                {exitCode != null && (
                  <span>Exit code: <span className="text-red-400 font-semibold">{exitCode}</span></span>
                )}
                {provider && <span>Provider: <span className="text-red-400">{provider}</span></span>}
                {model && <span>Model: <span className="text-red-400">{model}</span></span>}
              </div>
              {exitError && (
                <pre className="mt-2 text-xs font-mono text-red-400/90 whitespace-pre-wrap break-words bg-red-900/20 rounded p-2 max-h-40 overflow-y-auto">
                  {exitError}
                </pre>
              )}
            </div>
          </div>
          <div className="px-4 pb-3 flex justify-end">
            <button
              onClick={openGitHubIssue}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-red-600/30 text-red-300 hover:bg-red-600/50 hover:text-red-200 transition-colors border border-red-500/30"
            >
              <ExternalLink size={12} />
              Submit GitHub Issue
            </button>
          </div>
        </div>
      )}

      {/* Profile metadata (when teamId provides richer data) */}
      {profile && (
        <div className="px-5 py-3 border-b border-th-border">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {profile.projectId && (
              <div><span className="text-th-text-muted">Project:</span> <span className="text-th-text">{profile.projectId}</span></div>
            )}
            <div><span className="text-th-text-muted">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
            <div><span className="text-th-text-muted">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleString()}</span></div>
            <div><span className="text-th-text-muted">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleString()} ({formatRelativeTime(profile.updatedAt)})</span></div>
          </div>
        </div>
      )}

      {/* Current Task */}
      {task && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Current Task</h4>
          <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{task}</p>
        </div>
      )}

      {/* Token Usage */}
      {totalTokens > 0 && agent && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Token Usage</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-th-text-alt">
            <span>Input: {formatTokens(agent.inputTokens)}</span>
            <span>Output: {formatTokens(agent.outputTokens)}</span>
            <span>Cache Read: {formatTokens(agent.cacheReadTokens)}</span>
            <span>Cache Write: {formatTokens(agent.cacheWriteTokens)}</span>
          </div>
          <div className="mt-1 text-xs font-mono text-th-text-muted">
            Total: {formatTokens(totalTokens)}
          </div>
        </div>
      )}

      {/* Context Window */}
      {agent && (agent.contextWindowSize ?? 0) > 0 && (() => {
        const used = agent.contextWindowUsed ?? 0;
        const size = agent.contextWindowSize ?? 1;
        const pct = Math.round((used / size) * 100);
        return (
          <div className="px-5 py-3 border-b border-th-border">
            <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Context Window</h4>
            <div className="mt-1.5">
              <div className="flex items-center gap-2 text-[10px] font-mono text-th-text-muted">
                <span>Context: {formatTokens(used)} / {formatTokens(size)}</span>
                <span>({pct}%)</span>
              </div>
              <div className="w-full bg-th-bg-muted rounded-full h-1 mt-1">
                <div
                  className={`h-1 rounded-full transition-all ${
                    pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Live session banner (from profile) */}
      {profile?.live && !isAgentFailed && (
        <div className="mx-4 mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-2 text-green-400 text-xs mb-1">
            <Activity className="w-3.5 h-3.5" />Live Session
          </div>
          {profile.live.task && <p className="text-sm text-th-text">{profile.live.task}</p>}
        </div>
      )}

      {/* Latest Output preview */}
      {outputPreview && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Latest Output</h4>
          <pre className="text-xs font-mono text-th-text-alt whitespace-pre-wrap max-h-40 overflow-y-auto bg-th-bg/50 rounded p-2">
            {outputPreview}
          </pre>
        </div>
      )}

      {/* Exit Error (inline, when not in failed banner) */}
      {exitError && !isAgentFailed && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Exit Error</h4>
          <div className="text-xs font-mono text-red-400 whitespace-pre-wrap bg-red-900/20 border border-red-800/40 rounded p-2">
            {exitError}
          </div>
        </div>
      )}

      {/* Last task summary (from profile, if no live task) */}
      {!task && profile?.lastTaskSummary && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Last Task</h4>
          <p className="text-sm text-th-text-alt">{profile.lastTaskSummary}</p>
        </div>
      )}

      {/* Communications */}
      {agentComms.length > 0 && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
            Communications ({agentComms.length})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {agentComms.slice(-20).map((c) => {
              const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const isSender = c.fromId === agentId;
              return (
                <div
                  key={c.id}
                  className="text-xs font-mono cursor-pointer hover:bg-th-bg-muted/40 rounded px-1 py-0.5 transition-colors"
                  onClick={() => setSelectedComm(c)}
                >
                  <div className="flex items-center gap-1">
                    <span className={isSender ? 'text-cyan-400' : 'text-green-400'}>{isSender ? c.fromRole : c.toRole}</span>
                    <span className="text-th-text-muted">{isSender ? '→' : '←'}</span>
                    <span className={isSender ? 'text-green-400' : 'text-cyan-400'}>{isSender ? c.toRole : c.fromRole}</span>
                    <span className="text-th-text-muted ml-auto">{time}</span>
                  </div>
                  <p className="text-th-text-alt mt-0.5 break-words whitespace-pre-wrap">
                    <MentionText text={c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Activity */}
      {agentActivity.length > 0 && (
        <div className="px-5 py-3 border-b border-th-border">
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
            Activity ({agentActivity.length})
          </h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {agentActivity.slice(-15).map((evt) => {
              const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={evt.id} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-th-text-muted">{time}</span>
                  <span className="text-th-text-alt truncate" title={evt.summary}>{evt.summary}</span>
                  {evt.status && (
                    <span className={`ml-auto shrink-0 text-[10px] ${
                      evt.status === 'completed' ? 'text-purple-400' :
                      evt.status === 'in_progress' ? 'text-blue-400' : 'text-th-text-muted'
                    }`}>{evt.status}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasContent && (
        <div className="px-5 py-8 text-center text-th-text-muted text-xs font-mono">
          No activity yet for this agent
        </div>
      )}

      {/* Comm detail popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedComm(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-th-text-muted">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selectedComm.timestamp).toLocaleTimeString()}
                </span>
                <button type="button" aria-label="Close communication detail" onClick={() => setSelectedComm(null)} className="text-th-text-muted hover:text-th-text text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <pre className="text-sm font-mono text-th-text-alt whitespace-pre-wrap break-words leading-relaxed">
                    <MentionText text={selectedComm.content} agents={useAppStore.getState().agents} onClickAgent={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedComm(null); }} />
                  </pre>
                )
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ─────────────────────────────────────────────

interface SettingsTabProps {
  agentId: string;
  profile: AgentProfile | null;
  isAlive: boolean;
  model: string;
  provider: string | null;
  setProfile: React.Dispatch<React.SetStateAction<AgentProfile | null>>;
}

function SettingsTab({ agentId, profile, isAlive, model, provider, setProfile }: SettingsTabProps) {
  const addToast = useToastStore((s) => s.add);
  const { models: availableModels } = useModels();

  return (
    <div className="p-4 space-y-3 text-sm">
      <div>
        <label className="text-th-text-muted text-xs block mb-1">Model</label>
        {isAlive ? (
          <select
            value={model}
            onChange={async (e) => {
              try {
                await apiFetch(`/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify({ model: e.target.value }) });
                setProfile((p) => p ? { ...p, model: e.target.value, live: p.live ? { ...p.live, model: e.target.value } : p.live } : p);
                addToast('success', 'Model updated');
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                addToast('error', `Failed to update model: ${msg}`);
              }
            }}
            className="w-full text-sm bg-th-bg border border-th-border text-th-text rounded px-2 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
          >
            {(() => {
              const options = availableModels.includes(model) ? availableModels : [model, ...availableModels];
              return options.map((m) => <option key={m} value={m}>{deriveModelName(m)}</option>);
            })()}
          </select>
        ) : (
          <span className="text-th-text font-mono text-xs">{model || '—'}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {provider && (
          <div><span className="text-th-text-muted">CLI Provider:</span> <span className="text-th-text capitalize">{provider}</span></div>
        )}
        {profile?.live?.backend && (
          <div><span className="text-th-text-muted">Backend:</span> <span className="text-th-text">{profile.live.backend}</span></div>
        )}
      </div>

      {!isAlive && !provider && !profile?.live?.backend && (
        <div className="text-xs text-th-text-muted text-center py-4">
          No settings available for this agent
        </div>
      )}
    </div>
  );
}

export default AgentDetailPanel;
