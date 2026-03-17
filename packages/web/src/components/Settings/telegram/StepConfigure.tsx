// packages/web/src/components/Settings/telegram/StepConfigure.tsx
// Step 3: Notification preferences, quiet hours, and rate limit.

import { useState, useCallback } from 'react';
import { Bell, BellOff, Clock, Check, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import {
  NOTIFICATION_CATEGORIES,
  DEFAULT_ENABLED_CATEGORIES,
  DEFAULT_QUIET_HOURS,
  DEFAULT_RATE_LIMIT,
  type StepProps,
  type NotificationCategory,
  type QuietHours,
} from './types';

export function StepConfigure({ config, onUpdate, onNext, onBack }: StepProps) {
  const [enabledCategories, setEnabledCategories] = useState<Set<NotificationCategory>>(
    config.notifications?.enabledCategories
      ? new Set(config.notifications.enabledCategories)
      : DEFAULT_ENABLED_CATEGORIES,
  );
  const [quietHours, setQuietHours] = useState<QuietHours>(
    config.notifications?.quietHours || DEFAULT_QUIET_HOURS,
  );
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(
    config.rateLimitPerMinute || DEFAULT_RATE_LIMIT,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategory = useCallback((category: NotificationCategory, isCritical: boolean) => {
    if (isCritical) return;
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

  const handleFinish = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: true,
          botToken: config.botToken,
          allowedChatIds: config.allowedChatIds,
          rateLimitPerMinute,
          notifications: {
            enabledCategories: Array.from(enabledCategories),
            quietHours: quietHours.enabled ? quietHours : null,
          },
        }),
      });

      onUpdate({
        rateLimitPerMinute,
        notifications: {
          enabledCategories: Array.from(enabledCategories),
          quietHours: quietHours.enabled ? quietHours : null,
        },
      });
      onNext();
    } catch (err) {
      setError((err as Error).message || 'Could not save — check connection');
    } finally {
      setSaving(false);
    }
  }, [config, rateLimitPerMinute, enabledCategories, quietHours, onUpdate, onNext]);

  return (
    <div data-testid="telegram-wizard-step-3" className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-th-text mb-1">Configure Notifications</h4>
        <p className="text-xs text-th-text-muted">
          Choose which events trigger Telegram notifications. You can change these later.
        </p>
      </div>

      {/* Critical notifications (always on) */}
      <div>
        <h5 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Bell className="w-3 h-3" /> Always On (Critical)
        </h5>
        <div className="space-y-1.5">
          {NOTIFICATION_CATEGORIES.filter(c => c.critical).map(cat => (
            <label key={cat.id} className="flex items-center justify-between py-1">
              <span className="flex items-center gap-2 text-xs text-th-text-alt">
                <span>{cat.icon}</span>
                {cat.label}
                <span className="text-[10px] text-orange-400 bg-orange-400/10 px-1 py-0.5 rounded">
                  always on
                </span>
              </span>
              <div className="relative w-8 h-4 rounded-full bg-accent opacity-50 cursor-not-allowed">
                <span className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white translate-x-4" />
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Optional notifications */}
      <div>
        <h5 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">
          Optional
        </h5>
        <div className="space-y-1.5">
          {NOTIFICATION_CATEGORIES.filter(c => !c.critical).map(cat => {
            const isEnabled = enabledCategories.has(cat.id);
            return (
              <label key={cat.id} className="flex items-center justify-between py-1 cursor-pointer">
                <span className="flex items-center gap-2 text-xs text-th-text-alt">
                  <span>{cat.icon}</span>
                  {cat.label}
                </span>
                <button
                  onClick={() => toggleCategory(cat.id, false)}
                  data-testid={`telegram-notif-${cat.id}`}
                  aria-label={`${isEnabled ? 'Disable' : 'Enable'} ${cat.label} notifications`}
                  role="switch"
                  aria-checked={isEnabled}
                  className={`relative w-8 h-4 rounded-full transition-colors ${
                    isEnabled ? 'bg-accent' : 'bg-th-bg-hover'
                  }`}
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

      {/* Quiet hours */}
      <div>
        <label className="flex items-center justify-between mb-2">
          <span className="text-xs text-th-text-muted flex items-center gap-1.5">
            <BellOff className="w-3 h-3" /> Quiet Hours
          </span>
          <button
            onClick={() => setQuietHours(prev => ({ ...prev, enabled: !prev.enabled }))}
            data-testid="telegram-quiet-toggle"
            aria-label={quietHours.enabled ? 'Disable quiet hours' : 'Enable quiet hours'}
            role="switch"
            aria-checked={quietHours.enabled}
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
          <>
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
            <p className="text-[10px] text-th-text-muted mt-1.5">
              ⚠️ Critical notifications (crashes, approvals) are always delivered during quiet hours.
            </p>
          </>
        )}
      </div>

      {/* Rate limit */}
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

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded" role="alert">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-alt transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleFinish}
          disabled={saving}
          data-testid="telegram-finish-btn"
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold disabled:opacity-50 hover:bg-accent-muted transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          {saving ? 'Saving…' : 'Complete Setup ✓'}
        </button>
      </div>
    </div>
  );
}
