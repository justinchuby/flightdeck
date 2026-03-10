import { useState } from 'react';
import { useConflicts } from '../../hooks/useConflicts';
import { CONFLICT_TYPE_LABELS, SEVERITY_COLORS, SEVERITY_BG, type ConflictAlert } from './types';

interface Props {
  conflict: ConflictAlert;
  onClose: () => void;
}

export function ConflictDetailPanel({ conflict, onClose }: Props) {
  const { resolve, dismiss } = useConflicts();
  const [resolving, setResolving] = useState(false);

  const handleResolve = async (type: string) => {
    setResolving(true);
    try {
      if (type === 'sequence') {
        await resolve(conflict.id, {
          type: 'sequenced',
          order: [conflict.agents[0].agentId, conflict.agents[1].agentId],
        });
      } else if (type === 'proceed') {
        await resolve(conflict.id, { type: 'dismissed', by: 'user' });
      } else if (type === 'dismiss') {
        await dismiss(conflict.id);
      }
      onClose();
    } catch {
      // Error is swallowed — user can retry
    } finally {
      setResolving(false);
    }
  };

  const [a1, a2] = conflict.agents;
  const overlapFiles = conflict.files.filter(f => f.agents.length > 1);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full sm:max-w-[480px] h-full bg-th-bg border-l border-th-border overflow-y-auto motion-slide-in-right"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm ${SEVERITY_COLORS[conflict.severity]}`}>⚠</span>
              <h2 className="text-sm font-semibold text-th-text">
                {CONFLICT_TYPE_LABELS[conflict.type]} —{' '}
                {conflict.severity.charAt(0).toUpperCase() + conflict.severity.slice(1)} Severity
              </h2>
            </div>
            <button onClick={onClose} className="text-th-text-muted hover:text-th-text">
              ✕
            </button>
          </div>
          <div className="text-[10px] text-th-text-muted">
            Detected {new Date(conflict.detectedAt).toLocaleTimeString()}
          </div>

          {/* Agent comparison */}
          <div className="grid grid-cols-2 gap-3">
            {[a1, a2].map((agent, i) => (
              <div key={i} className="border border-th-border-muted rounded-lg p-3">
                <div className="text-xs font-semibold text-th-text mb-1">💻 {agent.role}</div>
                {agent.taskId && (
                  <div className="text-[10px] text-th-text-muted mb-1">Task: {agent.taskId}</div>
                )}
                <div className="space-y-0.5">
                  {agent.files.map((f, j) => (
                    <div key={j} className="text-[11px] text-th-text-muted font-mono truncate">
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Overlap details */}
          {overlapFiles.length > 0 && (
            <div className={`rounded-lg p-3 ${SEVERITY_BG[conflict.severity]}`}>
              <div
                className={`text-xs font-medium ${SEVERITY_COLORS[conflict.severity]} mb-1`}
              >
                ⚠ Overlap: {overlapFiles.map(f => f.path).join(', ')}
              </div>
              <div className="text-[11px] text-th-text-muted">{conflict.description}</div>
            </div>
          )}

          {/* Resolution options */}
          <div className="border-t border-th-border pt-3 space-y-3">
            <div className="text-xs font-semibold text-th-text">Resolution Options</div>

            {[
              {
                key: 'sequence',
                num: '①',
                title: 'Sequence their work',
                desc: `Pause ${a2.role} until ${a1.role} commits overlapping files.`,
              },
              {
                key: 'split',
                num: '②',
                title: 'Split the file',
                desc: 'Separate conflicting types into distinct files. Requires manual refactor.',
              },
              {
                key: 'proceed',
                num: '③',
                title: 'Let them proceed',
                desc: 'Both agents continue. Manual merge may be required.',
              },
              {
                key: 'dismiss',
                num: '④',
                title: 'Dismiss this alert',
                desc: "You've reviewed and it's not a real conflict.",
              },
            ].map(opt => (
              <div
                key={opt.key}
                className="flex items-start gap-3 p-2 rounded hover:bg-th-bg-muted transition-colors"
              >
                <span className="text-xs text-accent shrink-0">{opt.num}</span>
                <div className="flex-1">
                  <div className="text-xs font-medium text-th-text">{opt.title}</div>
                  <div className="text-[11px] text-th-text-muted">{opt.desc}</div>
                </div>
                <button
                  onClick={() => handleResolve(opt.key)}
                  disabled={resolving || opt.key === 'split'}
                  className="text-[11px] px-3 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors shrink-0"
                >
                  {opt.key === 'dismiss' ? 'Dismiss' : 'Apply →'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
