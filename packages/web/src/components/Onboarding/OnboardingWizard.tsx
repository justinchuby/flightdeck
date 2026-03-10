import { useState } from 'react';
import { X } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

interface OnboardingStep {
  title: string;
  description: string;
  icon: string;
  action?: string;
}

// ── Steps ────────────────────────────────────────────────────────────

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to Flightdeck!',
    description:
      'A multi-agent AI orchestration system. Your AI crew works in parallel, coordinated by a lead agent.',
    icon: '🚀',
  },
  {
    title: 'The Dashboard',
    description:
      'The Lead Dashboard is your command center. Watch agents work in real-time, manage tasks, and make decisions.',
    icon: '📊',
  },
  {
    title: 'Mission Control',
    description:
      "Get a bird's-eye view of project health, agent fleet status, alerts, and task progress.",
    icon: '🎯',
  },
  {
    title: 'Task Management',
    description:
      'Use the Task DAG to define task dependencies. Templates help you create common workflows quickly.',
    icon: '📋',
  },
  {
    title: 'Agent Communication',
    description:
      'Agents can message each other directly, form groups, and share knowledge through collective memory.',
    icon: '💬',
  },
  {
    title: 'Keyboard Shortcuts',
    description:
      'Press Cmd+K (or Ctrl+K) to open the command palette. Quick navigation to any page.',
    icon: '⌨️',
    action: 'Try it now!',
  },
  {
    title: 'Themes',
    description:
      'Switch between light and dark themes in Settings, or toggle with the command palette.',
    icon: '🎨',
  },
  {
    title: "You're Ready!",
    description:
      'Start by creating a project and spawning your first agent. The system learns and improves over time.',
    icon: '✨',
  },
];

const STORAGE_KEY = 'onboarding-complete';

// ── Hook ─────────────────────────────────────────────────────────────

export function useOnboarding() {
  const isComplete = !!localStorage.getItem(STORAGE_KEY);
  return { shouldShow: !isComplete };
}

// ── Component ────────────────────────────────────────────────────────

interface Props {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  };

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-surface-raised border border-th-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Skip button */}
        <button
          onClick={handleComplete}
          className="absolute top-3 right-3 p-1.5 rounded-md text-th-text-muted hover:text-th-text hover:bg-th-bg-hover transition-colors"
          aria-label="Skip onboarding"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Body */}
        <div className="px-8 pt-10 pb-6 text-center">
          {/* Icon */}
          <div className="text-6xl mb-5 leading-none select-none">{current.icon}</div>

          {/* Title */}
          <h2 className="text-xl font-semibold text-th-text-alt mb-3">{current.title}</h2>

          {/* Description */}
          <p className="text-sm text-th-text-muted leading-relaxed min-h-[3.5rem]">
            {current.description}
          </p>

          {/* Optional call-to-action hint */}
          {current.action && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/30 text-xs text-accent font-medium">
              {current.action}
            </div>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`rounded-full transition-all duration-200 ${
                i === step
                  ? 'w-5 h-2 bg-accent'
                  : 'w-2 h-2 bg-th-border hover:bg-th-border-hover'
              }`}
            />
          ))}
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={handlePrev}
            disabled={step === 0}
            className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-lg hover:bg-th-bg-hover transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            ← Previous
          </button>

          <span className="text-xs text-th-text-muted tabular-nums">
            {step + 1} / {STEPS.length}
          </span>

          <button
            onClick={handleNext}
            className="px-5 py-2 text-sm font-semibold bg-accent text-black rounded-lg hover:bg-accent-muted transition-colors"
          >
            {isLast ? 'Get Started' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
