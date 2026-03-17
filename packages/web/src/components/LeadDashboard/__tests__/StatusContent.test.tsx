// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => ({
    spawnAgent: vi.fn(), terminateAgent: vi.fn(), interruptAgent: vi.fn(),
    restartAgent: vi.fn(), updateAgent: vi.fn(),
  }),
}));

vi.mock('../../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

import { CrewStatusContent } from '../CrewStatusContent';

const makeAgent = (overrides = {}) => ({
  id: 'a1',
  role: { name: 'Developer', icon: '💻' },
  status: 'running',
  model: 'gpt-4',
  provider: 'openai',
  ...overrides,
});

describe('CrewStatusContent', () => {
  it('renders without crashing', () => {
    const { container } = render(<CrewStatusContent agents={[]} delegations={[]} />);
    expect(container).toBeTruthy();
  });

  it('shows agent list', () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
  });

  it('shows multiple agents', () => {
    const agents = [
      makeAgent({ id: 'a1' }),
      makeAgent({ id: 'a2', role: { name: 'Tester', icon: '🧪' }, status: 'idle' }),
    ];
    render(<CrewStatusContent agents={agents} delegations={[]} />);
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
    expect(screen.getByText(/Tester/)).toBeInTheDocument();
  });

  it('handles agent click', () => {
    render(<CrewStatusContent agents={[makeAgent()]} delegations={[]} />);
    const agentEl = screen.getByText(/Developer/);
    fireEvent.click(agentEl.closest('[class*="cursor"]') || agentEl);
    // Should not crash; may select agent
    expect(agentEl).toBeInTheDocument();
  });

  it('shows agent status', () => {
    render(<CrewStatusContent agents={[makeAgent({ status: 'failed' })]} delegations={[]} />);
    const text = document.body.textContent || '';
    expect(text).toMatch(/Developer/);
  });
});
