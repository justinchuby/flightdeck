/**
 * ProviderManager — Detect CLI availability and manage provider preferences.
 *
 * All providers manage their own authentication. ProviderManager only:
 * 1. Detects if a CLI binary is installed on PATH
 * 2. Checks if the provider is authenticated (via status command)
 * 3. Gets/sets model preferences per provider
 * 4. Toggles providers enabled/disabled
 *
 * Two access patterns:
 * - **Config** (`getProviderConfigs`) — instant, no shell calls, for initial UI render
 * - **Status** (`getAllProviderStatusesAsync`) — async parallel detection with caching
 */

import { execSync } from 'node:child_process';
import { execFile as execFileCb } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import type { Database } from '../db/database.js';
import type { ConfigStore } from '../config/ConfigStore.js';
import type { FlightdeckConfig } from '../config/configSchema.js';
import { PROVIDER_PRESETS, type ProviderId } from '../adapters/presets.js';
import { WHICH_COMMAND } from '../utils/platform.js';
import { PROVIDER_REGISTRY, PROVIDER_IDS } from '@flightdeck/shared';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFileCb);

// ── Types ────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  /** Whether the CLI binary is on PATH. */
  installed: boolean;
  /** Whether the provider reports authenticated (null if not checked). */
  authenticated: boolean | null;
  /** Whether the provider is enabled in settings. */
  enabled: boolean;
  /** Path to the binary, or null if not installed. */
  binaryPath: string | null;
  /** CLI version string, or null if not detectable. */
  version: string | null;
}

/** Lightweight config-only view for instant UI rendering (no CLI detection). */
export interface ProviderConfig {
  id: ProviderId;
  name: string;
  binary: string;
  enabled: boolean;
}

export interface AuthCheckResult {
  authenticated: boolean;
  error?: string;
}

export interface ModelPreferences {
  defaultModel?: string;
  preferredModels?: string[];
}

/** Cached detection result with expiry timestamp. */
interface CachedDetection {
  installed: boolean;
  authenticated: boolean | null;
  binaryPath: string | null;
  version: string | null;
  expiresAt: number;
}

// ── Auth status commands per provider ────────────────────────────
// Only copilot has a genuine auth-status command. For other providers,
// we verify the binary is functional with a safe, quick command.
// Some CLIs (e.g. claude) crash on --version, so we only check what works.

// Auth commands derived from the central ProviderRegistry
const AUTH_COMMANDS: Partial<Record<ProviderId, string>> = Object.fromEntries(
  PROVIDER_IDS
    .filter((id: ProviderId) => PROVIDER_REGISTRY[id].authCommand)
    .map((id: ProviderId) => [id, PROVIDER_REGISTRY[id].authCommand!]),
) as Partial<Record<ProviderId, string>>;

// ── Constants ────────────────────────────────────────────────────

const SETTING_PREFIX = 'provider:';
const CACHE_TTL_MS = 60_000; // 60 seconds
const ASYNC_EXEC_TIMEOUT_MS = 5_000;

// ── ProviderManager ──────────────────────────────────────────────

export class ProviderManager extends EventEmitter {
  private readonly db: Database | undefined;
  private readonly configStore: ConfigStore | undefined;
  private readonly exec: (cmd: string) => string;
  private readonly execAsync: (cmd: string, args: string[]) => Promise<string>;

  /** In-memory cache for CLI detection results (keyed by provider ID). */
  private readonly detectionCache = new Map<ProviderId, CachedDetection>();
  /** Runtime fallback used while config-store persistence catches up or fails. */
  private resolvedProviderOverride: ProviderId | null = null;
  /** Configured provider whose fallback write most recently failed. */
  private failedProviderPersistenceConfiguredId: ProviderId | null = null;
  /** Monotonic guard against stale async provider writes applying after reload/recovery. */
  private providerResolutionVersion = 0;

  /** Configurable TTL for testing. */
  readonly cacheTtlMs: number;

