/**
 * ProvidersSection — provider availability and configuration for Settings.
 *
 * Shows which CLI providers are installed, authenticated, and enabled.
 * Includes per-provider configuration: binary override, default model,
 * required environment variables, and default CLI arguments.
 */
import { useState, useEffect, useCallback } from 'react';
import { Cpu, Loader2, Zap, ExternalLink, ChevronDown, ChevronRight, Star, Terminal, Key, Settings2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { StatusBadge, providerStatusProps } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';

// ── Types ───────────────────────────────────────────────────────────

interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authenticated: boolean | null;
  enabled: boolean;
  binaryPath: string | null;
  version: string | null;
}

interface TestResult {
  success: boolean;
  message: string;
}

// ── Provider display metadata ───────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  copilot: '🐙',
  claude: '🟠',
  gemini: '💎',
  opencode: '🔓',
  cursor: '↗️',
  codex: '🤖',
};

const PROVIDER_AUTH_LABELS: Record<string, string> = {
  copilot: 'Authenticated via GitHub',
  claude: 'Authenticated via Anthropic API key',
  gemini: 'Authenticated via Google',
  opencode: 'Manages own keys',
  cursor: 'Authenticated via Cursor',
  codex: 'Authenticated via OpenAI',
};

const PROVIDER_DOCS: Record<string, string> = {
  copilot: 'https://docs.github.com/en/copilot',
  claude: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk',
  gemini: 'https://ai.google.dev/gemini-api/docs/api-key',
  opencode: 'https://opencode.ai/docs/providers/',
  cursor: 'https://docs.cursor.com',
  codex: 'https://platform.openai.com/docs/api-reference',
};

/** Default CLI arguments per provider (mirrors server presets.ts). */
const PROVIDER_DEFAULT_ARGS: Record<string, string[]> = {
  copilot: [],  // Copilot uses in-process SDK — no CLI args needed
  claude: [],   // Claude uses in-process SDK — no CLI args needed
  gemini: ['--experimental-acp'],
  cursor: ['acp'],
  codex: ['--acp'],
  opencode: ['acp'],
};

/** Required environment variables per provider. */
const PROVIDER_REQUIRED_ENV: Record<string, string[]> = {
  copilot: [],
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  cursor: ['CURSOR_API_KEY'],
  codex: ['OPENAI_API_KEY'],
  opencode: [],
};

/** Whether the provider supports in-process SDK mode. */
const PROVIDER_SDK_CAPABLE: Record<string, boolean> = {
  copilot: true,
  claude: true,
  gemini: false,
  cursor: false,
  codex: false,
  opencode: false,
};

/** Whether the provider supports session resume. */
const PROVIDER_RESUME_SUPPORT: Record<string, boolean> = {
  copilot: true,
  claude: true,
  gemini: false,
  cursor: true,
  codex: false,
  opencode: false,
};

// ── Provider Card ───────────────────────────────────────────────────

