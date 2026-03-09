import { useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { RolePreview } from './RolePreview';

interface RoleData {
  id?: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  model: string;
  systemPrompt: string;
}

interface Props {
  initial?: RoleData;
  onSave: (role: RoleData) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const CURATED_ICONS = [
  '🔒', '🛡', '🗄', '📊', '🎯', '🔬', '📝', '🧪', '🧠', '🎨',
  '📐', '🔧', '⚡', '🌐', '📡', '🤝', '🗂', '📦', '🔍', '✏️',
  '🏗', '💻', '🔮', '📈', '🧹', '🛠', '🪄', '🎓', '📖', '🗣',
  '🤖', '👁', '🧩', '🎭', '🕵', '💡', '🔋', '🦾', '🧬', '📱',
  '🔑', '🪪', '🧮', '📚', '🔄', '⚙', '💬', '🗺', '🎪', '🧲',
];

const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#64748b', '#a855f7',
];

const PROMPT_TEMPLATES: Record<string, { label: string; prompt: string }> = {
  security: {
    label: 'Security Specialist',
    prompt:
      'You are a security auditor specializing in web app security. Focus on: OWASP Top 10, authentication flows, data validation, secrets management, and dependency vulnerabilities. Flag issues by severity (P0-P3).',
  },
  database: {
    label: 'Database Expert',
    prompt:
      'You are a database specialist. Focus on: schema design, query optimization, indexing strategies, migrations, and data integrity. Review SQL patterns and suggest performance improvements.',
  },
  api: {
    label: 'API Designer',
    prompt:
      'You are an API design expert. Focus on: RESTful patterns, GraphQL schemas, versioning strategies, documentation, and backward compatibility. Ensure consistent naming conventions.',
  },
  performance: {
    label: 'Performance Engineer',
    prompt:
      'You are a performance engineer. Focus on: profiling, optimization, benchmarking, memory management, and scalability. Identify bottlenecks and suggest targeted improvements.',
  },
  devops: {
    label: 'DevOps/CI',
    prompt:
      'You are a DevOps engineer. Focus on: CI/CD pipelines, deployment strategies, containerization, monitoring, alerting, and infrastructure as code. Ensure reliable and reproducible builds.',
  },
  blank: {
    label: 'Blank',
    prompt: '',
  },
};

const MODELS = [
  { id: 'opus', name: 'Opus', quality: 5, speed: 'Best quality' },
  { id: 'sonnet', name: 'Sonnet', quality: 4, speed: 'Balanced' },
  { id: 'haiku', name: 'Haiku', quality: 3, speed: 'Fastest' },
];

export function RoleBuilder({ initial, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [icon, setIcon] = useState(initial?.icon || '🤖');
  const [color, setColor] = useState(initial?.color || COLOR_PALETTE[0]);
  const [model, setModel] = useState(initial?.model || 'sonnet');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || '');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const wordCount = systemPrompt
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const tokenEstimate = Math.round(wordCount * 1.4);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const role: RoleData = { id: initial?.id, name, description, icon, color, model, systemPrompt };
      if (initial?.id) {
        await apiFetch(`/roles/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify(role),
        });
      } else {
        await apiFetch('/roles', {
          method: 'POST',
          body: JSON.stringify(role),
        });
      }
      onSave(role);
    } catch {
      /* save failed — button resets */
    } finally {
      setSaving(false);
    }
  }, [initial, name, description, icon, color, model, systemPrompt, onSave]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ response: string }>('/roles/test', {
        method: 'POST',
        body: JSON.stringify({
          role: { name, description, icon, color, model, systemPrompt },
          message: 'Hello, introduce yourself.',
        }),
      });
      setTestResult(res.response || 'No response received.');
    } catch {
      setTestResult('Test failed.');
    } finally {
      setTesting(false);
    }
  }, [name, description, icon, color, model, systemPrompt]);

  const handleDelete = useCallback(async () => {
    if (!initial?.id || !onDelete) return;
    setDeleting(true);
    try {
      await apiFetch(`/roles/${initial.id}`, { method: 'DELETE' });
      onDelete();
    } finally {
      setDeleting(false);
    }
  }, [initial, onDelete]);

  return (
    <div className="space-y-4 max-w-2xl motion-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-th-text">
          🎭 {initial?.id ? 'Edit Role' : 'Create Custom Role'}
        </h3>
        <button
          onClick={onCancel}
          className="text-th-text-muted hover:text-th-text text-sm"
        >
          ✕
        </button>
      </div>

      {/* IDENTITY */}
      <section className="space-y-3">
        <div className="text-xs text-th-text-muted uppercase tracking-wider">
          Identity
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowIconPicker(!showIconPicker)}
              className="w-12 h-12 rounded-lg border border-th-border flex items-center justify-center text-2xl hover:border-accent transition-colors"
              style={{ backgroundColor: color + '20' }}
            >
              {icon}
            </button>
            {showIconPicker && (
              <div
                className="absolute top-14 left-0 z-20 bg-th-bg border border-th-border rounded-lg p-2 shadow-lg grid grid-cols-10 gap-1 w-72"
                role="radiogroup"
              >
                {CURATED_ICONS.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      setIcon(e);
                      setShowIconPicker(false);
                    }}
                    className={`w-6 h-6 text-sm rounded hover:bg-th-bg-alt ${icon === e ? 'ring-2 ring-accent' : ''}`}
                    role="radio"
                    aria-checked={icon === e}
                    aria-label={e}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Role name"
          className="w-full px-3 py-2 text-sm bg-th-bg-alt border border-th-border rounded-lg text-th-text focus:outline-none focus:border-accent"
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="w-full px-3 py-2 text-sm bg-th-bg-alt border border-th-border rounded-lg text-th-text focus:outline-none focus:border-accent resize-none"
          rows={2}
        />
      </section>

      {/* MODEL */}
      <section className="space-y-3">
        <div className="text-xs text-th-text-muted uppercase tracking-wider">
          Model
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`p-3 rounded-lg border text-left transition-colors ${
                model === m.id
                  ? 'border-accent bg-accent/10'
                  : 'border-th-border-muted hover:border-th-border'
              }`}
            >
              <div className="text-xs font-medium text-th-text">
                {model === m.id ? '◉' : '○'} {m.name}
              </div>
              <div className="text-[10px] text-th-text-muted">{m.speed}</div>
              <div className="text-[10px] text-yellow-400">
                {'⭐'.repeat(m.quality)}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* BEHAVIOR */}
      <section className="space-y-3">
        <div className="text-xs text-th-text-muted uppercase tracking-wider">
          Behavior
        </div>

        <select
          onChange={(e) => {
            const t = PROMPT_TEMPLATES[e.target.value];
            if (t) setSystemPrompt(t.prompt);
          }}
          className="text-xs bg-th-bg-alt border border-th-border rounded px-2 py-1.5 text-th-text w-full"
        >
          <option value="">Start from a template...</option>
          {Object.entries(PROMPT_TEMPLATES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt..."
          className="w-full px-3 py-2 text-sm bg-th-bg-alt border border-th-border rounded-lg text-th-text font-mono focus:outline-none focus:border-accent resize-none"
          rows={6}
        />
        <div className="text-[10px] text-th-text-muted">
          {wordCount} words (~{tokenEstimate} tokens)
        </div>
      </section>

      {/* PREVIEW */}
      <section className="space-y-2">
        <div className="text-xs text-th-text-muted uppercase tracking-wider">
          Preview
        </div>
        <RolePreview
          icon={icon}
          name={name || 'New Role'}
          model={model}
          color={color}
          description={description}
        />
        <div className="text-[10px] text-th-text-muted italic">
          This is how your role will appear in the crew
        </div>
      </section>

      {/* Test result */}
      {testResult && (
        <div className="bg-th-bg-alt border border-th-border rounded-lg p-3 text-xs text-th-text">
          <div className="text-[10px] text-th-text-muted mb-1">
            Test Response:
          </div>
          {testResult}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-th-border">
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 text-th-text-muted hover:text-th-text transition-colors"
          >
            Cancel
          </button>
          {initial?.id && onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={testing || !name}
            className="text-xs px-3 py-1.5 border border-th-border rounded-md text-th-text hover:bg-th-bg-alt disabled:opacity-50 transition-colors"
          >
            {testing ? 'Testing…' : 'Test Role ▸'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name}
            className="text-xs px-4 py-1.5 bg-accent text-white rounded-md hover:bg-accent/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Role →'}
          </button>
        </div>
      </div>
    </div>
  );
}
