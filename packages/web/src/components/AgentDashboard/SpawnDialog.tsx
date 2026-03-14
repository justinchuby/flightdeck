import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useModels, deriveModelName } from '../../hooks/useModels';
import { apiFetch } from '../../hooks/useApi';
import { X, ChevronDown } from 'lucide-react';

interface ProviderStatus {
  id: string;
  name: string;
  installed: boolean;
  authenticated: boolean | null;
  enabled: boolean;
}

interface Props {
  api: any;
  onClose: () => void;
}

export function SpawnDialog({ api, onClose }: Props) {
  const roles = useAppStore((s) => s.roles);
  const config = useAppStore((s) => s.config);
  const { filteredModels: models } = useModels();
  const [selectedRole, setSelectedRole] = useState(roles[0]?.id || '');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch available providers
  useEffect(() => {
    const baseUrl = (config as any)?.baseUrl || '';
    const fetchData = async () => {
      try {
        const provRes = await fetch(`${baseUrl}/settings/providers`);
        if (provRes.ok) {
          const data = await provRes.json();
          setProviders(data.filter((p: ProviderStatus) => p.installed));
        }
      } catch { /* ignore — advanced options just won't be available */ }
    };
    fetchData();
  }, [config]);

  const handleSpawn = async () => {
    if (!selectedRole) return;
    setLoading(true);
    setError('');
    try {
      const options: { model?: string; provider?: string } = {};
      if (selectedProvider) options.provider = selectedProvider;
      if (selectedModel) options.model = selectedModel;
      await api.spawnAgent(selectedRole, undefined, Object.keys(options).length ? options : undefined);
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to spawn agent');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-raised border border-th-border rounded-xl p-5 w-[420px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Spawn Agent</h3>
          <button onClick={onClose} className="text-th-text-muted hover:text-th-text">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {roles.map((role) => (
            <label
              key={role.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedRole === role.id
                  ? 'border-accent bg-accent/5'
                  : 'border-th-border hover:border-th-border-hover'
              }`}
            >
              <input
                type="radio"
                name="role"
                value={role.id}
                checked={selectedRole === role.id}
                onChange={() => setSelectedRole(role.id)}
                className="sr-only"
              />
              <span className="text-xl">{role.icon}</span>
              <div>
                <div className="text-sm font-medium">{role.name}</div>
                <div className="text-xs text-th-text-muted">{role.description}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Advanced options: provider & model */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-xs text-th-text-muted hover:text-th-text mb-3 transition-colors"
        >
          <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          Advanced options
        </button>

        {showAdvanced && (
          <div className="space-y-3 mb-4 p-3 border border-th-border rounded-lg bg-surface-sunken">
            {/* Provider selector */}
            {providers.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-th-text-muted mb-1">Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="w-full bg-surface-raised border border-th-border rounded-md px-3 py-1.5 text-sm text-th-text"
                >
                  <option value="">Default (server config)</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.authenticated === false ? '(not authenticated)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Model selector */}
            {models.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-th-text-muted mb-1">Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-surface-raised border border-th-border rounded-md px-3 py-1.5 text-sm text-th-text"
                >
                  <option value="">Default (role config)</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{deriveModelName(m)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-th-text-alt hover:text-th-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSpawn}
            disabled={loading || !selectedRole}
            className="px-4 py-2 text-sm bg-accent text-black rounded-lg font-medium hover:bg-accent-muted disabled:opacity-50 transition-colors"
          >
            {loading ? 'Spawning...' : 'Spawn'}
          </button>
        </div>
      </div>
    </div>
  );
}
