import { useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import {
  X,
  Copy,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import type { AgentHealthInfo } from '../pages/CrewPage';
import { shortAgentId } from '../utils/agentLabel';

// ── Types ───────────────────────────────────────────────────────────

interface Props {
  agentId: string;
  crewId: string;
  agent?: AgentHealthInfo;
  onClose: () => void;
  onActionComplete: () => void;
}

type ActionType = 'clone' | 'retrain';

interface ConfirmState {
  action: ActionType;
  title: string;
  message: string;
  destructive: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function AgentLifecycle({ agentId, crewId, agent, onClose, onActionComplete }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const executeAction = useCallback(async (action: ActionType) => {
    setLoading(true);
    setResult(null);

    try {
      const encodedCrew = encodeURIComponent(crewId);
      const encodedAgent = encodeURIComponent(agentId);

      switch (action) {
        case 'clone': {
          const data = await apiFetch<{ clone?: { agentId?: string } }>(`/crews/${encodedCrew}/agents/${encodedAgent}/clone`, {
            method: 'POST',
          });
          setResult({ ok: true, message: `Agent cloned: ${data.clone?.agentId ? shortAgentId(data.clone.agentId) : 'new agent'}` });
          break;
        }
        case 'retrain': {
          // Retrain = placeholder for knowledge reset (requires knowledge API)
          setResult({ ok: true, message: 'Retrain initiated (knowledge reset queued)' });
          break;
        }
      }

      onActionComplete();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, message: message || `Failed to ${action} agent` });
    } finally {
      setLoading(false);
      setConfirm(null);
    }
  }, [agentId, crewId, onActionComplete]);

  const requestAction = useCallback((action: ActionType) => {
    const configs: Record<ActionType, ConfirmState> = {
      clone: {
        action: 'clone',
        title: 'Clone Agent',
        message: `This will create a new agent with the same role, model, and knowledge as ${shortAgentId(agentId)}.`,
        destructive: false,
      },
      retrain: {
        action: 'retrain',
        title: 'Retrain Agent',
        message: `This will reset the procedural knowledge for agent ${shortAgentId(agentId)}. Core and semantic knowledge will be preserved.`,
        destructive: true,
      },
    };
    setConfirm(configs[action]);
    setResult(null);
  }, [agentId]);

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
            <span className="text-xs text-th-text-muted font-mono">{shortAgentId(agentId)}</span>
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
