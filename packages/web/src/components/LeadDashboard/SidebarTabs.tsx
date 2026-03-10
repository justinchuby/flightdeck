import { useState, useCallback } from 'react';
import {
  Bot,
  MessageSquare,
  Users,
  Network,
  Wrench,
  BarChart3,
  Clock,
  PanelRightClose,
  PanelRightOpen,
  Lightbulb,
  Settings,
  Eye,
  EyeOff,
} from 'lucide-react';
import { DecisionPanelContent } from './DecisionPanel';
import { CommsPanelContent } from './CommsPanel';
import { GroupsPanelContent } from './GroupsPanel';
import { TaskDagPanelContent } from './TaskDagPanel';
import { ModelConfigPanel } from './ModelConfigPanel';
import { CostBreakdown } from '../TokenEconomics/CostBreakdown';
import { TimerDisplay } from '../TimerDisplay/TimerDisplay';
import type { DagStatus, AgentInfo } from '../../types';
import type { AgentComm } from '../../stores/leadStore';

export interface SidebarLayoutProps {
  collapsed: boolean;
  onToggle: () => void;
  width: number;
  onResize: (e: React.MouseEvent) => void;
}

export interface TabStateProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  tabOrder: string[];
  onTabOrderChange: (order: string[]) => void;
  hiddenTabs: Set<string>;
  onToggleTabVisibility: (tabId: string) => void;
  showConfig: boolean;
  onToggleConfig: () => void;
  onResize: (e: React.MouseEvent) => void;
}

