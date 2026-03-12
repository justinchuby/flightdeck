/**
 * ProviderManager — Detect CLI availability and manage provider preferences.
 *
 * All providers manage their own authentication. ProviderManager only:
 * 1. Detects if a CLI binary is installed on PATH
 * 2. Checks if the provider is authenticated (via status command)
 * 3. Gets/sets model preferences per provider
 * 4. Toggles providers enabled/disabled
 */

import { execSync } from 'node:child_process';
import type { Database } from '../db/database.js';
import type { ConfigStore } from '../config/ConfigStore.js';
import { PROVIDER_PRESETS, type ProviderId } from '../adapters/presets.js';
import { PROVIDER_REGISTRY, PROVIDER_IDS } from '@flightdeck/shared';
import { logger } from '../utils/logger.js';

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

export interface AuthCheckResult {
  authenticated: boolean;
  error?: string;
}

export interface ModelPreferences {
  defaultModel?: string;
  preferredModels?: string[];
}

// ── Auth status commands per provider ────────────────────────────
// Only copilot has a genuine auth-status command. For other providers,
// we verify the binary is functional with a safe, quick command.
// Some CLIs (e.g. claude) crash on --version, so we only check what works.

// Auth commands derived from the central ProviderRegistry
const AUTH_COMMANDS: Partial<Record<ProviderId, string>> = Object.fromEntries(
  PROVIDER_IDS
    .filter((id) => PROVIDER_REGISTRY[id].authCommand)
    .map((id) => [id, PROVIDER_REGISTRY[id].authCommand!]),
) as Partial<Record<ProviderId, string>>;

// ── Constants ────────────────────────────────────────────────────

const SETTING_PREFIX = 'provider:';

// ── ProviderManager ──────────────────────────────────────────────

export class ProviderManager {
  private readonly db: Database | undefined;
  private readonly configStore: ConfigStore | undefined;
  private readonly exec: (cmd: string) => string;

  constructor(opts: {
    db?: Database;
    configStore?: ConfigStore;
    execCommand?: (cmd: string) => string;
  } = {}) {
    this.db = opts.db;
    this.configStore = opts.configStore;
    this.exec = opts.execCommand ?? ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 5_000 }).trim());
  }

  // ── Detection ────────────────────────────────────────────

  /** Check if a provider's CLI binary is on PATH. */
  detectInstalled(provider: ProviderId): { installed: boolean; binaryPath: string | null } {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) throw new Error(`Unknown provider: ${provider}`);

    try {
      const path = this.exec(`which ${preset.binary}`);
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
      // Extract version-like pattern (e.g., "v1.2.3" or "1.2.3")
      const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-.]\w+)*)/);
      return match ? match[0] : raw.split('\n')[0].trim().slice(0, 50);
    } catch {
      return null;
    }
  }

  /** Get full status for a single provider. */
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

  /** Get status for all providers. */
  getAllProviderStatuses(): ProviderStatus[] {
    return (Object.keys(PROVIDER_PRESETS) as ProviderId[]).map((id) =>
      this.getProviderStatus(id),
    );
  }

  // ── Enabled/Disabled ─────────────────────────────────────

  isProviderEnabled(provider: ProviderId): boolean {
    if (this.configStore) {
      const settings = this.configStore.current.providerSettings[provider];
      return settings?.enabled ?? false;
    }
    if (!this.db) return true;
    return this.db.getSetting(`${SETTING_PREFIX}${provider}:enabled`) !== 'false';
  }

  setProviderEnabled(provider: ProviderId, enabled: boolean): void {
    if (this.configStore) {
      const current = this.configStore.current.providerSettings[provider] ?? { enabled: false, models: [] };
      this.configStore.writePartial({ providerSettings: { [provider]: { ...current, enabled } } }).catch(err => logger.warn({ msg: 'Failed to persist provider enabled state', provider, error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}${provider}:enabled`, String(enabled));
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
      const current = this.configStore.current.providerSettings[provider] ?? { enabled: false, models: [] };
      this.configStore.writePartial({
        providerSettings: { [provider]: { ...current, models: prefs.preferredModels ?? [] } },
      }).catch(err => logger.warn({ msg: 'Failed to persist model preferences', provider, error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}${provider}:models`, JSON.stringify(prefs));
  }

  // ── Active Provider ─────────────────────────────────────

  getActiveProviderId(): ProviderId {
    if (this.configStore) {
      return this.configStore.current.provider.id as ProviderId;
    }
    if (!this.db) return 'copilot';
    const raw = this.db.getSetting(`${SETTING_PREFIX}active`);
    if (raw && raw in PROVIDER_PRESETS) return raw as ProviderId;
    return 'copilot';
  }

  setActiveProviderId(provider: ProviderId): void {
    if (this.configStore) {
      this.configStore.writePartial({ provider: { ...this.configStore.current.provider, id: provider } }).catch(err => logger.warn({ msg: 'Failed to persist active provider', provider, error: err }));
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}active`, provider);
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
      this.configStore.writePartial({ providerRanking: ranking }).catch(err =>
        logger.warn({ msg: 'Failed to persist provider ranking', error: err }),
      );
      return;
    }
    if (!this.db) return;
    this.db.setSetting(`${SETTING_PREFIX}ranking`, JSON.stringify(ranking));
  }
}
