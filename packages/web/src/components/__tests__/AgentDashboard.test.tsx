// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiFetch = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  useApi: () => ({
    spawnAgent: vi.fn(), terminateAgent: vi.fn(), interruptAgent: vi.fn(),
    restartAgent: vi.fn(), updateAgent: vi.fn(), updateConfig: vi.fn(),
    createRole: vi.fn(), deleteRole: vi.fn(), fetchGroups: vi.fn(),
    fetchGroupMessages: vi.fn(), fetchDagStatus: vi.fn(),
  }),
}));

vi.mock('../../contexts/ApiContext', () => ({
  useApiContext: () => ({
    spawnAgent: vi.fn(), terminateAgent: vi.fn(), interruptAgent: vi.fn(),
    restartAgent: vi.fn(), updateAgent: vi.fn(), updateConfig: vi.fn(),
    createRole: vi.fn(), deleteRole: vi.fn(), fetchGroups: vi.fn(),
    fetchGroupMessages: vi.fn(), fetchDagStatus: vi.fn(),
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProjectId: () => 'p1',
}));

vi.mock('../../hooks/useModels', () => ({
  useModels: () => ({
    models: [], filteredModels: [], modelName: (id: string) => id,
    loading: false, error: null, defaults: {}, modelsByProvider: {}, activeProvider: 'openai',
  }),
}));

vi.mock('../ChatPanel/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

const storeState: Record<string, unknown> = {
  agents: [],
  selectedAgentId: null,
  effectiveId: 'lead-1',
  setSelectedAgent: vi.fn(),
  projects: {},
};

vi.mock('../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      typeof sel === 'function' ? sel(storeState) : storeState,
    { getState: () => storeState, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      typeof sel === 'function' ? sel(storeState) : storeState,
    { getState: () => storeState, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    typeof sel === 'function'
      ? sel({ oversightLevel: 'balanced' })
      : { oversightLevel: 'balanced' },
}));

vi.mock('../Toast', () => ({
  useToastStore: () => vi.fn(),
}));

import { AgentDashboard } from '../AgentDashboard/AgentDashboard';

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AgentDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.agents = [];
    storeState.selectedAgentId = null;
  });

  it('renders without crashing', () => {
    const { container } = renderDashboard();
    expect(container).toBeTruthy();
  });

  it('shows dashboard with empty agents', () => {
    renderDashboard();
    const text = document.body.textContent || '';
    expect(text).toMatch(/Total|Agent|Active|0/i);
  });

  it('renders with agents and selected agent', () => {
    storeState.agents = [
      { id: 'a1', role: { id: 'dev', name: 'Developer', icon: '\ud83d\udcbb' }, status: 'running', messages: [], childIds: [], createdAt: new Date().toISOString(), outputPreview: '', model: 'gpt-4', projectId: 'p1' },
    ];
    storeState.selectedAgentId = 'a1';
    const { container } = renderDashboard();
    expect(container).toBeTruthy();
  });
});
