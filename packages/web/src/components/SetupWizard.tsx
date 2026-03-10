import { useState, useEffect, useCallback } from 'react';
import {
  Rocket,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronLeft,
  X,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ───────────────────────────────────────────────────────────

interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authenticated: boolean | null;
  enabled: boolean;
  binaryPath: string | null;
}

type Step = 'welcome' | 'providers' | 'done';

const STORAGE_KEY = 'flightdeck-setup-completed';

const PROVIDER_ICONS: Record<string, string> = {
  copilot: '🐙',
  claude: '🟠',
  gemini: '💎',
  opencode: '🔓',
  cursor: '↗️',
  codex: '🤖',
};

const PROVIDER_DOCS: Record<string, string> = {
  copilot: 'https://github.com/features/copilot',
  claude: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  gemini: 'https://github.com/google-gemini/gemini-cli',
  opencode: 'https://github.com/nicepkg/opencode',
  cursor: 'https://www.cursor.com/',
  codex: 'https://github.com/openai/codex',
};

// ── Component ───────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ProviderStatus[]>('/settings/providers')
      .then(setProviders)
      .catch(() => { /* initial fetch — will retry */ })
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  }, [onComplete]);

  const handleFinish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  }, [onComplete]);

  const installedCount = providers.filter((p) => p.installed).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="setup-wizard"
    >
      <div className="bg-th-bg border border-th-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-th-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-th-text">Flightdeck Setup</h2>
          </div>
          <button
            onClick={handleDismiss}
            className="text-th-text-muted hover:text-th-text p-1"
            aria-label="Dismiss"
            data-testid="wizard-dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {step === 'welcome' && (
            <div className="text-center space-y-4" data-testid="step-welcome">
              <Rocket className="w-12 h-12 text-accent mx-auto" />
              <h3 className="text-lg font-semibold text-th-text">Welcome to Flightdeck!</h3>
              <p className="text-sm text-th-text-muted leading-relaxed">
                Let's check your AI agent providers. Flightdeck orchestrates
                multiple AI coding agents — you'll need at least one provider
                installed to get started.
              </p>
            </div>
          )}

          {step === 'providers' && (
            <div className="space-y-3" data-testid="step-providers">
              <p className="text-sm text-th-text-muted mb-4">
                {installedCount > 0
                  ? `${installedCount} of ${providers.length} providers detected.`
                  : 'No providers detected. Install at least one to start.'}
              </p>
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-th-border bg-th-bg-alt"
                      data-testid={`provider-${p.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{PROVIDER_ICONS[p.id] ?? '🔧'}</span>
                        <span className="text-sm font-medium text-th-text">{p.name}</span>
                        {p.id !== 'copilot' && (
                          <span className="inline-flex items-center text-[10px] font-medium text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                            Preview
                          </span>
                        )}
                      </div>
                      {p.installed ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Installed
                        </span>
                      ) : (
                        <a
                          href={PROVIDER_DOCS[p.id] ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-accent hover:underline"
                          data-testid={`install-${p.id}`}
                        >
                          Install
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4" data-testid="step-done">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
              <h3 className="text-lg font-semibold text-th-text">You're ready!</h3>
              <p className="text-sm text-th-text-muted leading-relaxed">
                {installedCount > 0
                  ? `${installedCount} provider${installedCount > 1 ? 's' : ''} detected. Create your first project to start working with AI agents.`
                  : 'You can set up providers later in Settings. Create a project to explore the interface.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-th-border">
          <button
            onClick={handleDismiss}
            className="text-xs text-th-text-muted hover:text-th-text"
            data-testid="wizard-skip"
          >
            Skip setup
          </button>
          <div className="flex items-center gap-2">
            {step !== 'welcome' && (
              <button
                onClick={() => setStep(step === 'done' ? 'providers' : 'welcome')}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text border border-th-border rounded"
                data-testid="wizard-back"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}
            {step === 'done' ? (
              <button
                onClick={handleFinish}
                className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 rounded"
                data-testid="wizard-finish"
              >
                Get Started
              </button>
            ) : (
              <button
                onClick={() => setStep(step === 'welcome' ? 'providers' : 'done')}
                className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 rounded"
                data-testid="wizard-next"
              >
                {step === 'welcome' ? 'Check Providers' : 'Continue'}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Check if the setup wizard should be shown (no providers configured + not dismissed). */
export function shouldShowSetupWizard(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'true';
}
