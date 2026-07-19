// packages/web/src/components/Settings/TelegramSettings.tsx
// Settings panel for Telegram bot integration configuration.
// Follows the ProvidersSection pattern: useState + apiFetch + expandable cards.

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import {
  MessageCircle,
  Zap,
  Plus,
  X,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  Shield,
  Bell,
  BellOff,
} from 'lucide-react';
import { formatTime } from '../../utils/format';

// ── Types ──────────────────────────────────────────────────

interface TelegramStatus {
  enabled: boolean;
  adapters: Array<{ platform: string; running: boolean }>;
  sessions: Array<{
    chatId: string;
    platform: string;
    projectId: string;
    boundBy: string;
    expiresAt: string;
  }>;
  pendingNotifications: number;
  subscriptions: number;
}

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedChatIds: string[];
  rateLimitPerMinute: number;
  notifications?: {
    enabledCategories?: NotificationCategory[];
    quietHours?: QuietHours | null;
  };
}

interface TestResult {
  sent: boolean;
  error?: string;
}

type NotificationCategory =
  | 'agent_spawned'
  | 'agent_completed'
  | 'task_completed'
  | 'decision_recorded'
  | 'decision_needs_approval'
  | 'agent_crashed'
  | 'system_alert';

interface QuietHours {
  enabled: boolean;
  startHour: number;
  endHour: number;
}

const NOTIFICATION_CATEGORIES: Array<{ id: NotificationCategory; label: string; icon: string; critical: boolean }> = [
  { id: 'decision_needs_approval', label: 'Decisions needing approval', icon: '🔔', critical: true },
  { id: 'agent_crashed', label: 'Agent crashes', icon: '⚠️', critical: true },
  { id: 'system_alert', label: 'System alerts', icon: '🚨', critical: true },
  { id: 'decision_recorded', label: 'Decisions recorded', icon: '📝', critical: false },
  { id: 'task_completed', label: 'Task completions', icon: '✅', critical: false },
  { id: 'agent_spawned', label: 'Agent spawned', icon: '🤖', critical: false },
  { id: 'agent_completed', label: 'Agent completed', icon: '🏁', critical: false },
];

// ── Component ──────────────────────────────────────────────

