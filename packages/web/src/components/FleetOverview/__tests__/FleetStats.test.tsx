// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FleetStats } from '../FleetStats';

const makeAgent = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  role: { id: 'dev', name: 'Developer', icon: '💻' },
  status: 'running' as const,
  childIds: [],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
  ...overrides,
});

describe('FleetStats', () => {
  it('shows agent count', () => {
    render(<FleetStats agents={[makeAgent(), makeAgent({ id: 'a2' })]} locks={[]} />);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('counts running agents', () => {
    const agents = [
      makeAgent({ id: 'a1', status: 'running' }),
      makeAgent({ id: 'a2', status: 'idle' }),
      makeAgent({ id: 'a3', status: 'running' }),
    ];
    render(<FleetStats agents={agents} locks={[]} />);
    expect(screen.getByText('2')).toBeInTheDocument(); // 2 running
  });

  it('counts completed and failed agents', () => {
    const agents = [
      makeAgent({ id: 'a1', status: 'completed' }),
      makeAgent({ id: 'a2', status: 'failed' }),
      makeAgent({ id: 'a3', status: 'completed' }),
    ];
    render(<FleetStats agents={agents} locks={[]} />);
    // Should show 2 completed, 1 failed
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows file lock count', () => {
    const locks = [
      { filePath: 'src/a.ts', agentId: 'a1', agentRole: 'dev', projectId: 'p1', reason: '', acquiredAt: new Date().toISOString(), expiresAt: new Date().toISOString() },
    ];
    render(<FleetStats agents={[makeAgent()]} locks={locks} />);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('renders with empty data', () => {
    render(<FleetStats agents={[]} locks={[]} />);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });
});
