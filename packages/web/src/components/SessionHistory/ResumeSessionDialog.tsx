import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { Play, Loader2, Users, UserPlus, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ProvideFeedback } from '../ProvideFeedback';
import type { SessionDetail, SessionAgent } from './SessionHistory';
import { shortAgentId } from '../../utils/agentLabel';

type ResumeMode = 'resume-all' | 'select' | 'fresh';

interface ResumeSessionDialogProps {
  projectId: string;
  lastSession: SessionDetail;
  onClose: () => void;
  onResume: () => void;
}

function AgentCheckbox({
  agent,
  checked,
  onChange,
}: {
  agent: SessionAgent;
  checked: boolean;
  onChange: (agentId: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs py-1 cursor-pointer hover:bg-th-bg-hover/30 px-1 rounded">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange(agent.agentId)}
        className="rounded border-th-border"
      />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-th-text">{agent.role}</span>
          <code className="text-[10px] text-th-text-muted">{shortAgentId(agent.agentId)}</code>
          {agent.provider && (
            <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1 rounded">{agent.provider}</span>
          )}
          <span className="text-th-text-muted">({agent.model})</span>
          {agent.sessionId ? (
            <span className="text-green-500 flex items-center gap-0.5" title={`Session: ${agent.sessionId}`}>
              <CheckCircle2 size={10} />
              <span className="text-[10px]">resumable</span>
              <code className="text-[10px] text-green-500/70">{shortAgentId(agent.sessionId)}</code>
            </span>
          ) : (
            <span className="text-th-text-muted flex items-center gap-0.5" title="No session ID — will start fresh">
              <span className="text-[10px]">fresh start</span>
            </span>
          )}
        </div>
        {agent.lastTaskSummary && (
          <span className="text-[10px] text-th-text-muted truncate max-w-xs">{agent.lastTaskSummary}</span>
        )}
      </div>
    </label>
  );
}

const MODE_OPTIONS: Array<{ value: ResumeMode; icon: typeof Users; label: string; description: string }> = [
  {
    value: 'resume-all',
    icon: Users,
    label: 'Resume all agents',
    description: 'Respawn the full crew from the previous session',
  },
  {
    value: 'select',
    icon: UserPlus,
    label: 'Select specific agents',
    description: 'Choose which agents to bring back',
  },
  {
    value: 'fresh',
    icon: Sparkles,
    label: 'Fresh start',
    description: 'New lead only, with project context from previous sessions',
  },
];

export function ResumeSessionDialog({ projectId, lastSession, onClose, onResume }: ResumeSessionDialogProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ResumeMode>('resume-all');
  const nonLeadAgents = lastSession.agents.filter(a => a.role !== 'lead');

  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    () => new Set(nonLeadAgents.map(a => a.agentId)),
  );
  const [task, setTask] = useState('');
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAgent = useCallback((agentId: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const handleResume = useCallback(async () => {
    setResuming(true);
    setError(null);
    try {
      const response = await apiFetch<{ id: string }>(`/projects/${projectId}/resume`, {
        method: 'POST',
        body: JSON.stringify({
          task: task.trim() || undefined,
          freshStart: mode === 'fresh',
          resumeAll: mode === 'resume-all',
          agents: mode === 'select' ? Array.from(selectedAgents) : undefined,
          sessionId: lastSession.id,
        }),
      });
      onResume();
      if (response?.id) {
        navigate(`/projects/${projectId}/session`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resume project');
    } finally {
      setResuming(false);
    }
  }, [projectId, mode, task, selectedAgents, onResume, navigate]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="resume-session-dialog"
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-th-border">
          <Play className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold text-th-text">Resume Project</h2>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Previous session info */}
          <div className="text-xs text-th-text-muted bg-th-bg-muted/30 rounded-md px-3 py-2">
            Previous session: {lastSession.agents.length} agents ·{' '}
            {lastSession.taskSummary.done}/{lastSession.taskSummary.total} tasks completed
            {lastSession.task && (
              <div className="mt-1 text-th-text truncate">"{lastSession.task}"</div>
            )}
          </div>

          {/* Mode selector */}
          <div className="space-y-1.5">
            <label className="block text-xs text-th-text-muted font-medium">Resume Mode</label>
            {MODE_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const isSelected = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`flex items-start gap-2.5 w-full text-left p-2.5 rounded-md border transition-colors ${
                    isSelected
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-th-border/50 hover:bg-th-bg-hover/30'
                  }`}
                >
                  <Icon size={16} className={isSelected ? 'text-accent mt-0.5' : 'text-th-text-muted mt-0.5'} />
                  <div>
                    <div className={`text-sm font-medium ${isSelected ? 'text-accent' : 'text-th-text'}`}>
                      {opt.label}
                      {opt.value === 'resume-all' && (
                        <span className="ml-1.5 text-th-text-muted font-normal">
                          ({lastSession.agents.length} agents)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-th-text-muted">{opt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Agent checkboxes (select mode) */}
          {mode === 'select' && nonLeadAgents.length > 0 && (
            <div className="space-y-1 pl-1">
              <div className="text-xs text-th-text-muted font-medium mb-1">
                Select agents to resume (lead always included):
              </div>
              {nonLeadAgents.map(agent => (
                <AgentCheckbox
                  key={agent.agentId}
                  agent={agent}
                  checked={selectedAgents.has(agent.agentId)}
                  onChange={toggleAgent}
                />
              ))}
            </div>
          )}

          {mode === 'select' && nonLeadAgents.length === 0 && (
            <div className="text-xs text-th-text-muted pl-1">
              No non-lead agents to select — only the lead will resume.
            </div>
          )}

          {/* Optional task override */}
          <div>
            <label className="block text-xs text-th-text-muted mb-1 font-medium">
              Task (optional — overrides previous)
            </label>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Continue previous work…"
              className="w-full text-sm bg-th-bg border border-th-border rounded-md px-3 py-2 text-th-text focus:outline-none focus:border-accent/50 resize-none"
              rows={2}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3 space-y-2" data-testid="resume-error">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <div className="text-xs text-red-400">
                  <span className="font-medium">Unable to resume session.</span>{' '}
                  {error}
                </div>
              </div>
              <div className="flex items-center gap-2 pl-5">
                <ProvideFeedback
                  context={{
                    title: 'Session resume failed',
                    errorMessage: error,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-th-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming}
            className="px-5 py-2 bg-accent hover:bg-accent/80 disabled:bg-th-bg-hover disabled:text-th-text-muted text-white text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
          >
            {resuming ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {resuming ? 'Resuming…' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
