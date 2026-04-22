/**
 * Settings routes — provider availability and configuration.
 *
 * Providers manage their own authentication. We only detect:
 * 1. Is the CLI binary installed on PATH?
 * 2. Is the provider authenticated/responsive? (quick health check)
 * 3. Model preferences and enable/disable toggles.
 *
 * Two-phase loading:
 * - GET /settings/providers — instant config (id, name, enabled). No CLI calls.
 * - GET /settings/providers/status — async parallel CLI detection with caching.
 *
 * NO API keys are managed, stored, or displayed.
 */
import { Router } from 'express';
import { isValidProviderId } from '../adapters/presets.js';
import type { ProviderId } from '../adapters/presets.js';
import { ProviderManager } from '../providers/ProviderManager.js';
import type { AppContext } from './context.js';

// ── Routes ──────────────────────────────────────────────────────────

export function settingsRoutes(ctx: AppContext): Router {
  const router = Router();
  const pm = ctx.providerManager ?? new ProviderManager({ db: ctx.db, configStore: ctx.configStore });

  /**
   * GET /settings/providers — instant provider configs (no CLI detection).
   * Returns id, name, enabled for all providers. Used for immediate UI render.
   */
  router.get('/settings/providers', (_req, res) => {
    const configs = pm.getProviderConfigs();
    res.json(configs);
  });

  /**
   * GET /settings/providers/status — async CLI detection for all providers.
   * Runs `which`, auth check, and version detection in parallel with caching.
   * Returns full ProviderStatus[] with installed/authenticated/version fields.
   */
  router.get('/settings/providers/status', async (_req, res) => {
    try {
      const statuses = await pm.getAllProviderStatusesAsync();
      res.json(statuses);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to detect provider statuses' });
    }
  });

  /**
   * GET /settings/providers/:provider — single provider status + model prefs.
   */
  router.get('/settings/providers/:provider', async (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    try {
      const status = await pm.getProviderStatusAsync(provider);
      const modelPrefs = pm.getModelPreferences(provider);
      res.json({ ...status, modelPreferences: modelPrefs });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get provider status' });
    }
  });

  /**
   * POST /settings/providers/:provider/test — run connection/auth health check.
   */
  router.post('/settings/providers/:provider/test', async (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    try {
      const { installed } = await pm.detectInstalledAsync(provider);
      if (!installed) {
        return res.json({ success: false, message: `CLI binary not found on PATH` });
      }
      const auth = await pm.checkAuthenticatedAsync(provider);
      // Invalidate cache after explicit test so next status fetch is fresh
      pm.invalidateCache(provider);
      res.json({
        success: auth.authenticated,
        message: auth.authenticated
          ? 'Provider is installed and responsive'
          : `Auth check failed: ${auth.error ?? 'unknown error'}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Test failed' });
    }
  });

  /**
   * PUT /settings/providers/:provider — update provider config (enabled, model prefs).
   * Returns config + cached status if available (no new CLI calls for toggle response).
   */
  router.put('/settings/providers/:provider', async (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    const { enabled, modelPreferences } = req.body as {
      enabled?: boolean;
      modelPreferences?: { defaultModel?: string; preferredModels?: string[] };
    };

    let activeProvider = pm.getActiveProviderId();
    if (enabled !== undefined) {
      try {
        pm.setProviderEnabled(provider, enabled);
        activeProvider = pm.resolveAndPersistProvider();
      } catch (err: any) {
        return res.status(409).json({ error: err.message || 'Failed to update provider enabled state' });
      }
    }
    if (modelPreferences) {
      pm.setModelPreferences(provider, modelPreferences);
    }

    try {
      const status = await pm.getProviderStatusAsync(provider);
      const prefs = pm.getModelPreferences(provider);
      res.json({ ...status, modelPreferences: prefs, activeProvider });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to get provider status' });
    }
  });

  /**
   * GET /settings/provider — get the active provider ID.
   */
  router.get('/settings/provider', (_req, res) => {
    res.json({ activeProvider: pm.resolveAndPersistProvider() });
  });

  /**
   * PUT /settings/provider — set the active provider.
   */
  router.put('/settings/provider', (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id || !isValidProviderId(id)) {
      return res.status(400).json({ error: `Invalid provider: ${id}` });
    }
    try {
      pm.setActiveProviderId(id as ProviderId);
      res.json({ activeProvider: id });
    } catch (err: any) {
      res.status(409).json({ error: err.message || 'Failed to set active provider' });
    }
  });

  /**
   * GET /settings/provider-ranking — get provider preference order.
   */
  router.get('/settings/provider-ranking', (_req, res) => {
    res.json({ ranking: pm.getProviderRanking() });
  });

  /**
   * PUT /settings/provider-ranking — set provider preference order.
   */
  router.put('/settings/provider-ranking', (req, res) => {
    const { ranking } = req.body as { ranking?: string[] };
    if (!ranking || !Array.isArray(ranking)) {
      return res.status(400).json({ error: 'ranking must be an array of provider IDs' });
    }
    const valid = ranking.filter(isValidProviderId) as ProviderId[];
    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid provider IDs in ranking' });
    }
    pm.setProviderRanking(valid);
    res.json({ ranking: pm.getProviderRanking() });
  });

  return router;
}
