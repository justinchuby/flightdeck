import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Crown, MessageSquare, GitBranch, ChevronDown, ChevronRight, ChevronUp, AlertTriangle, Download, FolderOpen, Eye } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLeadStore } from '../../stores/leadStore';
import { useTimerStore, selectActiveTimerCount } from '../../stores/timerStore';
import type { AgentReport, ProgressSnapshot, ActivityEvent, AgentComm } from '../../stores/leadStore';
import type { AcpTextChunk, DagStatus, Decision, ChatGroup, GroupMessage, Delegation, LeadProgress } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { parseAgentReport } from './AgentReportBlock';
import { BannerDecisionActions } from './DecisionPanel';
import { useFileDrop } from '../../hooks/useFileDrop';
import { useAttachments } from '../../hooks/useAttachments';
import { DropOverlay } from '../DropOverlay';
import { InputComposer } from './InputComposer';
import { ChatMessages, type CatchUpSummary } from './ChatMessages';
import { SidebarTabs } from './SidebarTabs';
import { CrewStatusContent } from './CrewStatusContent';
import { NewProjectModal } from './NewProjectModal';
import { ProgressDetailModal, AgentReportDetailModal } from './ProgressDetailModal';
import { useLeadWebSocket } from './useLeadWebSocket';
import { useDragResize } from './useDragResize';
import type { useApi } from '../../hooks/useApi';
import { apiFetch } from '../../hooks/useApi';
import type { useWebSocket } from '../../hooks/useWebSocket';

/** Shape returned by /api/agents/:id/messages and /api/projects/:id/messages */
interface MessageHistoryResponse {
  messages: Array<{
    content: string;
    sender: string;
    timestamp: string;
    fromRole?: string;
  }>;
}

/** Shape returned by /api/lead — list of active lead agents */
interface LeadListItem {
  id: string;
  status: string;
  role?: string;
  projectId?: string;
}

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
  api: ReturnType<typeof useApi>;
  ws: ReturnType<typeof useWebSocket>;
  readOnly?: boolean;
}

