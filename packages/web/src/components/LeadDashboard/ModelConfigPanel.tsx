import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, RotateCcw, Save, Loader2, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { deriveModelName } from '../../hooks/useModels';
import { getProviderColors } from '../../utils/providerColors';
import { getProvider } from '@flightdeck/shared';

/** Role ID → allowed model IDs */
export type ModelConfigMap = Record<string, string[]>;

interface ModelConfigResponse {
  config: ModelConfigMap;
  defaults: ModelConfigMap;
}

interface ModelsListResponse {
  models: string[];
  defaults: ModelConfigMap;
  modelsByProvider?: Record<string, string[]>;
}

/** Human-readable display names derived from model IDs */
const modelName = deriveModelName;

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

/** Provider tab label — derived from central ProviderRegistry. */
function getProviderLabel(id: string): string {
  return getProvider(id)?.name.replace(/ \(ACP\)$/, '').replace(/^Google /, '').replace(/^GitHub /, '') ?? id;
}

interface Props {
  /** Project ID — if provided, loads/saves config for this project */
  projectId?: string;
  /** Inline mode for project creation (no save button, uses onChange) */
  value?: ModelConfigMap;
  onChange?: (config: ModelConfigMap) => void;
  /** Compact mode for sidebar */
  compact?: boolean;
}

/** Deep-compare two ModelConfigMaps (order-insensitive per-role) */
function configsEqual(a: ModelConfigMap, b: ModelConfigMap): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in b)) return false;
    const listA = [...(a[key] ?? [])].sort();
    const listB = [...(b[key] ?? [])].sort();
    if (listA.length !== listB.length) return false;
    if (listA.some((v, i) => v !== listB[i])) return false;
  }
  return true;
}

export function ModelConfigPanel({ projectId, value, onChange, compact }: Props) {
  const [config, setConfig] = useState<ModelConfigMap>(value ?? {});
  const [savedConfig, setSavedConfig] = useState<ModelConfigMap>(value ?? {});
  const [defaults, setDefaults] = useState<ModelConfigMap>({});
  const [allModels, setAllModels] = useState<string[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [providerTab, setProviderTab] = useState<string>('copilot');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => !configsEqual(config, savedConfig), [config, savedConfig]);

  // Fetch available models and defaults
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const modelsData = await apiFetch<ModelsListResponse>('/models');
        setAllModels(modelsData.models);
        setDefaults(modelsData.defaults);
        if (modelsData.modelsByProvider) {
          setModelsByProvider(modelsData.modelsByProvider);
        }
        if (!value && !projectId) {
          setConfig(modelsData.defaults);
          setSavedConfig(modelsData.defaults);
        }
      } catch {
        setError('Failed to load models');
      } finally {
        if (!projectId) setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // Fetch project-specific config if projectId is provided
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    apiFetch<ModelConfigResponse>(`/projects/${projectId}/model-config`)
      .then((data) => {
        setConfig(data.config);
        setSavedConfig(data.config);
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

  const discardChanges = useCallback(() => {
    setConfig(savedConfig);
    onChange?.(savedConfig);
    setSaved(false);
  }, [savedConfig, onChange]);

  const saveConfig = useCallback(async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/model-config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      setSavedConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to save');
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
      {/* Sticky header: title, actions, and provider tabs */}
      <div className="sticky top-0 z-10 bg-th-bg pb-1" data-testid="allowlist-sticky-header">
        {/* Header with actions */}
        {projectId && (
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-th-text-muted font-medium">Model Allowlist</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={resetToDefaults}
                className="flex items-center gap-0.5 px-1.5 py-0.5 text-th-text-muted hover:text-th-text-alt rounded transition-colors"
                title="Reset to defaults"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              {(isDirty || saving || saved) && (
                <>
                  <button
                    onClick={discardChanges}
                    disabled={saving}
                    className="flex items-center gap-0.5 px-2 py-0.5 rounded transition-colors bg-th-bg-hover hover:bg-th-bg-alt text-th-text-muted hover:text-th-text-alt"
                    data-testid="discard-changes"
                  >
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                  <button
                    onClick={saveConfig}
                    disabled={saving}
                    className={`flex items-center gap-0.5 px-2 py-0.5 rounded transition-colors ${
                      saved
                        ? 'bg-green-600/20 text-green-400'
                        : 'bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-600 dark:text-yellow-400'
                    }`}
                    data-testid="save-config"
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
                </>
              )}
            </div>
          </div>
        )}

        {error && <div className="px-1 text-red-400 text-[10px]">{error}</div>}

        {/* Provider tabs */}
        <div className="flex gap-1 px-1 border-b border-th-border pb-1 overflow-x-auto"
             style={{ scrollbarWidth: 'thin' }}>
          {Object.keys(modelsByProvider).length > 0
            ? Object.entries(modelsByProvider).map(([providerId, providerModels]) => {
                const tabModels = allModels.filter((m) => providerModels.includes(m));
                if (tabModels.length === 0) return null;
                const isActive = providerTab === providerId;
                const label = getProviderLabel(providerId);
                const colors = getProviderColors(providerId);
                return (
                  <button
                    key={providerId}
                    onClick={() => setProviderTab(providerId)}
                    className={`px-2 py-0.5 rounded-t text-[10px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                      isActive
                        ? `${colors.text} border-current bg-th-bg-alt`
                        : 'text-th-text-muted border-transparent hover:text-th-text-alt'
                    }`}
                  >
                    {label}
                    <span className="ml-1 opacity-60">({tabModels.length})</span>
                  </button>
                );
              })
            : /* Fallback: show a single "All" tab when backend hasn't responded */
              <button className="px-2 py-0.5 rounded-t text-[10px] font-medium border-b-2 text-th-text-muted border-current bg-th-bg-alt">
                All ({allModels.length})
              </button>
          }
        </div>
      </div>

      {/* Role → Model grid for selected provider tab */}
      <div className="space-y-1.5">
        {CONFIG_ROLES.map((roleId) => {
          const allowedModels = config[roleId] ?? defaults[roleId] ?? [];
          const providerModelSet = modelsByProvider[providerTab];
          const visibleModels = providerModelSet
            ? allModels.filter((m) => providerModelSet.includes(m))
            : allModels;
          if (visibleModels.length === 0) return null;
          return (
            <div key={roleId} className="px-1">
              <div className="text-th-text-alt font-medium mb-0.5">
                {ROLE_NAMES[roleId] || roleId}
              </div>
              <div className="flex flex-wrap gap-1">
                {visibleModels.map((modelId) => {
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
                      title={modelName(modelId)}
                    >
                      {compact
                        ? modelId.replace('claude-', '').replace(/^gemini-/, 'g-').replace('gpt-', 'g')
                        : modelName(modelId)}
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
