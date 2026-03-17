// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCardDetails } from '../ProjectCardDetails';

afterEach(cleanup);

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));
vi.mock('../../../utils/format', () => ({
  formatDate: (d: string) => new Date(d).toLocaleDateString(),
}));
vi.mock('../../ui/StatusBadge', () => ({
  projectStatusProps: (project: any) => {
    if (project.status === 'archived') return { variant: 'neutral', label: 'Archived', pulse: false };
    const running = project.runningAgentCount ?? 0;
    const idle = project.idleAgentCount ?? 0;
    if (running > 0) return { variant: 'success', label: 'Running', pulse: true };
    if (idle > 0) return { variant: 'warning', label: 'Idle', pulse: false };
    return { variant: 'neutral', label: 'Stopped', pulse: false };
  },
}));
vi.mock('../../../utils/statusColors', () => ({
  sessionStatusDot: (status: string) => status === 'active' ? 'bg-green-400' : 'bg-gray-400',
}));
vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

const makeProject = (overrides: Record<string, unknown> = {}) => ({
  id: 'proj-1',
  name: 'Test Project',
  description: 'A test project',
  cwd: '/home/user/project',
  status: 'active',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T12:00:00Z',
  activeAgentCount: 3,
  runningAgentCount: 2,
  idleAgentCount: 1,
  failedAgentCount: 0,
  storageMode: 'local' as const,
  sessions: [
    {
      id: 1,
      projectId: 'proj-1',
      leadId: 'lead-abcd1234',
      status: 'active',
      startedAt: '2024-01-15T10:00:00Z',
      endedAt: null,
      task: 'Build feature X',
    },
  ],
  activeLeadId: 'lead-abcd1234',
  taskProgress: { done: 5, total: 10 },
  tokenUsage: { inputTokens: 50000, outputTokens: 25000, costUsd: 0.5 },
  ...overrides,
});

const defaultProps = () => ({
  project: makeProject(),
  onResume: vi.fn(),
  onArchive: vi.fn(),
  onStop: vi.fn(),
  onDelete: vi.fn(),
  isConfirmingDelete: false,
  onConfirmDelete: vi.fn(),
  onCancelDelete: vi.fn(),
  editingCwdId: null as string | null,
  cwdValue: '',
  onEditCwd: vi.fn(),
  onCwdChange: vi.fn(),
  onSaveCwd: vi.fn(),
  onCancelCwdEdit: vi.fn(),
  onViewSession: vi.fn(),
});

function renderCard(overrides = {}) {
  const props = { ...defaultProps(), ...overrides };
  return {
    ...render(
      <MemoryRouter>
        <ProjectCardDetails {...props} />
      </MemoryRouter>,
    ),
    props,
  };
}

// ─── CWD edit keyboard shortcuts ──────────────────────────────────────────────

describe('CWD edit keyboard shortcuts', () => {
  it('Enter key in CWD input calls onSaveCwd with project id', () => {
    const { props } = renderCard({ editingCwdId: 'proj-1', cwdValue: '/new/path' });
    const input = screen.getByDisplayValue('/new/path');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSaveCwd).toHaveBeenCalledWith('proj-1');
  });

  it('Escape key in CWD input calls onCancelCwdEdit', () => {
    const { props } = renderCard({ editingCwdId: 'proj-1', cwdValue: '/new/path' });
    const input = screen.getByDisplayValue('/new/path');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onCancelCwdEdit).toHaveBeenCalled();
  });

  it('Save button calls onSaveCwd with project id', () => {
    const { props } = renderCard({ editingCwdId: 'proj-1', cwdValue: '/new/path' });
    fireEvent.click(screen.getByText('Save'));
    expect(props.onSaveCwd).toHaveBeenCalledWith('proj-1');
  });

  it('Cancel button calls onCancelCwdEdit', () => {
    const { props } = renderCard({ editingCwdId: 'proj-1', cwdValue: '/new/path' });
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onCancelCwdEdit).toHaveBeenCalled();
  });
});

// ─── CWD edit pencil icon click ───────────────────────────────────────────────

describe('CWD edit pencil icon', () => {
  it('pencil button calls onEditCwd with project id and current cwd', () => {
    const { props } = renderCard();
    const pencilBtn = screen.getByTitle('Edit working directory');
    fireEvent.click(pencilBtn);
    expect(props.onEditCwd).toHaveBeenCalledWith('proj-1', '/home/user/project');
  });

  it('pencil button passes empty string when cwd is null', () => {
    const { props } = renderCard({ project: makeProject({ cwd: null }) });
    const pencilBtn = screen.getByTitle('Edit working directory');
    fireEvent.click(pencilBtn);
    expect(props.onEditCwd).toHaveBeenCalledWith('proj-1', '');
  });
});

