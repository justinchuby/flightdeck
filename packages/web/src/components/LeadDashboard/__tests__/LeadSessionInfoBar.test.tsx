// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LeadSessionInfoBar } from '../LeadSessionInfoBar';
import type { AgentInfo } from '../../../types';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ files: [], agentCount: 0, eventCount: 0 }),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'lead-1',
    role: { id: 'lead', name: 'Lead', icon: '👑', instructions: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01',
    outputPreview: '',
    model: 'claude-sonnet-4',
    cwd: '/home/user/project',
    sessionId: 'sess-abc-123',
    ...overrides,
  } as AgentInfo;
}

describe('LeadSessionInfoBar', () => {
  it('renders cwd when present', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByText('/home/user/project')).toBeInTheDocument();
  });

  it('renders sessionId when present', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByText('sess-abc-123')).toBeInTheDocument();
  });

  it('has copy button', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByText('copy')).toBeInTheDocument();
  });

  it('has export button', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByTitle('Export session to disk')).toBeInTheDocument();
  });

  it('hides cwd when not set', () => {
    render(
      <LeadSessionInfoBar
        leadAgent={makeAgent({ cwd: undefined })}
        selectedLeadId="lead-1"
      />,
    );
    expect(screen.queryByText('/home/user/project')).not.toBeInTheDocument();
  });

  it('hides session info when sessionId not set', () => {
    render(
      <LeadSessionInfoBar
        leadAgent={makeAgent({ sessionId: undefined })}
        selectedLeadId="lead-1"
      />,
    );
    expect(screen.queryByText('copy')).not.toBeInTheDocument();
  });
});
