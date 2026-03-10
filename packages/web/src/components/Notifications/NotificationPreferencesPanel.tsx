import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import {
  CHANNEL_DISPLAY, EVENT_LABELS, EVENT_DESCRIPTIONS, PRESET_DEFAULTS, ROUTING_ALL_OFF,
  type NotificationChannel, type ChannelType, type NotifiableEvent, type PresetName,
} from './types';

const ALL_EVENTS = Object.keys(EVENT_LABELS) as NotifiableEvent[];
const CHANNEL_ORDER: ChannelType[] = ['desktop', 'slack', 'telegram'];

export function NotificationPreferencesPanel() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [routing, setRouting] = useState<Record<NotifiableEvent, ChannelType[]>>({} as any);
  const [preset, setPreset] = useState<PresetName>('conservative');
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [loading, setLoading] = useState(true);

  // Load settings
  useEffect(() => {
    Promise.all([
      apiFetch<unknown>('/notifications/channels').catch(() => []),
      apiFetch<unknown>('/notifications/routing').catch(() => ({
        routing: ROUTING_ALL_OFF,
        preset: 'conservative',
      })),
    ]).then(([channelsRaw, routingRaw]) => {
      // Defensive: API may return [] or { channels: [] }
      const ch = Array.isArray(channelsRaw) ? channelsRaw : (channelsRaw as any)?.channels ?? [];
      setChannels(ch);
      const rd = routingRaw as any;
      setRouting(rd?.routing ?? ROUTING_ALL_OFF);
      setPreset(rd?.preset ?? 'conservative');
    }).finally(() => setLoading(false));
  }, []);

  const enabledChannelTypes = channels.filter((c) => c.enabled).map((c) => c.type);

  const toggleRouting = useCallback((event: NotifiableEvent, channelType: ChannelType) => {
    setRouting((prev) => {
      const current = prev[event] ?? [];
      const next = current.includes(channelType)
        ? current.filter((c) => c !== channelType)
        : [...current, channelType];
      return { ...prev, [event]: next };
    });
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    setPreset(name);
    setRouting(PRESET_DEFAULTS[name]);
  }, []);

  const toggleChannel = useCallback((channelId: string) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === channelId ? { ...c, enabled: !c.enabled } : c)),
    );
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await apiFetch('/notifications/settings', {
        method: 'PUT',
        body: JSON.stringify({
          channels, routing, preset,
          quietHours: quietEnabled ? { start: quietStart, end: quietEnd } : null,
        }),
      });
    } catch { /* best effort */ }
  }, [channels, routing, preset, quietEnabled, quietStart, quietEnd]);

  if (loading) {
    return <div className="text-xs text-th-text-muted p-4">Loading notification settings...</div>;
  }

  return (
    <div className="space-y-6" data-testid="notification-preferences">
      <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
        <Bell className="w-3.5 h-3.5" />
        Notification Settings
      </h3>

      {/* Channels section */}
      <div>
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">Channels</h3>
        <div className="space-y-2">
          {channels.length === 0 ? (
            // Show default channel cards when none configured
            CHANNEL_ORDER.map((type) => {
              const display = CHANNEL_DISPLAY[type];
              return (
                <ChannelCard
                  key={type}
                  icon={display.icon}
                  label={display.label}
                  description={display.description}
                  enabled={false}
                  onToggle={() => {}}
                  actionLabel="Set Up →"
                />
              );
            })
          ) : (
            channels.map((ch) => {
              const display = CHANNEL_DISPLAY[ch.type];
              return (
                <ChannelCard
                  key={ch.id}
                  icon={display.icon}
                  label={display.label}
                  description={display.description}
                  enabled={ch.enabled}
                  onToggle={() => toggleChannel(ch.id)}
                  actionLabel={ch.enabled ? 'Configure →' : 'Connect →'}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Event routing matrix */}
      <div>
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">Event Routing</h3>
        <p className="text-[10px] text-th-text-muted mb-3">Which events go where?</p>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-th-border">
                <th className="text-left py-1.5 pr-4 text-th-text-muted font-medium">Event</th>
                {CHANNEL_ORDER.map((type) => (
                  <th key={type} className="text-center px-2 py-1.5 text-th-text-muted font-medium capitalize">
                    {CHANNEL_DISPLAY[type].icon}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_EVENTS.map((event) => (
                <tr key={event} className="border-b border-th-border/30 hover:bg-th-bg-hover/30">
                  <td className="py-1.5 pr-4">
                    <span className="text-th-text-alt">{EVENT_LABELS[event]}</span>
                    <p className="text-[9px] text-th-text-muted leading-tight mt-0.5">{EVENT_DESCRIPTIONS[event]}</p>
                  </td>
                  {CHANNEL_ORDER.map((type) => {
                    const isEnabled = enabledChannelTypes.includes(type);
                    const isChecked = (routing[event] ?? []).includes(type);
                    return (
                      <td key={type} className="text-center px-2 py-1.5">
                        {isEnabled || channels.length === 0 ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleRouting(event, type)}
                            className="w-3.5 h-3.5 accent-accent rounded"
                          />
                        ) : (
                          <span className="text-th-text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Presets */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[10px] text-th-text-muted">Presets:</span>
          {(['conservative', 'moderate', 'everything'] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-2.5 py-1 text-[10px] rounded-full transition-colors capitalize ${
                preset === p
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-th-bg border border-th-border text-th-text-muted hover:text-th-text'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Quiet hours */}
      <div>
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">Quiet Hours</h3>
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={quietEnabled}
            onChange={() => setQuietEnabled(!quietEnabled)}
            className="w-3.5 h-3.5 accent-accent rounded"
          />
          <span className="text-[11px] text-th-text-alt">
            Suppress external notifications during quiet hours
          </span>
        </label>
        {quietEnabled && (
          <div className="flex items-center gap-2 text-[11px] text-th-text-muted ml-5">
            <input
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              className="bg-th-bg border border-th-border rounded px-2 py-1 text-th-text"
            />
            <span>—</span>
            <input
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              className="bg-th-bg border border-th-border rounded px-2 py-1 text-th-text"
            />
            <span className="text-[10px]">(In-app notifications still appear)</span>
          </div>
        )}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="px-4 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent/90"
      >
        Save Settings
      </button>
    </div>
  );
}

function ChannelCard({ icon, label, description, enabled, onToggle, actionLabel }: {
  icon: string; label: string; description: string; enabled: boolean; onToggle: () => void; actionLabel: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 border border-th-border rounded-lg ${enabled ? '' : 'opacity-60'}`}>
      <span className="text-lg">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-th-text-alt font-medium">{label}</p>
        <p className="text-[10px] text-th-text-muted">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={onToggle} className="sr-only" />
        <div className={`w-8 h-4 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-th-bg-alt'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
      </label>
      <button className="text-[10px] text-accent hover:underline ml-2">{actionLabel}</button>
    </div>
  );
}
