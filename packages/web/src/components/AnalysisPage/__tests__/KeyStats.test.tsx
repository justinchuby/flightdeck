/**
 * Unit tests for KeyStats — token breakdown display.
 *
 * Covers: token stat shown when agents have token data,
 * token stat hidden when no token data, format helper.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyStats } from '../KeyStats';
import type { AgentInfo } from '../../../types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: 'developer',
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

describe('KeyStats', () => {
  it('shows token breakdown when agents have token data', () => {
    const agents: AgentInfo[] = [
      makeAgent({ id: 'a1', inputTokens: 120_000, outputTokens: 45_000 }),
      makeAgent({ id: 'a2', inputTokens: 80_000, outputTokens: 30_000 }),
    ];
    render(<KeyStats agents={agents} />);

    // Should display "200k in / 75k out"
    expect(screen.getByText('Tokens')).toBeInTheDocument();
    expect(screen.getByText('200k in / 75k out')).toBeInTheDocument();
  });

  it('does not show token stat when no agents have token data', () => {
    const agents: AgentInfo[] = [
      makeAgent({ id: 'a1', inputTokens: 0, outputTokens: 0 }),
    ];
    render(<KeyStats agents={agents} />);

    expect(screen.queryByText('Tokens')).not.toBeInTheDocument();
  });

  it('formats millions correctly', () => {
    const agents: AgentInfo[] = [
      makeAgent({ id: 'a1', inputTokens: 2_500_000, outputTokens: 1_200_000 }),
    ];
    render(<KeyStats agents={agents} />);

    expect(screen.getByText('2.5M in / 1.2M out')).toBeInTheDocument();
  });

  it('formats small numbers correctly', () => {
    const agents: AgentInfo[] = [
      makeAgent({ id: 'a1', inputTokens: 500, outputTokens: 200 }),
    ];
    render(<KeyStats agents={agents} />);

    expect(screen.getByText('500 in / 200 out')).toBeInTheDocument();
  });

  it('always shows Agents, Duration, and Completed stats', () => {
    const agents: AgentInfo[] = [makeAgent()];
    render(<KeyStats agents={agents} />);

    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
