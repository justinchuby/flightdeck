import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectContext } from '../../contexts/ProjectContext';
import { KeyStats } from '../AnalysisPage/KeyStats';
import { MilestoneTimeline } from '../OverviewPage/MilestoneTimeline';
import { AgentHeatmap } from '../AnalysisPage/AgentHeatmap';
import type { AgentInfo } from '../../types';
import type { ReplayKeyframe } from '../../hooks/useSessionReplay';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../stores/appStore', () => ({
  useAppStore: (sel: any) => sel({
    agents: [
      { id: 'a1', role: { id: 'lead', name: 'Lead' }, status: 'running' },
      { id: 'a2', role: { id: 'dev', name: 'Developer' }, status: 'idle' },
    ],
  }),
}));

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: (sel: any) => sel({
    selectedLeadId: 'lead-1',
    projects: {},
  }),
}));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockImplementation((path: string) => {
    if (path === '/projects') {
      return Promise.resolve([
        { id: 'proj-1', name: 'Test Project', status: 'active', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
      ]);
    }
    if (path.includes('/keyframes')) {
      return Promise.resolve({ keyframes: [] });
    }
    if (path.includes('/decisions')) {
      return Promise.resolve([]);
    }
    if (path.includes('/activity')) {
      return Promise.resolve([]);
    }
    return Promise.resolve({ ok: false });
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────

const mockAgents: AgentInfo[] = [
  { id: 'a1', role: { id: 'lead', name: 'Lead' } as any, status: 'running', model: 'claude' } as any,
  { id: 'a2', role: { id: 'dev', name: 'Developer' } as any, status: 'idle', model: 'claude' } as any,
  { id: 'a3', role: { id: 'dev', name: 'Developer' } as any, status: 'completed', model: 'gpt' } as any,
];

// ── Tests ──────────────────────────────────────────────────────────

describe('KeyStats', () => {
  it('renders stats card with agents, duration, and completed', () => {
    render(<KeyStats agents={mockAgents} />);
    expect(screen.getByTestId('key-stats')).toBeTruthy();
    expect(screen.getByText('Key Stats')).toBeTruthy();
    expect(screen.getByText('1 active / 3 total')).toBeTruthy();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Duration')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('shows completed count for agents with completed status', () => {
    render(<KeyStats agents={mockAgents} />);
    // 1 completed agent in mockAgents (a3)
    expect(screen.getByText('1 agent')).toBeTruthy();
  });

  it('shows active count reflecting running agents', () => {
    const moreAgents = [
      ...mockAgents,
      { id: 'a4', role: { id: 'dev', name: 'Developer' } as any, status: 'running', model: 'claude' } as any,
    ];
    render(<KeyStats agents={moreAgents} />);
    expect(screen.getByText('2 active / 4 total')).toBeTruthy();
  });
});

describe('MilestoneTimeline', () => {
  it('renders empty state', () => {
    render(
      <MemoryRouter>
        <MilestoneTimeline keyframes={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No milestones yet')).toBeTruthy();
  });

  it('renders only progress keyframes, filtering out spawn/delegation noise', () => {
    const kf: ReplayKeyframe[] = [
      { timestamp: '2025-01-01T10:00:00Z', label: 'Spawned Developer', type: 'spawn' },
      { timestamp: '2025-01-01T10:01:00Z', label: 'Created & delegated to Architect', type: 'delegation' },
      { timestamp: '2025-01-01T10:05:00Z', label: 'Task completed', type: 'milestone' },
      { timestamp: '2025-01-01T10:06:00Z', label: 'Pushed commit abc123', type: 'commit' },
      { timestamp: '2025-01-01T10:07:00Z', label: 'Terminated QA Tester', type: 'agent_exit' },
    ];
    render(
      <MemoryRouter>
        <MilestoneTimeline keyframes={kf} />
      </MemoryRouter>,
    );
    // Progress events shown
    expect(screen.getByText('Task completed')).toBeTruthy();
    expect(screen.getByText('Pushed commit abc123')).toBeTruthy();
    // Noise filtered out
    expect(screen.queryByText('Spawned Developer')).toBeNull();
    expect(screen.queryByText(/Created & delegated/)).toBeNull();
    expect(screen.queryByText('Terminated QA Tester')).toBeNull();
  });

  it('shows empty state when all keyframes are filtered noise', () => {
    const kf: ReplayKeyframe[] = [
      { timestamp: '2025-01-01T10:00:00Z', label: 'Spawned Developer', type: 'spawn' },
      { timestamp: '2025-01-01T10:01:00Z', label: 'Created & delegated to Architect', type: 'delegation' },
    ];
    render(
      <MemoryRouter>
        <MilestoneTimeline keyframes={kf} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No milestones yet')).toBeTruthy();
  });
});

describe('AgentHeatmap', () => {
  it('renders empty state', () => {
    render(<AgentHeatmap agents={[]} buckets={[]} />);
    expect(screen.getByText('No agent activity data')).toBeTruthy();
  });

  it('renders with agents', () => {
    render(<AgentHeatmap agents={mockAgents} buckets={[
      { agentId: 'a1', time: Date.now(), intensity: 0.8 },
    ]} />);
    expect(screen.getByTestId('agent-heatmap')).toBeTruthy();
  });
});

describe('OverviewPage rendering', () => {
  it('renders overview page without project tabs', async () => {
    const { OverviewPage } = await import('../OverviewPage/OverviewPage');
    render(
      <ProjectContext.Provider value={{ projectId: 'proj-1' }}>
        <MemoryRouter>
          <OverviewPage />
        </MemoryRouter>
      </ProjectContext.Provider>,
    );
    // ProjectTabs were removed — page should render without them
    const page = await screen.findByTestId('overview-page');
    expect(page).toBeTruthy();
    expect(screen.queryByTestId('project-tabs')).toBeNull();
  });
});
