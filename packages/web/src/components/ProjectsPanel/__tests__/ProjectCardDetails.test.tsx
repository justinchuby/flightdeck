// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCardDetails } from '../ProjectCardDetails';

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
      leadId: 'lead-1',
      status: 'active',
      startedAt: '2024-01-15T10:00:00Z',
      endedAt: null,
      task: 'Build feature X',
    },
  ],
  activeLeadId: 'lead-1',
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

describe('ProjectCardDetails', () => {
  it('renders project ID', () => {
    renderCard();
    expect(screen.getByText('proj-1')).toBeInTheDocument();
  });

  it('shows working directory', () => {
    renderCard();
    expect(screen.getByText(/\/home\/user\/project/)).toBeInTheDocument();
  });

  it('shows creation date', () => {
    renderCard();
    expect(screen.getByText(/Jan.*2024|2024/)).toBeInTheDocument();
  });

  it('shows task progress', () => {
    renderCard();
    const text = document.body.textContent || '';
    expect(text).toMatch(/5.*10|50%/);
  });

  it('shows session info', () => {
    renderCard();
    expect(screen.getByText(/Build feature X/)).toBeInTheDocument();
  });

  it('shows action buttons', () => {
    const { container } = renderCard();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('shows delete confirmation UI', () => {
    renderCard({ isConfirmingDelete: true });
    const text = document.body.textContent || '';
    expect(text).toMatch(/confirm|sure|delete/i);
  });

  it('shows edit cwd UI when editing', () => {
    renderCard({ editingCwdId: 'proj-1', cwdValue: '/new/path' });
    const input = screen.getByDisplayValue('/new/path');
    expect(input).toBeInTheDocument();
  });

  it('renders with no sessions', () => {
    renderCard({ project: makeProject({ sessions: [], activeLeadId: undefined }) });
    expect(screen.getByText('proj-1')).toBeInTheDocument();
  });

  it('shows storage mode', () => {
    renderCard();
    const text = document.body.textContent || '';
    expect(text).toMatch(/local/i);
  });
});
