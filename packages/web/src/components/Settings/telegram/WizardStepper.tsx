// packages/web/src/components/Settings/telegram/WizardStepper.tsx
// 3-step progress indicator for the Telegram setup wizard.

import { Check } from 'lucide-react';

interface Step {
  label: string;
  number: number;
}

const STEPS: Step[] = [
  { label: 'Connect Bot', number: 1 },
  { label: 'Link Chat', number: 2 },
  { label: 'Configure', number: 3 },
];

interface WizardStepperProps {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}

export function WizardStepper({ currentStep, completedSteps, onStepClick }: WizardStepperProps) {
  return (
    <div className="flex items-center gap-2 mb-6" role="tablist" aria-label="Setup wizard progress">
      {STEPS.map((step, index) => {
        const isCompleted = completedSteps.has(step.number);
        const isActive = currentStep === step.number;
        const isPending = !isCompleted && !isActive;
        const canClick = isCompleted;

        return (
          <div key={step.number} className="flex items-center gap-2 flex-1 last:flex-initial">
            <button
              role="tab"
              aria-selected={isActive}
              aria-label={`Step ${step.number}: ${step.label}${isCompleted ? ' (completed)' : isActive ? ' (current)' : ''}`}
              onClick={() => canClick && onStepClick(step.number)}
              disabled={!canClick}
              className={`flex items-center gap-2 ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {/* Step circle */}
              {isCompleted ? (
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                  <Check className="w-4 h-4 text-black" />
                </div>
              ) : isActive ? (
                <div className="w-7 h-7 rounded-full border-2 border-accent flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-accent">{step.number}</span>
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full border border-th-border flex items-center justify-center shrink-0">
                  <span className="text-xs text-th-text-muted">{step.number}</span>
                </div>
              )}

              {/* Step label */}
              <span
                className={`text-xs whitespace-nowrap ${
                  isActive ? 'text-th-text font-medium' : isCompleted ? 'text-accent' : 'text-th-text-muted'
                }`}
              >
                {step.label}
              </span>
            </button>

            {/* Connecting line */}
            {index < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 min-w-[20px] ${
                  isCompleted ? 'bg-accent' : 'bg-th-border'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
