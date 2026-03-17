// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LeadAgentReportsBanner } from '../LeadAgentReportsBanner';
import type { AgentReport } from '../../../stores/leadStore';

vi.mock('../AgentReportBlock', () => ({
  parseAgentReport: () => ({ isReport: false, header: '', task: '', output: '', sessionId: '', isAck: false }),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeReport(overrides: Partial<AgentReport> & { id: string }): AgentReport {
  return {
    fromRole: 'developer',
    fromId: 'agent-abc',
    content: 'Report content line one',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('LeadAgentReportsBanner', () => {
  it('renders nothing when no reports', () => {
    const { container } = render(
      <LeadAgentReportsBanner agentReports={[]} onExpandReport={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows report count badge', () => {
    const reports = [makeReport({ id: 'r1' }), makeReport({ id: 'r2' })];
    render(<LeadAgentReportsBanner agentReports={reports} onExpandReport={vi.fn()} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('starts expanded showing reports', () => {
    const reports = [makeReport({ id: 'r1', content: 'First report', fromRole: 'tester' })];
    render(<LeadAgentReportsBanner agentReports={reports} onExpandReport={vi.fn()} />);
    expect(screen.getByText('tester')).toBeInTheDocument();
    // Since parseAgentReport returns isReport: false, summary = first line of content
    expect(screen.getByText('First report')).toBeInTheDocument();
  });

  it('clicking report calls onExpandReport', () => {
    const onExpandReport = vi.fn();
    const reports = [makeReport({ id: 'r1' })];
    render(<LeadAgentReportsBanner agentReports={reports} onExpandReport={onExpandReport} />);
    // Click on the report row
    fireEvent.click(screen.getByText('Report content line one'));
    expect(onExpandReport).toHaveBeenCalledWith(reports[0]);
  });

  it('collapses on button click', () => {
    const reports = [makeReport({ id: 'r1', fromRole: 'designer' })];
    render(<LeadAgentReportsBanner agentReports={reports} onExpandReport={vi.fn()} />);
    expect(screen.getByText('designer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('designer')).not.toBeInTheDocument();
  });
});
