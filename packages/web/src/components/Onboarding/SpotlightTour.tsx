import { useState, useEffect, useCallback } from 'react';
import { useSpotlight } from '../../hooks/useSpotlight';

interface TourStep {
  target: string;          // CSS selector
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="pulse-strip"]',
    position: 'bottom',
    title: 'The Pulse',
    body: "Your crew's health at a glance. Agents, cost, and pending decisions — always visible.",
  },
  {
    target: '[data-tour="agent-card"]',
    position: 'right',
    title: 'Your Agents',
    body: 'Each has a role, a task, and a context gauge. They work in parallel while you supervise.',
  },
  {
    target: '[data-tour="approval-badge"]',
    position: 'bottom',
    title: 'Decisions Need You',
    body: 'When agents need permission, the count appears here. Click to review.',
  },
  {
    target: '[data-tour="cmd-k"]',
    position: 'bottom',
    title: 'The Command Palette',
    body: "Press \u2318K for anything: navigate, search, or give commands like 'wrap it up'.",
  },
  {
    target: '[data-tour="sidebar"]',
    position: 'right',
    title: 'Navigate',
    body: 'Switch between views. More views appear as your session grows.',
  },
  {
    target: 'body',
    position: 'center',
    title: "You're Ready! \ud83c\udf89",
    body: "You're supervising an AI crew. Watch them work, approve decisions, and steer with \u2318K.",
  },
];

const STORAGE_KEY = 'onboarding-tour-complete';

interface Props {
  onComplete: () => void;
}

export function SpotlightTour({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const currentStep = TOUR_STEPS[step];
  const spotlight = useSpotlight(currentStep.target === 'body' ? null : currentStep.target);

  const next = useCallback(() => {
    if (step >= TOUR_STEPS.length - 1) {
      localStorage.setItem(STORAGE_KEY, 'true');
      onComplete();
    } else {
      setStep(s => s + 1);
    }
  }, [step, onComplete]);

  const back = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  const skip = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  }, [onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, back, skip]);

  // Build clip-path for spotlight cutout
  const clipPath = spotlight
    ? `polygon(
        0% 0%, 0% 100%, 
        ${spotlight.left}px 100%, ${spotlight.left}px ${spotlight.top}px, 
        ${spotlight.left + spotlight.width}px ${spotlight.top}px, 
        ${spotlight.left + spotlight.width}px ${spotlight.top + spotlight.height}px, 
        ${spotlight.left}px ${spotlight.top + spotlight.height}px, ${spotlight.left}px 100%, 
        100% 100%, 100% 0%
      )`
    : undefined;

  // Tooltip position
  const tooltipStyle = (): React.CSSProperties => {
    if (currentStep.position === 'center' || !spotlight) {
      return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const s = spotlight;
    switch (currentStep.position) {
      case 'bottom':
        return { position: 'fixed', top: s.top + s.height + 12, left: s.left + s.width / 2, transform: 'translateX(-50%)' };
      case 'top':
        return { position: 'fixed', bottom: window.innerHeight - s.top + 12, left: s.left + s.width / 2, transform: 'translateX(-50%)' };
      case 'right':
        return { position: 'fixed', top: s.top + s.height / 2, left: s.left + s.width + 12, transform: 'translateY(-50%)' };
      case 'left':
        return { position: 'fixed', top: s.top + s.height / 2, right: window.innerWidth - s.left + 12, transform: 'translateY(-50%)' };
    }
  };

  return (
    <div className="fixed inset-0 z-tour" aria-modal="true" role="dialog" aria-label="Guided tour">
      {/* Overlay with cutout */}
      <div
        className="absolute inset-0 bg-black/60 transition-all duration-300"
        style={clipPath ? { clipPath } : undefined}
        onClick={next}
      />

      {/* Tooltip */}
      <div
        style={tooltipStyle()}
        className="z-tour max-w-sm bg-th-bg rounded-xl shadow-xl border border-th-border p-4"
        role="alertdialog"
      >
        <h3 className="text-sm font-semibold text-th-text mb-1">{currentStep.title}</h3>
        <p className="text-xs text-th-text-muted mb-4 leading-relaxed">{currentStep.body}</p>

        {/* Progress dots */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === step ? 'bg-accent' : i < step ? 'bg-accent/50' : 'bg-th-bg-muted'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-th-text-muted">Step {step + 1} of {TOUR_STEPS.length}</span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={skip} className="text-[10px] text-th-text-muted hover:text-th-text transition-colors">
              Skip tour
            </button>
            {step > 0 && (
              <button onClick={back} className="text-[11px] px-2 py-1 rounded text-th-text-muted hover:bg-th-bg-muted transition-colors">
                ← Back
              </button>
            )}
            <button onClick={next} className="text-[11px] px-3 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium">
              {step >= TOUR_STEPS.length - 1 ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function isTourComplete(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function resetTour(): void {
  localStorage.removeItem(STORAGE_KEY);
}
