import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { X } from 'lucide-react';

interface Props {
  api: any;
  onClose: () => void;
}

export function SpawnDialog({ api, onClose }: Props) {
  const roles = useAppStore((s) => s.roles);
  const [selectedRole, setSelectedRole] = useState(roles[0]?.id || '');
  const [autopilot, setAutopilot] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSpawn = async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      await api.spawnAgent(selectedRole, undefined, autopilot);
      onClose();
    } catch (err) {
      console.error('Failed to spawn agent:', err);
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

        <label className="flex items-center gap-2 mb-4 px-1 text-sm text-th-text-alt cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autopilot}
            onChange={(e) => setAutopilot(e.target.checked)}
            className="rounded border-th-border bg-th-bg-alt text-accent focus:ring-accent/30"
          />
          <span>Autopilot</span>
          <span className="text-xs text-th-text-muted">— auto-approve all tool calls</span>
        </label>

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
