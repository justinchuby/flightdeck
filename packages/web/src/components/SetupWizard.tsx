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
  Loader2,
  ToggleLeft,
  ToggleRight,
  User,
  Users,
  Shield,
  Zap,
  Scale,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { getProvider } from '@flightdeck/shared';
import { ProviderIcon } from './ui/ProviderIcon';

// ── Types ───────────────────────────────────────────────────────────

/** Lightweight config returned instantly (no CLI detection). */
interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
}

/** Full status from async CLI detection. */
interface ProviderStatusData {
  id: string;
  installed: boolean;
  authenticated: boolean | null;
  binaryPath: string | null;
}

/** Combined view. */
interface ProviderView {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean | null;  // null = still detecting
  authenticated: boolean | null;
}

type Step = 'welcome' | 'providers' | 'preferences' | 'done';
type UserType = 'personal' | 'team';
type OversightLevel = 'supervised' | 'balanced' | 'autonomous';

const USER_TYPE_CONFIG: Record<UserType, { defaultAgents: number; label: string; description: string }> = {
  personal: {
    defaultAgents: 5,
    label: 'Personal / Solo',
    description: 'Defaults to 5 concurrent agents — great for solo projects.',
  },
  team: {
    defaultAgents: 50,
    label: 'Team / Company',
    description: 'Defaults to 50 concurrent agents — suited for larger codebases.',
  },
};

const OVERSIGHT_CONFIG: Record<OversightLevel, { label: string; description: string; Icon: React.ElementType }> = {
  supervised: {
    label: 'Supervised',
    description: 'Agents explain reasoning and show plans before acting',
    Icon: Shield,
  },
  balanced: {
    label: 'Balanced',
    description: 'Explains key decisions, works efficiently on routine tasks',
    Icon: Scale,
  },
  autonomous: {
    label: 'Autonomous',
    description: 'Works independently with minimal explanation — fewest tokens',
    Icon: Zap,
  },
};

const STORAGE_KEY = 'flightdeck-setup-completed';

