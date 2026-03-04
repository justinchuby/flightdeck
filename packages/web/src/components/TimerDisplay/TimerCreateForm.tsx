import { useState, useCallback } from 'react';
import { useTimerStore } from '../../stores/timerStore';
import { useAppStore } from '../../stores/appStore';

interface TimerCreateFormProps {
  onClose: () => void;
}

export function TimerCreateForm({ onClose }: TimerCreateFormProps) {
  const agents = useAppStore((s) => s.agents);
  const createTimer = useTimerStore((s) => s.createTimer);

  const runningAgents = agents.filter((a) => a.status === 'running' || a.status === 'idle');

  const [agentId, setAgentId] = useState(runningAgents[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [delayStr, setDelayStr] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseDelay = useCallback((input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Support formats: "300", "5m", "30s", "2h", "1.5m"
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|hours?|minutes?|seconds?)?$/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = (match[2] ?? 's').toLowerCase();

    if (unit.startsWith('h')) return Math.round(value * 3600);
    if (unit.startsWith('m')) return Math.round(value * 60);
    return Math.round(value);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!agentId) { setError('Select an agent'); return; }
      if (!label.trim()) { setError('Label is required'); return; }

      const delaySeconds = parseDelay(delayStr);
      if (!delaySeconds || delaySeconds <= 0) { setError('Enter a valid delay (e.g. "5m", "30s", "2h")'); return; }
      if (delaySeconds > 86400) { setError('Delay cannot exceed 24 hours'); return; }

      setSubmitting(true);
      try {
        await createTimer({ agentId, label: label.trim(), message: message.trim(), delaySeconds, repeat });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create timer');
      } finally {
        setSubmitting(false);
      }
    },
    [agentId, label, message, delayStr, repeat, createTimer, onClose, parseDelay],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-th-border pt-2 mt-2" data-testid="timer-create-form">
      <div>
        <label className="block text-[10px] text-th-text-muted mb-0.5">Agent</label>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-full bg-th-bg-muted border border-th-border rounded px-1.5 py-1 text-[11px] text-th-text-alt"
          data-testid="timer-agent-select"
        >
          {runningAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.role.name} ({a.id.slice(0, 8)})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[10px] text-th-text-muted mb-0.5">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. check-build"
          className="w-full bg-th-bg-muted border border-th-border rounded px-1.5 py-1 text-[11px] text-th-text-alt"
          data-testid="timer-label-input"
          maxLength={100}
        />
      </div>

      <div>
        <label className="block text-[10px] text-th-text-muted mb-0.5">Delay</label>
        <input
          type="text"
          value={delayStr}
          onChange={(e) => setDelayStr(e.target.value)}
          placeholder="e.g. 5m, 30s, 2h"
          className="w-full bg-th-bg-muted border border-th-border rounded px-1.5 py-1 text-[11px] text-th-text-alt"
          data-testid="timer-delay-input"
        />
      </div>

      <div>
        <label className="block text-[10px] text-th-text-muted mb-0.5">Message (optional)</label>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Reminder text sent to agent"
          className="w-full bg-th-bg-muted border border-th-border rounded px-1.5 py-1 text-[11px] text-th-text-alt"
          data-testid="timer-message-input"
          maxLength={500}
        />
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-th-text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => setRepeat(e.target.checked)}
          data-testid="timer-repeat-checkbox"
        />
        Repeat
      </label>

      {error && <div className="text-[10px] text-red-400" data-testid="timer-create-error">{error}</div>}

      <div className="flex gap-1.5 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="px-2 py-1 rounded text-[10px] bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
          data-testid="timer-create-submit"
        >
          {submitting ? 'Creating…' : 'Create Timer'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-1 rounded text-[10px] text-th-text-muted hover:text-th-text-alt"
          data-testid="timer-create-cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
