/**
 * ProvidersSection — provider availability and configuration for Settings.
 *
 * Two-phase loading for instant UI:
 * 1. Config (id, name, enabled) loads instantly — toggles are interactive immediately
 * 2. Status (installed, authenticated, version) loads progressively — badges fill in
 *
 * Includes per-provider configuration: binary override, default model,
 * authentication guidance, and default CLI arguments.
 * Drag-and-drop reordering via @dnd-kit/sortable.
 */
import { useState, useEffect, useCallback } from 'react';
import { Cpu, Loader2, Zap, ExternalLink, ChevronDown, ChevronRight, Terminal, Settings2, GripVertical, LogIn } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getProvider } from '@flightdeck/shared';
import { apiFetch } from '../../hooks/useApi';
import { StatusBadge, providerStatusProps } from '../ui/StatusBadge';
import { EmptyState } from '../ui/EmptyState';

// ── Types ───────────────────────────────────────────────────────────

/** Lightweight config returned instantly (no CLI detection). */
interface ProviderConfig {
  id: string;
  name: string;
  binary: string;
  enabled: boolean;
}

/** Full status returned from async CLI detection. */
interface ProviderStatusData {
  id: string;
  installed: boolean;
  authenticated: boolean | null;
  binaryPath: string | null;
  version: string | null;
}

