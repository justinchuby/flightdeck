// packages/web/src/components/Settings/TelegramSettings.tsx
// Root component for Telegram integration settings.
// Dual-mode: Setup wizard for first-time config, dashboard for ongoing management.

import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { TelegramSetupWizard } from './TelegramSetupWizard';
import { TelegramDashboard } from './TelegramDashboard';
import type { TelegramConfig, TelegramStatus } from './telegram/types';

// ── Component ──────────────────────────────────────────────

export function TelegramSettings() {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'wizard' | 'dashboard'>('wizard');

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<TelegramStatus>('/integrations/status');
      setStatus(data);
    } catch {
      // Status may not be available yet
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<{ telegram: TelegramConfig }>('/config');
      if (data.telegram) {
        setConfig(data.telegram);
        return data.telegram;
      }
    } catch {
      // Config may not have telegram section yet
    }
    return null;
  }, []);

  useEffect(() => {
    Promise.all([loadConfig(), loadStatus()]).then(([cfg]) => {
      // Determine mode: if token is set and at least 1 chat → dashboard
      if (cfg?.botToken && cfg.allowedChatIds.length > 0) {
        setMode('dashboard');
      }
      setLoading(false);
    });
  }, [loadConfig, loadStatus]);

  const handleRefresh = useCallback(async () => {
    const [cfg] = await Promise.all([loadConfig(), loadStatus()]);
    if (cfg) setConfig(cfg);
  }, [loadConfig, loadStatus]);

  const handleWizardComplete = useCallback((completedConfig: TelegramConfig) => {
    setConfig(completedConfig);
    setMode('dashboard');
    handleRefresh();
  }, [handleRefresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-th-text-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading Telegram settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
        <MessageCircle className="w-3.5 h-3.5" /> Telegram Integration
      </h3>

      {mode === 'wizard' ? (
        <TelegramSetupWizard
          config={config}
          onComplete={handleWizardComplete}
        />
      ) : config && status ? (
        <TelegramDashboard
          config={config}
          status={status}
          onReconfigure={() => setMode('wizard')}
          onRefresh={handleRefresh}
        />
      ) : null}
    </div>
  );
}
