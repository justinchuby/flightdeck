import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { TrustPresetBar } from './TrustPresetBar';
import { RuleRow } from './RuleRow';
import { RuleEditor } from './RuleEditor';
import { type IntentRule, type TrustPreset } from './types';

export function IntentRulesDashboard() {
  const [rules, setRules] = useState<IntentRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePreset, setActivePreset] = useState<TrustPreset | null>('autonomous');
  const [creating, setCreating] = useState(false);

  // Fetch rules directly — backend returns the same shape
  const fetchRules = useCallback(async () => {
    try {
      const data = await apiFetch<IntentRule[]>('/intents');
      setRules(Array.isArray(data) ? data : []);
    } catch { /* rules stay empty */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Toggle rule enabled/disabled
  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      await apiFetch(`/intents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch { fetchRules(); }
  }, [fetchRules]);

  // Delete rule
  const handleDelete = useCallback(async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiFetch(`/intents/${id}`, { method: 'DELETE' });
    } catch { fetchRules(); }
  }, [fetchRules]);

  // Save rule (create or update)
  const handleSave = useCallback(async (rule: IntentRule) => {
    const isNew = !rules.find((r) => r.id === rule.id);
    if (isNew) {
      try {
        await apiFetch('/intents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: rule.match.categories[0] ?? 'general',
            name: rule.name,
            action: rule.action,
            roles: rule.match.roles,
            conditions: rule.conditions,
            priority: rule.priority,
          }),
        });
        setCreating(false);
        fetchRules();
      } catch { /* keep editor open */ }
    } else {
      try {
        await apiFetch(`/intents/${rule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: rule.name,
            action: rule.action,
            roles: rule.match.roles,
            conditions: rule.conditions,
            priority: rule.priority,
            enabled: rule.enabled,
          }),
        });
        fetchRules();
      } catch { /* optimistic update stays */ }
    }
  }, [rules, fetchRules]);

  // Apply preset
  const handlePreset = useCallback(async (preset: TrustPreset) => {
    setActivePreset(preset);
    try {
      await apiFetch(`/intents/presets/${preset}`, { method: 'POST' });
      fetchRules();
    } catch { /* preset failed */ }
  }, [fetchRules]);

  // Summary stats
  const enabledCount = rules.filter((r) => r.enabled).length;
  const totalMatches = rules.reduce((s, r) => s + r.metadata.matchCount, 0);
  const avgEffectiveness = (() => {
    const scored = rules.filter((r) => r.metadata.effectivenessScore != null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, r) => s + (r.metadata.effectivenessScore ?? 0), 0) / scored.length);
  })();

  if (loading) {
    return <div className="text-xs text-th-text-muted p-4">Loading intent rules...</div>;
  }

  return (
    <div className="space-y-3" data-testid="intent-rules-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
          🎯 Intent Rules
        </h3>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          <Plus size={12} /> New Rule
        </button>
      </div>

      {/* Trust presets */}
      <TrustPresetBar active={activePreset} onSelect={handlePreset} />

      {/* Create new rule */}
      {creating && (
        <div className="border border-accent/30 rounded-lg p-3 bg-accent/5">
          <p className="text-xs font-medium text-th-text-alt mb-1">New Intent Rule</p>
          <RuleEditor onSave={handleSave} onCancel={() => setCreating(false)} />
        </div>
      )}

      {/* Rules table */}
      {rules.length > 0 ? (
        <div className="border border-th-border rounded-lg overflow-hidden">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onSave={handleSave}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-xs text-th-text-muted">
            No intent rules yet. Create one or apply a trust preset to get started.
          </p>
        </div>
      )}

      {/* Summary */}
      {rules.length > 0 && (
        <p className="text-[10px] text-th-text-muted">
          📊 {enabledCount} rules active • {totalMatches} total matches
          {avgEffectiveness != null && ` • ${avgEffectiveness}% effective`}
        </p>
      )}
    </div>
  );
}
