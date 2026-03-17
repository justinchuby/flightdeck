// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressDetailModal, AgentReportDetailModal } from '../ProgressDetailModal';

const makeProgress = (overrides = {}) => ({
  crewSize: 3,
  active: 2,
  completed: 1,
  failed: 0,
  totalDelegations: 5,
  completionPct: 40,
  crewAgents: [
    { id: 'a1', status: 'running', role: { name: 'Developer', icon: '\ud83d\udcbb' } },
    { id: 'a2', status: 'idle', role: { name: 'Tester', icon: '\ud83e\uddea' } },
  ],
  delegations: [
    { id: 'd1', status: 'active', toRole: 'developer', toAgentId: 'a1', task: 'Implement feature X' },
    { id: 'd2', status: 'completed', toRole: 'tester', toAgentId: 'a2', task: 'Test feature X' },
  ],
  ...overrides,
});

const makeHistory = (n = 2) =>
  Array.from({ length: n }, (_, i) => ({
    summary: `Progress update ${i + 1}`,
    completed: i > 0 ? ['Task A'] : [],
    inProgress: ['Task B'],
    blocked: i > 0 ? ['Task C'] : [],
    timestamp: Date.now() - (n - i) * 60000,
  }));

describe('ProgressDetailModal', () => {
  it('renders with progress data', () => {
    const onClose = vi.fn();
    render(<ProgressDetailModal progress={makeProgress()} progressHistory={makeHistory()} onClose={onClose} />);
    expect(screen.getByText('Progress Detail')).toBeInTheDocument();
    expect(screen.getByText(/40% complete/)).toBeInTheDocument();
  });

  it('shows crew roster', () => {
    render(<ProgressDetailModal progress={makeProgress()} progressHistory={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Tester')).toBeInTheDocument();
  });

  it('shows delegation stats', () => {
    render(<ProgressDetailModal progress={makeProgress()} progressHistory={[]} onClose={vi.fn()} />);
    expect(screen.getByText('3 agents')).toBeInTheDocument();
    expect(screen.getByText('2 active')).toBeInTheDocument();
  });

  it('shows failed count when > 0', () => {
    render(<ProgressDetailModal progress={makeProgress({ failed: 2 })} progressHistory={[]} onClose={vi.fn()} />);
    expect(screen.getByText('2 failed')).toBeInTheDocument();
  });

  it('shows latest progress report', () => {
    render(<ProgressDetailModal progress={null} progressHistory={makeHistory()} onClose={vi.fn()} />);
    expect(screen.getByText('Progress update 2')).toBeInTheDocument();
    expect(screen.getByText('Task A')).toBeInTheDocument();
  });

  it('shows in-progress and blocked items', () => {
    render(<ProgressDetailModal progress={null} progressHistory={makeHistory()} onClose={vi.fn()} />);
    expect(screen.getByText('Task B')).toBeInTheDocument();
    expect(screen.getByText('Task C')).toBeInTheDocument();
  });

  it('shows progress timeline when multiple entries', () => {
    render(<ProgressDetailModal progress={null} progressHistory={makeHistory(3)} onClose={vi.fn()} />);
    expect(screen.getByText('Progress Timeline')).toBeInTheDocument();
  });

  it('shows delegations list', () => {
    render(<ProgressDetailModal progress={makeProgress()} progressHistory={[]} onClose={vi.fn()} />);
    expect(screen.getByText('Delegations')).toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText(/Implement feature X/)).toBeInTheDocument();
  });

  it('truncates long task text', () => {
    const longTask = 'A'.repeat(200);
    const progress = makeProgress({
      delegations: [{ id: 'd1', status: 'active', toRole: 'dev', toAgentId: 'a1', task: longTask }],
    });
    render(<ProgressDetailModal progress={progress} progressHistory={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/A{20,}…/)).toBeInTheDocument();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ProgressDetailModal progress={null} progressHistory={[]} onClose={onClose} />);
    const backdrop = container.firstChild as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(<ProgressDetailModal progress={null} progressHistory={[]} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close progress detail'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with null progress', () => {
    const { container } = render(<ProgressDetailModal progress={null} progressHistory={[]} onClose={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it('handles empty delegations', () => {
    const progress = makeProgress({ delegations: [] });
    const { container } = render(<ProgressDetailModal progress={progress} progressHistory={[]} onClose={vi.fn()} />);
    expect(container.textContent).not.toContain('Delegations');
  });
});

describe('AgentReportDetailModal', () => {
  const makeReport = (overrides = {}) => ({
    fromAgentId: 'a1',
    fromRole: 'Developer',
    content: '## Status\nAll tests passing.\n\n- Fixed bug #123\n- Updated docs',
    timestamp: Date.now(),
    ...overrides,
  });

  it('renders report content', () => {
    render(<AgentReportDetailModal report={makeReport()} onClose={vi.fn()} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('shows timestamp', () => {
    const { container } = render(<AgentReportDetailModal report={makeReport()} onClose={vi.fn()} />);
    expect(container.textContent).toMatch(/\d+:\d+/);
  });

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(<AgentReportDetailModal report={makeReport()} onClose={onClose} />);
    fireEvent.mouseDown(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on X button click', () => {
    const onClose = vi.fn();
    render(<AgentReportDetailModal report={makeReport()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close report'));
    expect(onClose).toHaveBeenCalled();
  });
});
