import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// ── Add Task Form ───────────────────────────────────────────────────

export interface AddTaskFormProps {
  projectId: string;
  onCreated: () => void;
  onClose: () => void;
}

export function AddTaskForm({ projectId, onCreated, onClose }: AddTaskFormProps) {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !role.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          role: role.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      onCreated();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message ?? 'Failed to create task');
      console.error('Failed to create task', err);
    } finally {
      setSubmitting(false);
    }
  }, [title, role, description, projectId, onCreated, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="bg-th-bg border border-th-border rounded-lg p-3 space-y-2"
      data-testid="add-task-form"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-th-text">New Task</span>
        <button type="button" onClick={onClose} className="text-th-text-muted hover:text-th-text">
          <X size={14} />
        </button>
      </div>
      <input
        autoFocus
        required
        aria-label="Task title"
        placeholder="Title *"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50"
      />
      <input
        required
        aria-label="Task role"
        placeholder="Role *"
        value={role}
        onChange={e => setRole(e.target.value)}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50"
      />
      <textarea
        aria-label="Task description"
        placeholder="Description (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={2}
        className="w-full text-xs bg-th-bg-muted border border-th-border rounded px-2 py-1.5 text-th-text placeholder:text-th-text-muted focus:outline-none focus:border-blue-500/50 resize-none"
      />
      {error && <div className="text-[10px] text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-2 py-1 rounded text-th-text-muted hover:text-th-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !title.trim() || !role.trim()}
          className="text-[11px] px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Adding…' : 'Add Task'}
        </button>
      </div>
    </form>
  );
}
