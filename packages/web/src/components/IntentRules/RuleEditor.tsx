import { useState, useMemo } from 'react';
import { ACTION_DISPLAY, CONDITION_LABELS, CONDITION_UNITS, type IntentRule, type RuleAction, type IntentCondition, type ConditionType, type ConditionOp } from './types';
import { CATEGORY_LABELS } from '../../constants/categories';

interface RuleEditorProps {
  rule?: IntentRule;
  onSave: (rule: IntentRule) => void;
  onCancel: () => void;
}

const ACTIONS: RuleAction[] = ['allow', 'alert', 'require-review'];
const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS);
const CONDITION_TYPES: ConditionType[] = ['file_count', 'cost_estimate', 'time_elapsed', 'context_usage'];

export function RuleEditor({ rule, onSave, onCancel }: RuleEditorProps) {
  const [action, setAction] = useState<RuleAction>(rule?.action ?? 'allow');
  const [categories, setCategories] = useState<string[]>(rule?.match.categories ?? []);
  const [scopeType, setScopeType] = useState<'all' | 'roles'>(
    rule?.match.roles && rule.match.roles.length > 0 ? 'roles' : 'all',
  );
  const [roles, setRoles] = useState<string[]>(rule?.match.roles ?? []);
  const [conditions, setConditions] = useState<IntentCondition[]>(rule?.conditions ?? []);
  const [name, setName] = useState(rule?.name ?? '');

  // Auto-generate name from selections
  const autoName = useMemo(() => {
    const actionLabel = ACTION_DISPLAY[action].label;
    const cats = categories.length > 0 ? categories.join(', ') : 'all';
    const scope = scopeType === 'roles' && roles.length > 0 ? `from ${roles.join(', ')}` : '';
    return `${actionLabel} ${cats} ${scope}`.trim();
  }, [action, categories, scopeType, roles]);

  const displayName = name || autoName;

  function handleSave() {
    const saved: IntentRule = {
      id: rule?.id ?? `rule-${Date.now()}`,
      name: displayName,
      enabled: rule?.enabled ?? true,
      priority: rule?.priority ?? 0,
      action,
      match: {
        categories,
        roles: scopeType === 'roles' ? roles : undefined,
      },
      conditions: conditions.length > 0 ? conditions : undefined,
      metadata: rule?.metadata ?? {
        source: 'manual',
        matchCount: 0,
        lastMatchedAt: null,
        effectivenessScore: null,
        issuesAfterMatch: 0,
        createdAt: new Date().toISOString(),
      },
    };
    onSave(saved);
  }

  function addCondition() {
    setConditions([...conditions, { type: 'file_count', operator: 'lt', value: 50 }]);
  }

  function removeCondition(index: number) {
    setConditions(conditions.filter((_, i) => i !== index));
  }

  function updateCondition(index: number, patch: Partial<IntentCondition>) {
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function toggleCategory(cat: string) {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  return (
    <div className="space-y-3 pt-3" data-testid="rule-editor">
      {/* Action */}
      <div>
        <label className="text-[10px] text-th-text-muted">Action</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as RuleAction)}
          className="mt-0.5 w-full text-xs bg-th-bg-alt border border-th-border rounded-md px-2 py-1"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_DISPLAY[a].icon} {ACTION_DISPLAY[a].label}</option>
          ))}
        </select>
      </div>

      {/* Categories */}
      <div>
        <label className="text-[10px] text-th-text-muted">Categories</label>
        <div className="flex flex-wrap gap-1 mt-1">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                categories.includes(cat)
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'border-th-border text-th-text-muted hover:text-th-text'
              }`}
            >
              {CATEGORY_LABELS[cat] ?? cat}
              {categories.includes(cat) && ' ✕'}
            </button>
          ))}
        </div>
      </div>

      {/* Scope */}
      <div>
        <label className="text-[10px] text-th-text-muted">From</label>
        <div className="flex gap-3 mt-1">
          <label className="flex items-center gap-1 text-xs text-th-text-alt">
            <input
              type="radio"
              checked={scopeType === 'all'}
              onChange={() => setScopeType('all')}
              className="w-3 h-3"
            />
            All agents
          </label>
          <label className="flex items-center gap-1 text-xs text-th-text-alt">
            <input
              type="radio"
              checked={scopeType === 'roles'}
              onChange={() => setScopeType('roles')}
              className="w-3 h-3"
            />
            Specific roles
          </label>
        </div>
        {scopeType === 'roles' && (
          <input
            type="text"
            value={roles.join(', ')}
            onChange={(e) => setRoles(e.target.value.split(',').map((r) => r.trim()).filter(Boolean))}
            placeholder="developer, qa_tester"
            className="mt-1 w-full text-xs bg-th-bg-alt border border-th-border rounded-md px-2 py-1"
          />
        )}
      </div>

      {/* Conditions */}
      <div>
        <label className="text-[10px] text-th-text-muted">Conditions (optional)</label>
        {conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-1.5 mt-1">
            <select
              value={cond.type}
              onChange={(e) => updateCondition(i, { type: e.target.value as ConditionType })}
              className="text-[10px] bg-th-bg-alt border border-th-border rounded px-1.5 py-0.5"
            >
              {CONDITION_TYPES.map((t) => (
                <option key={t} value={t}>{CONDITION_LABELS[t]}</option>
              ))}
            </select>
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOp })}
              className="text-[10px] bg-th-bg-alt border border-th-border rounded px-1.5 py-0.5"
            >
              <option value="lt">under</option>
              <option value="gt">over</option>
              <option value="between">between</option>
            </select>
            <input
              type="number"
              value={cond.value}
              onChange={(e) => updateCondition(i, { value: Number(e.target.value) })}
              className="w-16 text-[10px] bg-th-bg-alt border border-th-border rounded px-1.5 py-0.5"
            />
            <span className="text-[9px] text-th-text-muted">{CONDITION_UNITS[cond.type]}</span>
            <button onClick={() => removeCondition(i)} className="text-red-400 text-[10px]">✕</button>
          </div>
        ))}
        <button onClick={addCondition} className="text-[10px] text-accent hover:underline mt-1">
          + Add condition
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="text-[10px] text-th-text-muted">Rule name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={autoName}
          className="mt-0.5 w-full text-xs bg-th-bg-alt border border-th-border rounded-md px-2 py-1"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-[11px] px-2.5 py-1 rounded-md border border-th-border text-th-text-muted hover:text-th-text"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={categories.length === 0}
          className="text-[11px] px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
        >
          Save Rule
        </button>
      </div>
    </div>
  );
}
