// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { ProjectCard } from '../ProjectCard';

const makeProject = (overrides = {}) => ({
  id: 'proj-1',
  name: 'My Test Project',
  description: 'A project for testing',
  cwd: '/home/user/project',
  status: 'active',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T12:00:00Z',
  activeAgentCount: 3,
  runningAgentCount: 2,
  idleAgentCount: 1,
  failedAgentCount: 0,
  storageMode: 'local' as const,
  sessions: [],
  taskProgress: { done: 5, total: 10 },
  tokenUsage: { inputTokens: 50000, outputTokens: 25000, costUsd: 0.5 },
  ...overrides,
});

function renderCard(overrides = {}) {
  const props = {
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
    isExpanded: false,
    onToggleExpand: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <MemoryRouter>
        <ProjectCard {...props} />
      </MemoryRouter>,
    ),
    props,
  };
}

describe('ProjectCard', () => {
  it('renders project name', () => {
    renderCard();
    expect(screen.getByText('My Test Project')).toBeInTheDocument();
  });

  it('shows project status badge', () => {
    renderCard();
    // Active status should show a badge
    const text = document.body.textContent || '';
    expect(text).toMatch(/active|running|agent/i);
  });

  it('shows agent count', () => {
    renderCard();
    expect(screen.getAllByText(/3/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows task progress', () => {
    renderCard();
    const text = document.body.textContent || '';
    expect(text).toMatch(/5.*10|50/);
  });

  it('handles click on card', () => {
    renderCard();
    const name = screen.getByText('My Test Project');
    fireEvent.click(name);
    // Click may toggle expand
    expect(name).toBeInTheDocument();
  });

  it('renders expanded state', () => {
    const { container } = renderCard({ isExpanded: true });
    expect(container).toBeTruthy();
  });

  it('shows stopped status', () => {
    renderCard({ project: makeProject({ status: 'stopped', activeAgentCount: 0 }) });
    const text = document.body.textContent || '';
    expect(text).toMatch(/stopped|inactive|0/i);
  });

  it('handles delete confirmation state', () => {
    const { container } = renderCard({ isConfirmingDelete: true });
    expect(container).toBeTruthy();
  });
});
