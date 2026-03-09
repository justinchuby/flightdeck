import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus, Loader2, Check, Sparkles } from 'lucide-react';

interface RoleInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  model: string;
}

interface ModelsListResponse {
  models: string[];
  defaults: Record<string, string[]>;
}

/** Human-readable display names for model IDs (mirrors ModelConfigPanel) */
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

export interface NewSessionDialogProps {
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}

export function NewSessionDialog({ projectId, onClose, onStarted }: NewSessionDialogProps) {
  const [task, setTask] = useState('');
  const [leadModel, setLeadModel] = useState('');
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<RoleInfo[]>('/roles')
      .then((roles) => setAvailableRoles(roles.filter((r) => r.id !== 'lead')))
      .catch(() => { /* role fetch failure is non-critical */ });
    apiFetch<ModelsListResponse>('/models')
      .then((data) => setAvailableModels(data.models ?? []))
      .catch(() => { /* model fetch failure is non-critical */ });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleRole = useCallback((roleId: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }, []);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      let fullTask = task.trim() || undefined;
      if (selectedRoles.size > 0) {
        const teamHint = `\n\n[Initial Crew] The user has pre-selected these roles for the initial crew: ${Array.from(selectedRoles).join(', ')}. Please create these agents as your first action.`;
        fullTask = (fullTask || '') + teamHint;
      }
      await apiFetch(`/projects/${projectId}/resume`, {
        method: 'POST',
        body: JSON.stringify({
          freshStart: true,
          task: fullTask,
          model: leadModel || undefined,
        }),
      });
      onStarted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setStarting(false);
    }
  }, [projectId, task, leadModel, selectedRoles, onStarted]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="new-session-dialog"
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-th-border">
          <Sparkles className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold text-th-text">New Session</h2>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Task input */}
          <div>
            <label className="block text-xs text-th-text-muted mb-1 font-medium">
              Task / Prompt
            </label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe what the crew should work on..."
              className="w-full text-sm bg-th-bg border border-th-border rounded-md px-3 py-2 text-th-text focus:outline-none focus:border-accent/50 resize-none"
              rows={3}
              data-testid="new-session-task"
              autoFocus
            />
          </div>

          {/* Lead model */}
          <div>
            <label className="block text-xs text-th-text-muted mb-1 font-medium">
              Lead Model
            </label>
            <select
              value={leadModel}
              onChange={(e) => setLeadModel(e.target.value)}
              className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm text-th-text focus:outline-none focus:border-accent/50"
              data-testid="new-session-model"
            >
              <option value="">Default</option>
              {availableModels.map((id) => (
                <option key={id} value={id}>{MODEL_NAMES[id] ?? id}</option>
              ))}
            </select>
          </div>

          {/* Initial Crew Selection */}
          {availableRoles.length > 0 && (
            <div>
              <label className="block text-xs text-th-text-muted mb-1.5 font-medium">
                Initial Crew <span className="text-th-text-muted">(optional — pre-select roles to auto-create)</span>
              </label>
              <div className="flex flex-wrap gap-1.5" data-testid="role-selector">
                {availableRoles.map((role) => {
                  const isSelected = selectedRoles.has(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors border ${
                        isSelected
                          ? 'bg-accent/20 border-accent/50 text-accent'
                          : 'bg-th-bg border-th-border text-th-text-muted hover:border-th-border-hover'
                      }`}
                      title={role.description}
                      data-testid={`role-${role.id}`}
                    >
                      <span>{role.icon}</span>
                      <span>{role.name}</span>
                      {isSelected && <Check className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2" data-testid="new-session-error">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-th-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="px-5 py-2 bg-accent hover:bg-accent/80 disabled:bg-th-bg-hover disabled:text-th-text-muted text-white text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
            data-testid="start-session-btn"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {starting ? 'Starting…' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
