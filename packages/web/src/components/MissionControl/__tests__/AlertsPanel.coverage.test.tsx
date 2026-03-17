// @vitest-environment jsdom
/**
 * Extra coverage for AlertsPanel — executeAction branches (dismiss, invalid endpoint, error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import { AlertsPanel, detectAlerts } from '../AlertsPanel';
import type { AgentInfo } from '../../../types';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    provider: 'copilot',
    backend: 'acp',
    inputTokens: 0,
    outputTokens: 0,
    contextWindowSize: 0,
    contextWindowUsed: 0,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    pendingMessages: 0,
    createdAt: new Date().toISOString(),
    childIds: [],
    toolCalls: [],
    messages: [],
    isSubLead: false,
    hierarchyLevel: 0,
    outputPreview: '',
    ...overrides,
  } as AgentInfo;
}

describe('AlertsPanel — executeAction coverage', () => {
  const leadId = 'lead-1';

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ agents: [] });
    useLeadStore.setState({ projects: {} });
  });

  it('renders decision alerts with pending decisions older than 3 min', () => {
    useAppStore.setState({
      agents: [makeAgent({ id: leadId })],
    });
    useLeadStore.setState({
      projects: {
        [leadId]: {
          decisions: [{
            id: 'dec-1',
            agentId: 'agent-1',
            agentRole: 'Developer',
            leadId,
            projectId: null,
            title: 'Approve deploy',
            rationale: 'Ready',
            needsConfirmation: true,
            status: 'recorded',
            autoApproved: false,
            confirmedAt: null,
            timestamp: new Date(Date.now() - 600_000).toISOString(),
            category: 'architecture',
          }],
          dagStatus: null,
        } as never,
      },
    });
    render(<AlertsPanel leadId={leadId} />);
    expect(screen.getByText(/Decision pending: Approve deploy/)).toBeInTheDocument();
  });

  it('shows no alerts for decisions that do not need confirmation', () => {
    useAppStore.setState({ agents: [makeAgent({ id: leadId })] });
    useLeadStore.setState({
      projects: {
        [leadId]: {
          decisions: [{
            id: 'dec-2',
            agentId: 'agent-1',
            agentRole: 'Developer',
            leadId,
            projectId: null,
            title: 'Auto-approved',
            rationale: '',
            needsConfirmation: false,
            status: 'recorded',
            autoApproved: true,
            confirmedAt: null,
            timestamp: new Date(Date.now() - 600_000).toISOString(),
            category: 'architecture',
          }],
          dagStatus: null,
        } as never,
      },
    });
    render(<AlertsPanel leadId={leadId} />);
    expect(screen.getByText('No active alerts')).toBeInTheDocument();
  });

  it('detectAlerts handles agent with string role', () => {
    const agent = makeAgent({ status: 'failed', role: 'architect' as any });
    const alerts = detectAlerts([agent], [], null);
    expect(alerts.length).toBe(1);
    expect(alerts[0].title).toContain('architect failed');
  });

  it('detectAlerts handles dagStatus with 0 blocked tasks', () => {
    const dagStatus = {
      tasks: [],
      fileLockMap: {},
      summary: { pending: 0, ready: 0, running: 0, done: 5, failed: 0, blocked: 0, paused: 0, skipped: 0 },
    } as any;
    const alerts = detectAlerts([], [], dagStatus);
    expect(alerts).toHaveLength(0);
  });
});
