import { TRIGGER_LABELS, STATUS_DISPLAY, type RecoveryEvent } from './types';

interface TimelineRecoveryMarkerProps {
  event: RecoveryEvent;
  onClick?: () => void;
}

export function TimelineRecoveryMarker({ event, onClick }: TimelineRecoveryMarkerProps) {
  const trigger = TRIGGER_LABELS[event.trigger];
  const status = STATUS_DISPLAY[event.status];
  const agentLabel = event.originalAgentId.slice(0, 8);
  const isResolved = event.status === 'recovered' || event.status === 'failed';

  const durationMs = event.recoveredAt
    ? new Date(event.recoveredAt).getTime() - new Date(event.startedAt).getTime()
    : event.failedAt
      ? new Date(event.failedAt).getTime() - new Date(event.startedAt).getTime()
      : Date.now() - new Date(event.startedAt).getTime();
  const durationSec = (durationMs / 1000).toFixed(1);

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border cursor-pointer transition-colors ${
        event.status === 'failed'
          ? 'bg-red-500/10 border-red-500/30 text-red-400'
          : event.status === 'recovered'
            ? 'bg-green-500/10 border-green-500/30 text-green-500'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
      }`}
      onClick={onClick}
      title={`Recovery: ${durationSec}s\nTrigger: ${trigger}\nStatus: ${status.label}\nAttempt: ${event.attempts}`}
      data-testid="timeline-recovery-marker"
    >
      {/* Crash indicator */}
      <span className="text-red-500">🔴</span>

      {/* Gap visualization */}
      <span
        className="inline-block w-8 h-2 rounded-sm"
        style={{
          background: isResolved
            ? undefined
            : 'repeating-linear-gradient(45deg, transparent, transparent 2px, var(--th-border) 2px, var(--th-border) 4px)',
          backgroundColor: isResolved ? 'transparent' : undefined,
        }}
      />

      {/* Recovery indicator */}
      <span>{status.icon}</span>

      {/* Label */}
      <span className="font-medium">{agentLabel}</span>
      <span className="text-th-text-muted">{durationSec}s</span>

      {event.replacementAgentId && event.replacementAgentId !== event.originalAgentId && (
        <span className="text-th-text-muted">→ {event.replacementAgentId.slice(0, 8)}</span>
      )}
    </div>
  );
}
