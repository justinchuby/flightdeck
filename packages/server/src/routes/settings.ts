/**
 * Settings routes — provider availability and configuration.
 *
 * Providers manage their own authentication. We only detect:
 * 1. Is the CLI binary installed on PATH?
 * 2. Is the provider authenticated/responsive? (quick health check)
 * 3. Model preferences and enable/disable toggles.
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
   * GET /settings/providers — list all providers with installed/auth status.
   */
  router.get('/settings/providers', (_req, res) => {
    const statuses = pm.getAllProviderStatuses();
    res.json(statuses);
  });

  /**
   * GET /settings/providers/:provider — single provider status + model prefs.
   */
  router.get('/settings/providers/:provider', (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    const status = pm.getProviderStatus(provider);
    const modelPrefs = pm.getModelPreferences(provider);
    res.json({ ...status, modelPreferences: modelPrefs });
  });

  /**
   * POST /settings/providers/:provider/test — run connection/auth health check.
   */
  router.post('/settings/providers/:provider/test', (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    const { installed } = pm.detectInstalled(provider);
    if (!installed) {
      return res.json({ success: false, message: `CLI binary not found on PATH` });
    }
    const auth = pm.checkAuthenticated(provider);
    res.json({
      success: auth.authenticated,
      message: auth.authenticated
        ? 'Provider is installed and responsive'
        : `Auth check failed: ${auth.error ?? 'unknown error'}`,
    });
  });

  /**
   * PUT /settings/providers/:provider — update provider config (enabled, model prefs).
   */
  router.put('/settings/providers/:provider', (req, res) => {
    const { provider } = req.params;
    if (!isValidProviderId(provider)) {
      return res.status(404).json({ error: `Unknown provider: ${provider}` });
    }
    const { enabled, modelPreferences } = req.body as {
      enabled?: boolean;
      modelPreferences?: { defaultModel?: string; preferredModels?: string[] };
    };

    if (enabled !== undefined) {
      pm.setProviderEnabled(provider, enabled);
    }
    if (modelPreferences) {
      pm.setModelPreferences(provider, modelPreferences);
    }

    const status = pm.getProviderStatus(provider);
    const prefs = pm.getModelPreferences(provider);
    res.json({ ...status, modelPreferences: prefs });
  });

  /**
   * PUT /settings/provider — set the active provider.
   */
  router.put('/settings/provider', (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id || !isValidProviderId(id)) {
      return res.status(400).json({ error: `Invalid provider: ${id}` });
    }
    pm.setActiveProviderId(id as ProviderId);
    res.json({ activeProvider: id });
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

