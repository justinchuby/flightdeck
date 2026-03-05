import { useState, useEffect } from 'react';
import { STATUS_DISPLAY, type RecoveryEvent } from './types';

interface PulseRecoveryIndicatorProps {
  events: RecoveryEvent[];
  onClickEvent?: (id: string) => void;
}

export function PulseRecoveryIndicator({ events, onClickEvent }: PulseRecoveryIndicatorProps) {
  // Filter to active (non-terminal) events
  const active = events.filter((e) => e.status !== 'recovered' && e.status !== 'failed');
  const recovered = events.filter((e) => e.status === 'recovered');
  const failed = events.filter((e) => e.status === 'failed');

  // Auto-dismiss recovered events after 10s
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    for (const e of recovered) {
      if (dismissedIds.has(e.id)) continue;
      const t = setTimeout(() => {
        setDismissedIds((prev) => new Set([...prev, e.id]));
      }, 10_000);
      timers.push(t);
    }
    return () => timers.forEach(clearTimeout);
  }, [recovered, dismissedIds]);

  const visibleRecovered = recovered.filter((e) => !dismissedIds.has(e.id));
  const allVisible = [...active, ...visibleRecovered, ...failed];

  if (allVisible.length === 0) return null;

  // If multiple, show summary
  if (active.length > 1) {
    return (
      <button
        className="flex items-center gap-1 text-[11px] text-blue-400 animate-pulse"
        onClick={() => onClickEvent?.(active[0].id)}
        data-testid="pulse-recovery-indicator"
      >
        <span>🔄</span>
        <span>{active.length} agents recovering...</span>
      </button>
    );
  }

  // Show single most important event
  const primary = failed[0] ?? active[0] ?? visibleRecovered[0];
  if (!primary) return null;

  const display = STATUS_DISPLAY[primary.status];
  const agentLabel = primary.originalAgentId.slice(0, 8);
  const isAnimated = primary.status === 'generating_briefing' || primary.status === 'restarting';

  return (
    <button
      className={`flex items-center gap-1 text-[11px] ${display.color} ${isAnimated ? 'animate-pulse' : ''}`}
      onClick={() => onClickEvent?.(primary.id)}
      data-testid="pulse-recovery-indicator"
    >
      <span>{display.icon}</span>
      <span>{agentLabel} {display.label.toLowerCase()}</span>
    </button>
  );
}
