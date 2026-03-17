// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mocks (before imports) ───────────────────────────────────
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

// ── Imports ──────────────────────────────────────────────────
import { useProjectActions } from '../useProjectActions';
import type { EnrichedProject } from '../ProjectCard';

// ── Helpers ──────────────────────────────────────────────────
function makeProject(overrides: Partial<EnrichedProject> = {}): EnrichedProject {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: '',
    cwd: '/tmp/test',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activeAgentCount: 0,
    storageMode: 'user',
    ...overrides,
  } as EnrichedProject;
}

const mockFetchProjects = vi.fn().mockResolvedValue(undefined);

function setup(projects: EnrichedProject[] = [makeProject()]) {
  return renderHook(() => useProjectActions(mockFetchProjects, projects));
}

// ── Tests ────────────────────────────────────────────────────
describe('useProjectActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  // ── Toggle expand ──────────────────────────────────────────
  describe('handleToggle', () => {
    it('expands a project and fetches detail', async () => {
      const detail = makeProject({ description: 'detailed' });
      mockApiFetch.mockResolvedValueOnce(detail);
      const setProjects = vi.fn();
      const { result } = setup();

      await act(async () => {
        await result.current.handleToggle('proj-1', setProjects);
      });

      expect(result.current.expandedId).toBe('proj-1');
      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1');
      expect(setProjects).toHaveBeenCalled();
    });

    it('collapses when toggling the same id', async () => {
      mockApiFetch.mockResolvedValueOnce(makeProject());
      const setProjects = vi.fn();
      const { result } = setup();

      await act(async () => {
        await result.current.handleToggle('proj-1', setProjects);
      });
      expect(result.current.expandedId).toBe('proj-1');

      await act(async () => {
        await result.current.handleToggle('proj-1', setProjects);
      });
      expect(result.current.expandedId).toBeNull();
    });

    it('handles fetch error gracefully', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('fail'));
      const setProjects = vi.fn();
      const { result } = setup();

      await act(async () => {
        await result.current.handleToggle('proj-1', setProjects);
      });
      expect(result.current.expandedId).toBe('proj-1');
    });
  });

  // ── Resume ─────────────────────────────────────────────────
  describe('handleResume', () => {
    it('resumes and navigates on success with id', async () => {
      mockApiFetch.mockResolvedValueOnce({ id: 'sess-1' });
      const { result } = setup();

      await act(async () => {
        await result.current.handleResume('proj-1');
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/resume', {
        method: 'POST',
        body: JSON.stringify({ resumeAll: true }),
      });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Project resumed — lead agent spawned');
      expect(mockNavigate).toHaveBeenCalledWith('/projects/proj-1/session');
    });

    it('refreshes projects when response has no id', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const { result } = setup();

      await act(async () => {
        await result.current.handleResume('proj-1');
      });

      expect(mockFetchProjects).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('shows error toast on failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
      const { result } = setup();

      await act(async () => {
        await result.current.handleResume('proj-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to resume: Network error');
    });
  });

  // ── Archive ────────────────────────────────────────────────
  describe('handleArchive', () => {
    it('archives a project and refreshes', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const { result } = setup();

      await act(async () => {
        await result.current.handleArchive('proj-1');
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Project archived');
      expect(mockFetchProjects).toHaveBeenCalled();
    });

    it('shows error toast on archive failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Forbidden'));
      const { result } = setup();

      await act(async () => {
        await result.current.handleArchive('proj-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to archive: Forbidden');
    });
  });

  // ── Stop ───────────────────────────────────────────────────
  describe('handleStop', () => {
    it('stops agents and shows terminated count', async () => {
      mockApiFetch.mockResolvedValueOnce({ terminated: 3 });
      const { result } = setup();

      await act(async () => {
        await result.current.handleStop('proj-1');
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1/stop', { method: 'POST' });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Stopped 3 agent(s)');
    });

    it('shows 0 when terminated is missing', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const { result } = setup();

      await act(async () => {
        await result.current.handleStop('proj-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith('success', 'Stopped 0 agent(s)');
    });

    it('shows error toast on stop failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('timeout'));
      const { result } = setup();

      await act(async () => {
        await result.current.handleStop('proj-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to stop agents: timeout');
    });
  });

  // ── Delete confirm flow ────────────────────────────────────
  describe('delete confirm flow', () => {
    it('sets confirmingDeleteId on request', () => {
      const { result } = setup();

      act(() => {
        result.current.handleRequestDelete('proj-1');
      });

      expect(result.current.confirmingDeleteId).toBe('proj-1');
    });

    it('clears confirmingDeleteId on cancel', () => {
      const { result } = setup();

      act(() => { result.current.handleRequestDelete('proj-1'); });
      act(() => { result.current.handleCancelDelete(); });

      expect(result.current.confirmingDeleteId).toBeNull();
    });

    it('deletes project and clears expanded on confirm', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProject()) // toggle fetch
        .mockResolvedValueOnce({}); // delete

      const setProjects = vi.fn();
      const { result } = setup();

      await act(async () => {
        await result.current.handleToggle('proj-1', setProjects);
      });

      await act(async () => {
        await result.current.handleConfirmDelete('proj-1');
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1', { method: 'DELETE' });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Project deleted');
      expect(result.current.expandedId).toBeNull();
      expect(result.current.confirmingDeleteId).toBeNull();
    });

    it('shows error toast on delete failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Not found'));
      const { result } = setup();

      await act(async () => {
        await result.current.handleConfirmDelete('proj-1');
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to delete: Not found');
    });
  });

  // ── CWD editing ────────────────────────────────────────────
  describe('CWD editing', () => {
    it('sets editing state with current cwd', () => {
      const { result } = setup();

      act(() => { result.current.handleEditCwd('proj-1', '/old/path'); });

      expect(result.current.editingCwdId).toBe('proj-1');
      expect(result.current.cwdValue).toBe('/old/path');
    });

    it('saves cwd and updates projects', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      const setProjects = vi.fn();
      const { result } = setup();

      act(() => { result.current.handleEditCwd('proj-1', '/old/path'); });
      act(() => { result.current.setCwdValue('/new/path'); });

      await act(async () => {
        await result.current.handleSaveCwd('proj-1', setProjects);
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/proj-1', {
        method: 'PATCH',
        body: JSON.stringify({ cwd: '/new/path' }),
      });
      expect(result.current.editingCwdId).toBeNull();
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Working directory updated');
      expect(setProjects).toHaveBeenCalled();
    });

    it('shows error toast on save failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('bad path'));
      const setProjects = vi.fn();
      const { result } = setup();

      act(() => { result.current.handleEditCwd('proj-1', '/old'); });

      await act(async () => {
        await result.current.handleSaveCwd('proj-1', setProjects);
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to update path: bad path');
    });

    it('cancels cwd edit', () => {
      const { result } = setup();

      act(() => { result.current.handleEditCwd('proj-1', '/some/path'); });
      act(() => { result.current.handleCancelCwdEdit(); });

      expect(result.current.editingCwdId).toBeNull();
    });
  });

  // ── Batch operations ───────────────────────────────────────
  describe('batch operations', () => {
    it('toggleSelect adds and removes ids', () => {
      const { result } = setup();

      act(() => { result.current.toggleSelect('proj-1'); });
      expect(result.current.selectedIds.has('proj-1')).toBe(true);

      act(() => { result.current.toggleSelect('proj-1'); });
      expect(result.current.selectedIds.has('proj-1')).toBe(false);
    });

    it('selectAllVisible selects active projects', () => {
      const projects = [
        makeProject({ id: 'p1', status: 'active' }),
        makeProject({ id: 'p2', status: 'archived' }),
        makeProject({ id: 'p3', status: 'active' }),
      ];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => { result.current.selectAllVisible('active'); });
      expect(result.current.selectedIds).toEqual(new Set(['p1', 'p3']));
    });

    it('selectAllVisible selects all projects', () => {
      const projects = [
        makeProject({ id: 'p1', status: 'active' }),
        makeProject({ id: 'p2', status: 'archived' }),
      ];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => { result.current.selectAllVisible('all'); });
      expect(result.current.selectedIds).toEqual(new Set(['p1', 'p2']));
    });

    it('selectAllVisible selects archived projects', () => {
      const projects = [
        makeProject({ id: 'p1', status: 'active' }),
        makeProject({ id: 'p2', status: 'archived' }),
      ];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => { result.current.selectAllVisible('archived'); });
      expect(result.current.selectedIds).toEqual(new Set(['p2']));
    });

    it('clearSelection empties selection', () => {
      const { result } = setup();

      act(() => { result.current.toggleSelect('proj-1'); });
      act(() => { result.current.clearSelection(); });

      expect(result.current.selectedIds.size).toBe(0);
    });

    it('handleBatchArchive archives selected and clears selection', async () => {
      mockApiFetch.mockResolvedValue({});
      const projects = [makeProject({ id: 'p1' }), makeProject({ id: 'p2' })];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => {
        result.current.toggleSelect('p1');
        result.current.toggleSelect('p2');
      });

      await act(async () => {
        await result.current.handleBatchArchive();
      });

      expect(mockAddToast).toHaveBeenCalledWith('success', 'Archived 2 project(s)');
      expect(result.current.selectedIds.size).toBe(0);
      expect(mockFetchProjects).toHaveBeenCalled();
    });

    it('handleBatchDelete only deletes archived projects', async () => {
      mockApiFetch.mockResolvedValue({});
      const projects = [
        makeProject({ id: 'p1', status: 'archived' }),
        makeProject({ id: 'p2', status: 'active' }),
      ];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => {
        result.current.toggleSelect('p1');
        result.current.toggleSelect('p2');
      });

      await act(async () => {
        await result.current.handleBatchDelete();
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/p1', { method: 'DELETE' });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Deleted 1 project(s)');
    });

    it('handleBatchDelete shows error when no archived projects', async () => {
      const projects = [makeProject({ id: 'p1', status: 'active' })];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => { result.current.toggleSelect('p1'); });

      await act(async () => {
        await result.current.handleBatchDelete();
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Only archived projects can be batch-deleted');
      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('allSelectedArchived reflects selection state', () => {
      const projects = [
        makeProject({ id: 'p1', status: 'archived' }),
        makeProject({ id: 'p2', status: 'active' }),
      ];
      const { result } = renderHook(() => useProjectActions(mockFetchProjects, projects));

      act(() => { result.current.toggleSelect('p1'); });
      expect(result.current.allSelectedArchived).toBe(true);

      act(() => { result.current.toggleSelect('p2'); });
      expect(result.current.allSelectedArchived).toBe(false);
    });
  });

  // ── Import ─────────────────────────────────────────────────
  describe('handleImportProject', () => {
    it('imports project and shows toast with shared artifact count', async () => {
      mockApiFetch.mockResolvedValueOnce({
        id: 'new-1',
        name: 'Imported',
        imported: { hasShared: true, sharedAgentCount: 5 },
      });
      const { result } = setup();

      act(() => { result.current.setImportPath('/some/path'); });

      await act(async () => {
        await result.current.handleImportProject();
      });

      expect(mockApiFetch).toHaveBeenCalledWith('/projects/import', {
        method: 'POST',
        body: JSON.stringify({ cwd: '/some/path' }),
      });
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Imported "Imported" (5 shared artifacts found)');
      expect(result.current.showImportDialog).toBe(false);
      expect(result.current.importPath).toBe('');
      expect(result.current.importLoading).toBe(false);
    });

    it('imports project without shared artifacts', async () => {
      mockApiFetch.mockResolvedValueOnce({ id: 'new-1', name: 'Imported' });
      const { result } = setup();

      act(() => { result.current.setImportPath('/path'); });

      await act(async () => {
        await result.current.handleImportProject();
      });

      expect(mockAddToast).toHaveBeenCalledWith('success', 'Imported "Imported"');
    });

    it('does nothing when importPath is empty', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.handleImportProject();
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('shows error toast on import failure', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('No config found'));
      const { result } = setup();

      act(() => { result.current.setImportPath('/bad/path'); });

      await act(async () => {
        await result.current.handleImportProject();
      });

      expect(mockAddToast).toHaveBeenCalledWith('error', 'Import failed: No config found');
      expect(result.current.importLoading).toBe(false);
    });

    it('sets importLoading during import', async () => {
      let resolveImport!: (v: any) => void;
      mockApiFetch.mockReturnValueOnce(new Promise((r) => { resolveImport = r; }));
      const { result } = setup();

      act(() => { result.current.setImportPath('/path'); });

      let importPromise: Promise<void>;
      act(() => {
        importPromise = result.current.handleImportProject();
      });

      expect(result.current.importLoading).toBe(true);

      await act(async () => {
        resolveImport({ id: '1', name: 'P' });
        await importPromise!;
      });

      expect(result.current.importLoading).toBe(false);
    });
  });
});