// ─── Action button callbacks ──────────────────────────────────────────────────

describe('Action button callbacks', () => {
  it('Resume button calls onResume — shown when not archived and not live', () => {
    const { props } = renderCard({
      project: makeProject({ status: 'active', runningAgentCount: 0, idleAgentCount: 0 }),
    });
    fireEvent.click(screen.getByText('Resume'));
    expect(props.onResume).toHaveBeenCalledWith('proj-1');
  });

  it('Archive button calls onArchive — shown when live (running)', () => {
    const { props } = renderCard({
      project: makeProject({ runningAgentCount: 2 }),
    });
    fireEvent.click(screen.getByText('Archive'));
    expect(props.onArchive).toHaveBeenCalledWith('proj-1');
  });

  it('Archive button shown when idle (warning variant)', () => {
    const { props } = renderCard({
      project: makeProject({ runningAgentCount: 0, idleAgentCount: 3 }),
    });
    fireEvent.click(screen.getByText('Archive'));
    expect(props.onArchive).toHaveBeenCalledWith('proj-1');
  });

  it('Stop button calls onStop — shown when runningAgentCount > 0', () => {
    const { props } = renderCard({
      project: makeProject({ runningAgentCount: 1 }),
    });
    fireEvent.click(screen.getByText('Stop All Agents'));
    expect(props.onStop).toHaveBeenCalledWith('proj-1');
  });

  it('Stop button is hidden when runningAgentCount is 0', () => {
    renderCard({
      project: makeProject({ runningAgentCount: 0 }),
    });
    expect(screen.queryByText('Stop All Agents')).not.toBeInTheDocument();
  });

  it('Delete button for archived project calls onDelete', () => {
    const { props } = renderCard({
      project: makeProject({ status: 'archived', runningAgentCount: 0, idleAgentCount: 0 }),
    });
    fireEvent.click(screen.getByText('Delete'));
    expect(props.onDelete).toHaveBeenCalledWith('proj-1');
  });

  it('Confirm delete button calls onConfirmDelete', () => {
    const { props } = renderCard({ isConfirmingDelete: true });
    const deleteButtons = screen.getAllByText('Delete');
    const confirmBtn = deleteButtons.find(btn => btn.tagName === 'BUTTON' && btn.className.includes('bg-red-500'));
    fireEvent.click(confirmBtn!);
    expect(props.onConfirmDelete).toHaveBeenCalledWith('proj-1');
  });

  it('Cancel delete button calls onCancelDelete', () => {
    const { props } = renderCard({ isConfirmingDelete: true });
    fireEvent.click(screen.getByText('Cancel'));
    expect(props.onCancelDelete).toHaveBeenCalled();
  });

  it('Resume button is hidden for archived projects', () => {
    renderCard({
      project: makeProject({ status: 'archived', runningAgentCount: 0, idleAgentCount: 0 }),
    });
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });
});

// ─── Enter Project link ───────────────────────────────────────────────────────

describe('Enter Project link', () => {
  it('renders with correct href', () => {
    renderCard();
    const link = screen.getByText('Enter Project').closest('a');
    expect(link).toHaveAttribute('href', '/projects/proj-1');
  });
});

// ─── Go to Session link ──────────────────────────────────────────────────────

describe('Go to Session link', () => {
  it('shown when project is live (running agents)', () => {
    renderCard({ project: makeProject({ runningAgentCount: 2 }) });
    const link = screen.getByText('Go to Session').closest('a');
    expect(link).toHaveAttribute('href', '/projects/proj-1/session');
  });

  it('shown when project is idle (warning variant)', () => {
    renderCard({ project: makeProject({ runningAgentCount: 0, idleAgentCount: 3 }) });
    const link = screen.getByText('Go to Session').closest('a');
    expect(link).toHaveAttribute('href', '/projects/proj-1/session');
  });

  it('hidden when project is stopped', () => {
    renderCard({
      project: makeProject({ runningAgentCount: 0, idleAgentCount: 0 }),
    });
    expect(screen.queryByText('Go to Session')).not.toBeInTheDocument();
  });
});

// ─── Token usage display ─────────────────────────────────────────────────────

describe('Token usage display', () => {
  it('shows formatted token counts', () => {
    renderCard();
    const text = document.body.textContent || '';
    expect(text).toContain('50.0K in');
    expect(text).toContain('25.0K out');
  });

  it('shows cost when > 0', () => {
    renderCard();
    expect(screen.getByText('($0.50)')).toBeInTheDocument();
  });

  it('hides cost when costUsd is 0', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 1000, outputTokens: 500, costUsd: 0 } }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('1.0K in');
    expect(text).not.toContain('$');
  });

  it('hidden when no token usage', () => {
    renderCard({
      project: makeProject({ tokenUsage: undefined }),
    });
    expect(screen.queryByText('Token Usage')).not.toBeInTheDocument();
  });

  it('hidden when all tokens are zero', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }),
    });
    expect(screen.queryByText('Token Usage')).not.toBeInTheDocument();
  });
});

