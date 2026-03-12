import { usePredictions } from '../../hooks/usePredictions';
import { SEVERITY_COLORS } from './types';

export function PulsePredictionIndicator() {
  const { predictions } = usePredictions();

  // Get most urgent (highest severity + confidence)
  const urgent = predictions
    .filter(p => p.type !== 'completion_estimate')
    .sort((a, b) => {
      const sev = { critical: 0, warning: 1, info: 2 };
      const sevDiff = (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
      if (sevDiff !== 0) return sevDiff;
      return b.confidence - a.confidence;
    })[0];

  if (!urgent) return null;

  // Shorten for Pulse display
  const shortLabel =
    urgent.type === 'context_exhaustion'
      ? `ctx ~${urgent.timeHorizon}m`
      : urgent.type === 'cost_overrun'
        ? `tokens ~${urgent.timeHorizon}m`
        : urgent.type === 'agent_stall'
          ? `stall ${urgent.timeHorizon}m`
          : urgent.type === 'task_duration'
              ? `task +${urgent.timeHorizon}m`
              : `~${urgent.timeHorizon}m`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${SEVERITY_COLORS[urgent.severity]}`}
      title={urgent.title}
    >
      <span>🔮</span>
      <span>{shortLabel}</span>
    </span>
  );
}