export function LeadDashboard({ api: _api, ws, readOnly = false }: Props) {
  const { projects, selectedLeadId, drafts } = useLeadStore(
    useShallow((s) => ({ projects: s.projects, selectedLeadId: s.selectedLeadId, drafts: s.drafts }))
  );
  const agents = useAppStore((s) => s.agents);

  // Resolve project ID for historical agent derivation:
  // - "project:xxx" → strip prefix to get the project UUID
  // - Live lead UUID → use the lead's projectId, or the lead UUID itself as fallback
  const historicalProjectId = useMemo(() => {
    if (!selectedLeadId) return null;
    if (selectedLeadId.startsWith('project:')) return selectedLeadId.slice(8);
    const lead = agents.find((a) => a.id === selectedLeadId);
    return lead?.projectId ?? selectedLeadId;
  }, [selectedLeadId, agents]);

  // Resolve 'project:xxx' selectedLeadId to the actual active lead agent ID
  const effectiveLeadId = useMemo(() => {
    if (!selectedLeadId?.startsWith('project:')) return selectedLeadId;
    const projectId = selectedLeadId.slice(8);
    return agents.find(
      (a) => a.projectId === projectId && a.role?.id === 'lead' && a.status !== 'terminated',
    )?.id ?? selectedLeadId;
  }, [selectedLeadId, agents]);

  const { agents: derivedAgents } = useHistoricalAgents(agents.length, historicalProjectId);
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
  const reportsScrollRef = useRef<HTMLDivElement>(null);
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
  const [reportsExpanded, setReportsExpanded] = useState(true);
  const [pendingBannerExpanded, setPendingBannerExpanded] = useState(false);

  // ── Catch-up summary banner ──────────────────────────────────────────
  const lastInteractionRef = useRef(Date.now());
  const snapshotRef = useRef<{ tasks: number; decisions: number; comms: number; reports: number }>({ tasks: 0, decisions: 0, comms: 0, reports: 0 });
  const [catchUpSummary, setCatchUpSummary] = useState<CatchUpSummary | null>(null);

  // Track user interactions
  useEffect(() => {
    const markActive = () => {
      lastInteractionRef.current = Date.now();
    };
    const markScroll = () => {
      lastInteractionRef.current = Date.now();
      // Auto-dismiss banner on scroll (designer spec)
      if (catchUpSummary) setCatchUpSummary(null);
    };
    window.addEventListener('click', markActive);
    window.addEventListener('keydown', markActive);
    window.addEventListener('scroll', markScroll, true);
    return () => {
      window.removeEventListener('click', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('scroll', markScroll, true);
    };
  }, [catchUpSummary]);

  // Snapshot current counts on each interaction; check for inactivity on data changes
  useEffect(() => {
    const project = selectedLeadId ? projects[selectedLeadId] : null;
    if (!project) return;
    const currentCounts = {
      tasks: agents.filter(a => a.parentId === effectiveLeadId && (a.status === 'completed' || a.status === 'failed')).length,
      decisions: (project.decisions ?? EMPTY_DECISIONS).filter((d) => d.needsConfirmation && d.status === 'recorded').length,
      comms: (project.comms ?? EMPTY_COMMS).length,
      reports: (project.agentReports ?? EMPTY_REPORTS).length,
    };
    const elapsed = Date.now() - lastInteractionRef.current;
    if (elapsed >= 60_000 && !catchUpSummary) {
      const prev = snapshotRef.current;
      const tasksCompleted = Math.max(0, currentCounts.tasks - prev.tasks);
      const newMessages = Math.max(0, currentCounts.comms - prev.comms);
      const newReports = Math.max(0, currentCounts.reports - prev.reports);
      const totalNew = tasksCompleted + newMessages + newReports;
      if (totalNew >= 5 || currentCounts.decisions > 0) {
        setCatchUpSummary({ tasksCompleted, pendingDecisions: currentCounts.decisions, newMessages, newReports });
      }
    }
    // Always update snapshot when user is active
    if (elapsed < 60_000) {
      snapshotRef.current = currentCounts;
    }
  }, [agents, projects, selectedLeadId, catchUpSummary]);

  // Reset snapshot when switching projects
  useEffect(() => {
    snapshotRef.current = { tasks: 0, decisions: 0, comms: 0, reports: 0 };
    setCatchUpSummary(null);
  }, [selectedLeadId]);

  const currentProject = selectedLeadId ? projects[selectedLeadId] : null;
  const leadAgent = agents.find((a) => a.id === selectedLeadId);
  const isActive = leadAgent && (leadAgent.status === 'running' || leadAgent.status === 'idle');

  // On mount, load existing leads from server (skip in read-only mode — data pre-loaded)
  useEffect(() => {
    if (readOnly) return;
    const controller = new AbortController();
    // Load active leads
    apiFetch('/lead', { signal: controller.signal }).then((leads: LeadListItem[]) => {
      if (controller.signal.aborted) return;
      if (Array.isArray(leads)) {
        leads.forEach((l) => {
          useLeadStore.getState().addProject(l.id);
          // Pre-load message history for each lead
          apiFetch(`/agents/${l.id}/messages?limit=200&includeSystem=true`, { signal: controller.signal })
            .then((data: MessageHistoryResponse) => {
              if (controller.signal.aborted) return;
              if (Array.isArray(data?.messages) && data.messages.length > 0) {
                const msgs: AcpTextChunk[] = data.messages.map((m) => ({
                  type: 'text' as const,
                  text: m.content,
                  sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
                  timestamp: new Date(m.timestamp).getTime(),
                }));
                // Only set if WS hasn't already delivered messages (WS wins)
                const current = useLeadStore.getState().projects[l.id];
                if (!current || current.messages.length === 0) {
                  useLeadStore.getState().setMessages(l.id, msgs);
                }
              }
            })
            .catch((err: unknown) => { if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Message history fetch failed:', err); });
        });
        // Auto-select first running lead if none selected
        if (!useLeadStore.getState().selectedLeadId) {
          const running = leads.find((l) => l.status === 'running');
          if (running) useLeadStore.getState().selectLead(running.id);
        }
      }
    }).catch((err) => {
      if (!controller.signal.aborted) console.warn('[LeadDashboard] Failed to load leads:', err);
    });
    return () => controller.abort();
  }, [readOnly]);

  // Subscribe to selected lead agent WS stream and load message history
  useEffect(() => {
    if (!selectedLeadId) return;
    chatInitialScroll.current = false; // reset so we scroll to bottom on lead change

    // In read-only mode, skip WS — data is pre-loaded by ReadOnlySession wrapper
    if (!readOnly) {
      ws.subscribe(selectedLeadId);
    }

    const controller = new AbortController();
    // Load persisted message history if we don't have any messages yet
    const proj = useLeadStore.getState().projects[selectedLeadId];
    if (!proj || proj.messages.length === 0) {
      // For historical projects (project:XYZ), use project messages endpoint
      const isHistorical = selectedLeadId.startsWith('project:');
      const url = isHistorical
        ? `/api/projects/${selectedLeadId.slice(8)}/messages?limit=200`
        : `/api/agents/${selectedLeadId}/messages?limit=200&includeSystem=true`;
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: MessageHistoryResponse) => {
          if (controller.signal.aborted) return;
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const msgs: AcpTextChunk[] = data.messages.map((m) => ({
              type: 'text' as const,
              text: m.content,
              sender: m.sender as 'agent' | 'user' | 'system' | 'external' | 'thinking',
              ...(m.fromRole ? { fromRole: m.fromRole } : {}),
              timestamp: new Date(m.timestamp).getTime(),
            }));
            // Re-check: only set if WS hasn't delivered messages while we were fetching
            const current = useLeadStore.getState().projects[selectedLeadId];
            if (!current || current.messages.length === 0) {
              useLeadStore.getState().setMessages(selectedLeadId, msgs);
            }
          }
        })
        .catch((err: unknown) => { if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Message history fetch failed:', err); });
    }
    return () => {
      controller.abort();
      if (!readOnly) ws.unsubscribe(selectedLeadId);
    };
  }, [selectedLeadId, ws, readOnly]);

  // Auto-scroll on new messages only if near bottom
  const chatInitialScroll = useRef(false);
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    // On first render or lead change, scroll to bottom unconditionally
    if (!chatInitialScroll.current) {
      chatInitialScroll.current = true;
      messagesEndRef.current?.scrollIntoView();
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentProject?.messages]);

  // Auto-scroll agent reports to show latest
  useEffect(() => {
    const el = reportsScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [currentProject?.agentReports?.length, reportsExpanded]);

  // Poll progress for selected lead (skip for project: prefixed IDs, read-only mode, and terminated agents)
  const isActiveAgent = selectedLeadId != null && !selectedLeadId.startsWith('project:') && !readOnly && isActive === true;
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchProgress = () => {
      if (stopped) return;
      apiFetch(`/lead/${selectedLeadId}/progress`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && data && !data.error) useLeadStore.getState().setProgress(selectedLeadId, data);
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Progress poll failed:', err);
      });
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, isActiveAgent]);

  // Poll decisions for selected lead
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchDecisions = () => {
      if (stopped) return;
      apiFetch(`/lead/${selectedLeadId}/decisions`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) useLeadStore.getState().setDecisions(selectedLeadId, data);
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Decisions poll failed:', err);
      });
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 5000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, isActiveAgent]);

  // Fetch groups for selected lead
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    apiFetch(`/lead/${selectedLeadId}/groups`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && Array.isArray(data)) useLeadStore.getState().setGroups(selectedLeadId, data);
    }).catch((err: unknown) => { if (!(err instanceof DOMException)) console.warn('[LeadDashboard] Groups fetch failed:', err); });
    return () => controller.abort();
  }, [selectedLeadId, isActiveAgent]);

  // Fetch DAG status for selected lead — always use agent UUID for /api/lead/:id/dag
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const controller = new AbortController();
    let stopped = false;
    const fetchDag = () => {
      if (stopped) return;
      apiFetch<DagStatus>(`/lead/${selectedLeadId}/dag`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted && data && data.tasks) {
          const store = useLeadStore.getState();
          store.setDagStatus(selectedLeadId, data);
          // Also store under projectId so DagMinimap can find it by either key
          if (historicalProjectId && historicalProjectId !== selectedLeadId) {
            store.setDagStatus(historicalProjectId, data);
          }
        }
      }).catch((err: unknown) => {
        if (err instanceof Error && err.message.includes('404')) { stopped = true; return; }
        if (!(err instanceof DOMException)) console.warn('[LeadDashboard] DAG poll failed:', err);
      });
    };
    fetchDag();
    const interval = setInterval(fetchDag, 10000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [selectedLeadId, historicalProjectId, isActiveAgent]);

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

  const handleDismissCatchUp = useCallback(() => setCatchUpSummary(null), []);
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

  const sendMessage = useCallback(async (mode: 'queue' | 'interrupt' = 'queue', opts: { broadcast: boolean } = { broadcast: false }) => {
    if (!input.trim() || !selectedLeadId) return;
    const text = input.trim();
    setInput('');
    const store = useLeadStore.getState();
    // For interrupts, insert a separator so post-interrupt response appears as a new bubble
    if (mode === 'interrupt') {
      const proj = store.projects[selectedLeadId];
      const msgs = proj?.messages ?? EMPTY_MESSAGES;
      const last = msgs[msgs.length - 1];
      if (last?.sender === 'agent') {
        store.addMessage(selectedLeadId, { type: 'text', text: '---', sender: 'system', timestamp: Date.now() });
      }
    }
    store.addMessage(selectedLeadId, {
      type: 'text',
      text,
      sender: 'user',
      queued: mode === 'queue',
      timestamp: Date.now(),
      attachments: attachments.length > 0
        ? attachments
            .filter((a) => a.kind === 'image')
            .map((a) => ({ name: a.name, mimeType: a.mimeType, thumbnailDataUrl: a.thumbnailDataUrl }))
        : undefined,
    });
    const payload: Record<string, unknown> = { text, mode };
    if (opts.broadcast) payload.broadcast = true;
    if (attachments.length > 0) {
      payload.attachments = attachments
        .filter((a) => a.data)
        .map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }));
    }
    try {
      await apiFetch(`/lead/${selectedLeadId}/message`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      clearAttachments();
    } catch {
      // Network error — keep attachments so user can retry
    }
  }, [input, selectedLeadId, attachments, clearAttachments]);

  const removeQueuedMessage = useCallback(async (queueIndex: number) => {
    if (!selectedLeadId) return;
    try {
      await apiFetch(`/agents/${selectedLeadId}/queue/${queueIndex}`, { method: 'DELETE' });
      const store = useLeadStore.getState();
      const msgs = store.projects[selectedLeadId]?.messages || [];
      let seen = 0;
      const updated = msgs.filter((m: AcpTextChunk) => {
        if (!m.queued) return true;
        return seen++ !== queueIndex;
      });
      store.setMessages(selectedLeadId, updated);
    } catch { /* ignore */ }
  }, [selectedLeadId]);

  const reorderQueuedMessage = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!selectedLeadId) return;
    try {
      await apiFetch(`/agents/${selectedLeadId}/queue/reorder`, {
        method: 'POST',
        body: JSON.stringify({ from: fromIndex, to: toIndex }),
      });
      const store = useLeadStore.getState();
      const msgs = store.projects[selectedLeadId]?.messages || [];
      const queued = msgs.filter((m: AcpTextChunk) => m.queued);
      const nonQueued = msgs.filter((m: AcpTextChunk) => !m.queued);
      if (fromIndex < queued.length && toIndex < queued.length) {
        const [moved] = queued.splice(fromIndex, 1);
        queued.splice(toIndex, 0, moved);
        store.setMessages(selectedLeadId, [...nonQueued, ...queued]);
      }
    } catch { /* ignore */ }
  }, [selectedLeadId]);

  const handleConfirmDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'confirmed', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  const handleRejectDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'rejected', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  const handleDismissDecision = useCallback(async (decisionId: string) => {
    if (!selectedLeadId) return;
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'dismissed', confirmedAt: new Date().toISOString() });
    const decision = await apiFetch(`/decisions/${decisionId}/dismiss`, {
      method: 'POST',
    });
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
  }, [selectedLeadId]);

  const handleOpenAgentChat = useCallback((agentId: string) => {
    useAppStore.getState().setSelectedAgent(agentId);
  }, []);

  const messages = currentProject?.messages ?? EMPTY_MESSAGES;
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
    const live = agents.filter((a) => a.id === effectiveLeadId || a.parentId === effectiveLeadId);
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
            {/* Progress banner — clickable to open detail */}
            {progress && progress.totalDelegations > 0 && (
              <div
                className="border-b border-th-border px-4 py-1 flex items-center gap-3 text-xs font-mono bg-th-bg-alt/50 cursor-pointer hover:bg-th-bg-alt/80 transition-colors"
                onClick={() => setShowProgressDetail(true)}
                title="Click for detailed progress view"
              >
                <span className="text-blue-400">{progress.crewSize} agents</span>
                <span className="text-yellow-600 dark:text-yellow-400">{progress.active} active</span>
                <span className="text-green-400">{progress.completed} done</span>
                {progress.failed > 0 && (
                  <span className="text-red-400">{progress.failed} failed</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <div className="w-24 bg-th-bg-muted rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${progress.completionPct}%` }}
                    />
                  </div>
                  <span className="text-th-text-muted">{progress.completionPct}%</span>
                </div>
              </div>
            )}
            {progressSummary && (
              <div
                className="border-b border-th-border px-4 py-0.5 text-[11px] text-th-text-muted bg-th-bg-alt/30 font-mono truncate cursor-pointer hover:bg-th-bg-alt/50 transition-colors"
                onClick={() => setShowProgressDetail(true)}
                title="Click for detailed progress view"
              >
                📋 {progressSummary}
              </div>
            )}

            {/* Session info bar — cwd + session ID merged into one line */}
            <div className="border-b border-th-border px-4 py-0.5 flex items-center gap-3 text-[11px] font-mono text-th-text-muted bg-th-bg-alt/20 overflow-x-auto">
              {leadAgent?.cwd && (
                <span className="flex items-center gap-1 shrink-0">
                  <FolderOpen className="w-3 h-3 shrink-0" />
                  {leadAgent.cwd}
                </span>
              )}
              {leadAgent?.sessionId && (
                <span className="flex items-center gap-1 shrink-0 ml-auto">
                  <GitBranch className="w-3 h-3 shrink-0" />
                  {leadAgent.sessionId}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(leadAgent.sessionId!);
                      const btn = e.currentTarget;
                      btn.textContent = '✓';
                      setTimeout(() => { btn.textContent = 'copy'; }, 1500);
                    }}
                    className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0"
                  >
                    copy
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const data = await apiFetch(`/export/${selectedLeadId}`);
                        if (data.error) {
                          alert(`Export failed: ${data.error}`);
                        } else {
                          alert(`Session exported to:\n${data.outputDir}\n\n${data.files.length} files · ${data.agentCount} agents · ${data.eventCount} events`);
                        }
                      } catch {
                        alert('Export failed — server may be unavailable');
                      }
                    }}
                    className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0 flex items-center gap-0.5"
                    title="Export session to disk"
                  >
                    <Download className="w-2.5 h-2.5" />
                  </button>
                </span>
              )}
            </div>

            {/* Agent Reports — compact toggle */}
            {agentReports.length > 0 && (
              <div className="border-b border-th-border bg-amber-500/5 dark:bg-amber-500/10">
                <button
                  className="w-full flex items-center gap-2 px-4 py-1 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
                  onClick={() => setReportsExpanded(!reportsExpanded)}
                >
                  {reportsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <MessageSquare className="w-3 h-3" />
                  <span className="font-mono font-medium">Agent Reports</span>
                  <span className="bg-amber-500/20 px-1.5 rounded text-[10px]">{agentReports.length}</span>
                </button>
                {reportsExpanded && (
                  <div ref={reportsScrollRef} className="max-h-48 overflow-y-auto px-3 pb-2 space-y-1">
                    {agentReports.slice(-20).map((r) => {
                      const time = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const parsed = parseAgentReport(r.content);
                      const summary = parsed.isReport
                        ? [parsed.header, parsed.task].filter(Boolean).join(' — ')
                        : r.content.split('\n')[0];
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 px-2 py-1 rounded bg-amber-500/[0.06] border border-amber-400/20 border-l-2 border-l-amber-500/30 cursor-pointer hover:bg-amber-500/[0.10] transition-colors"
                          onClick={() => setExpandedReport(r)}
                        >
                          <span className="text-[10px] font-mono text-th-text-muted shrink-0">{time}</span>
                          <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400 shrink-0">{r.fromRole}</span>
                          <span className="text-xs font-mono text-th-text-alt truncate min-w-0">{summary}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Pending decisions banner */}
            {pendingConfirmations.length > 0 && !readOnly && (
              <div className="border-b border-amber-700/50 bg-amber-900/30">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-amber-600 dark:text-amber-200 hover:bg-amber-900/40 transition-colors"
                  onClick={() => setPendingBannerExpanded(!pendingBannerExpanded)}
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-mono font-medium">⚠ {pendingConfirmations.length} decision{pendingConfirmations.length !== 1 ? 's' : ''} need{pendingConfirmations.length === 1 ? 's' : ''} your confirmation</span>
                  {pendingBannerExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto text-amber-400" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto text-amber-400" />}
                </button>
                {pendingBannerExpanded && (
                  <div className="px-4 pb-3 space-y-2">
                    {pendingConfirmations.map((d) => (
                      <div key={d.id} className="bg-th-bg-alt/80 border border-amber-700/40 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-mono font-semibold text-th-text-alt">{d.title}</span>
                              {d.agentRole && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">{d.agentRole}</span>
                              )}
                            </div>
                            {d.rationale && (
                              <p className="text-xs font-mono text-th-text-muted line-clamp-2">{d.rationale}</p>
                            )}
                          </div>
                        </div>
                        <BannerDecisionActions
                          decisionId={d.id}
                          onConfirm={handleConfirmDecision}
                          onReject={handleRejectDecision}
                          onDismiss={handleDismissDecision}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ChatMessages
              messages={messages}
              agents={agents}
              isActive={!!isActive}
              chatContainerRef={chatContainerRef}
              messagesEndRef={messagesEndRef}
              catchUpSummary={catchUpSummary}
              onDismissCatchUp={handleDismissCatchUp}
              onScrollToBottom={handleScrollToBottom}
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
