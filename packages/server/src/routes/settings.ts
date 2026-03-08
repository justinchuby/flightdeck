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
  const pm = new ProviderManager({ db: ctx.db });

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

  return router;
}