// ── Component ───────────────────────────────────────────────────────

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [userType, setUserType] = useState<UserType | null>(null);
  const [oversightLevel, setOversightLevel] = useState<OversightLevel | null>(null);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const applyPreferences = useCallback(async (type: UserType, oversight: OversightLevel) => {
    try {
      await apiFetch('/config', {
        method: 'PATCH',
        body: JSON.stringify({
          maxConcurrentAgents: USER_TYPE_CONFIG[type].defaultAgents,
          oversightLevel: oversight,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* non-blocking — user can adjust in Settings */ }
  }, []);

  // Phase 1: instant config (id, name, enabled)
  useEffect(() => {
    apiFetch<ProviderConfig[]>('/settings/providers')
      .then((configs) => {
        setProviders(configs.map((c) => ({
          id: c.id, name: c.name, enabled: c.enabled,
          installed: null, authenticated: null,
        })));
      })
      .catch(() => { /* initial fetch — will retry */ })
      .finally(() => setConfigLoading(false));
  }, []);

  // Phase 2: async CLI detection (installed, authenticated)
  useEffect(() => {
    if (configLoading) return;
    apiFetch<ProviderStatusData[]>('/settings/providers/status')
      .then((statuses) => {
        const statusMap = new Map(statuses.map((s) => [s.id, s]));
        setProviders((prev) =>
          prev.map((p) => {
            const s = statusMap.get(p.id);
            return s ? { ...p, installed: s.installed, authenticated: s.authenticated } : p;
          }),
        );
      })
      .catch(() => { /* status detection failed — badges stay as loading */ })
      .finally(() => setStatusLoading(false));
  }, [configLoading]);

  const handleDismiss = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    onComplete();
  }, [onComplete]);

  const handleFinish = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    onComplete();
  }, [onComplete]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setTogglingId(id);
    // Optimistic update
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
    try {
      await apiFetch(`/settings/providers/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }), headers: { 'Content-Type': 'application/json' } });
    } catch {
      // Revert on failure
      setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !enabled } : p)));
    } finally {
      setTogglingId(null);
    }
  }, []);

  const installedCount = providers.filter((p) => p.installed === true).length;
  const enabledCount = providers.filter((p) => p.enabled).length;

  const handlePreferencesContinue = async () => {
    const type = userType ?? 'personal';
    const oversight = oversightLevel ?? 'autonomous';
    await applyPreferences(type, oversight);
    setStep('done');
  };

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
                Let's get you set up. We'll check your AI agent providers and
                configure a few defaults to match how you work.
              </p>
            </div>
          )}

          {step === 'providers' && (
            <div className="space-y-3" data-testid="step-providers">
              <p className="text-sm text-th-text-muted mb-4">
                {statusLoading
                  ? 'Detecting providers…'
                  : installedCount > 0
                    ? `${installedCount} of ${providers.length} providers detected. Toggle to enable or disable.`
                    : 'No providers detected. Install at least one to start.'}
              </p>
              {configLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2 max-h-[360px] overflow-y-auto">
                  {providers.map((p) => {
                    const def = getProvider(p.id);
                    const links = def?.setupLinks ?? [];
                    return (
                      <div
                        key={p.id}
                        className={`rounded-lg border bg-th-bg-alt transition-opacity ${
                          p.enabled ? 'border-th-border' : 'border-th-border/50 opacity-60'
                        }`}
                        data-testid={`provider-${p.id}`}
                      >
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-lg flex-shrink-0"><ProviderIcon provider={def} className="w-5 h-5 inline" /></span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-th-text">{p.name}</span>
                                {(def?.isPreview ?? true) && (
                                  <span className="inline-flex items-center text-[10px] font-medium text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                                    Preview
                                  </span>
                                )}
                              </div>
                              {p.id === 'copilot' && (
                                <div className="text-[10px] text-th-text-muted">Requires Copilot ≥ 1.0.4</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {/* Install status badge */}
                            {p.installed === null ? (
                              <Loader2 className="w-3.5 h-3.5 text-th-text-muted animate-spin" />
                            ) : p.installed ? (
                              <span className="flex items-center gap-1 text-xs text-green-400">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Installed
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-th-text-muted">
                                <XCircle className="w-3.5 h-3.5" />
                                Not found
                              </span>
                            )}
                            {/* Enable/disable toggle */}
                            <button
                              onClick={() => handleToggle(p.id, !p.enabled)}
                              disabled={togglingId === p.id}
                              className="text-th-text-muted hover:text-th-text transition-colors disabled:opacity-50"
                              aria-label={p.enabled ? `Disable ${p.name}` : `Enable ${p.name}`}
                              data-testid={`toggle-${p.id}`}
                            >
                              {p.enabled ? (
                                <ToggleRight className="w-6 h-6 text-accent" />
                              ) : (
                                <ToggleLeft className="w-6 h-6" />
                              )}
                            </button>
                          </div>
                        </div>
                        {/* Setup links (always visible for providers needing CLI + adapter) */}
                        {links.length > 0 && (
                          <div className="flex items-center gap-3 px-4 pb-2.5 -mt-1">
                            {links.map((link) => (
                              <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                              >
                                {link.label}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 'preferences' && (
            <div className="space-y-5" data-testid="step-preferences">
              {/* User type */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-th-text-muted uppercase tracking-wide">How will you use Flightdeck?</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['personal', 'team'] as UserType[]).map((type) => {
                    const cfg = USER_TYPE_CONFIG[type];
                    const selected = userType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setUserType(type)}
                        className={`flex items-center gap-3 rounded-lg border-2 px-3 py-3 transition-colors text-left ${
                          selected
                            ? 'border-accent bg-accent/10 text-th-text'
                            : 'border-th-border bg-th-bg-alt text-th-text-muted hover:border-th-border-alt hover:text-th-text'
                        }`}
                        data-testid={`user-type-${type}`}
                      >
                        {type === 'personal'
                          ? <User className={`w-5 h-5 flex-shrink-0 ${selected ? 'text-accent' : ''}`} />
                          : <Users className={`w-5 h-5 flex-shrink-0 ${selected ? 'text-accent' : ''}`} />
                        }
                        <div>
                          <div className="text-xs font-semibold">{cfg.label}</div>
                          <div className="text-[11px] leading-relaxed">{cfg.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Oversight level */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-th-text-muted uppercase tracking-wide">Oversight level</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['supervised', 'balanced', 'autonomous'] as OversightLevel[]).map((level) => {
                    const cfg = OVERSIGHT_CONFIG[level];
                    const selected = oversightLevel === level;
                    return (
                      <button
                        key={level}
                        onClick={() => setOversightLevel(level)}
                        className={`flex flex-col items-center gap-2 rounded-lg border-2 px-2 py-3 transition-colors text-center ${
                          selected
                            ? 'border-accent bg-accent/10 text-th-text'
                            : 'border-th-border bg-th-bg-alt text-th-text-muted hover:border-th-border-alt hover:text-th-text'
                        }`}
                        data-testid={`oversight-${level}`}
                      >
                        <cfg.Icon className={`w-4 h-4 ${selected ? 'text-accent' : ''}`} />
                        <div>
                          <div className="text-xs font-semibold">{cfg.label}</div>
                          <div className="text-[10px] leading-relaxed mt-0.5">{cfg.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-th-text-muted">Defaults to Autonomous if not selected. Adjustable any time in Settings.</p>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4" data-testid="step-done">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto" />
              <h3 className="text-lg font-semibold text-th-text">You're ready!</h3>
              <p className="text-sm text-th-text-muted leading-relaxed">
                {enabledCount > 0
                  ? `${enabledCount} provider${enabledCount > 1 ? 's' : ''} enabled. Create your first project to start working with AI agents.`
                  : 'You can set up providers later in Settings. Create a project to explore the interface.'}
              </p>
              {(userType || oversightLevel) && (
                <div className="text-xs text-th-text-muted space-y-1">
                  {userType && (
                    <p>
                      <span className="text-th-text font-medium">{USER_TYPE_CONFIG[userType].label}</span>
                      {' '}— {USER_TYPE_CONFIG[userType].defaultAgents} agents by default
                    </p>
                  )}
                  {oversightLevel && (
                    <p>
                      Oversight: <span className="text-th-text font-medium">{OVERSIGHT_CONFIG[oversightLevel].label}</span>
                    </p>
                  )}
                </div>
              )}
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
                onClick={() => {
                  if (step === 'done') setStep('preferences');
                  else if (step === 'preferences') setStep('providers');
                  else setStep('welcome');
                }}
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
            ) : step === 'preferences' ? (
              <button
                onClick={handlePreferencesContinue}
                className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 rounded"
                data-testid="wizard-next"
              >
                Continue
                <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={() => setStep(step === 'welcome' ? 'providers' : 'preferences')}
                className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 rounded"
                data-testid="wizard-next"
              >
                {step === 'welcome' ? 'Get Started' : 'Continue'}
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
  try { return localStorage.getItem(STORAGE_KEY) !== 'true'; } catch { return true; }
}
