import { sessionScore } from './types';
import type { SessionSummary } from './types';

interface SessionScoreBadgeProps {
  session: SessionSummary;
}

export function SessionScoreBadge({ session }: SessionScoreBadgeProps) {
  const score = sessionScore(session);
  return (
    <span className="text-amber-400 text-xs whitespace-nowrap" title={`Score: ${score}/5`}>
      {'★'.repeat(score)}{'☆'.repeat(5 - score)}
    </span>
  );
}
