import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Loader2, ChevronDown, ChevronRight, Wrench, Check, FolderOpen } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import { apiFetch } from '../../hooks/useApi';
import { ModelConfigPanel } from './ModelConfigPanel';
import { FolderPicker } from '../FolderPicker/FolderPicker';
import { useModels, deriveModelName } from '../../hooks/useModels';

interface RoleInfo { id: string; name: string; icon: string; description: string; model: string; }

interface NewProjectModalProps {
  onClose: () => void;
}

export function NewProjectModal({ onClose }: NewProjectModalProps) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameTouched, setNewProjectNameTouched] = useState(false);
  const [newProjectTask, setNewProjectTask] = useState('');
  const [newProjectModel, setNewProjectModel] = useState('');
  const [newProjectCwd, setNewProjectCwd] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [newProjectModelConfig, setNewProjectModelConfig] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState('');
  const { filteredModels: availableModels } = useModels();

  // Fetch available roles on mount
  useEffect(() => {
    apiFetch<RoleInfo[]>('/roles').then((roles) => {
      setAvailableRoles(roles.filter((r) => r.id !== 'lead'));
    }).catch(() => { /* role fetch failure is non-critical */ });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newProjectName.trim()) { setNewProjectNameTouched(true); return; }
    setStarting(true);
    setError('');
    try {
      const task = newProjectTask.trim() || undefined;
      let fullTask = task;
      if (selectedRoles.size > 0) {
        const teamHint = `\n\n[Initial Crew] The user has pre-selected these roles for the initial crew: ${Array.from(selectedRoles).join(', ')}. Please create these agents as your first action.`;
        fullTask = (task || '') + teamHint;
      }
      const data = await apiFetch<{ id?: string; projectId?: string }>('/lead/start', {
        method: 'POST',
        body: JSON.stringify({ name: newProjectName.trim(), task: fullTask, model: newProjectModel || undefined, cwd: newProjectCwd.trim() || undefined }),
      });
      if (data.id) {
        useLeadStore.getState().addProject(data.id);
        useLeadStore.getState().selectLead(data.id);
        if (task) {
          useLeadStore.getState().addMessage(data.id, { type: 'text', text: task, sender: 'user' });
        }
        if (newProjectModelConfig && data.projectId) {
          apiFetch(`/projects/${data.projectId}/model-config`, {
            method: 'PUT',
            body: JSON.stringify({ config: newProjectModelConfig }),
          }).catch(() => { /* best-effort — project still created */ });
        }
        onClose();
        if (data.projectId) {
          navigate(`/projects/${data.projectId}/session`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to start project');
    } finally {
      setStarting(false);
    }
  }, [newProjectName, newProjectTask, newProjectModel, newProjectCwd, selectedRoles, newProjectModelConfig, onClose, navigate]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-xl flex flex-col"
        >
          <div className="flex items-center gap-2 px-5 py-4 border-b border-th-border">
            <Crown className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            <h2 className="text-base font-semibold text-th-text">New Project</h2>
          </div>
          <div className="px-5 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
            <div>
              <label className="block text-xs text-th-text-muted mb-1 font-medium">Project Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => { setNewProjectName(e.target.value); setNewProjectNameTouched(true); }}
                onBlur={() => setNewProjectNameTouched(true)}
                placeholder="My Feature"
                maxLength={100}
                className={`w-full bg-th-bg border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none ${
                  newProjectNameTouched && !newProjectName.trim()
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-th-border focus:border-yellow-500'
                }`}
                autoFocus
              />
              {newProjectNameTouched && !newProjectName.trim() && (
                <p className="text-xs text-red-400 mt-1">Project name is required</p>
              )}
              {newProjectName.trim().length > 100 && (
                <p className="text-xs text-red-400 mt-1">Must be 100 characters or less</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-th-text-muted mb-1 font-medium">Task / Prompt</label>
              <textarea
                value={newProjectTask}
                onChange={(e) => setNewProjectTask(e.target.value)}
                placeholder="Describe what you want the crew to work on..."
                rows={6}
                className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500 resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-th-text-muted mb-1 font-medium">Model</label>
                <select
                  value={newProjectModel}
                  onChange={(e) => setNewProjectModel(e.target.value)}
                  className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
                >
                  <option value="">Default</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{deriveModelName(m)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-th-text-muted mb-1 font-medium">Working Directory</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newProjectCwd}
                    onChange={(e) => setNewProjectCwd(e.target.value)}
                    placeholder="/path/to/project"
                    className="flex-1 bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFolderPicker(true)}
                    className="px-2 py-2 bg-th-bg-muted hover:bg-th-bg-hover text-th-text-alt rounded-md text-xs shrink-0 transition-colors"
                    title="Browse folders"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            {/* Initial Crew Selection */}
            {availableRoles.length > 0 && (
              <div>
                <label className="block text-xs text-th-text-muted mb-1.5 font-medium">Initial Crew <span className="text-th-text-muted">(optional — pre-select roles to auto-create)</span></label>
                <div className="flex flex-wrap gap-1.5">
                  {availableRoles.map((role) => {
                    const isSelected = selectedRoles.has(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedRoles((prev) => {
                          const next = new Set(prev);
                          if (next.has(role.id)) next.delete(role.id); else next.add(role.id);
                          return next;
                        })}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors border ${
                          isSelected
                            ? 'bg-yellow-600/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-200'
                            : 'bg-th-bg border-th-border text-th-text-muted hover:border-th-border-hover'
                        }`}
                        title={role.description}
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
            {/* Model Configuration (collapsible) */}
            <div>
              <button
                type="button"
                onClick={() => setShowModelConfig(!showModelConfig)}
                className="flex items-center gap-1 text-xs text-th-text-alt hover:text-th-text font-medium transition-colors"
              >
                {showModelConfig ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <Wrench className="w-3 h-3" />
                Model Configuration
              </button>
              {showModelConfig && (
                <div className="mt-2 border border-th-border rounded-md p-2 bg-th-bg">
                  <ModelConfigPanel value={newProjectModelConfig ?? undefined} onChange={setNewProjectModelConfig} />
                </div>
              )}
            </div>
          </div>
          {error && (
            <div className="mx-5 mb-0 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-sm text-red-400">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-th-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={starting || !newProjectName.trim()}
              className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-th-bg-hover disabled:text-th-text-muted text-black text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
              {starting ? 'Starting...' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>

      {/* Folder picker modal */}
      {showFolderPicker && (
        <FolderPicker
          value={newProjectCwd}
          onChange={(path) => setNewProjectCwd(path)}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </>
  );
}
