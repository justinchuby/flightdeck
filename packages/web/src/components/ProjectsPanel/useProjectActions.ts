import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { useLeadStore } from '../../stores/leadStore';
import { useToastStore } from '../Toast';
import type { EnrichedProject } from './ProjectCard';

/**
 * Encapsulates all project CRUD actions: resume, archive, stop, delete,
 * CWD editing, batch operations, and import.
 */
export function useProjectActions(
  fetchProjects: () => Promise<void>,
  projects: EnrichedProject[],
) {
  const addToast = useToastStore((s) => s.add);
  const navigate = useNavigate();

  // ── Single-project actions ────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingCwdId, setEditingCwdId] = useState<string | null>(null);
  const [cwdValue, setCwdValue] = useState('');

  const handleToggle = useCallback(
    async (id: string, setProjects: React.Dispatch<React.SetStateAction<EnrichedProject[]>>) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      try {
        const detail = await apiFetch<EnrichedProject>(`/projects/${id}`);
        setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...detail } : p)));
      } catch {
        // Non-critical — the list data is still valid
      }
    },
    [expandedId],
  );

  const handleResume = useCallback(
    async (id: string) => {
      try {
        const response = await apiFetch<{ id: string }>(`/projects/${id}/resume`, { method: 'POST', body: JSON.stringify({ resumeAll: true }) });
        addToast('success', 'Project resumed — lead agent spawned');
        if (response?.id) {
          // Set leadStore immediately so WS messages are routed correctly from the start
          const leadStore = useLeadStore.getState();
          leadStore.addProject(response.id);
          leadStore.selectLead(response.id);
          navigate(`/projects/${id}/session`);
        } else {
          await fetchProjects();
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        addToast('error', `Failed to resume: ${msg}`);
      }
    },
    [addToast, fetchProjects, navigate],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'archived' }),
        });
        addToast('success', 'Project archived');
        await fetchProjects();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to archive: ${message}`);
      }
    },
    [addToast, fetchProjects],
  );

  const handleStop = useCallback(
    async (id: string) => {
      try {
        const data = await apiFetch<{ terminated: number }>(`/projects/${id}/stop`, { method: 'POST' });
        addToast('success', `Stopped ${data.terminated ?? 0} agent(s)`);
        await fetchProjects();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to stop agents: ${message}`);
      }
    },
    [addToast, fetchProjects],
  );

  const handleRequestDelete = useCallback((id: string) => {
    setConfirmingDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/projects/${id}`, { method: 'DELETE' });
        addToast('success', 'Project deleted');
        if (expandedId === id) setExpandedId(null);
        setConfirmingDeleteId(null);
        await fetchProjects();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addToast('error', `Failed to delete: ${message}`);
      }
    },
    [addToast, expandedId, fetchProjects],
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  // ── CWD editing ───────────────────────────────────────────
  const handleEditCwd = useCallback((id: string, currentCwd: string) => {
    setEditingCwdId(id);
    setCwdValue(currentCwd);
  }, []);

  const handleSaveCwd = useCallback(async (id: string, setProjects: React.Dispatch<React.SetStateAction<EnrichedProject[]>>) => {
    try {
      await apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ cwd: cwdValue }) });
      setProjects(prev => prev.map(p => p.id === id ? { ...p, cwd: cwdValue } : p));
      setEditingCwdId(null);
      addToast('success', 'Working directory updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to update path: ${message}`);
    }
  }, [cwdValue, addToast]);

  const handleCancelCwdEdit = useCallback(() => {
    setEditingCwdId(null);
  }, []);

  // ── Batch operations ──────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((filter: 'all' | 'active' | 'archived') => {
    const visible = projects.filter(p => {
      if (filter === 'active') return p.status === 'active';
      if (filter === 'archived') return p.status === 'archived';
      return true;
    });
    setSelectedIds(new Set(visible.map(p => p.id)));
  }, [projects]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBatchArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(
      ids.map(id => apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) })),
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    addToast('success', `Archived ${succeeded} project(s)`);
    clearSelection();
    await fetchProjects();
  }, [selectedIds, addToast, clearSelection, fetchProjects]);

  const handleBatchDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const archiveOnly = ids.filter(id => projects.find(p => p.id === id)?.status === 'archived');
    if (archiveOnly.length === 0) {
      addToast('error', 'Only archived projects can be batch-deleted');
      return;
    }
    const results = await Promise.allSettled(
      archiveOnly.map(id => apiFetch(`/projects/${id}`, { method: 'DELETE' })),
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    addToast('success', `Deleted ${succeeded} project(s)`);
    clearSelection();
    await fetchProjects();
  }, [selectedIds, projects, addToast, clearSelection, fetchProjects]);

  const allSelectedArchived = Array.from(selectedIds).every(
    id => projects.find(p => p.id === id)?.status === 'archived',
  );

  // ── Import ────────────────────────────────────────────────
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  const handleImportProject = useCallback(async () => {
    if (!importPath.trim()) return;
    setImportLoading(true);
    try {
      const result = await apiFetch<{ id: string; name: string; imported?: { hasShared: boolean; sharedAgentCount: number } }>('/projects/import', {
        method: 'POST',
        body: JSON.stringify({ cwd: importPath.trim() }),
      });
      const extra = result.imported?.sharedAgentCount
        ? ` (${result.imported.sharedAgentCount} shared artifacts found)`
        : '';
      addToast('success', `Imported "${result.name}"${extra}`);
      setShowImportDialog(false);
      setImportPath('');
      await fetchProjects();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Import failed: ${message}`);
    } finally {
      setImportLoading(false);
    }
  }, [importPath, addToast, fetchProjects]);

  return {
    // Single-project actions
    expandedId,
    handleToggle,
    handleResume,
    handleArchive,
    handleStop,
    handleRequestDelete,
    confirmingDeleteId,
    handleConfirmDelete,
    handleCancelDelete,
    // CWD editing
    editingCwdId,
    cwdValue,
    setCwdValue,
    handleEditCwd,
    handleSaveCwd,
    handleCancelCwdEdit,
    // Batch operations
    selectedIds,
    toggleSelect,
    selectAllVisible,
    clearSelection,
    handleBatchArchive,
    handleBatchDelete,
    allSelectedArchived,
    // Import
    showImportDialog,
    setShowImportDialog,
    importPath,
    setImportPath,
    importLoading,
    handleImportProject,
  };
}
