import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Crown, Send, Users, CheckCircle, Clock, Loader2, Plus, Trash2, Wrench, MessageSquare, GitBranch, ChevronDown, ChevronRight, ChevronUp, FolderOpen, Check, X, BarChart3, AlertTriangle, Square, Filter, Download, Zap, AlertCircle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLeadStore } from '../../stores/leadStore';
import { useTimerStore, selectActiveTimerCount } from '../../stores/timerStore';
import type { ActivityEvent, AgentComm, ProgressSnapshot, AgentReport } from '../../stores/leadStore';
import type { AcpTextChunk, ChatGroup, GroupMessage, DagStatus } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { MentionText, MarkdownContent, InlineMarkdownWithMentions } from '../../utils/markdown';
import { classifyMessage, tierPassesFilter, TIER_CONFIG, type TierFilter, type FeedItem } from '../../utils/messageTiers';
import { ModelConfigPanel } from './ModelConfigPanel';
import { formatTokens, AgentReportBlock } from './AgentReportBlock';
import { BannerDecisionActions } from './DecisionPanel';
import { CollapsibleReasoningBlock, RichContentBlock, AgentTextBlock } from './ChatRenderers';
import { CwdBar } from './CwdBar';
import { TokenEconomics } from '../TokenEconomics/TokenEconomics';
import { FolderPicker } from '../FolderPicker/FolderPicker';
import { agentStatusText } from '../../utils/statusColors';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { useFileDrop } from '../../hooks/useFileDrop';
import { useAttachments } from '../../hooks/useAttachments';
import { DropOverlay } from '../DropOverlay';
import { InputComposer } from './InputComposer';
import { ChatMessages, type CatchUpSummary } from './ChatMessages';
import { SidebarTabs } from './SidebarTabs';

interface RoleInfo { id: string; name: string; icon: string; description: string; model: string; }

interface Props {
  api: any;
  ws: any;
}

