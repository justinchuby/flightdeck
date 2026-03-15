import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionHistoryTable } from '../SessionHistoryTable';
import type { SessionSummary } from '../types';

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

function makeSessions(count: number): SessionSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    leadId: `lead-${String(i).padStart(3, '0')}`,
    projectId: i % 2 === 0 ? `project-${i}` : null,
    status: 'completed',
    startedAt: new Date(2024, 0, i + 1).toISOString(),
    endedAt: new Date(2024, 0, i + 1, 1, 30).toISOString(),
    agentCount: i + 1,
    taskCount: (i + 1) * 2,
    totalInputTokens: (i + 1) * 1000,
    totalOutputTokens: (i + 1) * 500,
  }));
}

describe('SessionHistoryTable', () => {
  const onSelect = vi.fn();
  const onToggleCompare = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders table with sessions', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.getByTestId('session-history-table')).toBeInTheDocument();
    expect(screen.getByText('Session History')).toBeInTheDocument();
    // 3 data rows + header = 4 rows
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(4);
  });

  it('shows empty state when no sessions', () => {
    render(<SessionHistoryTable sessions={[]} />);
    expect(screen.getByText('No sessions found')).toBeInTheDocument();
  });

  it('displays formatted duration', () => {
    const sessions = makeSessions(1);
    render(<SessionHistoryTable sessions={sessions} />);
    // 1h 30m duration
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('shows — for sessions with no endedAt', () => {
    const sessions: SessionSummary[] = [
      { leadId: 'lead-noend', projectId: null, status: 'active', startedAt: '2024-01-01T00:00:00Z', endedAt: null, agentCount: 1, taskCount: 1, totalInputTokens: 100, totalOutputTokens: 50 },
    ];
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('calls onSelect when a row is clicked', () => {
    const sessions = makeSessions(2);
    render(<SessionHistoryTable sessions={sessions} onSelect={onSelect} />);
    // Click the second data row
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[1]); // first data row (after header)
    expect(onSelect).toHaveBeenCalled();
  });

  it('shows checkboxes when onToggleCompare is provided', () => {
    const sessions = makeSessions(2);
    render(
      <SessionHistoryTable
        sessions={sessions}
        onToggleCompare={onToggleCompare}
        selectedIds={['lead-000']}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    // Default sort is date desc, so lead-001 is first row, lead-000 second
    // lead-000 is in selectedIds
    const lead000Row = screen.getByTitle(/lead-000/).closest('tr')!;
    const lead001Row = screen.getByTitle(/lead-001/).closest('tr')!;
    expect(lead000Row.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(lead001Row.querySelector('input[type="checkbox"]')).not.toBeChecked();
  });

  it('calls onToggleCompare when checkbox is clicked', () => {
    const sessions = makeSessions(2);
    render(
      <SessionHistoryTable
        sessions={sessions}
        onToggleCompare={onToggleCompare}
        selectedIds={[]}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onToggleCompare).toHaveBeenCalled();
  });

  it('does not show checkboxes when onToggleCompare is not provided', () => {
    const sessions = makeSessions(2);
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('sorts by date by default (descending)', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    const rows = screen.getAllByRole('row');
    // Default sort is date desc, so lead-002 (Jan 3) should be first data row
    expect(rows[1]).toHaveTextContent('lead-002');
  });

  it('toggles sort direction when clicking active sort field', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    // Click Date header to toggle from desc to asc
    fireEvent.click(screen.getByText('Date'));
    const rows = screen.getAllByRole('row');
    // Now ascending: lead-000 (Jan 1) should be first
    expect(rows[1]).toHaveTextContent('lead-000');
  });

  it('sorts by tokens when Tokens header is clicked', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    fireEvent.click(screen.getByText('Tokens'));
    const rows = screen.getAllByRole('row');
    // Desc sort: lead-002 has most tokens (3000+1500=4500)
    expect(rows[1]).toHaveTextContent('lead-002');
  });

  it('sorts by tasks when Tasks header is clicked', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    fireEvent.click(screen.getByText('Tasks'));
    const rows = screen.getAllByRole('row');
    // Desc sort: lead-002 has most tasks (6)
    expect(rows[1]).toHaveTextContent('lead-002');
  });

  it('sorts by agents when Agents header is clicked', () => {
    const sessions = makeSessions(3);
    render(<SessionHistoryTable sessions={sessions} />);
    fireEvent.click(screen.getByText('Agents'));
    const rows = screen.getAllByRole('row');
    // Desc sort: lead-002 has most agents (3)
    expect(rows[1]).toHaveTextContent('lead-002');
  });

  it('paginates with more than 10 sessions', () => {
    const sessions = makeSessions(15);
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.getByText('15 sessions')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    // 10 data rows + 1 header = 11 rows on page 1
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(11);
  });

  it('navigates to next/prev page', () => {
    const sessions = makeSessions(15);
    render(<SessionHistoryTable sessions={sessions} />);
    // Go to page 2
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    // 5 data rows + 1 header
    expect(screen.getAllByRole('row').length).toBe(6);
    // Go back to page 1
    fireEvent.click(screen.getByText('← Prev'));
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('disables Prev on first page and Next on last page', () => {
    const sessions = makeSessions(15);
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.getByText('← Prev')).toBeDisabled();
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('Next →')).toBeDisabled();
  });

  it('does not show pagination when sessions fit in one page', () => {
    const sessions = makeSessions(5);
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.queryByText('← Prev')).not.toBeInTheDocument();
  });

  it('shows projectId when available, falls back to short leadId', () => {
    const sessions: SessionSummary[] = [
      { leadId: 'lead-abcdefgh', projectId: 'my-project', status: 'completed', startedAt: '2024-01-01T00:00:00Z', endedAt: '2024-01-01T01:00:00Z', agentCount: 1, taskCount: 1, totalInputTokens: 100, totalOutputTokens: 50 },
      { leadId: 'lead-12345678', projectId: null, status: 'completed', startedAt: '2024-01-02T00:00:00Z', endedAt: '2024-01-02T01:00:00Z', agentCount: 1, taskCount: 1, totalInputTokens: 100, totalOutputTokens: 50 },
    ];
    render(<SessionHistoryTable sessions={sessions} />);
    expect(screen.getByText('my-project')).toBeInTheDocument();
    // The one with null projectId shows shortAgentId in the project column
    // But shortAgentId also shows in the session column, so look specifically in the project column context
    const nullProjectRow = screen.getByTitle(/lead-12345678/).closest('tr')!;
    // The project column should contain the short id
    const cells = nullProjectRow.querySelectorAll('td');
    // Find the project cell (4th cell: session, date, project, duration...)
    const projectCell = cells[2]; // 0-based: session, date, project
    expect(projectCell.textContent).toBe('lead-123');
  });
});
