// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock appStore before importing component
vi.mock('../../../stores/appStore', () => ({
  useAppStore: vi.fn((selector: any) => selector({ agents: [] })),
}));

import { TokenEconomics } from '../TokenEconomics';
import type { AgentInfo } from '../../../types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-' + Math.random().toString(36).slice(2, 10),
    role: { id: 'developer', name: 'Developer', icon: '💻', description: '', systemPrompt: '', color: '#000', builtIn: false },
    status: 'running',
    autopilot: false,
    task: 'test task',
    parentId: null,
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  } as AgentInfo;
}

describe('TokenEconomics', () => {
  it('shows empty state when no agents and no output', () => {
    render(<TokenEconomics agents={[]} />);
    expect(screen.getByText(/no agent output to estimate from/i)).toBeInTheDocument();
  });

  it('shows real token data without estimation labels', () => {
    const agents = [makeAgent({ inputTokens: 5000, outputTokens: 3000 })];
    render(<TokenEconomics agents={agents} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
    expect(screen.queryByText(/est\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/~4 chars/)).not.toBeInTheDocument();
  });

  it('estimates tokens from outputPreview when no real data', () => {
    const agents = [makeAgent({ outputPreview: 'a'.repeat(400) })]; // 400 chars = ~100 tokens
    render(<TokenEconomics agents={agents} />);
    expect(screen.getByText(/Token Usage \(est\.\)/)).toBeInTheDocument();
    expect(screen.getByText(/~4 chars\/token/)).toBeInTheDocument();
  });

  it('shows per-agent estimated output with ~ prefix', () => {
    const agents = [makeAgent({ outputPreview: 'a'.repeat(4000) })]; // ~1000 tokens
    render(<TokenEconomics agents={agents} />);
    // Multiple elements show ~1.0k (summary + table row) — just ensure at least one exists
    const matches = screen.getAllByText(/~1\.0k/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows dash for input when estimated (no input estimation)', () => {
    const agents = [makeAgent({ outputPreview: 'a'.repeat(400) })];
    render(<TokenEconomics agents={agents} />);
    // Input column should show '—'
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('does not estimate when agents have no outputPreview', () => {
    const agents = [makeAgent({ outputPreview: '' })];
    render(<TokenEconomics agents={agents} />);
    expect(screen.getByText(/no agent output to estimate from/i)).toBeInTheDocument();
  });
});
