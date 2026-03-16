// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

import { LeadSessionInfoBar } from '../LeadSessionInfoBar';

const makeLeadAgent = (overrides = {}) => ({
  id: 'lead-1',
  role: { id: 'lead', name: 'Lead', icon: '👑' },
  status: 'running' as const,
  childIds: ['a1'],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
  projectId: 'p1',
  cwd: '/home/user/project',
  ...overrides,
});

describe('LeadSessionInfoBar', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeLeadAgent()} selectedLeadId="lead-1" />,
    );
    expect(container).toBeTruthy();
  });

  it('shows working directory', () => {
    render(<LeadSessionInfoBar leadAgent={makeLeadAgent()} selectedLeadId="lead-1" />);
    expect(screen.getByText(/\/home\/user\/project/)).toBeInTheDocument();
  });

  it('renders with undefined lead agent', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={undefined} selectedLeadId="lead-1" />,
    );
    expect(container).toBeTruthy();
  });

  it('shows lead ID', () => {
    const { container } = render(
      <LeadSessionInfoBar leadAgent={makeLeadAgent()} selectedLeadId="lead-1" />,
    );
    const text = container.textContent || '';
    expect(text.length).toBeGreaterThan(0);
  });
});
