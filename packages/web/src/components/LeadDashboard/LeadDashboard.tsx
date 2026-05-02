import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Crown, Eye } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLeadStore } from '../../stores/leadStore';
import { useMessageStore } from '../../stores/messageStore';
import { useTimerStore, selectActiveTimerCount } from '../../stores/timerStore';
import type { AgentReport, ProgressSnapshot, ActivityEvent, AgentComm } from '../../stores/leadStore';
import type { AcpTextChunk, Decision, ChatGroup, GroupMessage, Delegation, LeadProgress } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { useFileDrop } from '../../hooks/useFileDrop';
import { useAttachments } from '../../hooks/useAttachments';
import { DropOverlay } from '../DropOverlay';
import { InputComposer } from './InputComposer';
import { ChatMessages } from './ChatMessages';
import { SidebarTabs } from './SidebarTabs';
import { CrewStatusContent } from './CrewStatusContent';
import { NewProjectModal } from './NewProjectModal';
import { ProgressDetailModal, AgentReportDetailModal } from './ProgressDetailModal';
import { useLeadWebSocket } from './useLeadWebSocket';
import { useDragResize } from './useDragResize';
import { useWebSocketContext } from '../../contexts/WebSocketContext';
import { useLeadPolling } from './useLeadPolling';
import { useLeadMessages } from './useLeadMessages';
import { useCatchUpSummary } from './useCatchUpSummary';
import { useDecisionActions } from './useDecisionActions';
import { useMessageActions } from './useMessageActions';
import { LeadProgressBanner } from './LeadProgressBanner';
import { LeadAgentReportsBanner } from './LeadAgentReportsBanner';
import { LeadPendingDecisionsBanner } from './LeadPendingDecisionsBanner';
import { LeadSessionInfoBar } from './LeadSessionInfoBar';

// Stable empty references — avoids new [] / {} on every render (zustand equality trap)
const EMPTY_MESSAGES: AcpTextChunk[] = [];
const EMPTY_DECISIONS: Decision[] = [];
const EMPTY_PROGRESS_HISTORY: ProgressSnapshot[] = [];
const EMPTY_ACTIVITY: ActivityEvent[] = [];
const EMPTY_COMMS: AgentComm[] = [];
const EMPTY_REPORTS: AgentReport[] = [];
const EMPTY_GROUPS: ChatGroup[] = [];
const EMPTY_GROUP_MESSAGES: Record<string, GroupMessage[]> = {};
const EMPTY_DELEGATIONS: Delegation[] = [];
const EMPTY_CREW_AGENTS: LeadProgress['crewAgents'] = [];

interface Props {
  readOnly?: boolean;
}