export function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config form state
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [tokenMasked, setTokenMasked] = useState(true);
  const [allowedChatIds, setAllowedChatIds] = useState<string[]>([]);
  const [newChatId, setNewChatId] = useState('');
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(20);

  // Notification preferences
  const [enabledCategories, setEnabledCategories] = useState<Set<NotificationCategory>>(
    new Set(NOTIFICATION_CATEGORIES.filter(c => c.critical).map(c => c.id)),
  );
  const [quietHours, setQuietHours] = useState<QuietHours>({
    enabled: false,
    startHour: 22,
    endHour: 8,
  });

  // Test connection state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Load status ────────────────────────────────────────

  useEffect(() => {
    loadStatus();
    loadConfig();
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetch<TelegramStatus>('/integrations/status');
      setStatus(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<{ telegram: TelegramConfig }>('/config');
      if (data.telegram) {
        setEnabled(data.telegram.enabled);
        setBotToken(data.telegram.botToken || '');
        setAllowedChatIds(data.telegram.allowedChatIds || []);
        setRateLimitPerMinute(data.telegram.rateLimitPerMinute || 20);
        if (data.telegram.notifications?.enabledCategories) {
          setEnabledCategories(new Set(data.telegram.notifications.enabledCategories));
        }
        if (data.telegram.notifications?.quietHours) {
          setQuietHours(data.telegram.notifications.quietHours);
        }
      }
    } catch {
      // Config may not have telegram section yet — use defaults
    }
  }, []);

  // ── Save config ────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled,
          botToken,
          allowedChatIds,
          rateLimitPerMinute,
          notifications: {
            enabledCategories: Array.from(enabledCategories),
            quietHours: quietHours.enabled ? quietHours : null,
          },
        }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Refresh status after config change
      setTimeout(loadStatus, 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [enabled, botToken, allowedChatIds, rateLimitPerMinute, enabledCategories, quietHours, loadStatus]);

  // ── Test connection ────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<TestResult>('/integrations/test-message', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'telegram',
          chatId: allowedChatIds[0] || 'test',
          text: '🛩️ Flightdeck connection test — if you see this, Telegram is working!',
        }),
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ sent: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }, [allowedChatIds]);

  // ── Toggle enable/disable ──────────────────────────────

  const handleToggleEnabled = useCallback(async (newEnabled: boolean) => {
    setEnabled(newEnabled);
    try {
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: newEnabled }),
      });
      setTimeout(loadStatus, 1000);
    } catch {
      setEnabled(!newEnabled); // Rollback
    }
  }, [loadStatus]);

  // ── Allowlist management ───────────────────────────────

  const addChatId = useCallback(() => {
    const trimmed = newChatId.trim();
    if (trimmed && !allowedChatIds.includes(trimmed)) {
      setAllowedChatIds(prev => [...prev, trimmed]);
      setNewChatId('');
    }
  }, [newChatId, allowedChatIds]);

  const removeChatId = useCallback((id: string) => {
    setAllowedChatIds(prev => prev.filter(c => c !== id));
  }, []);

  // ── Notification category toggle ───────────────────────

  const toggleCategory = useCallback((category: NotificationCategory, isCritical: boolean) => {
    if (isCritical) return; // Critical notifications cannot be disabled
    setEnabledCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // ── Render ─────────────────────────────────────────────

  const isConnected = status?.adapters.some(a => a.platform === 'telegram' && a.running) ?? false;

  const connectionStatus = !enabled
    ? { emoji: '⚪', label: 'Disabled', className: 'text-th-text-muted' }
    : isConnected
      ? { emoji: '🟢', label: 'Connected', className: 'text-green-400' }
      : { emoji: '🔴', label: 'Disconnected', className: 'text-red-400' };

  const maskedToken = botToken
    ? `${'•'.repeat(Math.max(0, botToken.length - 4))}${botToken.slice(-4)}`
    : '';

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
      {/* Header with status and enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
            <MessageCircle className="w-3.5 h-3.5" /> Telegram Integration
            <span className="inline-flex items-center text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
              In Development
            </span>
          </h3>
          <span
            className={`text-xs font-medium flex items-center gap-1 ${connectionStatus.className}`}
            data-testid="telegram-status"
          >
            {connectionStatus.emoji} {connectionStatus.label}
          </span>
        </div>
        <button
          onClick={() => handleToggleEnabled(!enabled)}
          data-testid="telegram-toggle"
          aria-label={enabled ? 'Disable Telegram integration' : 'Enable Telegram integration'}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            enabled ? 'bg-accent' : 'bg-th-bg-hover'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded" data-testid="telegram-error">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Bot Token */}
      <div>
        <label className="text-xs text-th-text-muted block mb-1.5 flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> Bot Token
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={tokenMasked ? 'password' : 'text'}
              value={tokenMasked ? maskedToken : botToken}
              onChange={(e) => { setBotToken(e.target.value); setTokenMasked(false); }}
              onFocus={() => { if (tokenMasked) { setTokenMasked(false); } }}
              placeholder="Enter your Telegram bot token"
              data-testid="telegram-token-input"
              aria-label="Telegram bot token"
              className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={handleTestConnection}
            disabled={testing || !botToken}
            data-testid="telegram-test-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        <p className="text-[10px] text-th-text-muted mt-1">
          Prefer setting <code className="text-th-text-muted">TELEGRAM_BOT_TOKEN</code> environment variable for security.
        </p>
        {testResult && (
          <div
            className={`flex items-center gap-1.5 text-xs mt-1.5 ${testResult.sent ? 'text-green-400' : 'text-red-400'}`}
            data-testid="telegram-test-result"
          >
            {testResult.sent ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {testResult.sent ? 'Test message sent successfully' : `Failed: ${testResult.error}`}
          </div>
        )}
      </div>

      {/* Allowed Chat IDs */}
      <div>
        <label className="text-xs text-th-text-muted block mb-1.5 flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> Allowed Chat IDs
        </label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newChatId}
            onChange={(e) => setNewChatId(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addChatId(); }}
            placeholder="Enter Telegram chat ID"
            data-testid="telegram-chatid-input"
            aria-label="New allowed chat ID"
            className="flex-1 bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
          />
          <button
            onClick={addChatId}
            disabled={!newChatId.trim()}
            data-testid="telegram-add-chatid"
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {allowedChatIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" data-testid="telegram-chatid-list">
            {allowedChatIds.map(id => (
              <span
                key={id}
                className="inline-flex items-center gap-1 bg-th-bg-alt border border-th-border rounded-md px-2 py-0.5 text-xs font-mono"
              >
                {id}
                <button
                  onClick={() => removeChatId(id)}
                  aria-label={`Remove chat ID ${id}`}
                  className="text-th-text-muted hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-th-text-muted">
            No chat IDs configured — all chats will be allowed.
          </p>
        )}
      </div>

      {/* Rate Limit */}
      <div>
        <label className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-th-text-muted flex items-center gap-1.5">
            <Clock className="w-3 h-3" /> Rate Limit
          </span>
          <span className="text-xs font-mono font-semibold text-accent">{rateLimitPerMinute}/min</span>
        </label>
        <input
          type="range"
          min={5}
          max={60}
          value={rateLimitPerMinute}
          onChange={(e) => setRateLimitPerMinute(Number(e.target.value))}
          aria-label="Rate limit per minute"
          data-testid="telegram-rate-limit"
          className="w-full accent-accent"
        />
        <div className="flex justify-between text-[10px] text-th-text-muted mt-0.5">
          <span>5</span><span>20</span><span>40</span><span>60</span>
        </div>
      </div>

      {/* Notification Preferences */}
      <div>
        <h4 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Bell className="w-3 h-3" /> Notification Types
        </h4>
        <div className="space-y-1.5">
          {NOTIFICATION_CATEGORIES.map(cat => {
            const isEnabled = enabledCategories.has(cat.id);
            return (
              <label
                key={cat.id}
                className="flex items-center justify-between py-1 cursor-pointer"
              >
                <span className="flex items-center gap-2 text-xs text-th-text-alt">
                  <span>{cat.icon}</span>
                  {cat.label}
                  {cat.critical && (
                    <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1 py-0.5 rounded">
                      always on
                    </span>
                  )}
                </span>
                <button
                  onClick={() => toggleCategory(cat.id, cat.critical)}
                  data-testid={`telegram-notif-${cat.id}`}
                  aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${cat.label} notifications`}
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    isEnabled ? 'bg-accent' : 'bg-th-bg-hover'
                  } ${cat.critical ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      isEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </label>
            );
          })}
        </div>
      </div>

      {/* Quiet Hours */}
      <div>
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs text-th-text-muted flex items-center gap-1.5">
            <BellOff className="w-3 h-3" /> Quiet Hours
          </span>
          <button
            onClick={() => setQuietHours(prev => ({ ...prev, enabled: !prev.enabled }))}
            data-testid="telegram-quiet-toggle"
            aria-label={quietHours.enabled ? 'Disable quiet hours' : 'Enable quiet hours'}
            className={`relative w-8 h-4 rounded-full transition-colors ${
              quietHours.enabled ? 'bg-accent' : 'bg-th-bg-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                quietHours.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
        {quietHours.enabled && (
          <div className="flex items-center gap-3 text-xs">
            <div>
              <label className="text-th-text-muted block mb-1">Start</label>
              <select
                value={quietHours.startHour}
                onChange={(e) => setQuietHours(prev => ({ ...prev, startHour: Number(e.target.value) }))}
                data-testid="telegram-quiet-start"
                className="bg-th-bg-alt border border-th-border rounded px-2 py-1 text-sm"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <span className="text-th-text-muted mt-4">to</span>
            <div>
              <label className="text-th-text-muted block mb-1">End</label>
              <select
                value={quietHours.endHour}
                onChange={(e) => setQuietHours(prev => ({ ...prev, endHour: Number(e.target.value) }))}
                data-testid="telegram-quiet-end"
                className="bg-th-bg-alt border border-th-border rounded px-2 py-1 text-sm"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {quietHours.enabled && (
          <p className="text-[10px] text-th-text-muted mt-1.5">
            ⚠️ Critical notifications (crashes, approvals needed) are always delivered, even during quiet hours.
          </p>
        )}
      </div>

      {/* Active Sessions */}
      {status && status.sessions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">
            Active Sessions ({status.sessions.length})
          </h4>
          <div className="space-y-1">
            {status.sessions.map(s => (
              <div key={`${s.chatId}-${s.projectId}`} className="flex items-center justify-between text-xs bg-th-bg-alt rounded-md px-3 py-1.5">
                <span className="font-mono">{s.chatId}</span>
                <span className="text-th-text-muted">→ {s.projectId}</span>
                <span className="text-th-text-muted text-[10px]">
                  expires {formatTime(s.expiresAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status summary */}
      {status && enabled && (
        <div className="flex items-center gap-4 text-[10px] text-th-text-muted pt-1">
          <span>📬 {status.pendingNotifications} pending</span>
          <span>🔔 {status.subscriptions} subscriptions</span>
          <span>💬 {status.sessions.length} sessions</span>
        </div>
      )}

      {/* Save button */}
      <div className="flex justify-end gap-2 pt-2 border-t border-th-border">
        <button
          onClick={handleSave}
          disabled={saving}
          data-testid="telegram-save-btn"
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold disabled:opacity-50 transition-colors hover:bg-accent-muted"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {saving ? 'Saving…' : saveSuccess ? 'Saved ✓' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
