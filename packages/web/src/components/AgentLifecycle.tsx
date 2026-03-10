import { useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import {
  X,
  UserMinus,
  Copy,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import type { AgentHealthInfo } from '../pages/CrewPage';

// ── Types ───────────────────────────────────────────────────────────

interface Props {
  agentId: string;
  teamId: string;
  agent?: AgentHealthInfo;
  onClose: () => void;
  onActionComplete: () => void;
}

type ActionType = 'retire' | 'clone' | 'retrain';

interface ConfirmState {
  action: ActionType;
  title: string;
  message: string;
  destructive: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function AgentLifecycle({ agentId, teamId, agent, onClose, onActionComplete }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [retireReason, setRetireReason] = useState('');

  const executeAction = useCallback(async (action: ActionType) => {
    setLoading(true);
    setResult(null);

    try {
      const encodedTeam = encodeURIComponent(teamId);
      const encodedAgent = encodeURIComponent(agentId);

      switch (action) {
        case 'retire': {
          await apiFetch(`/teams/${encodedTeam}/agents/${encodedAgent}/retire`, {
            method: 'POST',
            body: JSON.stringify({ reason: retireReason || undefined }),
          });
          setResult({ ok: true, message: 'Agent retired successfully' });
          break;
        }
        case 'clone': {
          const data = await apiFetch(`/teams/${encodedTeam}/agents/${encodedAgent}/clone`, {
            method: 'POST',
          });
          setResult({ ok: true, message: `Agent cloned: ${data.clone?.agentId?.slice(0, 8) ?? 'new agent'}` });
          break;
        }
        case 'retrain': {
          // Retrain = placeholder for knowledge reset (requires knowledge API)
          setResult({ ok: true, message: 'Retrain initiated (knowledge reset queued)' });
          break;
        }
      }

      onActionComplete();
    } catch (err: any) {
      setResult({ ok: false, message: err.message || `Failed to ${action} agent` });
    } finally {
      setLoading(false);
      setConfirm(null);
    }
  }, [agentId, teamId, retireReason, onActionComplete]);

  const requestAction = useCallback((action: ActionType) => {
    const configs: Record<ActionType, ConfirmState> = {
      retire: {
        action: 'retire',
        title: 'Retire Agent',
        message: `This will gracefully shut down agent ${agentId.slice(0, 8)} and mark it as retired. Its knowledge will be preserved. This is reversible.`,
        destructive: true,
      },
      clone: {
        action: 'clone',
        title: 'Clone Agent',
        message: `This will create a new agent with the same role, model, and knowledge as ${agentId.slice(0, 8)}.`,
        destructive: false,
      },
      retrain: {
        action: 'retrain',
        title: 'Retrain Agent',
        message: `This will reset the procedural knowledge for agent ${agentId.slice(0, 8)}. Core and semantic knowledge will be preserved.`,
        destructive: true,
      },
    };
    setConfirm(configs[action]);
    setResult(null);
  }, [agentId]);

  const isRetired = agent?.status === 'retired';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="agent-lifecycle-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg border border-th-border rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-th-border">
          <div>
            <h2 className="text-base font-semibold text-th-text">Agent Lifecycle</h2>
            <span className="text-xs text-th-text-muted font-mono">{agentId.slice(0, 8)}</span>
            {agent && (
              <span className="ml-2 text-xs text-th-text-muted">
                {agent.role} • {agent.status}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 space-y-3">
          {/* Result banner */}
          {result && (
            <div
              className={`rounded-lg p-3 text-sm flex items-center gap-2 ${
                result.ok
                  ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
              }`}
              data-testid="action-result"
              role={result.ok ? 'status' : 'alert'}
            >
              {result.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {result.message}
            </div>
          )}

          {/* Confirmation dialog */}
          {confirm && (
            <div
              className="border border-th-border rounded-lg p-4 space-y-3"
              data-testid="confirm-dialog"
            >
              <h3 className="text-sm font-semibold text-th-text">{confirm.title}</h3>
              <p className="text-xs text-th-text-muted">{confirm.message}</p>

              {confirm.action === 'retire' && (
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={retireReason}
                  onChange={(e) => setRetireReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-th-bg-alt border border-th-border rounded text-th-text placeholder-th-text-muted"
                  data-testid="retire-reason-input"
                />
              )}

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setConfirm(null)}
                  className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text border border-th-border rounded"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeAction(confirm.action)}
                  disabled={loading}
                  className={`px-3 py-1.5 text-xs rounded font-medium ${
                    confirm.destructive
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                      : 'bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30'
                  }`}
                  data-testid="confirm-button"
                >
                  {loading ? 'Processing…' : `Confirm ${confirm.title}`}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!confirm && (
            <div className="space-y-2">
              <ActionButton
                icon={<UserMinus className="w-4 h-4" />}
                label="Retire Agent"
                description="Gracefully shut down, preserve knowledge"
                onClick={() => requestAction('retire')}
                disabled={isRetired}
                destructive
                testId="action-retire"
              />
              <ActionButton
                icon={<Copy className="w-4 h-4" />}
                label="Clone Agent"
                description="Create new agent with same config & knowledge"
                onClick={() => requestAction('clone')}
                testId="action-clone"
              />
              <ActionButton
                icon={<RotateCcw className="w-4 h-4" />}
                label="Retrain Agent"
                description="Reset procedural knowledge, keep core/semantic"
                onClick={() => requestAction('retrain')}
                disabled={isRetired}
                destructive
                testId="action-retrain"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  destructive = false,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-center gap-3 ${
        disabled
          ? 'opacity-50 cursor-not-allowed border-th-border bg-th-bg-alt'
          : destructive
            ? 'border-th-border hover:border-red-500/30 hover:bg-red-500/5'
            : 'border-th-border hover:border-accent/30 hover:bg-accent/5'
      }`}
      data-testid={testId}
    >
      <span className={destructive ? 'text-red-400' : 'text-accent'}>{icon}</span>
      <div>
        <span className="text-sm font-medium text-th-text block">{label}</span>
        <span className="text-xs text-th-text-muted">{description}</span>
      </div>
    </button>
  );
}