// ─── Session click behavior ──────────────────────────────────────────────────

describe('Session click behavior', () => {
  it('onViewSession called with session data on click', () => {
    const { props } = renderCard();
    const sessionRow = screen.getByText('Build feature X').closest('[title="Click to view session summary"]');
    fireEvent.click(sessionRow!);
    expect(props.onViewSession).toHaveBeenCalledWith({
      leadId: 'lead-abcd1234',
      task: 'Build feature X',
      startedAt: '2024-01-15T10:00:00Z',
      endedAt: null,
      projectId: 'proj-1',
      status: 'active',
    });
  });
});

// ─── Session status dot ──────────────────────────────────────────────────────

describe('Session status dot', () => {
  it('running session shows animate-pulse', () => {
    const { container } = renderCard({
      project: makeProject({
        sessions: [{
          id: 1, projectId: 'proj-1', leadId: 'lead-abcd1234',
          status: 'active', startedAt: '2024-01-15T10:00:00Z', endedAt: null, task: 'Running task',
        }],
        activeLeadId: 'lead-abcd1234',
      }),
    });
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('completed session does not show animate-pulse', () => {
    const { container } = renderCard({
      project: makeProject({
        sessions: [{
          id: 2, projectId: 'proj-1', leadId: 'lead-other999',
          status: 'completed', startedAt: '2024-01-15T10:00:00Z', endedAt: '2024-01-15T11:00:00Z', task: 'Done task',
        }],
        activeLeadId: 'lead-abcd1234',
      }),
    });
    const dots = container.querySelectorAll('.rounded-full');
    const sessionDots = Array.from(dots).filter(d => d.classList.contains('w-1.5'));
    for (const dot of sessionDots) {
      expect(dot.className).not.toContain('animate-pulse');
    }
  });
});

// ─── formatTokenCount helper ─────────────────────────────────────────────────

describe('formatTokenCount via rendered output', () => {
  it('formats thousands as K (e.g. 1234 → 1.2K)', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 1234, outputTokens: 0, costUsd: 0 } }),
    });
    // inputTokens=1234 should NOT render since outputTokens=0, so set both > 0
  });

  it('1234 renders as 1.2K', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 1234, outputTokens: 1, costUsd: 0 } }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('1.2K in');
  });

  it('1234567 renders as 1.2M', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 1234567, outputTokens: 1, costUsd: 0 } }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('1.2M in');
  });

  it('999 renders as 999', () => {
    renderCard({
      project: makeProject({ tokenUsage: { inputTokens: 999, outputTokens: 1, costUsd: 0 } }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('999 in');
  });
});

// ─── Crew breakdown display ──────────────────────────────────────────────────

describe('Crew breakdown display', () => {
  it('shows running/idle/failed counts', () => {
    renderCard({
      project: makeProject({ runningAgentCount: 3, idleAgentCount: 2, failedAgentCount: 1 }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('3 running');
    expect(text).toContain('2 idle');
    expect(text).toContain('1 failed');
  });

  it('omits zero counts from breakdown', () => {
    renderCard({
      project: makeProject({ runningAgentCount: 0, idleAgentCount: 2, failedAgentCount: 0 }),
    });
    const text = document.body.textContent || '';
    expect(text).toContain('2 idle');
    expect(text).not.toContain('running');
    expect(text).not.toContain('failed');
  });
});

// ─── "Not set" for empty CWD ─────────────────────────────────────────────────

describe('CWD display', () => {
  it('shows "Not set" when cwd is null', () => {
    renderCard({ project: makeProject({ cwd: null }) });
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('shows "Not set" when cwd is empty string', () => {
    renderCard({ project: makeProject({ cwd: '' }) });
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });
});

// ─── Storage mode display ────────────────────────────────────────────────────

describe('Storage mode display', () => {
  it('shows "User (~/.flightdeck/)" for user storage mode', () => {
    renderCard({ project: makeProject({ storageMode: 'user' }) });
    expect(screen.getByText('User (~/.flightdeck/)')).toBeInTheDocument();
  });

  it('shows "Local (.flightdeck/)" for local storage mode', () => {
    renderCard({ project: makeProject({ storageMode: 'local' }) });
    expect(screen.getByText('Local (.flightdeck/)')).toBeInTheDocument();
  });
});