export function LeadDashboard({ readOnly = false }: Props) {
  const ws = useWebSocketContext();
  const { projects, selectedLeadId, drafts } = useLeadStore(
    useShallow((s) => ({ projects: s.projects, selectedLeadId: s.selectedLeadId, drafts: s.drafts }))
  );
  const agents = useAppStore((s) => s.agents);
  const connected = useAppStore((s) => s.connected);
  // Derive project ID from the selected lead agent
  const historicalProjectId = useMemo(() => {
    if (!selectedLeadId) return null;
    const lead = agents.find((a) => a.id === selectedLeadId);
    return lead?.projectId ?? selectedLeadId;
  }, [selectedLeadId, agents]);

  const { agents: derivedAgents } = useHistoricalAgents(agents.length, historicalProjectId, connected);
  const activeTimerCount = useTimerStore(selectActiveTimerCount);
  const input = selectedLeadId ? (drafts[selectedLeadId] ?? '') : '';
  const setInput = useCallback((text: string) => {
    if (selectedLeadId) useLeadStore.getState().setDraft(selectedLeadId, text);
  }, [selectedLeadId]);
  const { attachments, addAttachment, removeAttachment, clearAttachments } = useAttachments();
  const { isDragOver: isLeadDragOver, handleDragOver: leadDragOver, handleDragLeave: leadDragLeave, handleDrop: leadDrop, handlePaste: leadPaste, dropZoneClassName: _leadDropZoneClassName } = useFileDrop({
    onAttach: addAttachment,
  });
  const [showNewProject, setShowNewProject] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<string>('crew');
  const [sidebarTabHeight, setSidebarTabHeight] = useState(280);
  const [decisionsPanelHeight, setDecisionsPanelHeight] = useState(180);
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    const allSupportedTabs = ['crew', 'comms', 'groups', 'dag', 'models', 'costs', 'timers'];
    try {
      const stored = localStorage.getItem('flightdeck-sidebar-tabs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 4) {
          const tabs = parsed.filter((id: string) => id !== 'activity');
          // Migrate: ensure all supported tabs are present
          let changed = false;
          for (const tab of allSupportedTabs) {
            if (!tabs.includes(tab)) {
              tabs.push(tab);
              changed = true;
            }
          }
          if (changed) localStorage.setItem('flightdeck-sidebar-tabs', JSON.stringify(tabs));
          return tabs;
        }
      }
    } catch {}
    return allSupportedTabs;
  });
  const [hiddenTabs, setHiddenTabs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('flightdeck-hidden-tabs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {}
    return new Set();
  });
  const [showTabConfig, setShowTabConfig] = useState(false);
  const [showProgressDetail, setShowProgressDetail] = useState(false);
  const [expandedReport, setExpandedReport] = useState<AgentReport | null>(null);

  const currentProject = selectedLeadId ? projects[selectedLeadId] : null;
  const leadAgent = agents.find((a) => a.id === selectedLeadId);
  const isActive = leadAgent && (leadAgent.status === 'running' || leadAgent.status === 'idle');

  const { catchUpSummary, dismissCatchUp } = useCatchUpSummary(selectedLeadId, agents, currentProject);

  const chatInitialScroll = useRef(false);
  const { hasMore, loadingOlder, loadOlderMessages } = useLeadMessages(selectedLeadId, readOnly, ws, chatInitialScroll);

  const isActiveAgent = selectedLeadId != null && !readOnly && isActive === true;
  useLeadPolling(selectedLeadId, isActiveAgent, historicalProjectId);

  // Auto-scroll on new messages
  const channelMessages = useMessageStore((s) => selectedLeadId ? s.channels[selectedLeadId]?.messages : undefined);
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    if (!chatInitialScroll.current) {
      chatInitialScroll.current = true;
      messagesEndRef.current?.scrollIntoView();
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [channelMessages]);

  const reportsScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = reportsScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [currentProject?.agentReports?.length]);

  // Listen for lead-specific WebSocket events (skip in read-only mode)
  const wsAgents = readOnly ? [] : agents;
  const wsProjectId = readOnly ? null : historicalProjectId;
  useLeadWebSocket(wsAgents, wsProjectId);

  // Sidebar resize handlers
  const startResize = useDragResize('x', sidebarWidth, setSidebarWidth, 200, 600, true);
  const startTabResize = useDragResize('y', sidebarTabHeight, setSidebarTabHeight, 120, 600, true);
  const startDecisionsResize = useDragResize('y', decisionsPanelHeight, setDecisionsPanelHeight, 80, 400);

  const handleTabOrderChange = useCallback((newOrder: string[]) => {
    setTabOrder(newOrder);
    try { localStorage.setItem('flightdeck-sidebar-tabs', JSON.stringify(newOrder)); } catch {}
  }, []);

  const handleScrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const toggleTabVisibility = useCallback((tabId: string) => {
    setHiddenTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      try { localStorage.setItem('flightdeck-hidden-tabs', JSON.stringify([...next])); } catch {}
      // If hiding the active tab, switch to first visible tab
      if (next.has(tabId)) {
        setSidebarTab((current) => {
          if (current === tabId) {
            const allSupportedTabs = ['crew', 'comms', 'groups', 'dag', 'models', 'costs', 'timers'];
            return allSupportedTabs.find((id) => !next.has(id)) ?? 'crew';
          }
          return current;
        });
      }
      return next;
    });
  }, []);

  const { sendMessage, removeQueuedMessage, reorderQueuedMessage } = useMessageActions(
    selectedLeadId, input, setInput, attachments, clearAttachments,
  );

  const { handleConfirmDecision, handleRejectDecision, handleDismissDecision } = useDecisionActions(selectedLeadId);

  const handleOpenAgentChat = useCallback((agentId: string) => {
    useAppStore.getState().setSelectedAgent(agentId);
  }, []);

  const messages = channelMessages ?? EMPTY_MESSAGES;
  const decisions = currentProject?.decisions ?? EMPTY_DECISIONS;
  const pendingConfirmations = decisions.filter((d) => d.needsConfirmation && d.status === 'recorded');
  const progress = currentProject?.progress ?? null;
  const progressSummary = currentProject?.progressSummary ?? null;
  const progressHistory = currentProject?.progressHistory ?? EMPTY_PROGRESS_HISTORY;
  const activity = currentProject?.activity ?? EMPTY_ACTIVITY;
  const comms = currentProject?.comms ?? EMPTY_COMMS;
  const agentReports = currentProject?.agentReports ?? EMPTY_REPORTS;
  const groups = currentProject?.groups ?? EMPTY_GROUPS;
  const groupMessages = currentProject?.groupMessages ?? EMPTY_GROUP_MESSAGES;
  const dagStatus = currentProject?.dagStatus ?? null;
  const teamAgents = (() => {
    const live = agents.filter((a) => a.id === selectedLeadId || a.parentId === selectedLeadId);
    if (live.length > 0) return live;
    // Fallback: progress endpoint, then keyframe-derived agents
    const progressTeam = progress?.crewAgents ?? EMPTY_CREW_AGENTS;
    return progressTeam.length > 0 ? progressTeam : derivedAgents;
  })();

  const teamAgentIds = useMemo(() => new Set(teamAgents.map((a) => a.id)), [teamAgents]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* New project modal */}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}

      {/* Main content */}
      {!selectedLeadId ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Crown className="w-16 h-16 text-yellow-600/30 dark:text-yellow-400/30 mx-auto mb-4" />
            <p className="text-th-text-muted font-mono text-sm">Select a project or create a new one</p>
          </div>
        </div>
      ) : (
        <>
          {/* Chat area */}
          <div
            className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative"
            onDragOver={leadDragOver}
            onDragLeave={leadDragLeave}
            onDrop={leadDrop}
            onPaste={leadPaste}
          >
            {isLeadDragOver && <DropOverlay />}
            <LeadProgressBanner progress={progress} progressSummary={progressSummary} onShowDetail={() => setShowProgressDetail(true)} />

            <LeadSessionInfoBar leadAgent={leadAgent} selectedLeadId={selectedLeadId} />

            <LeadAgentReportsBanner agentReports={agentReports} reportsScrollRef={reportsScrollRef} onExpandReport={setExpandedReport} />

            {!readOnly && (
              <LeadPendingDecisionsBanner pendingConfirmations={pendingConfirmations} onConfirm={handleConfirmDecision} onReject={handleRejectDecision} onDismiss={handleDismissDecision} />
            )}

            <ChatMessages
              messages={messages}
              agents={agents}
              isActive={!!isActive}
              chatContainerRef={chatContainerRef}
              messagesEndRef={messagesEndRef}
              catchUpSummary={catchUpSummary}
              onDismissCatchUp={dismissCatchUp}
              onScrollToBottom={handleScrollToBottom}
              onLoadOlder={loadOlderMessages}
              hasMore={hasMore}
              loadingOlder={loadingOlder}
            />

            {readOnly ? (
              <div className="border-t border-th-border px-4 py-2 bg-th-bg-alt/50 flex items-center gap-2 text-xs font-mono text-th-text-muted">
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>Viewing past session — read-only</span>
              </div>
            ) : (
              <InputComposer
                input={input}
                onInputChange={setInput}
                isActive={!!isActive}
                selectedLeadId={selectedLeadId}
                messages={messages}
                attachments={attachments}
                onRemoveAttachment={removeAttachment}
                onSendMessage={sendMessage}
                onRemoveQueuedMessage={removeQueuedMessage}
                onReorderQueuedMessage={reorderQueuedMessage}
              />
            )}
          </div>

          <SidebarTabs
            layout={{
              collapsed: sidebarCollapsed,
              onToggle: () => setSidebarCollapsed((v) => !v),
              width: sidebarWidth,
              onResize: startResize,
            }}
            tabs={{
              activeTab: sidebarTab,
              onTabChange: setSidebarTab,
              tabOrder,
              onTabOrderChange: handleTabOrderChange,
              hiddenTabs,
              onToggleTabVisibility: toggleTabVisibility,
              showConfig: showTabConfig,
              onToggleConfig: () => setShowTabConfig((v) => !v),
              onResize: startTabResize,
            }}
            decision={{
              decisions,
              pendingConfirmations: readOnly ? [] : pendingConfirmations,
              panelHeight: decisionsPanelHeight,
              onResize: startDecisionsResize,
              // In read-only mode, pass noop handlers to prevent accidental POSTs
              // to /api/decisions/:id — historical sessions may have unresolved decisions
              // whose action buttons would otherwise be live.
              ...(readOnly
                ? { onConfirm: async () => {}, onReject: async () => {}, onDismiss: async () => {} }
                : { onConfirm: handleConfirmDecision, onReject: handleRejectDecision, onDismiss: handleDismissDecision }
              ),
            }}
            crewTabContent={
              <CrewStatusContent
                agents={teamAgents}
                delegations={progress?.delegations ?? EMPTY_DELEGATIONS}
                comms={comms}
                activity={activity}
                allAgents={agents}
                onOpenChat={handleOpenAgentChat}
              />
            }
            comms={comms}
            groups={groups}
            groupMessages={groupMessages}
            dagStatus={dagStatus}
            leadAgent={leadAgent}
            selectedLeadId={selectedLeadId}
            activeTimerCount={activeTimerCount}
            crewAgentIds={teamAgentIds}
          />
        </>
      )}

      {/* Progress detail popup */}
      {showProgressDetail && (
        <ProgressDetailModal
          progress={progress}
          progressHistory={progressHistory}
          onClose={() => setShowProgressDetail(false)}
        />
      )}

      {/* Agent report detail popup */}
      {expandedReport && (
        <AgentReportDetailModal
          report={expandedReport}
          onClose={() => setExpandedReport(null)}
        />
      )}
    </div>
  );
}
