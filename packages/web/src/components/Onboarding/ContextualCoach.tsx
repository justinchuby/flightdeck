import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo, Decision } from '../../types';

const CONTEXT_PRESSURE_THRESHOLD = 0.8;
const isContextPressured = (a: AgentInfo) =>
  a.contextWindowSize && a.contextWindowUsed && (a.contextWindowUsed / a.contextWindowSize) > CONTEXT_PRESSURE_THRESHOLD;

interface CoachTip {
  id: string;
  trigger: (state: { agents: AgentInfo[]; pendingDecisions: Decision[]; sessionMinutes: number }) => boolean;
  title: string;
  body: string;
  icon: string;
  cta?: { label: string; action: string }; // action is a route or special key
}

const TIPS: CoachTip[] = [
  {
    id: 'coach-cmdk',
    trigger: ({ sessionMinutes }) => sessionMinutes > 10,
    title: 'Press \u2318K for quick commands',
    body: "It's the fastest way to do anything \u2014 navigate, search, or give orders.",
    icon: '💡',
  },
  {
    id: 'coach-context-pressure',
    trigger: ({ agents }) => agents.some(isContextPressured),
    title: 'Context running low',
    body: 'An agent is running low on context. You can compact it to continue.',
    icon: '💡',
    cta: { label: 'Compact', action: 'compact' },
  },
  {
    id: 'coach-batch-approve',
    trigger: ({ pendingDecisions }) => pendingDecisions.length >= 5,
    title: 'Batch approve decisions',
    body: 'You have several pending decisions. Consider using batch approval.',
    icon: '💡',
    cta: { label: 'View Queue', action: '/approvals' },
  },
  // Idle agents tip removed — idle agents don't cost anything (per-token billing),
  // and the Lead assigns tasks, not the user.
  // Canvas View tip removed — feature was removed.
];

const AUTO_DISMISS_MS = 15_000;

interface Props {
  onNavigate?: (path: string) => void;
}

export function ContextualCoach({ onNavigate }: Props) {
  const agents = useAppStore(s => s.agents);
  const pendingDecisions = useAppStore(s => s.pendingDecisions);
  const [activeTip, setActiveTip] = useState<CoachTip | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [sessionStart] = useState(() => Date.now());

  const checkTips = useCallback(() => {
    const sessionMinutes = (Date.now() - sessionStart) / 60_000;
    for (const tip of TIPS) {
      const seenKey = `coach-seen-${tip.id}`;
      if (localStorage.getItem(seenKey)) continue;
      if (tip.trigger({ agents, pendingDecisions, sessionMinutes })) {
        setActiveTip(tip);
        setDismissed(false);
        return;
      }
    }
  }, [agents, pendingDecisions, sessionStart]);

  // Check every 30 seconds
  useEffect(() => {
    const timer = setInterval(checkTips, 30_000);
    // Initial check after 5 seconds
    const initial = setTimeout(checkTips, 5_000);
    return () => { clearInterval(timer); clearTimeout(initial); };
  }, [checkTips]);

  // Auto-dismiss
  useEffect(() => {
    if (!activeTip || dismissed) return;
    const timer = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [activeTip, dismissed]);

  const handleDismiss = () => {
    if (activeTip) {
      localStorage.setItem(`coach-seen-${activeTip.id}`, 'true');
    }
    setDismissed(true);
    setActiveTip(null);
  };

  const handleCta = () => {
    if (!activeTip?.cta) return;
    handleDismiss();
    if (activeTip.cta.action.startsWith('/') && onNavigate) {
      onNavigate(activeTip.cta.action);
    } else if (activeTip.cta.action === 'compact') {
      const pressured = agents.find(isContextPressured);
      if (pressured && onNavigate) {
        onNavigate(`/projects/${pressured.projectId}/session?agent=${pressured.id}`);
      } else if (onNavigate) {
        // No pressured agent found — navigate to agents view as fallback
        onNavigate('/crews');
      }
    }
  };

  if (!activeTip || dismissed) return null;

  return (
    <div
      className="fixed bottom-16 right-4 z-overlay max-w-xs bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg shadow-lg p-3 animate-in slide-in-from-right"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0">{activeTip.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-0.5">{activeTip.title}</div>
          <div className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">{activeTip.body}</div>
          {activeTip.cta && (
            <button onClick={handleCta} className="mt-2 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors">
              {activeTip.cta.label} →
            </button>
          )}
        </div>
        <button onClick={handleDismiss} className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 text-xs shrink-0" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
