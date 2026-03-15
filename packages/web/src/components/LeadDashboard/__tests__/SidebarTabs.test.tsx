// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarTabs } from '../SidebarTabs';
import type { DagStatus, AgentInfo, Decision, ChatGroup, GroupMessage } from '../../../types';
import type { AgentComm } from '../../../stores/leadStore';

// Mock all child panel components
vi.mock('../DecisionPanel', () => ({
  DecisionPanelContent: () => <div data-testid="decision-panel">Decisions Content</div>,
}));
vi.mock('../CommsPanel', () => ({
  CommsPanelContent: () => <div data-testid="comms-panel">Comms Content</div>,
}));
vi.mock('../GroupsPanel', () => ({
  GroupsPanelContent: () => <div data-testid="groups-panel">Groups Content</div>,
}));
vi.mock('../TaskDagPanel', () => ({
  TaskDagPanelContent: () => <div data-testid="dag-panel">DAG Content</div>,
}));
vi.mock('../ModelConfigPanel', () => ({
  ModelConfigPanel: () => <div data-testid="model-panel">Models Content</div>,
}));
vi.mock('../../TimerDisplay/TimerDisplay', () => ({
  TimerDisplay: () => <div data-testid="timer-panel">Timers Content</div>,
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
  describe('collapsed state', () => {
    it('shows only expand button when collapsed', () => {
      render(<SidebarTabs {...makeProps({ layout: { collapsed: true, onToggle: vi.fn(), width: 300, onResize: vi.fn() } })} />);
      expect(screen.getByLabelText('Expand sidebar')).toBeTruthy();
      expect(screen.queryByText('Crew')).toBeNull();
      expect(screen.queryByText('Comms')).toBeNull();
    });

    it('calls onToggle when expand button clicked', () => {
      const onToggle = vi.fn();
      render(<SidebarTabs {...makeProps({ layout: { collapsed: true, onToggle, width: 300, onResize: vi.fn() } })} />);
      fireEvent.click(screen.getByLabelText('Expand sidebar'));
      expect(onToggle).toHaveBeenCalled();
    });

    it('shows pending confirmation badge count when collapsed', () => {
      const props = makeProps({
        layout: { collapsed: true, onToggle: vi.fn(), width: 300, onResize: vi.fn() },
      });
      props.decision.pendingConfirmations = [{ id: 'd1' } as Decision, { id: 'd2' } as Decision, { id: 'd3' } as Decision];
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('3')).toBeTruthy();
    });

    it('does not show badge when no pending confirmations', () => {
      render(<SidebarTabs {...makeProps({ layout: { collapsed: true, onToggle: vi.fn(), width: 300, onResize: vi.fn() } })} />);
      // No badge number should appear
      expect(screen.queryByText('0')).toBeNull();
    });
  });

  describe('expanded state — tabs', () => {
    it('renders all visible tab labels', () => {
      render(<SidebarTabs {...makeProps()} />);
      expect(screen.getByText('Crew')).toBeTruthy();
      expect(screen.getByText('Comms')).toBeTruthy();
      expect(screen.getByText('Groups')).toBeTruthy();
      expect(screen.getByText('DAG')).toBeTruthy();
      expect(screen.getByText('Models')).toBeTruthy();
      expect(screen.getByText('Timers')).toBeTruthy();
    });

    it('clicking tab calls onTabChange with tab id', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      fireEvent.click(screen.getByText('Groups'));
      expect(props.tabs.onTabChange).toHaveBeenCalledWith('groups');
    });

    it('hides tabs in hiddenTabs set', () => {
      const props = makeProps();
      props.tabs.hiddenTabs = new Set(['timers', 'models']);
      render(<SidebarTabs {...props} />);
      expect(screen.queryByText('Timers')).toBeNull();
      expect(screen.queryByText('Models')).toBeNull();
      expect(screen.getByText('Crew')).toBeTruthy();
      expect(screen.getByText('DAG')).toBeTruthy();
    });

    it('renders collapse button', () => {
      render(<SidebarTabs {...makeProps()} />);
      expect(screen.getByLabelText('Collapse sidebar')).toBeTruthy();
    });

    it('calls onToggle when collapse button is clicked', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      fireEvent.click(screen.getByLabelText('Collapse sidebar'));
      expect(props.layout.onToggle).toHaveBeenCalled();
    });
  });

  describe('tab badges', () => {
    it('shows comms badge when comms have entries', () => {
      const props = makeProps();
      props.comms = [{ id: 'c1' } as AgentComm, { id: 'c2' } as AgentComm];
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('shows groups badge when groups have entries', () => {
      const props = makeProps();
      props.groups = [{ id: 'g1' } as ChatGroup, { id: 'g2' } as ChatGroup, { id: 'g3' } as ChatGroup];
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('3')).toBeTruthy();
    });

    it('shows dag task count badge', () => {
      const props = makeProps();
      props.dagStatus = { tasks: [{ id: 't1' }, { id: 't2' }] } as unknown as DagStatus;
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('shows timer badge when activeTimerCount > 0', () => {
      const props = makeProps();
      props.activeTimerCount = 5;
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('5')).toBeTruthy();
    });

    it('does not show badge when count is 0', () => {
      const props = makeProps();
      props.comms = [];
      props.groups = [];
      props.activeTimerCount = 0;
      render(<SidebarTabs {...props} />);
      // No numeric badges except decisions count (which is 0)
      const badges = screen.queryAllByText(/^\d+$/);
      // Only the decision count "0" should be present
      expect(badges.every(b => b.textContent === '0')).toBe(true);
    });
  });

  describe('tab content rendering', () => {
    it('shows crew content when crew tab is active', () => {
      render(<SidebarTabs {...makeProps()} />);
      expect(screen.getByTestId('crew-content')).toBeTruthy();
    });

    it('shows comms panel when comms tab is active', () => {
      const props = makeProps();
      props.tabs.activeTab = 'comms';
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('comms-panel')).toBeTruthy();
    });

    it('shows groups panel when groups tab is active', () => {
      const props = makeProps();
      props.tabs.activeTab = 'groups';
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('groups-panel')).toBeTruthy();
    });

    it('shows dag panel when dag tab is active', () => {
      const props = makeProps();
      props.tabs.activeTab = 'dag';
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('dag-panel')).toBeTruthy();
    });

    it('shows model panel when models tab is active and projectId exists', () => {
      const props = makeProps();
      props.tabs.activeTab = 'models';
      props.leadAgent = { projectId: 'proj-1' } as AgentInfo;
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('model-panel')).toBeTruthy();
    });

    it('shows "No project selected" when models tab active but no projectId', () => {
      const props = makeProps();
      props.tabs.activeTab = 'models';
      props.leadAgent = undefined;
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('No project selected')).toBeTruthy();
    });

    it('shows timer panel when timers tab is active', () => {
      const props = makeProps();
      props.tabs.activeTab = 'timers';
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('timer-panel')).toBeTruthy();
    });
  });

  describe('decisions section', () => {
    it('renders Decisions header', () => {
      render(<SidebarTabs {...makeProps()} />);
      expect(screen.getAllByText('Decisions').length).toBeGreaterThanOrEqual(1);
    });

    it('shows decision count', () => {
      const props = makeProps();
      props.decision.decisions = [{ id: 'd1' } as Decision, { id: 'd2' } as Decision];
      render(<SidebarTabs {...props} />);
      expect(screen.getByText('2')).toBeTruthy();
    });

    it('shows pending confirmation dot when pendingConfirmations exist', () => {
      const props = makeProps();
      props.decision.pendingConfirmations = [{ id: 'd1' } as Decision];
      const { container } = render(<SidebarTabs {...props} />);
      const dot = container.querySelector('.bg-yellow-500.rounded-full.w-2');
      expect(dot).toBeTruthy();
    });

    it('renders DecisionPanelContent', () => {
      render(<SidebarTabs {...makeProps()} />);
      expect(screen.getByTestId('decision-panel')).toBeTruthy();
    });
  });

  describe('config dropdown', () => {
    it('clicking settings button calls onToggleConfig', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      fireEvent.click(screen.getByTitle('Configure visible tabs'));
      expect(props.tabs.onToggleConfig).toHaveBeenCalled();
    });

    it('shows tab visibility toggles when showConfig is true', () => {
      const props = makeProps();
      props.tabs.showConfig = true;
      render(<SidebarTabs {...props} />);
      // The config dropdown shows capitalized tab names — each tab name appears in both the tab bar and the dropdown
      const allCrewTexts = screen.getAllByText('Crew');
      expect(allCrewTexts.length).toBeGreaterThanOrEqual(2); // tab + dropdown
    });

    it('clicking a visibility toggle calls onToggleTabVisibility', () => {
      const props = makeProps();
      props.tabs.showConfig = true;
      render(<SidebarTabs {...props} />);
      // The dropdown items show tab names — find the one in the dropdown
      // Since each tab name appears twice (in tabs and in dropdown), click the last one
      const dagItems = screen.getAllByText('Dag');
      fireEvent.click(dagItems[dagItems.length - 1]);
      expect(props.tabs.onToggleTabVisibility).toHaveBeenCalledWith('dag');
    });
  });
});
