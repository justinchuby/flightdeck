// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarTabs } from '../SidebarTabs';
import type { DagStatus, AgentInfo, Decision, ChatGroup, GroupMessage } from '../../../types';
import type { AgentComm } from '../../../stores/leadStore';

vi.mock('../DecisionPanel', () => ({
  DecisionPanelContent: () => <div data-testid="decision-panel" />,
}));
vi.mock('../CommsPanel', () => ({
  CommsPanelContent: () => <div data-testid="comms-panel" />,
}));
vi.mock('../GroupsPanel', () => ({
  GroupsPanelContent: () => <div data-testid="groups-panel" />,
}));
vi.mock('../TaskDagPanel', () => ({
  TaskDagPanelContent: () => <div data-testid="dag-panel" />,
}));
vi.mock('../ModelConfigPanel', () => ({
  ModelConfigPanel: () => <div data-testid="model-panel" />,
}));
vi.mock('../../TimerDisplay/TimerDisplay', () => ({
  TimerDisplay: () => <div data-testid="timer-panel" />,
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
    crewTabContent: <div data-testid="crew-content" />,
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

describe('SidebarTabs — coverage', () => {
  describe('drag visual state', () => {
    it('applies drag-over styling when dragging over a tab', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const commsBtn = screen.getByText('Comms').closest('button')!;

      // dragOver sets dragOverTab state → re-renders with blue border
      fireEvent.dragOver(commsBtn, { dataTransfer: { dropEffect: '' } });
      expect(commsBtn.className).toContain('border-blue-400');
    });

    it('clears drag-over styling after dragLeave', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const commsBtn = screen.getByText('Comms').closest('button')!;

      fireEvent.dragOver(commsBtn, { dataTransfer: { dropEffect: '' } });
      expect(commsBtn.className).toContain('border-blue-400');

      fireEvent.dragLeave(commsBtn);
      expect(commsBtn.className).not.toContain('border-blue-400');
    });

    it('clears drag-over styling after dragEnd', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const commsBtn = screen.getByText('Comms').closest('button')!;
      const crewBtn = screen.getByText('Crew').closest('button')!;

      fireEvent.dragOver(commsBtn, { dataTransfer: { dropEffect: '' } });
      expect(commsBtn.className).toContain('border-blue-400');

      fireEvent.dragEnd(crewBtn);
      expect(commsBtn.className).not.toContain('border-blue-400');
    });

    it('clears drag-over styling after drop', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const dagBtn = screen.getByText('DAG').closest('button')!;

      fireEvent.dragOver(dagBtn, { dataTransfer: { dropEffect: '' } });
      expect(dagBtn.className).toContain('border-blue-400');

      // Drop with valid data
      fireEvent.drop(dagBtn, { dataTransfer: { getData: () => 'crew' } });
      expect(dagBtn.className).not.toContain('border-blue-400');
    });
  });

  describe('full drag-drop lifecycle', () => {
    it('performs complete drag reorder: start → over → drop', () => {
      const props = makeProps();
      render(<SidebarTabs {...props} />);
      const crewBtn = screen.getByText('Crew').closest('button')!;
      const groupsBtn = screen.getByText('Groups').closest('button')!;

      // Start drag
      const dt = { setData: vi.fn(), effectAllowed: '', getData: vi.fn().mockReturnValue('crew'), dropEffect: '' };
      fireEvent.dragStart(crewBtn, { dataTransfer: dt });
      expect(dt.setData).toHaveBeenCalledWith('text/plain', 'crew');

      // Hover over target
      fireEvent.dragOver(groupsBtn, { dataTransfer: dt });
      expect(groupsBtn.className).toContain('border-blue-400');

      // Drop
      fireEvent.drop(groupsBtn, { dataTransfer: dt });
      expect(props.tabs.onTabOrderChange).toHaveBeenCalledWith(
        ['groups', 'comms', 'crew', 'dag', 'models', 'timers'],
      );
    });
  });

  describe('active tab styling', () => {
    it('applies active styling to the selected tab', () => {
      const props = makeProps();
      props.tabs.activeTab = 'dag';
      render(<SidebarTabs {...props} />);

      const dagBtn = screen.getByText('DAG').closest('button')!;
      expect(dagBtn.className).toContain('border-yellow-500');

      const crewBtn = screen.getByText('Crew').closest('button')!;
      expect(crewBtn.className).toContain('border-transparent');
    });
  });

  describe('tab ordering edge cases', () => {
    it('appends tabs missing from tabOrder (safety net)', () => {
      const props = makeProps();
      props.tabs.tabOrder = ['crew', 'comms']; // missing groups, dag, models, timers
      render(<SidebarTabs {...props} />);

      expect(screen.getByText('Groups')).toBeTruthy();
      expect(screen.getByText('DAG')).toBeTruthy();
      expect(screen.getByText('Models')).toBeTruthy();
      expect(screen.getByText('Timers')).toBeTruthy();
    });

    it('respects hidden tabs when building ordered list', () => {
      const props = makeProps();
      props.tabs.hiddenTabs = new Set(['comms', 'dag']);
      render(<SidebarTabs {...props} />);

      expect(screen.queryByText('Comms')).toBeNull();
      expect(screen.queryByText('DAG')).toBeNull();
      expect(screen.getByText('Crew')).toBeTruthy();
      expect(screen.getByText('Groups')).toBeTruthy();
    });
  });

  describe('comms tab with leadId', () => {
    it('renders comms panel with lead context', () => {
      const props = makeProps();
      props.tabs.activeTab = 'comms';
      props.selectedLeadId = 'lead-42';
      props.comms = [{ id: 'c1', from: 'a1', to: 'a2', message: 'hi', timestamp: '2025-01-01' } as any];
      render(<SidebarTabs {...props} />);
      expect(screen.getByTestId('comms-panel')).toBeTruthy();
    });
  });
});
