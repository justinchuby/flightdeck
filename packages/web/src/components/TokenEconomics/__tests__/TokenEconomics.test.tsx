// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Mock appStore before importing component
vi.mock('../../../stores/appStore', () => ({
  useAppStore: vi.fn((selector: any) => selector({ agents: [] })),
}));

import { TokenEconomics } from '../TokenEconomics';
import type { AgentInfo } from '../../../types';

afterEach(cleanup);

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-' + Math.random().toString(36).slice(2, 10),
    role: { id: 'developer', name: 'Developer', icon: '💻', description: '', systemPrompt: '', color: '#000', builtIn: false },
    status: 'running',
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
  it('shows hidden notice instead of token data', () => {
    render(<TokenEconomics agents={[]} />);
    expect(screen.getByTestId('token-economics-hidden')).toBeDefined();
  });

  it('shows hidden notice even with real token data', () => {
    const agents = [makeAgent({ inputTokens: 5000, outputTokens: 3000 })];
    render(<TokenEconomics agents={agents} />);
    expect(screen.getByTestId('token-economics-hidden')).toBeDefined();
  });

  it('shows hidden notice even with outputPreview', () => {
    const agents = [makeAgent({ outputPreview: 'a'.repeat(400) })];
    render(<TokenEconomics agents={agents} />);
    expect(screen.getByTestId('token-economics-hidden')).toBeDefined();
    expect(screen.queryByText(/est\./)).toBeNull();
  });
});
