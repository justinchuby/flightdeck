import { useState, useEffect, useCallback } from 'react';
import { Check, RotateCcw, Save, Loader2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

/** Role ID → allowed model IDs */
export type ModelConfigMap = Record<string, string[]>;

interface ModelConfigResponse {
  config: ModelConfigMap;
  defaults: ModelConfigMap;
}

interface ModelsListResponse {
  models: string[];
  defaults: ModelConfigMap;
}

/** Human-readable display names for model IDs */
const MODEL_NAMES: Record<string, string> = {
  'claude-opus-4.6': 'Claude Opus 4.6',
  'claude-opus-4.5': 'Claude Opus 4.5',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-haiku-4.5': 'Claude Haiku 4.5',
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.1-codex-max': 'GPT-5.1 Codex Max',
  'gpt-5.1-codex': 'GPT-5.1 Codex',
  'gpt-5.1': 'GPT-5.1',
  'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-4.1': 'GPT-4.1',
};

/** Role display names */
const ROLE_NAMES: Record<string, string> = {
  developer: 'Developer',
  architect: 'Architect',
  'code-reviewer': 'Code Reviewer',
  'critical-reviewer': 'Critical Reviewer',
  'readability-reviewer': 'Readability Reviewer',
  'tech-writer': 'Tech Writer',
  secretary: 'Secretary',
  'qa-tester': 'QA Tester',
  designer: 'Designer',
  'product-manager': 'Product Manager',
  generalist: 'Generalist',
  'radical-thinker': 'Radical Thinker',
  agent: 'Agent',
  lead: 'Project Lead',
};

/** Roles shown in config UI, in display order */
const CONFIG_ROLES = [
  'developer',
  'architect',
  'code-reviewer',
  'critical-reviewer',
  'readability-reviewer',
  'tech-writer',
  'secretary',
  'qa-tester',
  'designer',
  'product-manager',
  'generalist',
  'radical-thinker',
  'agent',
  'lead',
];

interface Props {
  /** Project ID — if provided, loads/saves config for this project */
  projectId?: string;
  /** Inline mode for project creation (no save button, uses onChange) */
  value?: ModelConfigMap;
  onChange?: (config: ModelConfigMap) => void;
  /** Compact mode for sidebar */
  compact?: boolean;
}

export function ModelConfigPanel({ projectId, value, onChange, compact }: Props) {
  const [config, setConfig] = useState<ModelConfigMap>(value ?? {});
  const [defaults, setDefaults] = useState<ModelConfigMap>({});
  const [allModels, setAllModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available models and defaults
  useEffect(() => {
    apiFetch<ModelsListResponse>('/models')
      .then((data) => {
        setAllModels(data.models);
        setDefaults(data.defaults);
        if (!value && !projectId) {
          setConfig(data.defaults);
        }
      })
      .catch(() => setError('Failed to load models'))
      .finally(() => {
        if (!projectId) setLoading(false);
      });
  }, []);

  // Fetch project-specific config if projectId is provided
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    apiFetch<ModelConfigResponse>(`/projects/${projectId}/model-config`)
      .then((data) => {
        setConfig(data.config);
        setDefaults(data.defaults);
      })
      .catch(() => setError('Failed to load project model config'))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Sync external value prop
  useEffect(() => {
    if (value) setConfig(value);
  }, [value]);

  const toggleModel = useCallback((roleId: string, modelId: string) => {
    setConfig((prev) => {
      const current = prev[roleId] ?? defaults[roleId] ?? [];
      const next = current.includes(modelId)
        ? current.filter((m) => m !== modelId)
        : [...current, modelId];
      // Ensure at least one model is selected
      if (next.length === 0) return prev;
      const updated = { ...prev, [roleId]: next };
      onChange?.(updated);
      setSaved(false);
      return updated;
    });
  }, [defaults, onChange]);

  const resetToDefaults = useCallback(() => {
    setConfig(defaults);
    onChange?.(defaults);
    setSaved(false);
  }, [defaults, onChange]);

  const saveConfig = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/model-config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [projectId, config]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-th-text-muted text-xs">
        <Loader2 className="w-3 h-3 animate-spin mr-1" /> Loading models...
      </div>
    );
  }

  if (error && allModels.length === 0) {
    return <div className="p-3 text-xs text-red-400">{error}</div>;
  }

  return (
    <div className={`${compact ? 'text-[11px]' : 'text-xs'} space-y-2`}>
      {/* Header with actions */}
      {projectId && (
        <div className="flex items-center justify-between px-1">
          <span className="text-th-text-muted font-medium">Model Allowlist</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={resetToDefaults}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-th-text-muted hover:text-th-text-alt rounded transition-colors"
              title="Reset to defaults"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            <button
              onClick={saveConfig}
              disabled={saving}
              className={`flex items-center gap-0.5 px-2 py-0.5 rounded transition-colors ${
                saved
                  ? 'bg-green-600/20 text-green-400'
                  : 'bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-600 dark:text-yellow-400'
              }`}
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : saved ? (
                <Check className="w-3 h-3" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="px-1 text-red-400 text-[10px]">{error}</div>}

      {/* Role → Model grid */}
      <div className="space-y-1.5">
        {CONFIG_ROLES.map((roleId) => {
          const allowedModels = config[roleId] ?? defaults[roleId] ?? [];
          return (
            <div key={roleId} className="px-1">
              <div className="text-th-text-alt font-medium mb-0.5">
                {ROLE_NAMES[roleId] || roleId}
              </div>
              <div className="flex flex-wrap gap-1">
                {allModels.map((modelId) => {
                  const isSelected = allowedModels.includes(modelId);
                  return (
                    <button
                      key={modelId}
                      onClick={() => toggleModel(roleId, modelId)}
                      className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                        isSelected
                          ? 'bg-yellow-600/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-200'
                          : 'bg-th-bg border-th-border text-th-text-muted hover:border-th-border-hover opacity-50'
                      }`}
                      title={MODEL_NAMES[modelId] || modelId}
                    >
                      {compact
                        ? modelId.replace('claude-', '').replace('gemini-3-pro-preview', 'gemini-3').replace('gpt-', 'g')
                        : MODEL_NAMES[modelId] || modelId}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
