// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarTabs } from '../SidebarTabs';
import type { DagStatus, AgentInfo, Decision, ChatGroup, GroupMessage } from '../../../types';
import type { AgentComm } from '../../../stores/leadStore';

// Mock all child panel components
vi.mock('../DecisionPanel', () => ({
  DecisionPanelContent: () => <div data-testid="decision-panel">Decisions</div>,
}));
vi.mock('../CommsPanel', () => ({
  CommsPanelContent: () => <div data-testid="comms-panel">Comms</div>,
}));
vi.mock('../GroupsPanel', () => ({
  GroupsPanelContent: () => <div data-testid="groups-panel">Groups</div>,
}));
vi.mock('../TaskDagPanel', () => ({
  TaskDagPanelContent: () => <div data-testid="dag-panel">DAG</div>,
}));
vi.mock('../ModelConfigPanel', () => ({
  ModelConfigPanel: () => <div data-testid="model-panel">Models</div>,
}));
vi.mock('../../TimerDisplay/TimerDisplay', () => ({
  TimerDisplay: () => <div data-testid="timer-panel">Timers</div>,
}));

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    layout: { collapsed: false, onToggle: vi.fn(), width: 300, onResize: vi.fn() },
    tabs: {
      activeTab: 'crew',
      onTabChange: vi.fn(),
      tabOrder: ['crew', 'comms', 'groups', 'dag', 'models', 'timers'],
      onTabOrderChange: vi.fn(),
      hiddenTabs: new Set<string>(),
      onToggleTabVisibility: vi.fn(),
      showConfig: false,
      onToggleConfig: vi.fn(),
      onResize: vi.fn(),
    },
    decision: {
      decisions: [] as Decision[],
      pendingConfirmations: [] as Decision[],
      panelHeight: 200,
      onResize: vi.fn(),
      onConfirm: vi.fn(),
      onReject: vi.fn(),
      onDismiss: vi.fn(),
    },
    crewTabContent: <div data-testid="crew-content">Crew Content</div>,
    comms: [] as AgentComm[],
    groups: [] as ChatGroup[],
    groupMessages: {} as Record<string, GroupMessage[]>,
    dagStatus: null as DagStatus | null,
    leadAgent: undefined as AgentInfo | undefined,
    selectedLeadId: null as string | null,
    activeTimerCount: 0,
    crewAgentIds: new Set<string>(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('SidebarTabs', () => {
  it('renders tab buttons when expanded', () => {
    render(<SidebarTabs {...makeProps()} />);
    expect(screen.getByText('Crew')).toBeDefined();
    expect(screen.getByText('Comms')).toBeDefined();
    expect(screen.getByText('Groups')).toBeDefined();
    expect(screen.getByText('DAG')).toBeDefined();
    expect(screen.getByText('Models')).toBeDefined();
    expect(screen.getByText('Timers')).toBeDefined();
  });

  it('shows only expand button when collapsed', () => {
    render(<SidebarTabs {...makeProps({ layout: { collapsed: true, onToggle: vi.fn(), width: 300, onResize: vi.fn() } })} />);
    expect(screen.getByLabelText('Expand sidebar')).toBeDefined();
    expect(screen.queryByText('Crew')).toBeNull();
  });

  it('clicking tab calls onTabChange', () => {
    const props = makeProps();
    render(<SidebarTabs {...props} />);
    fireEvent.click(screen.getByText('Comms'));
    expect(props.tabs.onTabChange).toHaveBeenCalledWith('comms');
  });

  it('shows crew content when crew tab is active', () => {
    render(<SidebarTabs {...makeProps()} />);
    expect(screen.getByTestId('crew-content')).toBeDefined();
  });

  it('shows comms panel when comms tab is active', () => {
    const props = makeProps();
    props.tabs.activeTab = 'comms';
    render(<SidebarTabs {...props} />);
    expect(screen.getByTestId('comms-panel')).toBeDefined();
  });

  it('shows dag panel when dag tab is active', () => {
    const props = makeProps();
    props.tabs.activeTab = 'dag';
    render(<SidebarTabs {...props} />);
    expect(screen.getByTestId('dag-panel')).toBeDefined();
  });

  it('shows pending decision badge when confirmations exist', () => {
    const props = makeProps();
    props.layout.collapsed = true;
    props.decision.pendingConfirmations = [{ id: 'd1', title: 'Test' } as Decision, { id: 'd2', title: 'Test2' } as Decision];
    render(<SidebarTabs {...props} />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('shows badge count on tabs', () => {
    const props = makeProps();
    props.comms = [{ id: 'c1' } as AgentComm, { id: 'c2' } as AgentComm];
    render(<SidebarTabs {...props} />);
    // The comms tab should show badge with count 2
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders collapse button', () => {
    render(<SidebarTabs {...makeProps()} />);
    expect(screen.getByLabelText('Collapse sidebar')).toBeDefined();
  });

  it('renders Decisions section header', () => {
    render(<SidebarTabs {...makeProps()} />);
    expect(screen.getAllByText('Decisions').length).toBeGreaterThanOrEqual(1);
  });

  it('hides tabs that are in hiddenTabs', () => {
    const props = makeProps();
    props.tabs.hiddenTabs = new Set(['timers', 'models']);
    render(<SidebarTabs {...props} />);
    expect(screen.queryByText('Timers')).toBeNull();
    expect(screen.queryByText('Models')).toBeNull();
    expect(screen.getByText('Crew')).toBeDefined();
  });
});