  constructor(opts: {
    db?: Database;
    configStore?: ConfigStore;
    execCommand?: (cmd: string) => string;
    execCommandAsync?: (cmd: string, args: string[]) => Promise<string>;
    cacheTtlMs?: number;
  } = {}) {
    super();
    this.db = opts.db;
    this.configStore = opts.configStore;
    this.exec = opts.execCommand ?? ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 5_000 }).trim());
    this.execAsync = opts.execCommandAsync ?? (async (cmd, args) => {
      const { stdout } = await execFileAsync(cmd, args, {
        encoding: 'utf8',
        timeout: ASYNC_EXEC_TIMEOUT_MS,
      });
      return stdout.trim();
    });
    this.cacheTtlMs = opts.cacheTtlMs ?? CACHE_TTL_MS;

    if (this.configStore) {
      this.configStore.on('config:provider:changed', () => this.resetRuntimeProviderResolution());
      this.configStore.on('config:reloaded', () => this.resetRuntimeProviderResolution());
    }
  }

  // ── Config (instant, no CLI calls) ──────────────────────

  /** Get lightweight config for all providers — instant, no shell calls. */
  getProviderConfigs(): ProviderConfig[] {
    return (Object.keys(PROVIDER_PRESETS) as ProviderId[]).map((id) => ({
      id,
      name: PROVIDER_PRESETS[id].name,
      binary: PROVIDER_PRESETS[id].binary,
      enabled: this.isProviderEnabled(id),
    }));
  }

  // ── Detection (sync, legacy) ────────────────────────────

  /** Check if a provider's CLI binary is on PATH. */
  detectInstalled(provider: ProviderId): { installed: boolean; binaryPath: string | null } {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) throw new Error(`Unknown provider: ${provider}`);

    try {
      const path = this.exec(`${WHICH_COMMAND} ${preset.binary}`);
      return { installed: true, binaryPath: path };
    } catch {
      return { installed: false, binaryPath: null };
    }
  }

  /** Run a quick auth/status check for a provider. */
  checkAuthenticated(provider: ProviderId): AuthCheckResult {
    const cmd = AUTH_COMMANDS[provider];
    // No auth command → assume authenticated if installed (provider manages own auth)
    if (!cmd) return { authenticated: true };

    try {
      this.exec(cmd);
      return { authenticated: true };
    } catch (err: any) {
      return { authenticated: false, error: err.message || String(err) };
    }
  }

  /** Detect CLI version. Returns version string or null. */
  detectVersion(provider: ProviderId): string | null {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return null;

    // All providers support --version for version detection
    const cmd = `${preset.binary} --version`;

    try {
      const raw = this.exec(cmd);
      return this.parseVersion(raw);
    } catch {
      return null;
    }
  }

  /** Get full status for a single provider (sync). */
  getProviderStatus(provider: ProviderId): ProviderStatus {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) throw new Error(`Unknown provider: ${provider}`);

    const { installed, binaryPath } = this.detectInstalled(provider);
    const auth = installed ? this.checkAuthenticated(provider) : null;
    const version = installed ? this.detectVersion(provider) : null;

    return {
      id: provider,
      name: preset.name,
      installed,
      authenticated: auth?.authenticated ?? null,
      enabled: this.isProviderEnabled(provider),
      binaryPath,
      version,
    };
  }

  /** Get status for all providers (sync). */
  getAllProviderStatuses(): ProviderStatus[] {
    return (Object.keys(PROVIDER_PRESETS) as ProviderId[]).map((id) =>
      this.getProviderStatus(id),
    );
  }

  // ── Detection (async, parallel, cached) ─────────────────

  /** Async installed check — uses `which` via execFile. */
  async detectInstalledAsync(provider: ProviderId): Promise<{ installed: boolean; binaryPath: string | null }> {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) throw new Error(`Unknown provider: ${provider}`);

    try {
      const path = await this.execAsync(WHICH_COMMAND, [preset.binary]);
      return { installed: true, binaryPath: path };
    } catch {
      return { installed: false, binaryPath: null };
    }
  }

  /** Async auth check. */
  async checkAuthenticatedAsync(provider: ProviderId): Promise<AuthCheckResult> {
    const cmd = AUTH_COMMANDS[provider];
    if (!cmd) return { authenticated: true };

    const parts = cmd.split(/\s+/);
    const binary = parts[0];
    const args = parts.slice(1);

    try {
      await this.execAsync(binary, args);
      return { authenticated: true };
    } catch (err: any) {
      return { authenticated: false, error: err.message || String(err) };
    }
  }

  /** Async version detection. */
  async detectVersionAsync(provider: ProviderId): Promise<string | null> {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return null;

    try {
      const raw = await this.execAsync(preset.binary, ['--version']);
      return this.parseVersion(raw);
    } catch {
      return null;
    }
  }

  /** Get full status for a single provider (async, uses cache). */
  async getProviderStatusAsync(provider: ProviderId): Promise<ProviderStatus> {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) throw new Error(`Unknown provider: ${provider}`);

    const cached = this.getCachedDetection(provider);
    if (cached) {
      return {
        id: provider,
        name: preset.name,
        installed: cached.installed,
        authenticated: cached.authenticated,
        enabled: this.isProviderEnabled(provider),
        binaryPath: cached.binaryPath,
        version: cached.version,
      };
    }

    const { installed, binaryPath } = await this.detectInstalledAsync(provider);
    const [auth, version] = await Promise.all([
      installed ? this.checkAuthenticatedAsync(provider) : Promise.resolve(null),
      installed ? this.detectVersionAsync(provider) : Promise.resolve(null),
    ]);

    const detection: CachedDetection = {
      installed,
      authenticated: auth?.authenticated ?? null,
      binaryPath,
      version,
      expiresAt: Date.now() + this.cacheTtlMs,
    };
    this.detectionCache.set(provider, detection);

    return {
      id: provider,
      name: preset.name,
      installed,
      authenticated: auth?.authenticated ?? null,
      enabled: this.isProviderEnabled(provider),
      binaryPath,
      version,
    };
  }

  /** Get status for all providers in parallel (async, cached). */
  async getAllProviderStatusesAsync(): Promise<ProviderStatus[]> {
    const ids = Object.keys(PROVIDER_PRESETS) as ProviderId[];
    return Promise.all(ids.map((id) => this.getProviderStatusAsync(id)));
  }

  // ── Cache Management ────────────────────────────────────

  /** Get cached detection if still valid. */
  private getCachedDetection(provider: ProviderId): CachedDetection | undefined {
    const cached = this.detectionCache.get(provider);
    if (!cached) return undefined;
    if (Date.now() >= cached.expiresAt) {
      this.detectionCache.delete(provider);
      return undefined;
    }
    return cached;
  }

  /** Invalidate cache for a provider or all providers. */
  invalidateCache(provider?: ProviderId): void {
    if (provider) {
      this.detectionCache.delete(provider);
    } else {
      this.detectionCache.clear();
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  private getMutableConfigStoreCurrent(): FlightdeckConfig | null {
    return this.configStore ? this.configStore.current as FlightdeckConfig : null;
  }

  private resetRuntimeProviderResolution(): void {
    this.providerResolutionVersion += 1;
    this.resolvedProviderOverride = null;
    this.failedProviderPersistenceConfiguredId = null;
    this.emit('provider:runtime-changed');
  }

  private beginProviderResolutionTransition(): number {
    this.providerResolutionVersion += 1;
    return this.providerResolutionVersion;
  }

  private isCurrentProviderResolutionTransition(version: number): boolean {
    return this.providerResolutionVersion === version;
  }

  private clearResolvedProviderOverride(providerId?: ProviderId): void {
    if (!this.configStore || !this.resolvedProviderOverride) return;
    if (providerId && this.configStore.current.provider.id !== providerId) return;
    this.resetRuntimeProviderResolution();
  }

  private rollbackResolvedProviderOverride(configuredProviderId?: ProviderId): void {
    this.resolvedProviderOverride = null;
    this.failedProviderPersistenceConfiguredId = configuredProviderId ?? null;
    this.emit('provider:runtime-changed');
  }

  private shouldSuppressFallback(configuredProviderId: ProviderId): boolean {
    return Boolean(
      this.configStore &&
      this.failedProviderPersistenceConfiguredId === configuredProviderId &&
      this.configStore.current.provider.id === configuredProviderId,
    );
  }

  private buildProviderSwitchPatch(provider: ProviderId): { provider: Partial<FlightdeckConfig['provider']> } {
    return {
      provider: {
        id: provider,
        binaryOverride: undefined,
        argsOverride: undefined,
        envOverride: undefined,
        cloudProvider: undefined,
      },
    };
  }

  private applyConfigStorePatchAfterWrite(patch: {
    provider?: Partial<FlightdeckConfig['provider']>;
    providerSettings?: FlightdeckConfig['providerSettings'];
    providerRanking?: FlightdeckConfig['providerRanking'];
  }): void {
    const config = this.getMutableConfigStoreCurrent();
    if (!config) return;

    if (patch.provider) {
      config.provider = { ...config.provider, ...patch.provider };
      if (patch.provider.id) {
        this.clearResolvedProviderOverride(patch.provider.id as ProviderId);
      }
    }
    if (patch.providerSettings) {
      config.providerSettings = {
        ...config.providerSettings,
        ...patch.providerSettings,
      };
    }
    if (patch.providerRanking) {
      config.providerRanking = patch.providerRanking;
    }
  }

  /** Extract version-like pattern from CLI output. */
  private parseVersion(raw: string): string {
    const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-.]\w+)*)/);
    return match ? match[0] : raw.split('\n')[0].trim().slice(0, 50);
  }

  // ── Enabled/Disabled ─────────────────────────────────────

  isProviderEnabled(provider: ProviderId): boolean {
    if (this.configStore) {
      const settings = this.configStore.current.providerSettings[provider];
      return settings?.enabled ?? true;
    }
    if (!this.db) return true;
    return this.db.getSetting(`${SETTING_PREFIX}${provider}:enabled`) !== 'false';
  }

  setProviderEnabled(provider: ProviderId, enabled: boolean): void {
    const activeProvider = this.getActiveProviderId();
    let fallbackProvider: ProviderId | null = null;
    if (!enabled && activeProvider === provider) {
      fallbackProvider = this.findFirstUsableProvider(provider);
      if (!fallbackProvider) {
        throw new Error(`Cannot disable active provider '${provider}' without another installed and enabled provider`);
      }
    }

    if (this.configStore) {
      const current = this.configStore.current.providerSettings[provider] ?? { enabled: true, models: [] };
      const nextProviderSettings = { ...current, enabled };
      const patch = {
        providerSettings: { [provider]: nextProviderSettings },
      } as {
        providerSettings: FlightdeckConfig['providerSettings'];
        provider?: Partial<FlightdeckConfig['provider']>;
      };
      if (fallbackProvider) {
        patch.provider = { id: fallbackProvider };
      }
      this.configStore.writePartial(patch)
        .then(() => this.applyConfigStorePatchAfterWrite(patch))
        .catch(err => logger.warn({ msg: 'Failed to persist provider enabled state', provider, error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}${provider}:enabled`, String(enabled));
    if (fallbackProvider) {
      this.persistActiveProvider(fallbackProvider);
    }
  }

  // ── Model Preferences ────────────────────────────────────

  getModelPreferences(provider: ProviderId): ModelPreferences {
    if (this.configStore) {
      const models = this.configStore.current.providerSettings[provider]?.models ?? [];
      return models.length ? { preferredModels: models } : {};
    }
    if (!this.db) return {};
    const raw = this.db.getSetting(`${SETTING_PREFIX}${provider}:models`);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  setModelPreferences(provider: ProviderId, prefs: ModelPreferences): void {
    if (this.configStore) {
      const current = this.configStore.current.providerSettings[provider] ?? { enabled: true, models: [] };
      const nextModels = prefs.preferredModels ?? [];
      const patch = {
        providerSettings: { [provider]: { ...current, models: nextModels } },
      } satisfies { providerSettings: FlightdeckConfig['providerSettings'] };
      this.configStore.writePartial(patch)
        .then(() => this.applyConfigStorePatchAfterWrite(patch))
        .catch(err => logger.warn({ msg: 'Failed to persist model preferences', provider, error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}${provider}:models`, JSON.stringify(prefs));
  }

  // ── Active Provider ─────────────────────────────────────

  getActiveProviderId(): ProviderId {
    if (this.configStore) {
      return this.resolvedProviderOverride ?? this.configStore.current.provider.id as ProviderId;
    }
    if (!this.db) return this.findFirstInstalledProvider();
    const raw = this.db.getSetting(`${SETTING_PREFIX}active`);
    if (raw && raw in PROVIDER_PRESETS) return raw as ProviderId;
    return this.findFirstInstalledProvider();
  }

  /**
   * Resolve the best available provider: checks if the configured provider is
   * actually installed and enabled, and falls back to the first available one
   * from the provider ranking if not.
   *
   * Call this during startup after the ProviderManager is created to ensure
   * the active provider is actually usable.
   */
  resolveAndPersistProvider(): ProviderId {
    const configured = this.configStore
      ? this.configStore.current.provider.id as ProviderId
      : this.getActiveProviderId();

    // Check if the configured provider is installed and enabled
    const { installed } = this.detectInstalled(configured);
    if (installed && this.isProviderEnabled(configured)) {
      logger.info({ module: 'provider', msg: 'Configured provider is available', provider: configured });
      return configured;
    }

    logger.warn({ module: 'provider', msg: 'Configured provider not available, searching for fallback', provider: configured, installed });

    if (this.shouldSuppressFallback(configured)) {
      logger.warn({ module: 'provider', msg: 'Skipping fallback after failed provider persistence until config changes', provider: configured });
      return configured;
    }

    // Walk the provider ranking to find the first installed+enabled provider
    const fallbackProvider = this.findFirstUsableProvider(configured);
    if (fallbackProvider) {
      logger.info({ module: 'provider', msg: 'Falling back to available provider', from: configured, to: fallbackProvider });
      const transitionVersion = this.beginProviderResolutionTransition();
      this.resolvedProviderOverride = fallbackProvider;
      this.emit('provider:runtime-changed');
      this.persistActiveProvider(fallbackProvider, configured, transitionVersion);
      return fallbackProvider;
    }

    // No provider found — keep the configured one and let downstream handle the error
    logger.warn({ module: 'provider', msg: 'No installed+enabled provider found, keeping configured', provider: configured });
    return configured;
  }

  /**
   * Find the first installed provider from the ranking, used as a last-resort
   * fallback when no DB or ConfigStore is available.
   */
  private findFirstInstalledProvider(): ProviderId {
    const allIds = Object.keys(PROVIDER_PRESETS) as ProviderId[];
    for (const id of allIds) {
      try {
        const { installed } = this.detectInstalled(id);
        if (installed) return id;
      } catch { /* skip */ }
    }
    return 'copilot'; // absolute last resort
  }

  private findFirstUsableProvider(excludeProvider?: ProviderId): ProviderId | null {
    const ranking = this.getProviderRanking();
    for (const candidateId of ranking) {
      if (candidateId === excludeProvider) continue;
      const { installed } = this.detectInstalled(candidateId);
      if (installed && this.isProviderEnabled(candidateId)) {
        return candidateId;
      }
    }
    return null;
  }

  private persistActiveProvider(provider: ProviderId, configuredProviderId?: ProviderId, transitionVersion?: number): void {
    if (this.configStore) {
      const patch = this.buildProviderSwitchPatch(provider);
      const version = transitionVersion ?? this.beginProviderResolutionTransition();
      // Only update the provider id — don't spread the current provider config,
      // which may contain overrides (binary, args, env, cloud) for a different provider.
      this.configStore.writePartial(patch)
        .then(() => {
          if (!this.isCurrentProviderResolutionTransition(version)) return;
          this.applyConfigStorePatchAfterWrite(patch);
        })
        .catch(err => {
          if (this.isCurrentProviderResolutionTransition(version)) {
            this.rollbackResolvedProviderOverride(configuredProviderId);
          }
          logger.warn({ msg: 'Failed to persist active provider', provider, error: err });
        });
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}active`, provider);
  }

  setActiveProviderId(provider: ProviderId): void {
    if (!this.isProviderEnabled(provider)) {
      throw new Error(`Provider '${provider}' is disabled`);
    }

    const { installed } = this.detectInstalled(provider);
    if (!installed) {
      throw new Error(`Provider '${provider}' is not installed`);
    }

    this.persistActiveProvider(provider);
  }

  async setProviderEnabledPersisted(provider: ProviderId, enabled: boolean): Promise<ProviderId> {
    const activeProvider = this.getActiveProviderId();
    let fallbackProvider: ProviderId | null = null;
    if (!enabled && activeProvider === provider) {
      fallbackProvider = this.findFirstUsableProvider(provider);
      if (!fallbackProvider) {
        throw new Error(`Cannot disable active provider '${provider}' without another installed and enabled provider`);
      }
    }

    if (this.configStore) {
      const current = this.configStore.current.providerSettings[provider] ?? { enabled: true, models: [] };
      const patch = {
        providerSettings: { [provider]: { ...current, enabled } },
        ...(fallbackProvider ? this.buildProviderSwitchPatch(fallbackProvider) : {}),
      } satisfies {
        providerSettings: FlightdeckConfig['providerSettings'];
        provider?: Partial<FlightdeckConfig['provider']>;
      };
      const transitionVersion = fallbackProvider ? this.beginProviderResolutionTransition() : 0;
      if (fallbackProvider) {
        this.resolvedProviderOverride = fallbackProvider;
        this.emit('provider:runtime-changed');
      }
      try {
        await this.configStore.writePartial(patch);
        if (fallbackProvider && !this.isCurrentProviderResolutionTransition(transitionVersion)) {
          return fallbackProvider;
        }
        this.applyConfigStorePatchAfterWrite(patch);
        return fallbackProvider ?? activeProvider;
      } catch (error) {
        if (fallbackProvider && this.isCurrentProviderResolutionTransition(transitionVersion)) {
          this.rollbackResolvedProviderOverride(activeProvider);
        }
        throw error;
      }
    }

    this.setProviderEnabled(provider, enabled);
    return this.getActiveProviderId();
  }

  async setActiveProviderIdPersisted(provider: ProviderId): Promise<ProviderId> {
    if (!this.isProviderEnabled(provider)) {
      throw new Error(`Provider '${provider}' is disabled`);
    }

    const { installed } = this.detectInstalled(provider);
    if (!installed) {
      throw new Error(`Provider '${provider}' is not installed`);
    }

    if (this.configStore) {
      const patch = this.buildProviderSwitchPatch(provider);
      const transitionVersion = this.beginProviderResolutionTransition();
      await this.configStore.writePartial(patch);
      if (!this.isCurrentProviderResolutionTransition(transitionVersion)) {
        return provider;
      }
      this.applyConfigStorePatchAfterWrite(patch);
      return provider;
    }

    this.persistActiveProvider(provider);
    return provider;
  }

  // ── Provider Ranking ───────────────────────────────────────

  /**
   * Get the user's preferred provider ordering.
   * Returns all provider IDs in preference order (most preferred first).
   * Missing providers are appended at the end in default order.
   */
  getProviderRanking(): ProviderId[] {
    const allIds = Object.keys(PROVIDER_PRESETS) as ProviderId[];
    let stored: string[] = [];
    if (this.configStore) {
      stored = this.configStore.current.providerRanking ?? [];
    } else if (this.db) {
      const raw = this.db.getSetting(`${SETTING_PREFIX}ranking`);
      if (raw) { try { stored = JSON.parse(raw); } catch { /* ignore */ } }
    }
    // Filter to valid IDs, then append any missing in default order
    const ranked = stored.filter((id): id is ProviderId => id in PROVIDER_PRESETS);
    const missing = allIds.filter(id => !ranked.includes(id));
    return [...ranked, ...missing];
  }

  setProviderRanking(ranking: ProviderId[]): void {
    if (this.configStore) {
      const patch = { providerRanking: ranking } satisfies { providerRanking: FlightdeckConfig['providerRanking'] };
      this.configStore.writePartial(patch)
        .then(() => this.applyConfigStorePatchAfterWrite(patch))
        .catch(err => logger.warn({ msg: 'Failed to persist provider ranking', error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}ranking`, JSON.stringify(ranking));
  }
}
