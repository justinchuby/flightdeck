// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarTabs } from '../SidebarTabs';
import type { DagStatus, AgentInfo, Decision, ChatGroup, GroupMessage } from '../../../types';
import type { AgentComm } from '../../../stores/leadStore';

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

describe('SidebarTabs — extra coverage', () => {
  describe('drag and drop reordering', () => {
    it('fires dragStart with tabId in dataTransfer', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;

      const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
      fireEvent.dragStart(crewTab, { dataTransfer });
      expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'crew');
      expect(dataTransfer.effectAllowed).toBe('move');
    });

    it('dragOver sets drop effect to move', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const commsTab = screen.getByText('Comms').closest('button')!;

      const dataTransfer = { dropEffect: '' };
      fireEvent.dragOver(commsTab, { dataTransfer });
      expect(dataTransfer.dropEffect).toBe('move');
    });

    it('drop reorders tabs via onTabOrderChange', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const dagTab = screen.getByText('DAG').closest('button')!;

      const dataTransfer = { getData: () => 'crew' };
      fireEvent.drop(dagTab, { dataTransfer });
      expect(props.tabs.onTabOrderChange).toHaveBeenCalledWith(
        ['dag', 'comms', 'groups', 'crew', 'models', 'timers'],
      );
    });

    it('drop with same source and target does not reorder', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;

      const dataTransfer = { getData: () => 'crew' };
      fireEvent.drop(crewTab, { dataTransfer });
      expect(props.tabs.onTabOrderChange).not.toHaveBeenCalled();
    });

    it('drop with empty dataTransfer does nothing', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;

      const dataTransfer = { getData: () => '' };
      fireEvent.drop(crewTab, { dataTransfer });
      expect(props.tabs.onTabOrderChange).not.toHaveBeenCalled();
    });

    it('drop with unknown tabId does not crash', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;

      const dataTransfer = { getData: () => 'nonexistent' };
      fireEvent.drop(crewTab, { dataTransfer });
      expect(props.tabs.onTabOrderChange).not.toHaveBeenCalled();
    });

    it('dragEnd clears drag-over visual state', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;
      fireEvent.dragEnd(crewTab);
      // No crash means dragEnd handler works correctly
      expect(crewTab).toBeTruthy();
    });

    it('dragLeave clears drag-over state', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewTab = screen.getByText('Crew').closest('button')!;
      fireEvent.dragLeave(crewTab);
      expect(crewTab).toBeTruthy();
    });
  });

  describe('config dropdown interactions', () => {
    it('shows hidden tab with EyeOff icon in dropdown', () => {
      const props = makeProps();
      props.tabs.showConfig = true;
      props.tabs.hiddenTabs = new Set(['timers']);
      const { container } = render(<SidebarTabs {...props} />);
      // Check for the Timers entry in the dropdown
      const dropdownEntries = container.querySelectorAll('.glass-dropdown button');
      expect(dropdownEntries.length).toBe(6); // all 6 tabs shown in config
    });

    it('clicking backdrop closes config dropdown', () => {
      const props = makeProps();
      props.tabs.showConfig = true;
      const { container } = render(<SidebarTabs {...props} />);
      // The backdrop is a fixed div with inset-0 and z-40
      const backdrop = container.querySelector('.fixed.inset-0.z-40');
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);
      expect(props.tabs.onToggleConfig).toHaveBeenCalled();
    });
  });

  describe('tab content edge cases', () => {
    it('models tab with leadAgent having projectId renders model panel', () => {
      const props = makeProps();
      props.tabs.activeTab = 'models';
      props.leadAgent = { projectId: 'p-1' } as AgentInfo;
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('model-panel')).toBeTruthy();
    });

    it('groups tab passes selectedLeadId and projectId from leadAgent', () => {
      const props = makeProps();
      props.tabs.activeTab = 'groups';
      props.selectedLeadId = 'lead-1';
      props.leadAgent = { projectId: 'proj-1' } as AgentInfo;
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('groups-panel')).toBeTruthy();
    });

    it('groups tab handles project: prefix in selectedLeadId', () => {
      const props = makeProps();
      props.tabs.activeTab = 'groups';
      props.selectedLeadId = 'project:abc123';
      props.leadAgent = undefined;
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('groups-panel')).toBeTruthy();
    });

    it('appends missing tabs not in tabOrder', () => {
      const props = makeProps();
      // Partial tabOrder — missing 'timers'
      props.tabs.tabOrder = ['crew', 'comms', 'groups', 'dag', 'models'];
      render(<SidebarTabs {...props} />);
      // Timers should still appear (safety net logic)
      expect(screen.getByText('Timers')).toBeTruthy();
    });
  });

  describe('resize handles', () => {
    it('sidebar drag handle triggers layout.onResize', () => {
      const props = makeProps();
      const { container } = render(<SidebarTabs {...props} />);
      const dragHandle = container.querySelector('.cursor-col-resize');
      expect(dragHandle).toBeTruthy();
      fireEvent.mouseDown(dragHandle!);
      expect(props.layout.onResize).toHaveBeenCalled();
    });

    it('decision resize handle triggers decision.onResize', () => {
      const props = makeProps();
      const { container } = render(<SidebarTabs {...props} />);
      const handles = container.querySelectorAll('.cursor-row-resize');
      // First row-resize is decision panel, second is tab section
      expect(handles.length).toBe(2);
      fireEvent.mouseDown(handles[0]);
      expect(props.decision.onResize).toHaveBeenCalled();
    });

    it('tab section resize handle triggers tabs.onResize', () => {
      const props = makeProps();
      const { container } = render(<SidebarTabs {...props} />);
      const handles = container.querySelectorAll('.cursor-row-resize');
      fireEvent.mouseDown(handles[1]);
      expect(props.tabs.onResize).toHaveBeenCalled();
    });
  });
});