function ProviderCard({
  provider,
  isActive,
  onToggle,
  onSetActive,
}: {
  provider: ProviderStatus;
  isActive: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onSetActive: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>(
        `/settings/providers/${provider.id}/test`,
        { method: 'POST' },
      );
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }, [provider.id]);

  const icon = PROVIDER_ICONS[provider.id] ?? '🔌';
  const docsUrl = PROVIDER_DOCS[provider.id];
  const authLabel = PROVIDER_AUTH_LABELS[provider.id] ?? 'Provider-managed auth';
  const defaultArgs = PROVIDER_DEFAULT_ARGS[provider.id] ?? [];
  const requiredEnv = PROVIDER_REQUIRED_ENV[provider.id] ?? [];
  const sdkCapable = PROVIDER_SDK_CAPABLE[provider.id] ?? false;
  const supportsResume = PROVIDER_RESUME_SUPPORT[provider.id] ?? false;

  return (
    <div
      className={`bg-surface-raised border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover ${
        isActive ? 'border-accent/50 ring-1 ring-accent/20' : 'border-th-border'
      }`}
      data-testid={`provider-card-${provider.id}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        aria-label={`${provider.name} provider details`}
      >
        <span className="text-lg" role="img" aria-label={provider.name}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-th-text-alt">{provider.name}</span>
            <StatusBadge {...providerStatusProps(provider)} />
            {isActive && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                <Star className="w-2.5 h-2.5" /> Active
              </span>
            )}
          </div>
          <div className="text-xs text-th-text-muted">
            {provider.installed
              ? `${authLabel}${provider.version ? ` · ${provider.version}` : ''}`
              : 'CLI not found on PATH'}
          </div>
        </div>
        {/* Enable/disable toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(provider.id, !provider.enabled);
          }}
          aria-label={provider.enabled ? `Disable ${provider.name}` : `Enable ${provider.name}`}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
            provider.enabled ? 'bg-accent' : 'bg-th-bg-hover'
          }`}
          data-testid={`toggle-${provider.id}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              provider.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-th-text-muted shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-th-text-muted shrink-0" />
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-th-border px-4 py-3 bg-th-bg-alt/30 space-y-3">
          {/* CLI Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-th-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" /> Binary:</span>
              <code className="font-mono text-th-text-alt">
                {provider.binaryPath ?? provider.id}
              </code>
            </div>
            <div>
              <span className="text-th-text-muted">Status:</span>{' '}
              <span className={provider.installed ? 'text-green-400' : 'text-th-text-muted'}>
                {provider.installed ? 'Installed' : 'Not found'}
                {provider.version && ` (${provider.version})`}
              </span>
            </div>
            <div>
              <span className="text-th-text-muted flex items-center gap-1"><Settings2 className="w-3 h-3" /> Default Args:</span>
              <code className="font-mono text-th-text-alt">
                {defaultArgs.length > 0 ? defaultArgs.join(' ') : '(none)'}
              </code>
            </div>
            <div>
              <span className="text-th-text-muted">Features:</span>{' '}
              <span className="text-th-text-alt">
                {[
                  sdkCapable && 'In-process SDK',
                  supportsResume && 'Resume',
                ].filter(Boolean).join(', ') || 'CLI mode'}
              </span>
            </div>
          </div>

          {/* Required Environment Variables */}
          {requiredEnv.length > 0 && (
            <div className="bg-th-bg-alt border border-th-border rounded-md p-2.5 text-xs">
              <span className="text-th-text-muted flex items-center gap-1 mb-1.5">
                <Key className="w-3 h-3" /> Required Environment Variables
              </span>
              <div className="flex flex-wrap gap-1.5">
                {requiredEnv.map((envVar) => (
                  <code
                    key={envVar}
                    className="px-2 py-0.5 bg-th-bg rounded-md text-th-text-alt font-mono"
                  >
                    {envVar}
                  </code>
                ))}
              </div>
              <p className="text-th-text-muted mt-1.5">
                Set these in your shell environment or <code className="text-th-text-muted">flightdeck.config.yaml</code> under <code className="text-th-text-muted">provider.envOverride</code>.
              </p>
            </div>
          )}

          {/* Setup instructions if not installed */}
          {!provider.installed && docsUrl && (
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3 text-xs">
              <p className="text-th-text-muted mb-1.5">
                Install the CLI to use this provider:
              </p>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:text-accent-muted transition-colors"
              >
                <ExternalLink size={10} /> Installation docs
              </a>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Test Connection */}
            {provider.installed && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded-md transition-colors disabled:opacity-50"
                data-testid={`test-connection-${provider.id}`}
              >
                {testing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            )}

            {/* Set as Active */}
            {provider.installed && provider.enabled && !isActive && (
              <button
                onClick={() => onSetActive(provider.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-md transition-colors"
                data-testid={`set-active-${provider.id}`}
              >
                <Star size={12} /> Set as Active
              </button>
            )}

            {testResult && (
              <span
                className={`text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}
                data-testid={`test-result-${provider.id}`}
              >
                {testResult.success ? '✅' : '❌'} {testResult.message}
              </span>
            )}
          </div>

          {/* Config hint */}
          <p className="text-[10px] text-th-text-muted">
            Override binary path or args in <code className="text-th-text-muted">flightdeck.config.yaml</code> → <code className="text-th-text-muted">provider.binaryOverride</code> / <code className="text-th-text-muted">provider.argsOverride</code>
          </p>
        </div>
      )}
    </div>
  );
}

// ── ProvidersSection ────────────────────────────────────────────────

export function ProvidersSection({ activeProviderId }: { activeProviderId?: string }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(activeProviderId ?? 'copilot');

  useEffect(() => {
    if (activeProviderId) setActiveId(activeProviderId);
  }, [activeProviderId]);

  useEffect(() => {
    apiFetch<ProviderStatus[]>('/settings/providers')
      .then(setProviders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
    try {
      await apiFetch(`/settings/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !enabled } : p)),
      );
    }
  }, []);

  const handleSetActive = useCallback(async (id: string) => {
    const prevId = activeId;
    setActiveId(id);
    try {
      await apiFetch('/settings/provider', {
        method: 'PUT',
        body: JSON.stringify({ id }),
      });
    } catch {
      setActiveId(prevId);
    }
  }, [activeId]);

  const installedCount = providers.filter((p) => p.installed).length;

  return (
    <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5" /> CLI Providers
        </h3>
        {!loading && (
          <span className="text-[10px] text-th-text-muted">
            {installedCount}/{providers.length} installed
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-th-text-muted">
          <Loader2 className="animate-spin mr-2" size={16} />
          <span className="text-sm">Loading providers…</span>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400 bg-red-400/10 rounded-md p-3" data-testid="providers-error">
          Failed to load providers: {error}
        </div>
      )}

      {!loading && !error && providers.length === 0 && (
        <EmptyState
          icon={<Cpu className="w-10 h-10 opacity-50" />}
          title="No providers configured"
          description="Install a CLI provider (Claude, Copilot, Gemini, Cursor, Codex, or OpenCode) to get started."
          compact
        />
      )}

      {!loading && !error && providers.length > 0 && (
        <div className="space-y-2" data-testid="providers-list">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isActive={provider.id === activeId}
              onToggle={handleToggle}
              onSetActive={handleSetActive}
            />
          ))}
        </div>
      )}
    </section>
  );
}