export function LeadDashboard({ api, ws }: Props) {
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

  const { agents: derivedAgents } = useHistoricalAgents(agents.length, historicalProjectId);
  const activeTimerCount = useTimerStore(selectActiveTimerCount);
  const input = selectedLeadId ? (drafts[selectedLeadId] ?? '') : '';
  const setInput = useCallback((text: string) => {
    if (selectedLeadId) useLeadStore.getState().setDraft(selectedLeadId, text);
  }, [selectedLeadId]);
  const handleLeadFileInsert = useCallback((text: string) => {
    setInput(input ? input + ' ' + text : text);
  }, [input, setInput]);
  const { attachments, addAttachment, removeAttachment, clearAttachments } = useAttachments();
  const { isDragOver: isLeadDragOver, handleDragOver: leadDragOver, handleDragLeave: leadDragLeave, handleDrop: leadDrop, handlePaste: leadPaste, dropZoneClassName: leadDropZoneClassName } = useFileDrop({
    onInsertText: handleLeadFileInsert,
    onAttach: addAttachment,
  });
  const [starting, setStarting] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameTouched, setNewProjectNameTouched] = useState(false);
  const [newProjectTask, setNewProjectTask] = useState('');
  const [newProjectModel, setNewProjectModel] = useState('');
  const [newProjectCwd, setNewProjectCwd] = useState('');
  const [resumeSessionId, setResumeSessionId] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [newProjectModelConfig, setNewProjectModelConfig] = useState<Record<string, string[]> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const reportsScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<string>('team');
  const [sidebarTabHeight, setSidebarTabHeight] = useState(280);
  const [decisionsPanelHeight, setDecisionsPanelHeight] = useState(180);
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    const allSupportedTabs = ['team', 'comms', 'groups', 'dag', 'models', 'costs', 'timers'];
    try {
      const stored = localStorage.getItem('flightdeck-sidebar-tabs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 4) {
          let tabs = parsed.filter((id: string) => id !== 'activity');
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
  const isResizing = useRef(false);

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
      tasks: agents.filter(a => a.parentId === selectedLeadId && (a.status === 'completed' || a.status === 'failed')).length,
      decisions: (project.decisions ?? []).filter((d: any) => d.needsConfirmation && d.status === 'recorded').length,
      comms: (project.comms ?? []).length,
      reports: (project.agentReports ?? []).length,
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

  // On mount, load existing leads from server
  useEffect(() => {
    // Load active leads
    fetch('/api/lead').then((r) => r.json()).then((leads: any[]) => {
      if (Array.isArray(leads)) {
        leads.forEach((l) => {
          useLeadStore.getState().addProject(l.id);
          // Pre-load message history for each lead
          fetch(`/api/agents/${l.id}/messages?limit=200`)
            .then((r) => r.json())
            .then((data: any) => {
              if (Array.isArray(data.messages) && data.messages.length > 0) {
                const msgs: AcpTextChunk[] = data.messages.map((m: any) => ({
                  type: 'text' as const,
                  text: m.content,
                  sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
                  timestamp: new Date(m.timestamp).getTime(),
                }));
                const current = useLeadStore.getState().projects[l.id];
                if (!current || current.messages.length === 0) {
                  useLeadStore.getState().setMessages(l.id, msgs);
                }
              }
            })
            .catch(() => {});
        });
        // Auto-select first running lead if none selected
        if (!useLeadStore.getState().selectedLeadId) {
          const running = leads.find((l) => l.status === 'running');
          if (running) useLeadStore.getState().selectLead(running.id);
        }
      }
    }).catch(() => {});
  }, []);

  // Fetch available roles when new project modal opens
  useEffect(() => {
    if (!showNewProject) return;
    fetch('/api/roles').then((r) => r.json()).then((roles: RoleInfo[]) => {
      setAvailableRoles(roles.filter((r) => r.id !== 'lead'));
    }).catch(() => {});
  }, [showNewProject]);

  // Subscribe to selected lead agent WS stream and load message history
  useEffect(() => {
    if (!selectedLeadId) return;
    chatInitialScroll.current = false; // reset so we scroll to bottom on lead change
    ws.subscribe(selectedLeadId);
    // Load persisted message history if we don't have any messages yet
    const proj = useLeadStore.getState().projects[selectedLeadId];
    if (!proj || proj.messages.length === 0) {
      // For historical projects (project:XYZ), use project messages endpoint
      const isHistorical = selectedLeadId.startsWith('project:');
      const url = isHistorical
        ? `/api/projects/${selectedLeadId.slice(8)}/messages?limit=200`
        : `/api/agents/${selectedLeadId}/messages?limit=200`;
      fetch(url)
        .then((r) => r.json())
        .then((data: any) => {
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            const msgs: AcpTextChunk[] = data.messages.map((m: any) => ({
              type: 'text' as const,
              text: m.content,
              sender: m.sender as 'agent' | 'user' | 'system' | 'thinking',
              timestamp: new Date(m.timestamp).getTime(),
            }));
            // Only set if still no messages (avoid overwriting live data)
            const current = useLeadStore.getState().projects[selectedLeadId];
            if (!current || current.messages.length === 0) {
              useLeadStore.getState().setMessages(selectedLeadId, msgs);
            }
          }
        })
        .catch(() => {});
    }
    return () => ws.unsubscribe(selectedLeadId);
  }, [selectedLeadId, ws]);

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

  // Poll progress for selected lead (skip for project: prefixed IDs — those are persisted projects, not running agents)
  const isActiveAgent = selectedLeadId != null && !selectedLeadId.startsWith('project:');
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const fetchProgress = () => {
      fetch(`/api/lead/${selectedLeadId}/progress`).then((r) => r.json()).then((data) => {
        if (data && !data.error) useLeadStore.getState().setProgress(selectedLeadId, data);
      }).catch(() => {});
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId, isActiveAgent]);

  // Poll decisions for selected lead
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const fetchDecisions = () => {
      fetch(`/api/lead/${selectedLeadId}/decisions`).then((r) => r.json()).then((data) => {
        if (Array.isArray(data)) useLeadStore.getState().setDecisions(selectedLeadId, data);
      }).catch(() => {});
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId, isActiveAgent]);

  // Fetch groups for selected lead
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    fetch(`/api/lead/${selectedLeadId}/groups`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) useLeadStore.getState().setGroups(selectedLeadId, data);
    }).catch(() => {});
  }, [selectedLeadId, isActiveAgent]);

  // Fetch DAG status for selected lead — always use agent UUID for /api/lead/:id/dag
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const fetchDag = () => {
      fetch(`/api/lead/${selectedLeadId}/dag`).then((r) => r.json()).then((data: any) => {
        if (data && data.tasks) {
          const store = useLeadStore.getState();
          store.setDagStatus(selectedLeadId, data as DagStatus);
          // Also store under projectId so DagMinimap can find it by either key
          if (historicalProjectId && historicalProjectId !== selectedLeadId) {
            store.setDagStatus(historicalProjectId, data as DagStatus);
          }
        }
      }).catch(() => {});
    };
    fetchDag();
    const interval = setInterval(fetchDag, 10000);
    return () => clearInterval(interval);
  }, [selectedLeadId, historicalProjectId, isActiveAgent]);

  // Listen for lead-specific WebSocket events
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      const store = useLeadStore.getState();
      const selectedLeadId = store.selectedLeadId;

      if (msg.type === 'lead:decision' && msg.agentId) {
        // Route to correct lead project (child decisions go under their parent lead)
        const targetLeadId = msg.leadId || msg.agentId;
        store.addDecision(targetLeadId, { ...msg, agentRole: msg.agentRole || 'Lead' });
      }

      // Stream PL text into chat
      if (msg.type === 'agent:text' && msg.agentId === selectedLeadId) {
        const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
        store.appendToLastAgentMessage(msg.agentId, rawText);
      }

      // Stream PL reasoning/thinking into chat (collapsed in UI)
      if (msg.type === 'agent:thinking' && msg.agentId === selectedLeadId) {
        const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
        store.appendToThinkingMessage(msg.agentId, rawText);
      }

      // Stream PL rich content into chat
      if (msg.type === 'agent:content' && msg.agentId === selectedLeadId) {
        store.addMessage(msg.agentId, {
          type: 'text',
          text: msg.content.text || '',
          sender: 'agent',
          contentType: msg.content.contentType,
          mimeType: msg.content.mimeType,
          data: msg.content.data,
          uri: msg.content.uri,
        });
      }

      // When lead goes back to running after idle, promote queued messages
      if (msg.type === 'agent:status' && msg.agentId === selectedLeadId && msg.status === 'running') {
        store.promoteQueuedMessages(msg.agentId);
      }

      // Track tool calls from PL and its children
      if (msg.type === 'agent:tool_call') {
        const leadId = selectedLeadId;
        if (!leadId) return;
        const { agentId, toolCall } = msg;
        // Only track if it's the lead or one of its children
        const isChild = agents.some((a) => a.id === agentId && a.parentId === leadId);
        if (agentId === leadId || isChild) {
          const agent = agents.find((a) => a.id === agentId);
          const roleName = agent?.role?.name ?? 'Agent';
          const uniqueId = `${toolCall.toolCallId}-${toolCall.status || Date.now()}`;
          store.addActivity(leadId, {
            id: uniqueId,
            agentId,
            agentRole: roleName,
            type: 'tool_call',
            summary: (typeof toolCall.title === 'string' ? toolCall.title : toolCall.title?.text ?? JSON.stringify(toolCall.title)) || (typeof toolCall.kind === 'string' ? toolCall.kind : JSON.stringify(toolCall.kind)) || 'Working...',
            status: toolCall.status,
            timestamp: Date.now(),
          });
        }
      }

      // Track delegation events
      if (msg.type === 'agent:delegated' && msg.parentId) {
        store.addActivity(msg.parentId, {
          id: msg.delegation?.id || `del-${Date.now()}`,
          agentId: msg.parentId,
          agentRole: 'Project Lead',
          type: 'delegation',
          summary: `Delegated to ${msg.delegation?.toRole}: ${msg.delegation?.task?.slice(0, 80) || ''}`,
          timestamp: Date.now(),
        });
        // Also track as a comm for heatmap
        const childAgent = agents.find((a) => a.id === msg.childId);
        store.addComm(msg.parentId, {
          id: `del-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fromId: msg.parentId,
          fromRole: 'Project Lead',
          toId: msg.childId,
          toRole: msg.delegation?.toRole || childAgent?.role?.name || 'Agent',
          content: msg.delegation?.task ?? '',
          timestamp: Date.now(),
          type: 'delegation',
        });
      }

      // Track agent completion reports
      if (msg.type === 'agent:completion_reported' && msg.parentId) {
        store.addActivity(msg.parentId, {
          id: `done-${Date.now()}`,
          agentId: msg.childId,
          agentRole: 'Agent',
          type: 'completion',
          summary: `Agent ${msg.childId?.slice(0, 8)} ${msg.status}`,
          timestamp: Date.now(),
        });
        // Also track as a comm for heatmap
        const childAgent = agents.find((a) => a.id === msg.childId);
        store.addComm(msg.parentId, {
          id: `report-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fromId: msg.childId,
          fromRole: childAgent?.role?.name || 'Agent',
          toId: msg.parentId,
          toRole: 'Project Lead',
          content: `Completion: ${msg.status ?? 'done'}`,
          timestamp: Date.now(),
          type: 'report',
        });
      }

      // Handle PROGRESS updates from the lead
      if (msg.type === 'lead:progress' && msg.agentId) {
        const leadId = msg.agentId;
        if (msg.summary) {
          store.setProgressSummary(leadId, msg.summary);
        }
        // Store full snapshot for detail view
        store.addProgressSnapshot(leadId, {
          summary: msg.summary || 'Progress update',
          completed: Array.isArray(msg.completed) ? msg.completed : [],
          inProgress: Array.isArray(msg.in_progress) ? msg.in_progress : [],
          blocked: Array.isArray(msg.blocked) ? msg.blocked : [],
          timestamp: Date.now(),
        });
        // Build a display string for the activity feed
        const parts: string[] = [];
        if (msg.summary) parts.push(msg.summary);
        if (Array.isArray(msg.in_progress) && msg.in_progress.length > 0) {
          parts.push(`In progress: ${msg.in_progress.join(', ')}`);
        }
        if (Array.isArray(msg.blocked) && msg.blocked.length > 0) {
          parts.push(`Blocked: ${msg.blocked.join(', ')}`);
        }
        store.addActivity(leadId, {
          id: `progress-${Date.now()}`,
          agentId: leadId,
          agentRole: 'Project Lead',
          type: 'progress',
          summary: parts.join(' · ') || 'Progress update',
          timestamp: Date.now(),
        });
      }

      // Track inter-agent messages (DMs and broadcasts)
      if (msg.type === 'agent:message_sent') {
        const fromAgent = agents.find((a) => a.id === msg.from);
        const toAgent = agents.find((a) => a.id === msg.to);
        const leadId = selectedLeadId;
        const isBroadcast = msg.to === 'all';
        if (leadId && (msg.from === leadId || fromAgent?.parentId === leadId || toAgent?.parentId === leadId || isBroadcast)) {
          store.addComm(leadId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fromId: msg.from,
            fromRole: msg.fromRole || fromAgent?.role?.name || 'Unknown',
            toId: msg.to,
            toRole: isBroadcast ? 'Team' : (msg.toRole || toAgent?.role?.name || 'Unknown'),
            content: msg.content ?? '',
            timestamp: Date.now(),
            type: isBroadcast ? 'broadcast' : 'message',
          });

          // Store messages sent TO the lead as agent reports (separate from lead's output)
          if (msg.to === leadId && msg.from !== 'system') {
            const senderRole = msg.fromRole || fromAgent?.role?.name || 'Agent';
            store.addAgentReport(leadId, {
              id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fromRole: senderRole,
              fromId: msg.from,
              content: msg.content ?? '',
              timestamp: Date.now(),
            });
          }

          // Surface DMs and broadcasts in the lead chat panel
          const preview = (msg.content ?? '').slice(0, 2000);
          const senderRole = msg.fromRole || fromAgent?.role?.name || 'Agent';
          const senderId = (msg.from ?? '').slice(0, 8);
          if (msg.from === 'system') {
            store.addMessage(leadId, {
              type: 'text', text: `⚙️ [System] ${preview}`, sender: 'system' as any, timestamp: Date.now(),
            });
          } else if (isBroadcast) {
            // Broadcasts tracked in comms panel — don't duplicate in chat
          } else if (msg.to === leadId) {
            store.addMessage(leadId, {
              type: 'text', text: `📨 [From ${senderRole} ${senderId}] ${preview}`, sender: 'system' as any, timestamp: Date.now(),
            });
          } else if (msg.from === leadId) {
            const recipientRole = msg.toRole || toAgent?.role?.name || 'Agent';
            const recipientId = (msg.to ?? '').slice(0, 8);
            store.addMessage(leadId, {
              type: 'text', text: `📤 [To ${recipientRole} ${recipientId}] ${preview}`, sender: 'system' as any, timestamp: Date.now(),
            });
          } else {
            // Inter-agent DMs tracked in comms panel — don't duplicate in chat
          }
        }
      }

      // Group chat events
      if (msg.type === 'group:created' && msg.leadId === selectedLeadId) {
        fetch(`/api/lead/${selectedLeadId}/groups`).then((r) => r.json()).then((data) => {
          if (Array.isArray(data)) store.setGroups(selectedLeadId!, data);
        }).catch(() => {});
      }
      if (msg.type === 'group:message' && msg.leadId === selectedLeadId) {
        store.addGroupMessage(selectedLeadId!, msg.groupName, msg.message);
        // Also track as a comm for heatmap (from → all group members)
        if (msg.message) {
          const gm = msg.message;
          store.addComm(selectedLeadId!, {
            id: `grp-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fromId: gm.fromAgentId,
            fromRole: gm.fromRole || 'Agent',
            toId: '',
            toRole: msg.groupName || 'Group',
            content: gm.content ?? '',
            timestamp: Date.now(),
            type: 'group_message',
          });
          // Group messages tracked in comms panel and groups tab — don't duplicate in chat
        }
      }

      // DAG status updates
      if (msg.type === 'dag:updated' && msg.leadId === selectedLeadId) {
        fetch(`/api/lead/${selectedLeadId}/dag`).then((r) => r.json()).then((data: any) => {
          if (data && data.tasks) {
            store.setDagStatus(selectedLeadId!, data as DagStatus);
            if (historicalProjectId && historicalProjectId !== selectedLeadId) {
              store.setDagStatus(historicalProjectId, data as DagStatus);
            }
          }
        }).catch(() => {});
      }

      // Context compaction — add system message to relevant lead's chat
      if (msg.type === 'agent:context_compacted' && msg.agentId) {
        const compactedId = msg.agentId;
        // Find the lead project this agent belongs to (could be the lead itself or a child)
        let targetLeadId: string | null = null;
        if (store.projects[compactedId]) {
          targetLeadId = compactedId;
        } else {
          const parentAgent = agents.find((a) => a.id === compactedId);
          if (parentAgent?.parentId && store.projects[parentAgent.parentId]) {
            targetLeadId = parentAgent.parentId;
          }
        }
        if (targetLeadId) {
          const pct = msg.percentDrop != null ? `${msg.percentDrop}%` : '?%';
          store.addMessage(targetLeadId, {
            type: 'text',
            text: `🔄 Context compacted for agent ${compactedId.slice(0, 8)}: ${pct} reduction`,
            sender: 'system',
            timestamp: Date.now(),
          });
        }
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [agents]);

  // Sidebar resize handlers
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - e.clientX;
      const newWidth = Math.min(600, Math.max(200, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const isTabResizing = useRef(false);
  const startTabResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isTabResizing.current = true;
    const startY = e.clientY;
    const startHeight = sidebarTabHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isTabResizing.current) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.min(600, Math.max(120, startHeight + delta));
      setSidebarTabHeight(newHeight);
    };

    const onMouseUp = () => {
      isTabResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarTabHeight]);

  const isDecisionsResizing = useRef(false);
  const startDecisionsResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDecisionsResizing.current = true;
    const startY = e.clientY;
    const startHeight = decisionsPanelHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDecisionsResizing.current) return;
      const delta = ev.clientY - startY;
      const newHeight = Math.min(400, Math.max(80, startHeight + delta));
      setDecisionsPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      isDecisionsResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [decisionsPanelHeight]);

  const handleTabOrderChange = useCallback((newOrder: string[]) => {
    setTabOrder(newOrder);
    localStorage.setItem('flightdeck-sidebar-tabs', JSON.stringify(newOrder));
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
      localStorage.setItem('flightdeck-hidden-tabs', JSON.stringify([...next]));
      // If hiding the active tab, switch to first visible tab
      if (next.has(tabId)) {
        setSidebarTab((current) => {
          if (current === tabId) {
            const allSupportedTabs = ['team', 'comms', 'groups', 'dag', 'models', 'costs', 'timers'];
            return allSupportedTabs.find((id) => !next.has(id)) ?? 'team';
          }
          return current;
        });
      }
      return next;
    });
  }, []);

  const startLead = useCallback(async (name: string, task?: string, model?: string, cwd?: string, sessionId?: string, initialTeam?: string[]) => {
    setStarting(true);
    try {
      // If initial team is selected, prepend to the task so the lead knows to create them
      let fullTask = task;
      if (initialTeam && initialTeam.length > 0) {
        const teamHint = `\n\n[Initial Team] The user has pre-selected these roles for the initial team: ${initialTeam.join(', ')}. Please create these agents as your first action.`;
        fullTask = (task || '') + teamHint;
      }
      const resp = await fetch('/api/lead/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, task: fullTask, model: model || undefined, cwd: cwd || undefined, sessionId: sessionId || undefined }),
      });
      const data = await resp.json();
      if (data.id) {
        useLeadStore.getState().addProject(data.id);
        useLeadStore.getState().selectLead(data.id);
        if (task) {
          useLeadStore.getState().addMessage(data.id, { type: 'text', text: task, sender: 'user' });
        }
        // Save model config if customized during project creation
        if (newProjectModelConfig && data.projectId) {
          apiFetch(`/projects/${data.projectId}/model-config`, {
            method: 'PUT',
            body: JSON.stringify({ config: newProjectModelConfig }),
          }).catch(() => { /* best-effort — project still created */ });
        }
        setShowNewProject(false);
        setNewProjectName('');
        setNewProjectNameTouched(false);
        setNewProjectTask('');
        setNewProjectModel('');
        setNewProjectCwd('');
        setResumeSessionId('');
        setSelectedRoles(new Set());
        setNewProjectModelConfig(null);
        setShowModelConfig(false);
      }
    } catch {
      // ignore
    } finally {
      setStarting(false);
    }
  }, [newProjectModelConfig]);

  const sendMessage = useCallback(async (mode: 'queue' | 'interrupt' = 'queue') => {
    if (!input.trim() || !selectedLeadId) return;
    const text = input.trim();
    setInput('');
    const store = useLeadStore.getState();
    // For interrupts, insert a separator so post-interrupt response appears as a new bubble
    if (mode === 'interrupt') {
      const proj = store.projects[selectedLeadId];
      const msgs = proj?.messages ?? [];
      const last = msgs[msgs.length - 1];
      if (last?.sender === 'agent') {
        store.addMessage(selectedLeadId, { type: 'text', text: '---', sender: 'system' as any, timestamp: Date.now() });
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
    if (attachments.length > 0) {
      payload.attachments = attachments
        .filter((a) => a.data)
        .map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }));
    }
    try {
      const resp = await fetch(`/api/lead/${selectedLeadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) clearAttachments();
    } catch {
      // Network error — keep attachments so user can retry
    }
  }, [input, selectedLeadId, attachments, clearAttachments]);

  const removeQueuedMessage = useCallback(async (queueIndex: number) => {
    if (!selectedLeadId) return;
    const resp = await fetch(`/api/agents/${selectedLeadId}/queue/${queueIndex}`, { method: 'DELETE' });
    if (resp.ok) {
      const store = useLeadStore.getState();
      const msgs = store.projects[selectedLeadId]?.messages || [];
      let seen = 0;
      const updated = msgs.filter((m: AcpTextChunk) => {
        if (!m.queued) return true;
        return seen++ !== queueIndex;
      });
      store.setMessages(selectedLeadId, updated);
    }
  }, [selectedLeadId]);

  const reorderQueuedMessage = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!selectedLeadId) return;
    const resp = await fetch(`/api/agents/${selectedLeadId}/queue/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromIndex, to: toIndex }),
    });
    if (resp.ok) {
      const store = useLeadStore.getState();
      const msgs = store.projects[selectedLeadId]?.messages || [];
      const queued = msgs.filter((m: AcpTextChunk) => m.queued);
      const nonQueued = msgs.filter((m: AcpTextChunk) => !m.queued);
      if (fromIndex < queued.length && toIndex < queued.length) {
        const [moved] = queued.splice(fromIndex, 1);
        queued.splice(toIndex, 0, moved);
        store.setMessages(selectedLeadId, [...nonQueued, ...queued]);
      }
    }
  }, [selectedLeadId]);

  const handleConfirmDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'confirmed', confirmedAt: new Date().toISOString() });
    const resp = await fetch(`/api/decisions/${decisionId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (resp.ok) {
      const decision = await resp.json();
      useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
    }
  }, [selectedLeadId]);

  const handleRejectDecision = useCallback(async (decisionId: string, reason?: string) => {
    if (!selectedLeadId) return;
    // Optimistic update — hide buttons immediately
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'rejected', confirmedAt: new Date().toISOString() });
    const resp = await fetch(`/api/decisions/${decisionId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (resp.ok) {
      const decision = await resp.json();
      useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
    }
  }, [selectedLeadId]);

  const handleDismissDecision = useCallback(async (decisionId: string) => {
    if (!selectedLeadId) return;
    useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: 'dismissed', confirmedAt: new Date().toISOString() });
    const resp = await fetch(`/api/decisions/${decisionId}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.ok) {
      const decision = await resp.json();
      useLeadStore.getState().updateDecision(selectedLeadId, decisionId, { status: decision.status, confirmedAt: decision.confirmedAt });
    }
  }, [selectedLeadId]);

  const handleOpenAgentChat = useCallback((agentId: string) => {
    useAppStore.getState().setSelectedAgent(agentId);
  }, []);

  const messages = currentProject?.messages ?? [];
  const decisions = currentProject?.decisions ?? [];
  const pendingConfirmations = decisions.filter((d: any) => d.needsConfirmation && d.status === 'recorded');
  const progress = currentProject?.progress ?? null;
  const progressSummary = currentProject?.progressSummary ?? null;
  const progressHistory = currentProject?.progressHistory ?? [];
  const activity = currentProject?.activity ?? [];
  const comms = currentProject?.comms ?? [];
  const agentReports = currentProject?.agentReports ?? [];
  const groups = currentProject?.groups ?? [];
  const groupMessages = currentProject?.groupMessages ?? {};
  const dagStatus = currentProject?.dagStatus ?? null;
  const teamAgents = (() => {
    const live = agents.filter((a) => a.id === selectedLeadId || a.parentId === selectedLeadId);
    if (live.length > 0) return live;
    // Fallback: progress endpoint, then keyframe-derived agents
    const progressTeam = progress?.teamAgents ?? [];
    return progressTeam.length > 0 ? progressTeam : derivedAgents;
  })();

  const teamAgentIds = useMemo(() => new Set(teamAgents.map((a: any) => a.id)), [teamAgents]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* New project modal */}
      {showNewProject && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNewProject(false); }}
        >
          <div
            className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-xl flex flex-col"
          >
            <div className="flex items-center gap-2 px-5 py-4 border-b border-th-border">
              <Crown className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              <h2 className="text-base font-semibold text-th-text">New Project</h2>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              <div>
                <label className="block text-xs text-th-text-muted mb-1 font-medium">Project Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => { setNewProjectName(e.target.value); setNewProjectNameTouched(true); }}
                  onBlur={() => setNewProjectNameTouched(true)}
                  placeholder="My Feature"
                  maxLength={100}
                  className={`w-full bg-th-bg border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none ${
                    newProjectNameTouched && !newProjectName.trim()
                      ? 'border-red-500 focus:border-red-500'
                      : 'border-th-border focus:border-yellow-500'
                  }`}
                  autoFocus
                />
                {newProjectNameTouched && !newProjectName.trim() && (
                  <p className="text-xs text-red-400 mt-1">Project name is required</p>
                )}
                {newProjectName.trim().length > 100 && (
                  <p className="text-xs text-red-400 mt-1">Must be 100 characters or less</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-th-text-muted mb-1 font-medium">Task / Prompt</label>
                <textarea
                  value={newProjectTask}
                  onChange={(e) => setNewProjectTask(e.target.value)}
                  placeholder="Describe what you want the team to work on..."
                  rows={6}
                  className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500 resize-y"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-th-text-muted mb-1 font-medium">Model</label>
                  <select
                    value={newProjectModel}
                    onChange={(e) => setNewProjectModel(e.target.value)}
                    className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
                  >
                    <option value="">Default</option>
                    <option value="claude-opus-4.6">Claude Opus 4.6</option>
                    <option value="claude-sonnet-4.6">Claude Sonnet 4.6</option>
                    <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>
                    <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
                    <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                    <option value="gpt-5.2-codex">GPT-5.2 Codex</option>
                    <option value="gpt-5.2">GPT-5.2</option>
                    <option value="gpt-5.1-codex">GPT-5.1 Codex</option>
                    <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-th-text-muted mb-1 font-medium">Working Directory</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newProjectCwd}
                      onChange={(e) => setNewProjectCwd(e.target.value)}
                      placeholder="/path/to/project"
                      className="flex-1 bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFolderPicker(true)}
                      className="px-2 py-2 bg-th-bg-muted hover:bg-th-bg-hover text-th-text-alt rounded-md text-xs shrink-0 transition-colors"
                      title="Browse folders"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-th-text-muted mb-1 font-medium">Resume Session <span className="text-th-text-muted">(optional — paste a session ID to continue previous work)</span></label>
                  <input
                    type="text"
                    value={resumeSessionId}
                    onChange={(e) => setResumeSessionId(e.target.value)}
                    placeholder="session-id-from-previous-lead"
                    className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              {/* Initial Team Selection */}
              {availableRoles.length > 0 && (
                <div>
                  <label className="block text-xs text-th-text-muted mb-1.5 font-medium">Initial Team <span className="text-th-text-muted">(optional — pre-select roles to auto-create)</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {availableRoles.map((role) => {
                      const isSelected = selectedRoles.has(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => setSelectedRoles((prev) => {
                            const next = new Set(prev);
                            if (next.has(role.id)) next.delete(role.id); else next.add(role.id);
                            return next;
                          })}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors border ${
                            isSelected
                              ? 'bg-yellow-600/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-200'
                              : 'bg-th-bg border-th-border text-th-text-muted hover:border-th-border-hover'
                          }`}
                          title={role.description}
                        >
                          <span>{role.icon}</span>
                          <span>{role.name}</span>
                          {isSelected && <Check className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Model Configuration (collapsible) */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowModelConfig(!showModelConfig)}
                  className="flex items-center gap-1 text-xs text-th-text-alt hover:text-th-text font-medium transition-colors"
                >
                  {showModelConfig ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <Wrench className="w-3 h-3" />
                  Model Configuration
                </button>
                {showModelConfig && (
                  <div className="mt-2 border border-th-border rounded-md p-2 bg-th-bg">
                    <ModelConfigPanel value={newProjectModelConfig ?? undefined} onChange={setNewProjectModelConfig} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-th-border">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newProjectName.trim()) { setNewProjectNameTouched(true); return; }
                  startLead(
                    newProjectName.trim(),
                    newProjectTask.trim() || undefined,
                    newProjectModel || undefined,
                    newProjectCwd.trim() || undefined,
                    resumeSessionId.trim() || undefined,
                    selectedRoles.size > 0 ? Array.from(selectedRoles) : undefined,
                  );
                }}
                disabled={starting || !newProjectName.trim()}
                className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-th-bg-hover disabled:text-th-text-muted text-black text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                {starting ? 'Starting...' : resumeSessionId.trim() ? 'Resume Project' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder picker modal */}
      {showFolderPicker && (
        <FolderPicker
          value={newProjectCwd}
          onChange={(path) => setNewProjectCwd(path)}
          onClose={() => setShowFolderPicker(false)}
        />
      )}

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
                className="border-b border-th-border px-4 py-2 flex items-center gap-4 text-sm font-mono bg-th-bg-alt/50 cursor-pointer hover:bg-th-bg-alt/80 transition-colors"
                onClick={() => setShowProgressDetail(true)}
                title="Click for detailed progress view"
              >
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span>{progress.teamSize} agents</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  <span>{progress.active} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>{progress.completed} done</span>
                </div>
                {progress.failed > 0 && (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span>{progress.failed} failed</span>
                  </div>
                )}
                {(() => {
                  return null;
                })()}
                <div className="ml-auto">
                  <div className="w-32 bg-th-bg-muted rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress.completionPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-th-text-muted">{progress.completionPct}%</span>
              </div>
            )}
            {progressSummary && (
              <div
                className="border-b border-th-border px-4 py-1.5 text-xs text-th-text-muted bg-th-bg-alt/30 font-mono truncate cursor-pointer hover:bg-th-bg-alt/50 transition-colors"
                onClick={() => setShowProgressDetail(true)}
                title="Click for detailed progress view"
              >
                📋 {progressSummary}
              </div>
            )}

            {/* Working directory bar */}
            <CwdBar leadId={selectedLeadId!} cwd={leadAgent?.cwd} />

            {/* Session ID bar — copyable for resume */}
            {leadAgent?.sessionId && (
              <div className="border-b border-th-border px-4 py-1 flex items-center gap-2 text-xs font-mono bg-th-bg-alt/20">
                <GitBranch className="w-3 h-3 text-th-text-muted shrink-0" />
                <span className="text-th-text-muted">Session:</span>
                <span className="text-th-text-muted truncate" title={leadAgent.sessionId}>{leadAgent.sessionId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(leadAgent.sessionId!);
                    const btn = document.activeElement as HTMLElement;
                    btn.textContent = 'copied!';
                    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
                  }}
                  className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0 ml-auto"
                >
                  copy
                </button>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/export/${selectedLeadId}`);
                      const data = await res.json();
                      if (data.error) {
                        alert(`Export failed: ${data.error}`);
                      } else {
                        alert(`Session exported to:\n${data.outputDir}\n\n${data.files.length} files · ${data.agentCount} agents · ${data.eventCount} events`);
                      }
                    } catch {
                      alert('Export failed — server may be unavailable');
                    }
                  }}
                  className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0 flex items-center gap-1"
                  title="Export session to disk (summary, agents, decisions, DAG)"
                >
                  <Download className="w-3 h-3" />
                  export
                </button>
              </div>
            )}

            {/* Agent Reports — separate from lead output */}
            {agentReports.length > 0 && (
              <div className="border-b border-th-border bg-amber-500/5 dark:bg-amber-500/10">
                <button
                  className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
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
                      return (
                        <div
                          key={r.id}
                          className="flex items-start gap-2 px-2 py-1.5 rounded bg-amber-500/[0.06] border border-amber-400/20 border-l-2 border-l-amber-500/30 cursor-pointer hover:bg-amber-500/[0.10] transition-colors"
                          onClick={() => setExpandedReport(r)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">{r.fromRole}</span>
                              <span className="text-[10px] text-th-text-muted ml-auto">{time}</span>
                            </div>
                            <AgentReportBlock content={r.content} compact />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Pending decisions banner */}
            {pendingConfirmations.length > 0 && (
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
                    {pendingConfirmations.map((d: any) => (
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
              pendingConfirmations,
              panelHeight: decisionsPanelHeight,
              onResize: startDecisionsResize,
              onConfirm: handleConfirmDecision,
              onReject: handleRejectDecision,
              onDismiss: handleDismissDecision,
            }}
            teamTabContent={
              <TeamStatusContent
                agents={teamAgents}
                delegations={progress?.delegations ?? []}
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
            teamAgentIds={teamAgentIds}
          />
        </>
      )}

      {/* Progress detail popup */}
      {showProgressDetail && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProgressDetail(false); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-th-text">Progress Detail</span>
              </div>
              <button type="button" aria-label="Close progress detail" onClick={() => setShowProgressDetail(false)} className="text-th-text-muted hover:text-th-text">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              {/* Delegation stats */}
              {progress && progress.totalDelegations > 0 && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-2">Delegation Overview</p>
                  <div className="flex items-center gap-4 text-sm font-mono mb-2">
                    <span className="text-blue-400">{progress.teamSize} agents</span>
                    <span className="text-yellow-600 dark:text-yellow-400">{progress.active} active</span>
                    <span className="text-purple-400">{progress.completed} done</span>
                    {progress.failed > 0 && <span className="text-red-400">{progress.failed} failed</span>}
                  </div>
                  <div className="w-full bg-th-bg-muted rounded-full h-2.5 mb-1">
                    <div
                      className="bg-green-500 h-2.5 rounded-full transition-all"
                      style={{ width: `${progress.completionPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-th-text-muted font-mono text-right">{progress.completionPct}% complete</p>
                </div>
              )}

              {/* Agent team roster */}
              {progress && progress.teamAgents && progress.teamAgents.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-2">Team Roster</p>
                  <div className="space-y-1">
                    {progress.teamAgents.map((ta) => (
                      <div key={ta.id} className="flex items-center gap-2 px-2 py-1 rounded bg-th-bg-muted/50 text-xs font-mono">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${ta.status === 'running' ? 'bg-green-400 animate-pulse motion-reduce:animate-none' : ta.status === 'idle' ? 'bg-yellow-400' : ta.status === 'failed' ? 'bg-red-400' : ta.status === 'terminated' ? 'bg-orange-400' : 'bg-gray-500'}`} />
                        <span className="text-th-text-alt">{ta.role?.name || 'Agent'}</span>
                        <span className="text-th-text-muted">{ta.id.slice(0, 8)}</span>
                        <span className="ml-auto text-th-text-muted">{ta.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Latest lead progress report */}
              {progressHistory.length > 0 && (() => {
                const latest = progressHistory[progressHistory.length - 1];
                return (
                  <div>
                    <p className="text-xs font-semibold text-th-text-muted mb-2">Latest Lead Report</p>
                    <p className="text-sm font-mono text-th-text-alt mb-3">{latest.summary}</p>
                    {latest.completed.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs text-purple-400 font-semibold mb-1">✓ Completed</p>
                        <ul className="space-y-0.5">
                          {latest.completed.map((item, i) => (
                            <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                              <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {latest.inProgress.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs text-blue-400 font-semibold mb-1">⟳ In Progress</p>
                        <ul className="space-y-0.5">
                          {latest.inProgress.map((item, i) => (
                            <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {latest.blocked.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs text-red-400 font-semibold mb-1">⚠ Blocked</p>
                        <ul className="space-y-0.5">
                          {latest.blocked.map((item, i) => (
                            <li key={i} className="text-xs font-mono text-th-text-alt pl-4 flex items-center gap-1.5">
                              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[10px] text-th-text-muted font-mono mt-2">
                      {new Date(latest.timestamp).toLocaleString()}
                    </p>
                  </div>
                );
              })()}

              {/* Progress history timeline */}
              {progressHistory.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-2">Progress Timeline</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {[...progressHistory].reverse().slice(1).map((snap, i) => (
                      <div key={i} className="flex items-start gap-2 border-l-2 border-th-border pl-3 py-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono text-th-text-alt">{snap.summary}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-th-text-muted">
                            {snap.completed.length > 0 && <span className="text-purple-500">✓{snap.completed.length}</span>}
                            {snap.inProgress.length > 0 && <span className="text-blue-400">⟳{snap.inProgress.length}</span>}
                            {snap.blocked.length > 0 && <span className="text-red-400">⚠{snap.blocked.length}</span>}
                            <span>{new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delegation details */}
              {progress && progress.delegations && progress.delegations.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-2">Delegations</p>
                  <div className="space-y-1">
                    {progress.delegations.map((d: any, i: number) => (
                      <div key={d.id || i} className="px-2 py-1.5 rounded bg-th-bg-muted/50 text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.status === 'active' ? 'bg-blue-500/20 text-blue-400' : d.status === 'completed' ? 'bg-purple-500/20 text-purple-400' : d.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-th-text-muted'}`}>
                            {d.status}
                          </span>
                          <span className="text-th-text-alt">{d.toRole}</span>
                          <span className="text-th-text-muted ml-auto">{d.childId?.slice(0, 8)}</span>
                        </div>
                        {d.task && (
                          <p className="text-th-text-muted mt-1 break-words">{d.task.length > 120 ? d.task.slice(0, 120) + '…' : d.task}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Agent report detail popup */}
      {expandedReport && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setExpandedReport(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">{expandedReport.fromRole}</span>
                <span className="text-xs text-th-text-muted">→ Project Lead</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(expandedReport.timestamp).toLocaleTimeString()}
                </span>
                <button type="button" aria-label="Close report" onClick={() => setExpandedReport(null)} className="text-th-text-muted hover:text-th-text">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <AgentReportBlock content={expandedReport.content} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamStatusContent({ agents, delegations, comms, activity, allAgents, onOpenChat }: { agents: any[]; delegations: any[]; comms?: AgentComm[]; activity?: ActivityEvent[]; allAgents?: any[]; onOpenChat?: (agentId: string) => void }) {
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  const [agentMsg, setAgentMsg] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const selectedDelegation = selectedAgent ? [...delegations].reverse().find((d: any) => d.toAgentId === selectedAgent.id) : null;
  const agentComms = selectedAgent ? (comms ?? []).filter((c) => c.fromId === selectedAgent.id || c.toId === selectedAgent.id) : [];
  const agentActivity = selectedAgent ? (activity ?? []).filter((e) => e.agentId === selectedAgent.id) : [];

  return (
    <>
      <div className="h-full overflow-y-auto p-1.5 space-y-1">
        {agents.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">No team members yet</p>
        ) : (
          agents.map((agent: any) => {
            const delegation = [...delegations].reverse().find((d: any) => d.toAgentId === agent.id);
            const colorClass = agentStatusText(agent.status);
            return (
              <div
                key={agent.id}
                className="bg-th-bg-alt border border-th-border rounded p-1.5 cursor-pointer hover:border-th-border-hover transition-colors"
                onClick={() => { setSelectedAgent(agent); setAgentMsg(''); setSendingMsg(false); }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm leading-none">{agent.role.icon}</span>
                  <span className="text-xs font-mono font-semibold text-th-text-alt truncate" title={agent.role.name}>{agent.role.name}</span>
                  <span className={`text-[10px] font-mono ${colorClass} ml-auto shrink-0`}>{agent.status}</span>
                  {onOpenChat && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenChat(agent.id); }}
                      className="flex items-center gap-0.5 text-[10px] font-mono leading-none px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors shrink-0"
                      title="Open agent chat panel"
                    >
                      <MessageSquare size={10} /> Chat
                    </button>
                  )}
                  <span className="text-[10px] font-mono text-th-text-muted shrink-0">{agent.id.slice(0, 8)}</span>
                </div>
                {delegation && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-[10px] font-mono text-th-text-muted truncate flex-1 min-w-0" title={delegation.task}>{delegation.task}</p>
                    {(agent.model || agent.role.model) && (
                      <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded shrink-0">{agent.model || agent.role.model}</span>
                    )}
                  </div>
                )}
                {!delegation && (agent.model || agent.role.model) && (
                  <div className="flex items-center justify-end gap-1.5 mt-0.5">
                    {(agent.model || agent.role.model) && (
                      <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded shrink-0">{agent.model || agent.role.model}</span>
                    )}
                  </div>
                )}
                {(() => {
                  const latestAct = (activity ?? []).filter((e) => e.agentId === agent.id).slice(-1)[0];
                  if (!latestAct) return null;
                  const actTime = new Date(latestAct.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] text-th-text-muted">{actTime}</span>
                      <span className="text-[10px] text-th-text-muted truncate" title={latestAct.summary}>{latestAct.summary}</span>
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      {/* Agent detail modal */}
      {selectedAgent && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedAgent(null); }}
        >
          <div
            className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-th-border">
              <span className="text-2xl">{selectedAgent.role.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-th-text">{selectedAgent.role.name}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${agentStatusText(selectedAgent.status)} bg-th-bg-muted`}>
                    {selectedAgent.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-th-text-muted font-mono">
                  <span>{selectedAgent.id.slice(0, 8)}</span>
                  {(selectedAgent.model || selectedAgent.role.model) && (
                    <span className="bg-th-bg-muted/50 px-1.5 rounded">{selectedAgent.model || selectedAgent.role.model}</span>
                  )}
                  {selectedAgent.sessionId && (
                    <button
                      className="bg-th-bg-muted/50 px-1.5 rounded hover:bg-th-bg-muted transition-colors"
                      title={`Session: ${selectedAgent.sessionId} — click to copy`}
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedAgent.sessionId!); }}
                    >
                      sess:{selectedAgent.sessionId.slice(0, 8)}
                    </button>
                  )}
                </div>
              </div>
              {(selectedAgent.status === 'running' || selectedAgent.status === 'idle') && (
                <div className="flex items-center gap-1 mr-2">
                  <button
                    onClick={() => apiFetch(`/agents/${selectedAgent.id}/interrupt`, { method: 'POST' })}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/40 transition-colors"
                    title="Interrupt agent"
                  >
                    <Zap size={12} /> Interrupt
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Stop this agent?')) {
                        fetch(`/api/agents/${selectedAgent.id}`, { method: 'DELETE' });
                        setSelectedAgent(null);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
                    title="Stop agent"
                  >
                    <Square size={12} /> Stop
                  </button>
                </div>
              )}
              <button
                onClick={() => setSelectedAgent(null)}
                className="text-th-text-muted hover:text-th-text text-lg leading-none p-1"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Assigned Task */}
              {selectedDelegation && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Assigned Task</h4>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDelegation.task}</p>
                  {selectedDelegation.status && (
                    <span className={`inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      selectedDelegation.status === 'completed' ? 'text-purple-400 bg-purple-900/30' :
                      selectedDelegation.status === 'active' ? 'text-blue-400 bg-blue-900/30' :
                      'text-red-400 bg-red-900/30'
                    }`}>{selectedDelegation.status}</span>
                  )}
                </div>
              )}

              {/* Token Usage — hidden (issue #106) */}

              {/* Context Window — keep this, it's real data from ACP */}
              {selectedAgent.contextWindowSize > 0 && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Context Window</h4>
                  <div className="mt-1.5">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-th-text-muted">
                      <span>Context: {formatTokens(selectedAgent.contextWindowUsed)} / {formatTokens(selectedAgent.contextWindowSize)}</span>
                      <span>({Math.round((selectedAgent.contextWindowUsed / selectedAgent.contextWindowSize) * 100)}%)</span>
                    </div>
                    <div className="w-full bg-th-bg-muted rounded-full h-1 mt-1">
                      <div
                        className={`h-1 rounded-full transition-all ${
                          selectedAgent.contextWindowUsed / selectedAgent.contextWindowSize > 0.8 ? 'bg-red-500' :
                          selectedAgent.contextWindowUsed / selectedAgent.contextWindowSize > 0.5 ? 'bg-yellow-500' :
                          'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.round((selectedAgent.contextWindowUsed / selectedAgent.contextWindowSize) * 100))}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Agent Output Preview */}
              {selectedAgent.outputPreview && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Latest Output</h4>
                  <pre className="text-xs font-mono text-th-text-alt whitespace-pre-wrap max-h-40 overflow-y-auto bg-th-bg/50 rounded p-2">
                    {selectedAgent.outputPreview}
                  </pre>
                </div>
              )}

              {/* Communications */}
              {agentComms.length > 0 && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
                    Communications ({agentComms.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {agentComms.slice(-20).map((c) => {
                      const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const isSender = c.fromId === selectedAgent.id;
                      return (
                        <div
                          key={c.id}
                          className="text-xs font-mono cursor-pointer hover:bg-th-bg-muted/40 rounded px-1 py-0.5 transition-colors"
                          onClick={() => setSelectedComm(c)}
                        >
                          <div className="flex items-center gap-1">
                            <span className={isSender ? 'text-cyan-400' : 'text-green-400'}>{isSender ? c.fromRole : c.toRole}</span>
                            <span className="text-th-text-muted">{isSender ? '→' : '←'}</span>
                            <span className={isSender ? 'text-green-400' : 'text-cyan-400'}>{isSender ? c.toRole : c.fromRole}</span>
                            <span className="text-th-text-muted ml-auto">{time}</span>
                          </div>
                          <p className="text-th-text-alt mt-0.5 break-words whitespace-pre-wrap">
                            <MentionText text={c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Activity */}
              {agentActivity.length > 0 && (
                <div className="px-5 py-3">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
                    Activity ({agentActivity.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {agentActivity.slice(-15).map((evt) => {
                      const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={evt.id} className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-th-text-muted">{time}</span>
                          <span className="text-th-text-alt truncate" title={evt.summary}>{evt.summary}</span>
                          {evt.status && (
                            <span className={`ml-auto shrink-0 text-[10px] ${
                              evt.status === 'completed' ? 'text-purple-400' :
                              evt.status === 'in_progress' ? 'text-blue-400' : 'text-th-text-muted'
                            }`}>{evt.status}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!selectedDelegation && !selectedAgent.outputPreview && agentComms.length === 0 && agentActivity.length === 0 && (
                <div className="px-5 py-8 text-center text-th-text-muted text-xs font-mono">
                  No activity yet for this agent
                </div>
              )}
            </div>

            {/* Message Input */}
            <div className="px-4 py-3 border-t border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1.5">Send Message</h4>
              <div className="flex gap-2">
                <textarea
                  value={agentMsg}
                  onChange={(e) => setAgentMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      if (agentMsg.trim() && !sendingMsg) {
                        setSendingMsg(true);
                        apiFetch(`/agents/${selectedAgent.id}/message`, {
                          method: 'POST',
                          body: JSON.stringify({ text: agentMsg.trim(), mode: 'queue' }),
                        }).then(() => {
                          setAgentMsg('');
                          useToastStore.getState().add('success', `Message sent to ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to send: ${err.message}`);
                        }).finally(() => setSendingMsg(false));
                      }
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (agentMsg.trim() && !sendingMsg) {
                        setSendingMsg(true);
                        apiFetch(`/agents/${selectedAgent.id}/message`, {
                          method: 'POST',
                          body: JSON.stringify({ text: agentMsg.trim(), mode: 'interrupt' }),
                        }).then(() => {
                          setAgentMsg('');
                          useToastStore.getState().add('success', `Interrupt sent to ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
                        }).finally(() => setSendingMsg(false));
                      } else {
                        apiFetch(`/agents/${selectedAgent.id}/interrupt`, { method: 'POST' }).then(() => {
                          useToastStore.getState().add('success', `Interrupted ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
                        });
                      }
                    }
                  }}
                  placeholder={`Message ${selectedAgent.role.name}...`}
                  className="flex-1 bg-th-bg border border-th-border rounded px-2 py-1.5 text-xs font-mono text-th-text resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  rows={2}
                  disabled={sendingMsg}
                />
                <div className="flex flex-col gap-1 self-end shrink-0">
                  <button
                    onClick={() => {
                      if (agentMsg.trim() && !sendingMsg) {
                        setSendingMsg(true);
                        apiFetch(`/agents/${selectedAgent.id}/message`, {
                          method: 'POST',
                          body: JSON.stringify({ text: agentMsg.trim(), mode: 'queue' }),
                        }).then(() => {
                          setAgentMsg('');
                          useToastStore.getState().add('success', `Message sent to ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to send: ${err.message}`);
                        }).finally(() => setSendingMsg(false));
                      }
                    }}
                    disabled={!agentMsg.trim() || sendingMsg}
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Send message (Enter)"
                  >
                    <Send size={12} /> {sendingMsg ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={() => {
                      if (agentMsg.trim() && !sendingMsg) {
                        setSendingMsg(true);
                        apiFetch(`/agents/${selectedAgent.id}/message`, {
                          method: 'POST',
                          body: JSON.stringify({ text: agentMsg.trim(), mode: 'interrupt' }),
                        }).then(() => {
                          setAgentMsg('');
                          useToastStore.getState().add('success', `Interrupt sent to ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
                        }).finally(() => setSendingMsg(false));
                      } else {
                        apiFetch(`/agents/${selectedAgent.id}/interrupt`, { method: 'POST' }).then(() => {
                          useToastStore.getState().add('success', `Interrupted ${selectedAgent.role.name}`);
                        }).catch((err: Error) => {
                          useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
                        });
                      }
                    }}
                    disabled={sendingMsg}
                    className="px-3 py-1.5 rounded bg-orange-600/80 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Interrupt agent (Ctrl+Enter)"
                  >
                    <Zap size={12} /> Interrupt
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-th-text-muted mt-1">Enter to send · Shift+Enter for newline · Ctrl+Enter to interrupt</p>
            </div>

          </div>
        </div>
      )}

      {/* Comm detail popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedComm(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-th-text-muted">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selectedComm.timestamp).toLocaleTimeString()}
                </span>
                <button type="button" aria-label="Close communication detail" onClick={() => setSelectedComm(null)} className="text-th-text-muted hover:text-th-text text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <pre className="text-sm font-mono text-th-text-alt whitespace-pre-wrap break-words leading-relaxed">
                    <MentionText text={selectedComm.content} agents={useAppStore.getState().agents} onClickAgent={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedComm(null); }} />
                  </pre>
                )
              }
            </div>
          </div>
        </div>
      )}
    </>
  );
}
