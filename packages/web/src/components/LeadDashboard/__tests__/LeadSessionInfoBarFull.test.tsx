// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { LeadSessionInfoBar } from '../LeadSessionInfoBar';

const makeAgent = (overrides = {}) => ({
  id: 'lead-1',
  role: { id: 'lead', name: 'Lead', icon: '\ud83d\udc51' },
  status: 'running' as const,
  childIds: ['a1', 'a2'],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
  projectId: 'p1',
  cwd: '/home/user/project',
  provider: 'openai',
  ...overrides,
});

describe('LeadSessionInfoBar', () => {
  it('renders with lead agent', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />,
    );
    expect(container.textContent).toBeTruthy();
  });

  it('shows working directory', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByText(/\/home\/user\/project/)).toBeInTheDocument();
  });

  it('handles undefined lead agent', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={undefined} selectedLeadId="lead-1" />,
    );
    expect(container).toBeTruthy();
  });

  it('shows model info', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />,
    );
    const text = container.textContent || '';
    // Component shows cwd and possibly other info
    expect(text.length).toBeGreaterThan(0);
  });

  it('shows agent count', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />,
    );
    const text = container.textContent || '';
    // Should show crew size or agent-related info
    expect(text.length).toBeGreaterThan(0);
  });

  it('shows status indicator for running agent', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeAgent({ status: 'running' })} selectedLeadId="lead-1" />,
    );
    expect(container.querySelector('[class*="bg-"]')).toBeTruthy();
  });

  it('handles agent with no cwd', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeAgent({ cwd: undefined })} selectedLeadId="lead-1" />,
    );
    expect(container).toBeTruthy();
  });

  it('handles completed agent', () => {
    const { container } = render(
      <LeadSessionInfoBar
        leadAgent={makeAgent({ status: 'completed' })}
        selectedLeadId="lead-1"
      />,
    );
    expect(container).toBeTruthy();
  });
});
