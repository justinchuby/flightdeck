// packages/web/src/components/Settings/TelegramSetupWizard.tsx
// 3-step setup wizard for first-time Telegram configuration.

import { useState, useCallback } from 'react';
import { WizardStepper } from './telegram/WizardStepper';
import { StepConnectBot } from './telegram/StepConnectBot';
import { StepLinkChat } from './telegram/StepLinkChat';
import { StepConfigure } from './telegram/StepConfigure';
import type { TelegramConfig } from './telegram/types';

interface TelegramSetupWizardProps {
  config: TelegramConfig | null;
  onComplete: (config: TelegramConfig) => void;
}

export function TelegramSetupWizard({ config, onComplete }: TelegramSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [wizardConfig, setWizardConfig] = useState<Partial<TelegramConfig>>(config || {});

  const handleUpdate = useCallback((partial: Partial<TelegramConfig>) => {
    setWizardConfig(prev => ({ ...prev, ...partial }));
  }, []);

  const handleNext = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      // Wizard complete — transition to dashboard
      onComplete(wizardConfig as TelegramConfig);
    }
  }, [currentStep, wizardConfig, onComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handleStepClick = useCallback((step: number) => {
    if (completedSteps.has(step)) {
      setCurrentStep(step);
    }
  }, [completedSteps]);

  return (
    <div className="space-y-4" data-testid="telegram-setup-wizard">
      <WizardStepper
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={handleStepClick}
      />

      <div role="tabpanel" aria-label={`Step ${currentStep} content`}>
        {currentStep === 1 && (
          <StepConnectBot
            config={wizardConfig}
            onUpdate={handleUpdate}
            onNext={handleNext}
          />
        )}
        {currentStep === 2 && (
          <StepLinkChat
            config={wizardConfig}
            onUpdate={handleUpdate}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        {currentStep === 3 && (
          <StepConfigure
            config={wizardConfig}
            onUpdate={handleUpdate}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