/** Combined view used by ProviderCard. */
interface ProviderStatus {
  id: string;
  name: string;
  binary: string;
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
// All metadata comes from PROVIDER_REGISTRY via getProvider() in @flightdeck/shared.

/** Small pill badge for preview providers. */
function PreviewBadge() {
  return (
    <span
      className="inline-flex items-center text-[10px] font-medium text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full"
      data-testid="preview-badge"
    >
      Preview
    </span>
  );
}

/** Skeleton placeholder for status badge while detection loads. */
function StatusBadgeSkeleton() {
  return (
    <span
      className="inline-flex items-center h-5 w-20 rounded-full bg-th-bg-hover animate-pulse"
      data-testid="status-badge-skeleton"
      role="status"
      aria-label="Loading status"
    />
  );
}

// ── Provider Card ───────────────────────────────────────────────────

function ProviderCard({
  provider,
  rank,
  onToggle,
  statusLoading,
}: {
  provider: ProviderStatus;
  rank: number;
  onToggle: (id: string, enabled: boolean) => void;
  statusLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

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

  const providerDef = getProvider(provider.id);
  const icon = providerDef?.icon ?? '🔌';
  const links = providerDef?.setupLinks ?? [];
  const authLabel = providerDef?.authLabel ?? 'Provider-managed auth';
  const defaultArgs = providerDef?.args ?? [];
  const loginLabel = providerDef?.loginInstructions ?? 'Log in via the provider CLI';
  const supportsResume = providerDef?.supportsResume ?? false;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-surface-raised border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover ${
        provider.enabled ? 'border-th-border' : 'border-th-border opacity-60'
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
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="touch-none p-0.5 text-th-text-muted/40 hover:text-th-text-muted cursor-grab active:cursor-grabbing transition-colors shrink-0"
          aria-label={`Drag to reorder ${provider.name}`}
          title="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <span className="text-lg" role="img" aria-label={provider.name}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-th-text-muted w-4 text-center">{rank}</span>
            <span className="text-sm font-medium text-th-text-alt">{provider.name}</span>
            {providerDef?.isPreview && <PreviewBadge />}
            {statusLoading ? <StatusBadgeSkeleton /> : <StatusBadge {...providerStatusProps(provider)} />}
          </div>
          <div className="text-xs text-th-text-muted">
            {statusLoading
              ? 'Checking status…'
              : provider.installed
                ? `${authLabel}${provider.version ? ` · ${provider.version}` : ''}`
                : 'CLI not found on PATH'}
          </div>
          {provider.id === 'copilot' && (
            <div className="text-[10px] text-amber-400/80 mt-0.5">Requires Copilot ≥ 1.0.5</div>
          )}
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
          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-th-text-muted flex items-center gap-1"><Terminal className="w-3 h-3" /> Binary:</span>
              <code className="font-mono text-th-text-alt">
                {provider.binaryPath ?? provider.binary ?? provider.id}
              </code>
            </div>
            <div>
              <span className="text-th-text-muted">Status:</span>{' '}
              <span className={provider.installed ? 'text-green-400' : 'text-th-text-muted'}>
                {statusLoading ? 'Checking…' : provider.installed ? 'Installed' : 'Not found'}
                {provider.version && ` (${provider.version})`}
              </span>
            </div>
            {defaultArgs.length > 0 && (
              <div>
                <span className="text-th-text-muted flex items-center gap-1"><Settings2 className="w-3 h-3" /> Default Args:</span>
                <code className="font-mono text-th-text-alt">
                  {defaultArgs.join(' ')}
                </code>
              </div>
            )}
            <div>
              <span className="text-th-text-muted">Features:</span>{' '}
              <span className="text-th-text-alt">
                {[
                  'ACP',
                  supportsResume && 'Resume',
                ].filter(Boolean).join(', ')}
              </span>
            </div>
          </div>

          {/* Authentication info */}
          {provider.authenticated === false && (
            <div className="bg-th-bg-alt border border-th-border rounded-md p-2.5 text-xs flex items-center gap-2">
              <LogIn className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-th-text-alt">{loginLabel}</span>
            </div>
          )}

          {/* Setup links and documentation */}
          {links.length > 0 && (
            <div className="bg-th-bg-alt border border-th-border rounded-md p-3 text-xs">
              {!provider.installed && (
                <p className="text-th-text-muted mb-1.5">
                  Install the CLI to use this provider:
                </p>
              )}
              <div className="flex flex-col gap-1" data-testid={`provider-links-${provider.id}`}>
                {links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:text-accent-muted transition-colors"
                  >
                    <ExternalLink size={10} /> {link.label}
                  </a>
                ))}
              </div>
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

export function ProvidersSection() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [ranking, setRanking] = useState<string[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Phase 1: Load config + ranking instantly (no CLI calls)
  useEffect(() => {
    Promise.all([
      apiFetch<ProviderConfig[]>('/settings/providers'),
      apiFetch<{ ranking: string[] }>('/settings/provider-ranking'),
    ])
      .then(([configs, { ranking: r }]) => {
        // Build initial provider list from config (no status yet)
        setProviders(configs.map((c) => ({
          ...c,
          installed: false,
          authenticated: null,
          binaryPath: null,
          version: null,
        })));
        setRanking(r);
        setConfigLoading(false);

        // Phase 2: Load CLI detection statuses asynchronously
        apiFetch<ProviderStatusData[]>('/settings/providers/status')
          .then((statuses) => {
            const statusMap = new Map(statuses.map((s) => [s.id, s]));
            setProviders((prev) =>
              prev.map((p) => {
                const status = statusMap.get(p.id);
                return status
                  ? { ...p, installed: status.installed, authenticated: status.authenticated, binaryPath: status.binaryPath, version: status.version }
                  : p;
              }),
            );
          })
          .catch((err) => {
            // Status fetch failure is non-critical — toggles still work
            logger.warn('Failed to load provider statuses:', err);
          })
          .finally(() => setStatusLoading(false));
      })
      .catch((err) => {
        setError(err.message);
        setConfigLoading(false);
        setStatusLoading(false);
      });
  }, []);

  // Sort providers by ranking
  const sortedProviders = [...providers].sort((a, b) => {
    const ai = ranking.indexOf(a.id);
    const bi = ranking.indexOf(b.id);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ranking.indexOf(active.id as string);
    const newIndex = ranking.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newRanking = arrayMove(ranking, oldIndex, newIndex);
    setRanking(newRanking);
    try {
      await apiFetch('/settings/provider-ranking', {
        method: 'PUT',
        body: JSON.stringify({ ranking: newRanking }),
      });
    } catch {
      setRanking(ranking);
    }
  }, [ranking]);

  const installedCount = providers.filter((p) => p.installed).length;

  return (
    <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
          <Cpu className="w-3.5 h-3.5" /> CLI Providers
          <span className="text-[10px] font-normal normal-case tracking-normal text-th-text-muted/60">
            — drag to reorder
          </span>
        </h3>
        {!configLoading && (
          <span className="text-[10px] text-th-text-muted" data-testid="installed-count">
            {statusLoading ? `${providers.length} providers` : `${installedCount}/${providers.length} installed`}
          </span>
        )}
      </div>

      {configLoading && (
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

      {!configLoading && !error && sortedProviders.length === 0 && (
        <EmptyState
          icon={<Cpu className="w-10 h-10 opacity-50" />}
          title="No providers configured"
          description="Install a CLI provider (Claude, Copilot, Gemini, Cursor, Codex, or OpenCode) to get started."
          compact
        />
      )}

      {!configLoading && !error && sortedProviders.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
            <div className="space-y-2" data-testid="providers-list">
              {sortedProviders.map((provider, idx) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  rank={idx + 1}
                  onToggle={handleToggle}
                  statusLoading={statusLoading}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

// Non-UI logger (safe no-op in browser if console not available)
const logger = {
  warn: (...args: unknown[]) => {
    if (typeof console !== 'undefined') console.warn('[ProvidersSection]', ...args);
  },
};
