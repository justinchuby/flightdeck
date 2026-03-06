import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';

// ── Mocks ──────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    panels: [
      { id: 'fleet', label: 'Agent Fleet', visible: true },
      { id: 'scorecards', label: 'Performance', visible: true },
    ],
  }),
}));

vi.mock('../../hooks/useFocusAgent', () => ({
  useFocusAgent: () => ({ data: null, loading: false }),
}));

// Lazy import after mocks are set up
const { MissionControlPage } = await import('../MissionControl/MissionControlPage');

// ── Helpers ────────────────────────────────────────────────────────

function renderMC() {
  return render(
    <MemoryRouter>
      <MissionControlPage />
    </MemoryRouter>,
  );
}

const MOCK_PROJECTS = [
  { id: 'proj-1', name: 'Test Project', status: 'active', createdAt: '2026-03-06T00:00:00Z' },
  { id: 'proj-2', name: 'Old Project', status: 'active', createdAt: '2026-03-05T00:00:00Z' },
];

const MOCK_KEYFRAMES = {
  keyframes: [
    { type: 'spawn', label: 'Spawned Developer: implement feature', timestamp: '2026-03-06T01:00:00Z' },
    { type: 'spawn', label: 'Spawned Architect: design system', timestamp: '2026-03-06T01:01:00Z' },
    { type: 'delegation', label: 'Delegated to Developer: write code', timestamp: '2026-03-06T01:02:00Z' },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────

describe('MissionControlPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setAgents([]);
    useLeadStore.setState({ selectedLeadId: null, projects: {} });
    mockApiFetch.mockImplementation((url: string) => {
      if (url === '/projects') return Promise.resolve(MOCK_PROJECTS);
      if (url.includes('/keyframes')) return Promise.resolve(MOCK_KEYFRAMES);
      return Promise.resolve([]);
    });
  });

  it('shows empty state when no projects exist', () => {
    mockApiFetch.mockResolvedValue([]);
    renderMC();
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    expect(screen.getByText(/No active project/)).toBeInTheDocument();
  });

  it('shows panels with live agents', () => {
    useLeadStore.setState({
      selectedLeadId: 'lead-1',
      projects: { 'lead-1': { comms: [], dagStatus: null, activity: [], progress: null } as any },
    });
    useAppStore.getState().setAgents([
      {
        id: 'lead-1',
        parentId: null,
        status: 'running',
        role: { id: 'lead', name: 'Lead', icon: '👑' },
        model: 'test',
        inputTokens: 100,
        outputTokens: 200,
        messages: [],
      } as any,
    ]);

    renderMC();
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
    // Panels should render (fleet and scorecards from mock layout)
    expect(screen.queryByText(/No active project/)).not.toBeInTheDocument();
  });

  it('fetches projects from API when no live agents', async () => {
    renderMC();
    // Initially shows empty state, then API loads projects
    expect(mockApiFetch).toHaveBeenCalledWith('/projects');
  });

  it('derives historical agents from keyframes', async () => {
    // Pre-set a leadId via leadStore so we skip the empty state
    useLeadStore.setState({
      selectedLeadId: 'proj-1',
      projects: { 'proj-1': { comms: [], dagStatus: null, activity: [], progress: null } as any },
    });

    renderMC();

    // Should fetch keyframes for the selected project
    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/replay/proj-1/keyframes');
    });
  });
});