export interface DecisionProps {
  decisions: any[];
  pendingConfirmations: any[];
  panelHeight: number;
  onResize: (e: React.MouseEvent) => void;
  onConfirm: (id: string, reason?: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}

interface SidebarTabsProps {
  layout: SidebarLayoutProps;
  tabs: TabStateProps;
  decision: DecisionProps;
  crewTabContent: React.ReactNode;
  comms: AgentComm[];
  groups: any[];
  groupMessages: Record<string, any>;
  dagStatus: DagStatus | null;
  leadAgent: AgentInfo | undefined;
  selectedLeadId: string | null;
  activeTimerCount: number;
  crewAgentIds: Set<string>;
}

export function SidebarTabs({
  layout,
  tabs,
  decision,
  crewTabContent,
  comms,
  groups,
  groupMessages,
  dagStatus,
  leadAgent,
  selectedLeadId,
  activeTimerCount,
  crewAgentIds,
}: SidebarTabsProps) {
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);

  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleTabDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTab(tabId);
  }, []);

  const handleTabDrop = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault();
    setDragOverTab(null);
    const sourceTabId = e.dataTransfer.getData('text/plain');
    if (!sourceTabId || sourceTabId === targetTabId) return;
    const newOrder = [...tabs.tabOrder];
    const srcIdx = newOrder.indexOf(sourceTabId);
    const tgtIdx = newOrder.indexOf(targetTabId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    [newOrder[srcIdx], newOrder[tgtIdx]] = [newOrder[tgtIdx], newOrder[srcIdx]];
    tabs.onTabOrderChange(newOrder);
  }, [tabs]);

  const handleTabDragEnd = useCallback(() => {
    setDragOverTab(null);
  }, []);

  const allTabs: Record<string, { icon: React.ReactNode; label: string; badge?: number }> = {
    crew: { icon: <Bot className="w-3 h-3" />, label: 'Crew' },
    comms: { icon: <MessageSquare className="w-3 h-3" />, label: 'Comms', badge: comms.length },
    groups: { icon: <Users className="w-3 h-3" />, label: 'Groups', badge: groups.length },
    dag: { icon: <Network className="w-3 h-3" />, label: 'DAG', badge: dagStatus?.tasks.length },
    models: { icon: <Wrench className="w-3 h-3" />, label: 'Models' },
    costs: { icon: <BarChart3 className="w-3 h-3" />, label: 'Attribution' },
    timers: { icon: <Clock className="w-3 h-3" />, label: 'Timers', badge: activeTimerCount || undefined },
  };

  if (layout.collapsed) {
    return (
      <div className="border-l border-th-border flex flex-col items-center py-2 w-10 shrink-0">
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={() => layout.onToggle()}
          className="p-1.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text relative"
          title="Expand sidebar"
        >
          <PanelRightOpen className="w-4 h-4" />
          {decision.pendingConfirmations.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-yellow-500 rounded-full text-[8px] font-bold text-black flex items-center justify-center" title={`${decision.pendingConfirmations.length} decision(s) need confirmation`}>
              {decision.pendingConfirmations.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  const orderedIds = tabs.tabOrder.filter((id) => id in allTabs && !tabs.hiddenTabs.has(id));
  // Append any missing visible tabs (safety net)
  for (const id of Object.keys(allTabs)) {
    if (!orderedIds.includes(id) && !tabs.hiddenTabs.has(id)) orderedIds.push(id);
  }

  return (
    <div className="flex shrink-0" style={{ width: layout.width }}>
      {/* Drag handle */}
      <div
        onMouseDown={layout.onResize}
        className="w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0"
      />
      <div className="flex-1 border-l border-th-border flex flex-col overflow-hidden min-w-0">
        <div className="px-2 py-1 border-b border-th-border flex items-center justify-end shrink-0">
          <button
            type="button"
            aria-label="Collapse sidebar"
            onClick={() => layout.onToggle()}
            className="p-1 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text"
            title="Collapse sidebar"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Decisions — always visible at top */}
        <div className="shrink-0 flex flex-col relative" style={{ height: decision.panelHeight, maxHeight: '30%' }}>
          <div className="px-3 py-1.5 flex items-center gap-2 border-b border-th-border shrink-0">
            <Lightbulb className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-xs font-semibold">Decisions</span>
            {decision.pendingConfirmations.length > 0 && (
              <span className="w-2 h-2 bg-yellow-500 rounded-full" title={`${decision.pendingConfirmations.length} pending`} />
            )}
            <span className="text-[10px] text-th-text-muted ml-auto">{decision.decisions.length}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <DecisionPanelContent decisions={decision.decisions} onConfirm={decision.onConfirm} onReject={decision.onReject} onDismiss={decision.onDismiss} />
          </div>
          {/* Resize handle for decisions panel */}
          <div
            onMouseDown={decision.onResize}
            className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0 absolute bottom-0 left-0 right-0"
            style={{ transform: 'translateY(2px)', zIndex: 10 }}
          />
        </div>

        {/* Tabbed bottom panels */}
        <div className="flex-1 min-h-0 border-t border-th-border flex flex-col relative">
          <div className="flex flex-wrap border-b border-th-border shrink-0 items-center">
            {orderedIds.map((tabId) => {
              const tab = allTabs[tabId];
              return (
                <button
                  key={tabId}
                  draggable
                  onDragStart={(e) => handleTabDragStart(e, tabId)}
                  onDragOver={(e) => handleTabDragOver(e, tabId)}
                  onDrop={(e) => handleTabDrop(e, tabId)}
                  onDragEnd={handleTabDragEnd}
                  onDragLeave={() => setDragOverTab(null)}
                  onClick={() => tabs.onTabChange(tabId)}
                  className={`flex items-center gap-1 px-2 py-1.5 text-[11px] whitespace-nowrap border-b-2 transition-colors cursor-grab active:cursor-grabbing ${
                    dragOverTab === tabId
                      ? 'border-blue-400 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                      : tabs.activeTab === tabId
                        ? 'border-yellow-500 text-yellow-600 dark:text-yellow-400'
                        : 'border-transparent text-th-text-muted hover:text-th-text-alt'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span className="text-[9px] bg-th-bg-muted text-th-text-muted px-1 rounded-full ml-0.5">{tab.badge}</span>
                  )}
                </button>
              );
            })}
            {/* Tab visibility settings */}
            <div className="relative ml-auto">
              <button
                onClick={() => tabs.onToggleConfig()}
                className="flex items-center px-1.5 py-1.5 text-th-text-muted hover:text-th-text-alt transition-colors"
                title="Configure visible tabs"
              >
                <Settings className="w-3 h-3" />
              </button>
              {tabs.showConfig && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => tabs.onToggleConfig()} />
                  <div className="absolute right-0 top-full mt-1 z-50 glass-dropdown rounded-md py-1 min-w-[140px]">
                    {(['crew', 'comms', 'groups', 'dag', 'models', 'costs', 'timers'] as const).map((tabId) => (
                      <button
                        key={tabId}
                        onClick={() => tabs.onToggleTabVisibility(tabId)}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] hover:bg-th-bg-muted transition-colors"
                      >
                        {tabs.hiddenTabs.has(tabId)
                          ? <EyeOff className="w-3 h-3 text-th-text-muted" />
                          : <Eye className="w-3 h-3 text-blue-500" />
                        }
                        <span className={tabs.hiddenTabs.has(tabId) ? 'text-th-text-muted' : ''}>{tabId.charAt(0).toUpperCase() + tabId.slice(1)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {tabs.activeTab === 'crew' && crewTabContent}
            {tabs.activeTab === 'comms' && <CommsPanelContent comms={comms} groupMessages={groupMessages} leadId={selectedLeadId ?? undefined} />}

            {tabs.activeTab === 'groups' && <GroupsPanelContent groups={groups} groupMessages={groupMessages} leadId={selectedLeadId} projectId={leadAgent?.projectId ?? (selectedLeadId?.startsWith('project:') ? selectedLeadId.slice(8) : null)} />}
            {tabs.activeTab === 'dag' && <TaskDagPanelContent dagStatus={dagStatus} />}
            {tabs.activeTab === 'models' && leadAgent?.projectId && (
              <div className="h-full overflow-y-auto p-2">
                <ModelConfigPanel projectId={leadAgent.projectId} compact />
              </div>
            )}
            {tabs.activeTab === 'models' && !leadAgent?.projectId && (
              <div className="flex items-center justify-center h-full text-th-text-muted text-xs">
                No project selected
              </div>
            )}
            {tabs.activeTab === 'costs' && <CostBreakdown />}
            {tabs.activeTab === 'timers' && <TimerDisplay projectAgentIds={crewAgentIds} />}
          </div>
          {/* Resize handle for tabbed section */}
          <div
            onMouseDown={tabs.onResize}
            className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0 absolute top-0 left-0 right-0"
            style={{ transform: 'translateY(-2px)' }}
          />
        </div>
      </div>
    </div>
  );
}
