import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Crown, Send, Users, CheckCircle, AlertCircle, Clock, Loader2, Plus, Trash2, Wrench, MessageSquare, GitBranch, PanelRightClose, PanelRightOpen, ChevronDown, ChevronRight, ChevronUp, Lightbulb, Bot, FolderOpen, Check, X, BarChart3, AlertTriangle, RefreshCw, Network, Pencil, Hand, Square, Filter, Download } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useLeadStore } from '../../stores/leadStore';
import { useTimerStore, selectActiveTimerCount } from '../../stores/timerStore';
import type { ActivityEvent, AgentComm, ProgressSnapshot, AgentReport } from '../../stores/leadStore';
import type { AcpTextChunk, ChatGroup, GroupMessage, DagStatus, Project } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { MentionText, MarkdownContent } from '../../utils/markdown';
import { classifyMessage, tierPassesFilter, TIER_CONFIG, type TierFilter, type FeedItem } from '../../utils/messageTiers';
import { classifyHighlight } from '../../utils/isUserDirectedMessage';
import { TaskDagPanelContent } from './TaskDagPanel';
import { TokenEconomics } from '../TokenEconomics/TokenEconomics';
import { CostBreakdown } from '../TokenEconomics/CostBreakdown';
import { TimerDisplay } from '../TimerDisplay/TimerDisplay';
import { FolderPicker } from '../FolderPicker/FolderPicker';
import { agentStatusText } from '../../utils/statusColors';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';

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
  const activeTimerCount = useTimerStore(selectActiveTimerCount);
  const input = selectedLeadId ? (drafts[selectedLeadId] ?? '') : '';
  const setInput = useCallback((text: string) => {
    if (selectedLeadId) useLeadStore.getState().setDraft(selectedLeadId, text);
  }, [selectedLeadId]);
  const [starting, setStarting] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectTask, setNewProjectTask] = useState('');
  const [newProjectModel, setNewProjectModel] = useState('');
  const [newProjectCwd, setNewProjectCwd] = useState('');
  const [resumeSessionId, setResumeSessionId] = useState('');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<RoleInfo[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<string>('team');
  const [sidebarTabHeight, setSidebarTabHeight] = useState(280);
  const [decisionsPanelHeight, setDecisionsPanelHeight] = useState(180);
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('ai-crew-sidebar-tabs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 4) return parsed.filter((id: string) => id !== 'activity');
      }
    } catch {}
    return ['team', 'comms', 'groups', 'dag'];
  });
  const [dragOverTab, setDragOverTab] = useState<string | null>(null);
  const [showProgressDetail, setShowProgressDetail] = useState(false);
  const [expandedReport, setExpandedReport] = useState<AgentReport | null>(null);
  const [reportsExpanded, setReportsExpanded] = useState(true);
  const [pendingBannerExpanded, setPendingBannerExpanded] = useState(false);
  const [renamingLeadId, setRenamingLeadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const isResizing = useRef(false);
  const [persistedProjects, setPersistedProjects] = useState<Project[]>([]);
  const [resumingProjectId, setResumingProjectId] = useState<string | null>(null);

  // ── Catch-up summary banner ──────────────────────────────────────────
  const lastInteractionRef = useRef(Date.now());
  const snapshotRef = useRef<{ tasks: number; decisions: number; comms: number; reports: number }>({ tasks: 0, decisions: 0, comms: 0, reports: 0 });
  const [catchUpSummary, setCatchUpSummary] = useState<{ tasksCompleted: number; pendingDecisions: number; newMessages: number; newReports: number } | null>(null);

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

  const leadAgents = agents.filter((a) => a.role.id === 'lead' && !a.parentId);
  // Map active lead projectIds for merging
  const activeProjectIds = new Set(leadAgents.map((a) => a.projectId).filter(Boolean));
  // Inactive persisted projects (no active lead)
  const inactiveProjects = persistedProjects.filter((p) => !activeProjectIds.has(p.id) && p.status !== 'archived');
  const currentProject = selectedLeadId ? projects[selectedLeadId] : null;
  const leadAgent = agents.find((a) => a.id === selectedLeadId);
  const isActive = leadAgent && (leadAgent.status === 'running' || leadAgent.status === 'idle');

  // On mount, load existing leads and persisted projects from server
  useEffect(() => {
    // Load persisted projects
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: Project[]) => { if (Array.isArray(data)) setPersistedProjects(data); })
      .catch(() => {});

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
      fetch(`/api/agents/${selectedLeadId}/messages?limit=200`)
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

  // Fetch DAG status for selected lead
  useEffect(() => {
    if (!isActiveAgent || !selectedLeadId) return;
    const fetchDag = () => {
      fetch(`/api/lead/${selectedLeadId}/dag`).then((r) => r.json()).then((data: any) => {
        if (data && data.tasks) useLeadStore.getState().setDagStatus(selectedLeadId, data as DagStatus);
      }).catch(() => {});
    };
    fetchDag();
    const interval = setInterval(fetchDag, 10000);
    return () => clearInterval(interval);
  }, [selectedLeadId, isActiveAgent]);

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
        }
      }

      // DAG status updates
      if (msg.type === 'dag:updated' && msg.leadId === selectedLeadId) {
        fetch(`/api/lead/${selectedLeadId}/dag`).then((r) => r.json()).then((data: any) => {
          if (data && data.tasks) store.setDagStatus(selectedLeadId!, data as DagStatus);
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
    setTabOrder((prev) => {
      const newOrder = [...prev];
      const srcIdx = newOrder.indexOf(sourceTabId);
      const tgtIdx = newOrder.indexOf(targetTabId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      [newOrder[srcIdx], newOrder[tgtIdx]] = [newOrder[tgtIdx], newOrder[srcIdx]];
      localStorage.setItem('ai-crew-sidebar-tabs', JSON.stringify(newOrder));
      return newOrder;
    });
  }, []);

  const handleTabDragEnd = useCallback(() => {
    setDragOverTab(null);
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
        setShowNewProject(false);
        setNewProjectName('');
        setNewProjectTask('');
        setNewProjectModel('');
        setNewProjectCwd('');
        setResumeSessionId('');
        setSelectedRoles(new Set());
      }
    } catch {
      // ignore
    } finally {
      setStarting(false);
    }
  }, []);

  const sendMessage = useCallback(async (mode: 'queue' | 'interrupt' = 'queue') => {
    if (!input.trim() || !selectedLeadId) return;
    const text = input.trim();
    setInput('');
    useLeadStore.getState().addMessage(selectedLeadId, { type: 'text', text, sender: 'user', queued: mode === 'queue', timestamp: Date.now() });
    await fetch(`/api/lead/${selectedLeadId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode }),
    });
  }, [input, selectedLeadId]);

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
  const teamAgents = agents.filter((a) => a.id === selectedLeadId || a.parentId === selectedLeadId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Project list sidebar */}
      <div className="w-56 border-r border-th-border flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-th-border flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            Projects
          </span>
          <button
            onClick={() => setShowNewProject(true)}
            className="p-1 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text"
            title="New Project"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {leadAgents.length === 0 && inactiveProjects.length === 0 && !showNewProject && (
            <div className="p-4 text-center">
              <Crown className="w-10 h-10 text-yellow-600/50 dark:text-yellow-400/50 mx-auto mb-2" />
              <p className="text-xs text-th-text-muted font-mono mb-3">No projects yet</p>
              <button
                onClick={() => setShowNewProject(true)}
                className="text-xs bg-yellow-600 hover:bg-yellow-500 text-black px-3 py-1.5 rounded font-semibold"
              >
                Create Project
              </button>
            </div>
          )}

          {leadAgents.map((lead) => {
            const isSelected = selectedLeadId === lead.id;
            const isRunning = lead.status === 'running';
            return (
              <button
                key={lead.id}
                onClick={() => {
                  useLeadStore.getState().addProject(lead.id);
                  useLeadStore.getState().selectLead(lead.id);
                }}
                className={`w-full text-left px-3 py-2.5 border-b border-th-border/50 transition-colors group ${
                  isSelected
                    ? 'bg-yellow-600/15 border-l-2 border-l-yellow-500'
                    : 'hover:bg-th-bg-alt border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-green-400' : 'bg-gray-500'}`} />
                  {renamingLeadId === lead.id ? (
                    <input
                      autoFocus
                      className="text-sm font-mono truncate flex-1 bg-th-bg-muted border border-th-border rounded px-1 py-0 text-th-text focus:outline-none focus:border-accent"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmed = renameValue.trim();
                          if (trimmed) {
                            fetch(`/api/lead/${lead.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ projectName: trimmed }),
                            }).catch(() => {});
                            useAppStore.getState().updateAgent(lead.id, { projectName: trimmed });
                          }
                          setRenamingLeadId(null);
                        }
                        if (e.key === 'Escape') setRenamingLeadId(null);
                      }}
                      onBlur={() => {
                        const trimmed = renameValue.trim();
                        if (trimmed && trimmed !== (lead.projectName || '')) {
                          fetch(`/api/lead/${lead.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ projectName: trimmed }),
                          }).catch(() => {});
                          useAppStore.getState().updateAgent(lead.id, { projectName: trimmed });
                        }
                        setRenamingLeadId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-sm font-mono truncate flex-1"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingLeadId(lead.id);
                        setRenameValue(lead.projectName || lead.task?.slice(0, 40) || '');
                      }}
                      title="Double-click to rename"
                    >
                      {lead.projectName || lead.task?.slice(0, 40) || lead.id.slice(0, 8)}
                    </span>
                  )}
                  <span
                    role="button"
                    title="Rename project"
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-th-bg-muted rounded transition-opacity shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingLeadId(lead.id);
                      setRenameValue(lead.projectName || lead.task?.slice(0, 40) || '');
                    }}
                  >
                    <Pencil className="w-3 h-3 text-th-text-muted hover:text-th-text-alt" />
                  </span>
                  <span
                    role="button"
                    title="Remove project"
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/40 rounded transition-opacity shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm('Remove this project? Running agents will be stopped.')) return;
                      // Kill lead + children on server
                      fetch(`/api/agents/${lead.id}`, { method: 'DELETE' }).catch(() => {});
                      lead.childIds.forEach((cid: string) => fetch(`/api/agents/${cid}`, { method: 'DELETE' }).catch(() => {}));
                      useLeadStore.getState().removeProject(lead.id);
                    }}
                  >
                    <X className="w-3.5 h-3.5 text-th-text-muted hover:text-red-400" />
                  </span>
                </div>
                <div className="text-xs text-th-text-muted mt-0.5 pl-4 font-mono">
                  {lead.status} · {agents.filter((a: any) => a.parentId === lead.id).length} agents
                  {(() => {
                    const allIds = [lead.id, ...(lead.childIds || [])];
                    const total = allIds.reduce((s, id) => {
                      const a = agents.find((ag: any) => ag.id === id);
                      return s + (a?.inputTokens || 0) + (a?.outputTokens || 0);
                    }, 0);
                    return total > 0 ? ` · ${formatTokens(total)} tokens` : '';
                  })()}
                </div>
              </button>
            );
          })}

          {/* Inactive persisted projects */}
          {inactiveProjects.length > 0 && (
            <>
              {leadAgents.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] font-medium text-th-text-muted uppercase tracking-wider border-t border-th-border/50">
                  Past Projects
                </div>
              )}
              {inactiveProjects.map((proj) => {
                const isSelected = selectedLeadId === `project:${proj.id}`;
                return (
                  <div
                    key={proj.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const key = `project:${proj.id}`;
                      useLeadStore.getState().addProject(key);
                      useLeadStore.getState().selectLead(key);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const key = `project:${proj.id}`;
                        useLeadStore.getState().addProject(key);
                        useLeadStore.getState().selectLead(key);
                      }
                    }}
                    className={`w-full text-left px-3 py-2.5 border-b border-th-border/50 transition-colors group cursor-pointer ${
                      isSelected
                        ? 'bg-yellow-600/15 border-l-2 border-l-yellow-500'
                        : 'hover:bg-th-bg-alt border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0 bg-th-bg-hover" />
                      <span className="text-sm font-mono truncate flex-1 text-th-text-muted">{proj.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setResumingProjectId(proj.id);
                          fetch(`/api/projects/${proj.id}/resume`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                          })
                            .then((r) => r.json())
                            .then((data) => {
                              if (data.id) {
                                useLeadStore.getState().addProject(data.id);
                                useLeadStore.getState().selectLead(data.id);
                                fetch('/api/projects').then((r) => r.json()).then((ps: Project[]) => {
                                  if (Array.isArray(ps)) setPersistedProjects(ps);
                                }).catch(() => {});
                              }
                            })
                            .catch(() => {})
                            .finally(() => setResumingProjectId(null));
                        }}
                        className="text-[10px] text-yellow-500 hover:text-yellow-600 dark:hover:text-yellow-400 bg-yellow-900/30 hover:bg-yellow-900/50 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title="Resume project"
                      >
                        {resumingProjectId === proj.id ? <Loader2 size={10} className="animate-spin" /> : 'Resume'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete project "${proj.name}"? This cannot be undone.`)) return;
                          fetch(`/api/projects/${proj.id}`, { method: 'DELETE' })
                            .then(() => {
                              setPersistedProjects((prev) => prev.filter((p) => p.id !== proj.id));
                              useLeadStore.getState().removeProject(`project:${proj.id}`);
                            })
                            .catch(() => {});
                        }}
                        className="p-0.5 hover:bg-red-900/40 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Delete project"
                      >
                        <X className="w-3.5 h-3.5 text-th-text-muted hover:text-red-400" />
                      </button>
                    </div>
                    <div className="text-xs text-th-text-muted mt-0.5 pl-4 font-mono">
                      {proj.status} · {proj.updatedAt?.slice(0, 10)}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* New project button at bottom of sidebar */}
        {showNewProject ? null : (
          <div className="border-t border-th-border p-2">
            <button
              onClick={() => setShowNewProject(true)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-yellow-600 dark:text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 py-1.5 rounded hover:bg-th-bg-alt transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        )}
      </div>

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
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-th-text-muted mb-1 font-medium">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Feature"
                  className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
                  autoFocus
                />
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
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-th-border">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-4 py-2 text-sm text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => startLead(
                  newProjectName || 'Untitled',
                  newProjectTask.trim() || undefined,
                  newProjectModel || undefined,
                  newProjectCwd.trim() || undefined,
                  resumeSessionId.trim() || undefined,
                  selectedRoles.size > 0 ? Array.from(selectedRoles) : undefined,
                )}
                disabled={starting}
                className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-th-bg-hover text-black text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
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
          <div className="flex-1 flex flex-col min-w-0">
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
                  const leadIn = progress.leadTokens?.input || 0;
                  const leadOut = progress.leadTokens?.output || 0;
                  const teamIn = (progress.teamAgents || []).reduce((s: number, a: any) => s + (a.inputTokens || 0), 0);
                  const teamOut = (progress.teamAgents || []).reduce((s: number, a: any) => s + (a.outputTokens || 0), 0);
                  const total = leadIn + leadOut + teamIn + teamOut;
                  return total > 0 ? (
                    <div className="flex items-center gap-1.5 text-th-text-muted" title={`Input: ${formatTokens(leadIn + teamIn)} · Output: ${formatTokens(leadOut + teamOut)}`}>
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      <span>{formatTokens(total)} tokens</span>
                    </div>
                  ) : null;
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
                  <div className="max-h-48 overflow-y-auto px-3 pb-2 space-y-1">
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
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages with prompt navigation */}
            <div className="flex-1 relative min-h-0">
              <div ref={chatContainerRef} className="absolute inset-0 overflow-y-auto p-4 space-y-1">
              {messages.filter((msg) => msg.text).map((msg, i, filtered) => {
                if (msg.queued) return null; // queued messages rendered below
                const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                if (msg.sender === 'user') {
                  return (
                    <div key={i} data-user-prompt={i} className="flex justify-end items-start gap-2 py-1">
                      <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
                      <div className="max-w-[80%] rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.sender === 'external') {
                  return (
                    <div key={i} className="flex items-start gap-2 py-1 bg-amber-500/[0.06] rounded-md border-l-2 border-amber-500/30 pl-2">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 bg-amber-500/10 dark:bg-amber-900/30 border border-amber-400/20 dark:border-amber-600/30 font-mono text-sm whitespace-pre-wrap text-th-text-alt">
                        <div className="flex items-center gap-1.5 mb-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
                          <MessageSquare className="w-3 h-3" />
                          {msg.fromRole || 'Agent'}
                        </div>
                        <MarkdownContent text={msg.text} mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />
                      </div>
                      <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
                    </div>
                  );
                }

                if (msg.sender === 'system') {
                  return (
                    <div key={i} className="flex justify-center py-1">
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-th-bg-alt/60 border border-th-border/50 text-xs font-mono text-th-text-muted">
                        <RefreshCw className="w-3 h-3 text-th-text-muted" />
                        {msg.text}
                        {ts && <span className="text-[10px] text-th-text-muted ml-1">{ts}</span>}
                      </div>
                    </div>
                  );
                }

                // Thinking/reasoning — collapsed by default, expandable on click
                if (msg.sender === 'thinking') {
                  return <CollapsibleReasoningBlock key={i} text={msg.text} timestamp={ts} />;
                }

                // Agent (lead) messages: no bubble, just flowing text
                // Only show timestamp on the first message in a consecutive agent run
                const prevMsg = i > 0 ? filtered[i - 1] : null;
                const isFirstInRun = !prevMsg || prevMsg.sender !== 'agent' || prevMsg.queued;
                const agentTs = isFirstInRun ? ts : '';

                // Highlight detection using shared utility
                const prevSenderIsUser = (prevMsg?.sender === 'user' && isFirstInRun);
                const highlight = classifyHighlight(msg.text, { prevSenderIsUser });
                const isUserDir = highlight === 'user-directed';

                const msgHighlight = highlight === 'user-directed'
                  ? 'bg-accent/[0.08] border-l-2 border-l-accent/40 pl-2 rounded-md'
                  : highlight === 'reply-to-user'
                    ? 'bg-blue-500/[0.06] border-l-2 border-l-blue-400/30 pl-2 rounded-md'
                    : '';

                if (msg.contentType && msg.contentType !== 'text') {
                  return (
                    <div key={i} className={`py-1 ${msgHighlight}`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <RichContentBlock msg={msg} />
                        </div>
                        {agentTs && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{agentTs}</span>}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`py-0.5 ${msgHighlight}`}>
                    <div className="flex items-start gap-2">
                      <div className={`flex-1 font-mono text-sm whitespace-pre-wrap min-w-0 ${isUserDir ? 'text-th-text' : 'text-th-text-alt'}`}>
                        <AgentTextBlock text={msg.text} />
                      </div>
                      {agentTs && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{agentTs}</span>}
                    </div>
                  </div>
                );
              })}
              {isActive && messages.length > 0 && messages[messages.length - 1]?.sender === 'user' && !messages[messages.length - 1]?.queued && (
                <div className="flex justify-start py-1">
                  <div className="text-th-text-muted font-mono text-sm flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-yellow-600 dark:text-yellow-400" />
                    <span>Working...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
              </div>
              {/* Prompt navigation */}
              <PromptNav containerRef={chatContainerRef} messages={messages} />
              {/* Catch-up summary — floating overlay at bottom-center */}
              {catchUpSummary && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[420px] max-w-[calc(100%-2rem)] animate-in slide-in-from-bottom fade-in duration-300">
                  <div
                    role="status"
                    aria-live="polite"
                    tabIndex={0}
                    className="bg-th-bg/95 backdrop-blur-md border border-th-border rounded-xl shadow-2xl px-4 py-3"
                    onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setCatchUpSummary(null); }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="text-xs font-semibold text-th-text-alt">While you were away</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono">
                      {catchUpSummary.tasksCompleted > 0 && <span className="text-emerald-400">{catchUpSummary.tasksCompleted} task{catchUpSummary.tasksCompleted !== 1 ? 's' : ''} completed</span>}
                      {catchUpSummary.pendingDecisions > 0 && <span className="text-amber-400">⚠ {catchUpSummary.pendingDecisions} decision{catchUpSummary.pendingDecisions !== 1 ? 's' : ''} pending</span>}
                      {catchUpSummary.newMessages > 0 && <span className="text-blue-400">{catchUpSummary.newMessages} new message{catchUpSummary.newMessages !== 1 ? 's' : ''}</span>}
                      {catchUpSummary.newReports > 0 && <span className="text-amber-600 dark:text-amber-400">{catchUpSummary.newReports} report{catchUpSummary.newReports !== 1 ? 's' : ''}</span>}
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <button onClick={() => setCatchUpSummary(null)} className="text-[11px] px-2.5 py-1 rounded-md bg-th-bg-alt border border-th-border text-th-text-alt hover:bg-th-bg-muted transition-colors">Dismiss</button>
                      <button onClick={() => { setCatchUpSummary(null); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }} className="text-[11px] px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">Show All</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Queued messages (pending) */}
            {messages.some((m) => m.queued) && (
              <div className="border-t border-dashed border-th-border px-4 py-2 bg-th-bg-alt/50">
                <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Queued ({messages.filter((m) => m.queued).length})
                </div>
                {messages.filter((m) => m.queued).map((msg, i, arr) => (
                  <div key={`q-${i}`} className="flex justify-end items-center gap-1.5 py-0.5 group">
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {i > 0 && (
                        <button onClick={() => reorderQueuedMessage(i, i - 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move up">
                          <ChevronUp className="w-3 h-3" />
                        </button>
                      )}
                      {i < arr.length - 1 && (
                        <button onClick={() => reorderQueuedMessage(i, i + 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move down">
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      )}
                      <button onClick={() => removeQueuedMessage(i)} className="p-0.5 rounded hover:bg-red-500/20 text-th-text-muted hover:text-red-400" title="Remove">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-[10px] text-th-text-muted">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                    <div className="max-w-[70%] rounded-lg px-3 py-1.5 bg-blue-600/40 text-blue-600 dark:text-blue-200 font-mono text-sm whitespace-pre-wrap border border-blue-500/30">
                      {msg.text}
                    </div>
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-th-border p-3">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      sendMessage('queue');
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      sendMessage('interrupt');
                    }
                  }}
                  placeholder={isActive ? 'Message the Lead... (Enter = send, Ctrl+Enter = interrupt)' : 'Project Lead is not active'}
                  disabled={!isActive}
                  rows={1}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
                  }}
                  className="flex-1 bg-th-bg-alt border border-th-border rounded px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500 disabled:opacity-50 resize-none overflow-y-auto"
                  style={{ maxHeight: 150 }}
                />
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => sendMessage('queue')}
                    disabled={!isActive || !input.trim()}
                    title="Send (queued) — Enter"
                    className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-th-bg-hover text-black px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => sendMessage('interrupt')}
                    disabled={!isActive || !input.trim()}
                    title="Interrupt current work (Ctrl+Enter)"
                    className="bg-red-700 hover:bg-red-600 disabled:bg-th-bg-hover text-white px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    Interrupt
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right sidebar: decisions + comms + activity + team */}
          {sidebarCollapsed ? (
            <div className="border-l border-th-border flex flex-col items-center py-2 w-10 shrink-0">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text relative"
                title="Expand sidebar"
              >
                <PanelRightOpen className="w-4 h-4" />
                {pendingConfirmations.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-yellow-500 rounded-full text-[8px] font-bold text-black flex items-center justify-center" title={`${pendingConfirmations.length} decision(s) need confirmation`}>
                    {pendingConfirmations.length}
                  </span>
                )}
              </button>
            </div>
          ) : (
            <div className="flex shrink-0" style={{ width: sidebarWidth }}>
              {/* Drag handle */}
              <div
                onMouseDown={startResize}
                className="w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0"
              />
              <div className="flex-1 border-l border-th-border flex flex-col overflow-hidden min-w-0">
                <div className="px-2 py-1 border-b border-th-border flex items-center justify-end shrink-0">
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text"
                    title="Collapse sidebar"
                  >
                    <PanelRightClose className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Decisions — always visible at top */}
                <div className="shrink-0 flex flex-col relative" style={{ height: decisionsPanelHeight, maxHeight: '30%' }}>
                  <div className="px-3 py-1.5 flex items-center gap-2 border-b border-th-border shrink-0">
                    <Lightbulb className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                    <span className="text-xs font-semibold">Decisions</span>
                    {pendingConfirmations.length > 0 && (
                      <span className="w-2 h-2 bg-yellow-500 rounded-full" title={`${pendingConfirmations.length} pending`} />
                    )}
                    <span className="text-[10px] text-th-text-muted ml-auto">{decisions.length}</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <DecisionPanelContent decisions={decisions} onConfirm={handleConfirmDecision} onReject={handleRejectDecision} />
                  </div>
                  {/* Resize handle for decisions panel */}
                  <div
                    onMouseDown={startDecisionsResize}
                    className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0 absolute bottom-0 left-0 right-0"
                    style={{ transform: 'translateY(2px)', zIndex: 10 }}
                  />
                </div>

                {/* Tabbed bottom panels */}
                <div className="flex-1 min-h-0 border-t border-th-border flex flex-col relative">
                  <div className="flex border-b border-th-border shrink-0 overflow-x-auto">
                    {(() => {
                      const allTabs: Record<string, { icon: React.ReactNode; label: string; badge?: number }> = {
                        team: { icon: <Bot className="w-3 h-3" />, label: 'Team', badge: teamAgents.length },
                        comms: { icon: <MessageSquare className="w-3 h-3" />, label: 'Comms', badge: comms.length },
                        groups: { icon: <Users className="w-3 h-3" />, label: 'Groups', badge: groups.length },
                        dag: { icon: <Network className="w-3 h-3" />, label: 'DAG', badge: dagStatus?.tasks.length },
                        tokens: { icon: <BarChart3 className="w-3 h-3" />, label: 'Tokens' },
                        costs: { icon: <BarChart3 className="w-3 h-3" />, label: 'Costs' },
                        timers: { icon: <Clock className="w-3 h-3" />, label: 'Timers', badge: activeTimerCount || undefined },
                      };
                      const orderedIds = tabOrder.filter((id) => id in allTabs);
                      // Append any missing tabs (safety net)
                      for (const id of Object.keys(allTabs)) {
                        if (!orderedIds.includes(id)) orderedIds.push(id);
                      }
                      return orderedIds.map((tabId) => {
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
                            onClick={() => setSidebarTab(tabId)}
                            className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] whitespace-nowrap border-b-2 transition-colors cursor-grab active:cursor-grabbing ${
                              dragOverTab === tabId
                                ? 'border-blue-400 bg-blue-500/10 text-blue-600 dark:text-blue-300'
                                : sidebarTab === tabId
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
                      });
                    })()}
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {sidebarTab === 'team' && <TeamStatusContent agents={teamAgents} delegations={progress?.delegations ?? []} comms={comms} activity={activity} allAgents={agents} onOpenChat={handleOpenAgentChat} />}
                    {sidebarTab === 'comms' && <CommsPanelContent comms={comms} groupMessages={groupMessages} leadId={selectedLeadId} />}
                    {sidebarTab === 'groups' && <GroupsPanelContent groups={groups} groupMessages={groupMessages} leadId={selectedLeadId} />}
                    {sidebarTab === 'dag' && <TaskDagPanelContent dagStatus={dagStatus} />}
                    {sidebarTab === 'tokens' && <TokenEconomics />}
                    {sidebarTab === 'costs' && <CostBreakdown />}
                    {sidebarTab === 'timers' && <TimerDisplay />}
                  </div>
                  {/* Resize handle for tabbed section */}
                  <div
                    onMouseDown={startTabResize}
                    className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0 absolute top-0 left-0 right-0"
                    style={{ transform: 'translateY(-2px)' }}
                  />
                </div>
              </div>
            </div>
          )}
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
              <button onClick={() => setShowProgressDetail(false)} className="text-th-text-muted hover:text-th-text">
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
                    <span className="text-green-400">{progress.completed} done</span>
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
                        <p className="text-xs text-green-400 font-semibold mb-1">✓ Completed</p>
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
                            {snap.completed.length > 0 && <span className="text-green-500">✓{snap.completed.length}</span>}
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
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.status === 'active' ? 'bg-blue-500/20 text-blue-400' : d.status === 'completed' ? 'bg-green-500/20 text-green-400' : d.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-th-text-muted'}`}>
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
                <button onClick={() => setExpandedReport(null)} className="text-th-text-muted hover:text-th-text">
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

/** Format token count for display (e.g. 1234 → "1.2k", 1234567 → "1.2M") */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Parse [Agent Report] or [Agent ACK] formatted content into structured parts */
function parseAgentReport(content: string): { header: string; task: string; output: string; sessionId: string; isReport: boolean; isAck: boolean } {
  // Check for ACK first
  const ackMatch = content.match(/^\[Agent ACK\]\s*(.+?)(?:\n|$)/);
  if (ackMatch) {
    const header = ackMatch[1].trim();
    const taskMatch = header.match(/acknowledged task:\s*(.*)/);
    return {
      header: header.replace(/\s*acknowledged task:.*/, ''),
      task: taskMatch ? taskMatch[1].trim() : '',
      output: '',
      sessionId: '',
      isReport: true,
      isAck: true,
    };
  }

  const reportMatch = content.match(/^\[Agent Report\]\s*(.+?)(?:\n|$)/);
  if (!reportMatch) return { header: '', task: '', output: '', sessionId: '', isReport: false, isAck: false };

  const header = reportMatch[1].trim();
  const taskMatch = content.match(/\nTask:\s*(.*?)(?:\n|$)/);
  const sessionMatch = content.match(/\nSession ID:\s*(.*?)(?:\n|$)/);
  const outputMatch = content.match(/\nOutput summary:\s*([\s\S]*)$/);

  // Clean output: strip ⟦⟦ ... ⟧⟧ fragments and normalize whitespace
  let output = outputMatch ? outputMatch[1].trim() : '';
  output = output.replace(/⟦⟦[\s\S]*?⟧⟧/g, '').replace(/⟦⟦[\s\S]*$/g, '').replace(/^[\s\S]*?⟧⟧/g, '').trim();
  output = output.replace(/\n\s(?=\S)/g, ' ');

  return {
    header,
    task: taskMatch ? taskMatch[1].trim() : '',
    output,
    sessionId: sessionMatch ? sessionMatch[1].trim() : '',
    isReport: true,
    isAck: false,
  };
}

/** Render an agent report with structured formatting */
function AgentReportBlock({ content, compact }: { content: string; compact?: boolean }) {
  const parsed = parseAgentReport(content);
  if (!parsed.isReport) {
    return <span className="text-xs font-mono text-th-text-alt whitespace-pre-wrap break-words">{content}</span>;
  }

  // ACK messages: compact inline rendering
  if (parsed.isAck) {
    return (
      <div className="text-xs font-mono flex items-center gap-1.5">
        <Check className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="text-amber-600 dark:text-amber-400">{parsed.header}</span>
        {parsed.task && <span className="text-th-text-muted"> — {compact && parsed.task.length > 60 ? parsed.task.slice(0, 60) + '…' : parsed.task}</span>}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="text-xs font-mono">
        <span className="text-th-text-alt">{parsed.header}</span>
        {parsed.task && <span className="text-th-text-muted"> — {parsed.task.length > 80 ? parsed.task.slice(0, 80) + '…' : parsed.task}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm font-mono">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-th-text-alt font-semibold">{parsed.header}</span>
      </div>
      {parsed.task && (
        <div>
          <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Task</span>
          <p className="text-th-text-alt whitespace-pre-wrap break-words mt-0.5">{parsed.task}</p>
        </div>
      )}
      {parsed.output && (
        <div>
          <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Output</span>
          <pre className="text-th-text-alt whitespace-pre-wrap break-words mt-0.5 bg-th-bg/50 rounded p-2 text-xs max-h-60 overflow-y-auto">{parsed.output}</pre>
        </div>
      )}
      {parsed.sessionId && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-th-text-muted uppercase tracking-wider">Session</span>
          <code className="text-th-text-muted bg-th-bg/50 px-1.5 py-0.5 rounded">{parsed.sessionId}</code>
          <button
            onClick={() => navigator.clipboard.writeText(parsed.sessionId)}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400"
          >
            copy
          </button>
        </div>
      )}
    </div>
  );
}

/** Inline comment + action buttons for pending decisions in the banner */
function BannerDecisionActions({ decisionId, onConfirm, onReject }: {
  decisionId: string;
  onConfirm: (id: string, reason?: string) => void;
  onReject: (id: string, reason?: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') onConfirm(decisionId, reason.trim() || undefined); }}
        placeholder="Comment (optional)..."
        className="flex-1 bg-th-bg border border-th-border rounded px-2 py-1 text-xs text-th-text-alt focus:outline-none focus:border-yellow-500"
      />
      <button
        onClick={() => onConfirm(decisionId, reason.trim() || undefined)}
        className="p-1.5 rounded bg-green-800 hover:bg-green-700 text-green-600 dark:text-green-200 transition-colors"
        title="Confirm"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onReject(decisionId, reason.trim() || undefined)}
        className="p-1.5 rounded bg-red-800 hover:bg-red-700 text-red-600 dark:text-red-200 transition-colors"
        title="Reject"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function DecisionPanelContent({ decisions, onConfirm, onReject }: { decisions: any[]; onConfirm?: (id: string, reason?: string) => void; onReject?: (id: string, reason?: string) => void }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedDecision, setSelectedDecision] = useState<any | null>(null);
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    });
  }, [decisions.length]);

  return (
    <>
      <div ref={feedRef} className="h-full overflow-y-auto p-2 space-y-2">
        {decisions.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">No decisions yet</p>
        ) : (
          decisions.map((d: any, i: number) => (
            <div
              key={d.id || `dec-${i}`}
              className={`bg-th-bg-alt border rounded p-2 cursor-pointer hover:bg-th-bg-muted/50 transition-colors ${d.needsConfirmation && d.status === 'recorded' ? 'border-yellow-600' : d.status === 'rejected' ? 'border-red-700' : 'border-th-border'}`}
              onClick={() => setSelectedDecision(d)}
            >
              <div className="flex items-start gap-2">
                <Lightbulb className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-semibold text-th-text-alt truncate">{d.title}</p>
                    {d.agentRole && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">{d.agentRole}</span>
                    )}
                    {d.status && d.status !== 'recorded' && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${d.status === 'confirmed' ? 'bg-green-500/20 text-green-600 dark:text-green-300' : 'bg-red-500/20 text-red-600 dark:text-red-300'}`}>{d.status}</span>
                    )}
                  </div>
                  {d.rationale && <p className="text-xs font-mono text-th-text-muted mt-1 line-clamp-2">{d.rationale}</p>}
                  <p className="text-xs text-th-text-muted mt-1">{new Date(d.timestamp).toLocaleTimeString()}</p>
                  {d.needsConfirmation && d.status === 'recorded' && (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={decisionReasons[d.id] ?? ''}
                        onChange={(e) => setDecisionReasons((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { onConfirm?.(d.id, decisionReasons[d.id]?.trim() || undefined); } }}
                        placeholder="Add a comment (optional)..."
                        className="w-full bg-th-bg border border-th-border rounded px-2 py-1 text-xs text-th-text-alt focus:outline-none focus:border-yellow-500 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { onConfirm?.(d.id, decisionReasons[d.id]?.trim() || undefined); }}
                          className="text-xs px-2 py-1 rounded bg-green-800 hover:bg-green-700 text-green-600 dark:text-green-200 flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Confirm
                        </button>
                        <button
                          onClick={() => { onReject?.(d.id, decisionReasons[d.id]?.trim() || undefined); }}
                          className="text-xs px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-red-600 dark:text-red-200 flex items-center gap-1"
                        >
                          <X className="w-3 h-3" /> Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Decision detail popup */}
      {selectedDecision && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedDecision(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <span className="text-sm font-semibold text-th-text">Decision</span>
                {selectedDecision.agentRole && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">by {selectedDecision.agentRole}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selectedDecision.timestamp).toLocaleString()}
                </span>
                <button onClick={() => setSelectedDecision(null)} className="text-th-text-muted hover:text-th-text">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              <h3 className="text-base font-mono font-semibold text-th-text mb-3">{selectedDecision.title}</h3>
              {selectedDecision.rationale && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Rationale</p>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDecision.rationale}</p>
                </div>
              )}
              {selectedDecision.alternatives && selectedDecision.alternatives.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Alternatives considered</p>
                  <ul className="list-disc list-inside text-sm font-mono text-th-text-muted space-y-1">
                    {selectedDecision.alternatives.map((alt: string, i: number) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedDecision.impact && (
                <div>
                  <p className="text-xs font-semibold text-th-text-muted mb-1">Impact</p>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDecision.impact}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
                  <span className="text-xs font-mono font-semibold text-th-text-alt truncate">{agent.role.name}</span>
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
                    {(agent.inputTokens > 0 || agent.outputTokens > 0) && (
                      <span className="text-[9px] font-mono text-purple-400/70 shrink-0">{formatTokens(agent.inputTokens + agent.outputTokens)}</span>
                    )}
                  </div>
                )}
                {!delegation && (agent.model || agent.role.model || agent.inputTokens > 0 || agent.outputTokens > 0) && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {(agent.model || agent.role.model) && (
                      <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded shrink-0">{agent.model || agent.role.model}</span>
                    )}
                    {(agent.inputTokens > 0 || agent.outputTokens > 0) && (
                      <span className="text-[9px] font-mono text-purple-400/70 shrink-0">{formatTokens(agent.inputTokens + agent.outputTokens)}</span>
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
                      <span className="text-[10px] text-th-text-muted truncate">{latestAct.summary}</span>
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
                </div>
              </div>
              {(selectedAgent.status === 'running' || selectedAgent.status === 'idle') && (
                <div className="flex items-center gap-1 mr-2">
                  <button
                    onClick={() => fetch(`/api/agents/${selectedAgent.id}/interrupt`, { method: 'POST' })}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/40 transition-colors"
                    title="Interrupt — cancel current work"
                  >
                    <Hand size={12} /> Interrupt
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
                      selectedDelegation.status === 'completed' ? 'text-green-400 bg-green-900/30' :
                      selectedDelegation.status === 'active' ? 'text-blue-400 bg-blue-900/30' :
                      'text-red-400 bg-red-900/30'
                    }`}>{selectedDelegation.status}</span>
                  )}
                </div>
              )}

              {/* Token Usage */}
              {(selectedAgent.inputTokens > 0 || selectedAgent.outputTokens > 0) && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Token Usage</h4>
                  <div className="flex gap-4 text-xs font-mono">
                    <span className="text-blue-600 dark:text-blue-300">↑ {formatTokens(selectedAgent.inputTokens)} in</span>
                    <span className="text-green-600 dark:text-green-300">↓ {formatTokens(selectedAgent.outputTokens)} out</span>
                    <span className="text-th-text-muted">Σ {formatTokens(selectedAgent.inputTokens + selectedAgent.outputTokens)}</span>
                  </div>
                  {selectedAgent.contextWindowSize > 0 && (
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
                  )}
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
                            {c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content}
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
                          <span className="text-th-text-alt truncate">{evt.summary}</span>
                          {evt.status && (
                            <span className={`ml-auto shrink-0 text-[10px] ${
                              evt.status === 'completed' ? 'text-green-400' :
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
                    if (e.key === 'Enter' && !e.shiftKey) {
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
                    }
                  }}
                  placeholder={`Message ${selectedAgent.role.name}...`}
                  className="flex-1 bg-th-bg border border-th-border rounded px-2.5 py-1.5 text-xs font-mono text-th-text resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  rows={2}
                  disabled={sendingMsg}
                />
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
                  className="self-end px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1 transition-colors"
                  title="Send message (Enter)"
                >
                  <Send size={12} /> {sendingMsg ? 'Sending…' : 'Send'}
                </button>
              </div>
              <p className="text-[10px] text-th-text-muted mt-1">Enter to send · Shift+Enter for newline · Message is queued for the agent</p>
            </div>

          </div>
        </div>
      )}

      {/* Comm detail popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
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
                <button onClick={() => setSelectedComm(null)} className="text-th-text-muted hover:text-th-text text-lg leading-none">×</button>
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

function CommsPanelContent({ comms, groupMessages, leadId }: { comms: AgentComm[]; groupMessages: Record<string, GroupMessage[]>; leadId?: string }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  const [selectedGroupMsg, setSelectedGroupMsg] = useState<GroupMessage | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  // Merge 1:1 comms and group messages into a unified feed sorted by timestamp
  const feed = useMemo(() => {
    const items: FeedItem[] = comms.map(c => ({ type: '1:1' as const, item: c }));
    for (const msgs of Object.values(groupMessages)) {
      for (const m of msgs) {
        items.push({ type: 'group' as const, item: m });
      }
    }
    items.sort((a, b) => {
      const ta = typeof a.item.timestamp === 'string' ? new Date(a.item.timestamp).getTime() : a.item.timestamp;
      const tb = typeof b.item.timestamp === 'string' ? new Date(b.item.timestamp).getTime() : b.item.timestamp;
      return ta - tb;
    });
    return items.slice(-50);
  }, [comms, groupMessages]);

  // Classify and filter
  const classifiedFeed = useMemo(() => {
    return feed
      .map(entry => ({ entry, tier: classifyMessage(entry, leadId) }))
      .filter(({ tier }) => tierPassesFilter(tier, tierFilter));
  }, [feed, leadId, tierFilter]);

  // Count by tier for filter bar
  const tierCounts = useMemo(() => {
    const counts = { critical: 0, notable: 0, routine: 0 };
    for (const entry of feed) {
      counts[classifyMessage(entry, leadId)]++;
    }
    return counts;
  }, [feed, leadId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    });
  }, [classifiedFeed.length]);

  const FILTER_OPTIONS: { value: TierFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'notable', label: `Important (${tierCounts.critical + tierCounts.notable})` },
    { value: 'critical', label: `Critical (${tierCounts.critical})` },
  ];

  return (
    <>
      {/* Tier filter bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-th-border/50 bg-th-bg/50">
        <Filter className="w-3 h-3 text-th-text-muted shrink-0" />
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${tierFilter === opt.value ? 'bg-th-bg-muted text-th-text-alt' : 'text-th-text-muted hover:text-th-text-alt hover:bg-th-bg-alt'}`}
            onClick={() => setTierFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div ref={feedRef} className="h-full overflow-y-auto">
        {classifiedFeed.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">
            {feed.length === 0 ? 'No messages yet' : 'No messages match this filter'}
          </p>
        ) : (
          classifiedFeed.map(({ entry, tier }, i) => {
            const tierStyle = TIER_CONFIG[tier];

            if (entry.type === 'group') {
              const gm = entry.item;
              const time = new Date(gm.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              return (
                <div
                  key={gm.id || `gm-${i}`}
                  className={`px-3 py-1.5 border-b border-l-2 cursor-pointer transition-colors ${tier === 'critical' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-red-500/[0.12]` : tier === 'routine' ? 'border-b-emerald-400/10 border-l-emerald-400/15 opacity-60 hover:opacity-100 hover:bg-emerald-500/[0.06]' : 'border-b-emerald-400/20 bg-emerald-500/[0.04] border-l-emerald-400/30 hover:bg-emerald-500/[0.08]'}`}
                  onClick={() => setSelectedGroupMsg(gm)}
                >
                  <div className="flex items-center gap-1 text-xs">
                    <Users className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="font-mono font-semibold text-emerald-400 truncate">{gm.groupName}</span>
                    <span className="text-th-text-muted">·</span>
                    <span className="font-mono text-cyan-400">{gm.fromRole}</span>
                    {tier === 'critical' && <span className="ml-1 text-red-400 animate-pulse motion-reduce:animate-none text-[10px]">●</span>}
                    <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                  </div>
                  <div className="text-xs font-mono text-th-text-alt mt-0.5">
                    <p className="truncate">
                      <MentionText text={gm.content.length > 120 ? gm.content.slice(0, 120) + '…' : gm.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                    </p>
                  </div>
                </div>
              );
            }
            const c = entry.item as AgentComm;
            const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const isToUser = leadId && c.toId === leadId;
            return (
              <div
                key={c.id}
                className={`px-3 py-1.5 border-b border-l-2 cursor-pointer transition-colors ${tier === 'critical' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-red-500/[0.12]` : tier === 'notable' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-blue-500/[0.08]` : `${isToUser ? 'bg-blue-500/[0.04] border-b-blue-400/15 border-l-blue-400/20' : 'border-b-gray-700/30 border-l-transparent'} opacity-60 hover:opacity-100 hover:bg-th-bg-muted/30`}`}
                onClick={() => setSelectedComm(c)}
              >
                <div className="flex items-center gap-1 text-xs">
                  <span className="font-mono font-semibold text-cyan-400">{c.fromRole}</span>
                  <span className="text-th-text-muted">→</span>
                  <span className="font-mono font-semibold text-green-400">{c.toRole}</span>
                  {tier === 'critical' && <span className="ml-1 text-red-400 animate-pulse motion-reduce:animate-none text-[10px]">●</span>}
                  <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                </div>
                <div className="text-xs font-mono text-th-text-alt mt-0.5">
                  {c.content.startsWith('[Agent Report]') || c.content.startsWith('[Agent ACK]')
                    ? <AgentReportBlock content={c.content} compact />
                    : <p className="truncate">
                        <MentionText text={c.content.length > 120 ? c.content.slice(0, 120) + '…' : c.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                      </p>
                  }
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Full message popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedComm(null); }}
        >
          <div
            className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-th-text-muted">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selectedComm.timestamp).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => setSelectedComm(null)}
                  className="text-th-text-muted hover:text-th-text text-lg leading-none"
                >
                  ×
                </button>
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

      {/* Group message popup */}
      {selectedGroupMsg && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedGroupMsg(null); }}
        >
          <div className="bg-th-bg-alt border border-emerald-600/40 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-700/40">
              <div className="flex items-center gap-2 text-sm">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="font-mono font-semibold text-emerald-400">{selectedGroupMsg.groupName}</span>
                <span className="text-th-text-muted">·</span>
                <span className="font-mono text-cyan-400">{selectedGroupMsg.fromRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {new Date(selectedGroupMsg.timestamp).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => setSelectedGroupMsg(null)}
                  className="text-th-text-muted hover:text-th-text text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <pre className="text-sm font-mono text-th-text-alt whitespace-pre-wrap break-words leading-relaxed">
                <MentionText text={selectedGroupMsg.content} agents={useAppStore.getState().agents} onClickAgent={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedGroupMsg(null); }} />
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function roleColor(role: string): string {
  const colors = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#e879f9', '#fb923c'];
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function GroupsPanelContent({
  groups,
  groupMessages,
  leadId,
}: {
  groups: ChatGroup[];
  groupMessages: Record<string, GroupMessage[]>;
  leadId: string | null;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [fetchedGroups, setFetchedGroups] = useState<Set<string>>(new Set());

  // Reset expanded state when lead changes
  useEffect(() => {
    setExpandedGroup(null);
    setFetchedGroups(new Set());
  }, [leadId]);

  // Fetch messages when a group is first expanded
  useEffect(() => {
    if (!expandedGroup || !leadId || fetchedGroups.has(expandedGroup)) return;
    setFetchedGroups((prev) => new Set(prev).add(expandedGroup));
    fetch(`/api/lead/${leadId}/groups/${encodeURIComponent(expandedGroup)}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const store = useLeadStore.getState();
          // Bulk-set messages for this group
          const proj = store.projects[leadId];
          if (proj) {
            data.forEach((msg: GroupMessage) => {
              store.addGroupMessage(leadId, expandedGroup, msg);
            });
          }
        }
      })
      .catch(() => {});
  }, [expandedGroup, leadId, fetchedGroups]);

  // Auto-scroll when messages change for expanded group
  useEffect(() => {
    if (expandedGroup) {
      requestAnimationFrame(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
      });
    }
  }, [expandedGroup, groupMessages[expandedGroup ?? '']?.length]);

  return (
    <div ref={feedRef} className="h-full overflow-y-auto">
      {groups.length === 0 ? (
        <p className="text-xs text-th-text-muted text-center py-4 font-mono">No groups yet</p>
      ) : (
        groups.map((g) => {
          const isExpanded = expandedGroup === g.name;
          const msgs = groupMessages[g.name] ?? [];
          return (
            <div key={g.name} className="border-b border-th-border/30">
              <button
                className="w-full text-left px-3 py-1.5 hover:bg-th-bg-muted/30 transition-colors flex items-center gap-2"
                onClick={() => setExpandedGroup(isExpanded ? null : g.name)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-th-text-muted shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-th-text-muted shrink-0" />
                )}
                <span className="text-xs font-mono font-semibold text-teal-400 truncate flex-1">{g.name}</span>
                <span className="text-[10px] font-mono text-th-text-muted shrink-0">{g.memberIds.length} members</span>
              </button>
              {isExpanded && (
                <div className="px-2 pb-2 space-y-0.5 max-h-60 overflow-y-auto">
                  {msgs.length === 0 ? (
                    <p className="text-[10px] text-th-text-muted text-center py-2 font-mono">No messages</p>
                  ) : (
                    msgs.map((m) => {
                      const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                      const shortId = m.fromAgentId?.slice(0, 6) ?? '';
                      return (
                        <div key={m.id} className="px-2 py-1 rounded bg-th-bg-alt/50 text-xs font-mono">
                          <div className="flex items-center gap-1">
                            <span className="text-th-text-muted text-[10px] shrink-0">{time}</span>
                            <span style={{ color: roleColor(m.fromRole) }} className="font-semibold truncate">
                              {m.fromRole}{shortId ? ` (${shortId})` : ''}:
                            </span>
                          </div>
                          <p className="text-th-text-alt break-words mt-0.5 whitespace-pre-wrap">
                            <MentionText text={m.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function ActivityFeedContent({ activity, agents }: { activity: ActivityEvent[]; agents: any[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    });
  }, [activity.length]);

  const recent = activity.slice(-30);

  const getIcon = (type: string, status?: string) => {
    if (type === 'delegation') return <GitBranch className="w-3 h-3 text-yellow-600 dark:text-yellow-400 shrink-0" />;
    if (type === 'completion') return <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />;
    if (type === 'message_sent') return <MessageSquare className="w-3 h-3 text-blue-400 shrink-0" />;
    if (type === 'progress') return <BarChart3 className="w-3 h-3 text-purple-400 shrink-0" />;
    if (status === 'in_progress') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
    if (status === 'completed') return <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />;
    return <Wrench className="w-3 h-3 text-th-text-muted shrink-0" />;
  };

  return (
    <div ref={feedRef} className="h-full overflow-y-auto">
      {recent.length === 0 ? (
        <p className="text-xs text-th-text-muted text-center py-4 font-mono">No activity yet</p>
      ) : (
        recent.map((evt) => {
          const agent = agents.find((a: any) => a.id === evt.agentId);
          const label = agent?.role?.name ?? evt.agentRole;
          const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return (
            <div key={evt.id} className="px-3 py-1.5 border-b border-th-border/30 flex items-start gap-2">
              {getIcon(evt.type, evt.status)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-th-text-muted">{label}</span>
                  <span className="text-[10px] font-mono text-th-text-muted">{evt.agentId?.slice(0, 8)}</span>
                  <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                </div>
                <span className="text-xs font-mono text-th-text-alt break-words">{typeof evt.summary === 'string' ? evt.summary : JSON.stringify(evt.summary)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  badge,
  defaultHeight = 160,
  minHeight = 60,
  maxHeight = 500,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: number;
  defaultHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(defaultHeight);
  const isResizing = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startY = e.clientY;
    const startH = height;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newH = Math.min(maxHeight, Math.max(minHeight, startH + (e.clientY - startY)));
      setHeight(newH);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [height, minHeight, maxHeight]);

  return (
    <div className="border-t border-th-border flex flex-col shrink-0" style={collapsed ? undefined : { height }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="px-3 py-1.5 flex items-center gap-2 shrink-0 hover:bg-th-bg-alt/50 transition-colors w-full text-left"
      >
        {collapsed ? <ChevronRight className="w-3 h-3 text-th-text-muted" /> : <ChevronDown className="w-3 h-3 text-th-text-muted" />}
        {icon}
        <span className="text-xs font-semibold">{title}</span>
        {badge !== undefined && <span className="text-[10px] text-th-text-muted ml-auto">{badge}</span>}
      </button>
      {!collapsed && (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
          <div
            onMouseDown={startResize}
            className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0"
          />
        </>
      )}
    </div>
  );
}

function CwdBar({ leadId, cwd }: { leadId: string; cwd?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cwd || '');
  const { updateAgent } = useAppStore();

  useEffect(() => { setValue(cwd || ''); }, [cwd]);

  const save = async () => {
    const trimmed = value.trim();
    await fetch(`/api/lead/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: trimmed || undefined }),
    });
    updateAgent(leadId, { cwd: trimmed || undefined });
    setEditing(false);
  };

  return (
    <div className="border-b border-th-border px-4 py-1.5 flex items-center gap-2 text-xs font-mono bg-th-bg-alt/30">
      <FolderOpen className="w-3 h-3 text-th-text-muted shrink-0" />
      {editing ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/path/to/project"
            className="flex-1 bg-th-bg-alt border border-th-border rounded px-2 py-0.5 text-xs font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
            autoFocus
          />
          <button onClick={save} className="text-green-400 hover:text-green-600 dark:hover:text-green-300 p-0.5"><Check className="w-3 h-3" /></button>
          <button onClick={() => setEditing(false)} className="text-th-text-muted hover:text-th-text p-0.5"><X className="w-3 h-3" /></button>
        </>
      ) : (
        <>
          <span className="text-th-text-muted truncate flex-1" title={cwd}>{cwd || '(server default)'}</span>
          <button
            onClick={() => setEditing(true)}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0"
          >
            edit
          </button>
        </>
      )}
    </div>
  );
}

/** Floating navigation to jump between user prompts in the chat */
function PromptNav({ containerRef, messages }: { containerRef: React.RefObject<HTMLDivElement | null>; messages: AcpTextChunk[] }) {
  const [currentIdx, setCurrentIdx] = useState(-1);

  const userIndices = useMemo(() => {
    const indices: number[] = [];
    const visible = messages.filter((m) => m.sender !== 'system' && m.text && !m.queued);
    visible.forEach((msg, i) => {
      if (msg.sender === 'user') indices.push(i);
    });
    return indices;
  }, [messages]);

  const total = userIndices.length;

  const jumpTo = useCallback((promptIdx: number) => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-user-prompt="${userIndices[promptIdx]}"]`) as HTMLElement;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentIdx(promptIdx);
      // Brief highlight
      el.classList.add('ring-2', 'ring-blue-400', 'ring-offset-1', 'ring-offset-gray-900', 'rounded-lg');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-1', 'ring-offset-gray-900', 'rounded-lg'), 1500);
    }
  }, [containerRef, userIndices]);

  const goUp = useCallback(() => {
    if (total === 0) return;
    const next = currentIdx <= 0 ? total - 1 : currentIdx - 1;
    jumpTo(next);
  }, [currentIdx, total, jumpTo]);

  const goDown = useCallback(() => {
    if (total === 0) return;
    const next = currentIdx >= total - 1 ? 0 : currentIdx + 1;
    jumpTo(next);
  }, [currentIdx, total, jumpTo]);

  if (total === 0) return null;

  return (
    <div className="absolute right-3 top-3 flex flex-col items-center gap-0.5 z-10">
      <button
        onClick={goUp}
        className="p-1 rounded bg-th-bg-alt/80 border border-th-border text-th-text-muted hover:text-th-text hover:bg-th-bg-muted transition-colors"
        title="Previous prompt"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] font-mono text-th-text-muted select-none leading-none py-0.5">
        {currentIdx >= 0 ? currentIdx + 1 : '·'}/{total}
      </span>
      <button
        onClick={goDown}
        className="p-1 rounded bg-th-bg-alt/80 border border-th-border text-th-text-muted hover:text-th-text hover:bg-th-bg-muted transition-colors"
        title="Next prompt"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-th-bg-muted px-1 rounded text-yellow-600 dark:text-yellow-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Renders agent text, separating ⟦⟦ command ⟧⟧ blocks from normal markdown */
function RichContentBlock({ msg }: { msg: AcpTextChunk }) {
  if (msg.contentType === 'image' && msg.data) {
    return (
      <div className="py-1">
        <img
          src={`data:${msg.mimeType || 'image/png'};base64,${msg.data}`}
          alt="Agent image"
          className="max-w-full max-h-96 rounded-lg border border-th-border"
        />
        {msg.uri && <p className="text-[10px] text-th-text-muted mt-1 font-mono">{msg.uri}</p>}
      </div>
    );
  }
  if (msg.contentType === 'audio' && msg.data) {
    return (
      <div className="py-1">
        <audio controls className="max-w-full">
          <source src={`data:${msg.mimeType || 'audio/wav'};base64,${msg.data}`} type={msg.mimeType || 'audio/wav'} />
        </audio>
      </div>
    );
  }
  if (msg.contentType === 'resource') {
    return (
      <div className="py-1">
        {msg.uri && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400 mb-1">
            <FolderOpen className="w-3 h-3" />
            <span className="font-mono">{msg.uri}</span>
          </div>
        )}
        {msg.text && (
          <pre className="text-xs font-mono text-th-text-alt bg-th-bg-alt border border-th-border rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {msg.text}
          </pre>
        )}
      </div>
    );
  }
  return null;
}

/** Collapsed-by-default reasoning block for lead thinking — click to expand */
function CollapsibleReasoningBlock({ text, timestamp }: { text: string; timestamp: string }) {
  if (!text?.trim()) return null;
  const [expanded, setExpanded] = useState(false);
  const preview = text.replace(/[\n\r]+/g, ' ').slice(0, 80);
  return (
    <div className="py-0.5">
      <div
        className="flex items-start gap-2 cursor-pointer group"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-th-text-muted">
            {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            <Lightbulb className="w-3 h-3 shrink-0" />
            <span className="italic">Reasoning</span>
            {!expanded && preview && <span className="text-th-text-muted/60 truncate ml-1">— {preview}{text.length > 80 ? '…' : ''}</span>}
          </div>
          {expanded && (
            <div className="mt-1 ml-5 font-mono text-xs text-th-text-muted italic whitespace-pre-wrap max-h-60 overflow-y-auto">
              {text}
            </div>
          )}
        </div>
        <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{timestamp}</span>
      </div>
    </div>
  );
}

/** Collapsed-by-default ⟦⟦ command ⟧⟧ block with click to expand */
function CollapsibleCommandBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const nameMatch = text.match(/⟦⟦\s*(\w+)/);
  const label = nameMatch ? nameMatch[1] : 'command';
  // Extract a preview from the JSON payload
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let preview = '';
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const parts: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') parts.push(`${k}: ${v.length > 60 ? v.slice(0, 57) + '...' : v}`);
      }
      preview = parts.join(', ');
    } catch {
      preview = jsonMatch[0].replace(/[\n\r]+/g, ' ').slice(0, 80);
    }
  }
  return (
    <div
      className="my-1 px-2 py-1 bg-th-bg-alt/80 border border-th-border rounded text-[11px] text-th-text-alt cursor-pointer hover:border-th-border-hover transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1 min-w-0">
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="font-mono text-th-text-alt shrink-0">{label}</span>
        {!expanded && preview && <span className="font-mono text-th-text-muted truncate ml-1">— {preview}</span>}
      </div>
      {expanded && <pre className="mt-1 whitespace-pre-wrap break-words text-th-text-muted">{text}</pre>}
    </div>
  );
}

/** Check if a ⟦⟦ ... ⟧⟧ block looks like a real command (ALL_CAPS name after ⟦⟦) */
function isRealCommandBlock(text: string): boolean {
  return /^⟦⟦\s*[A-Z][A-Z_]{2,}/.test(text);
}

function AgentTextBlock({ text }: { text: string }) {
  // Split on ⟦⟦ ... ⟧⟧ blocks (complete) and also detect unclosed ⟦⟦ blocks
  const segments = text.split(/(⟦⟦[\s\S]*?⟧⟧)/g);
  return (
    <>
      {segments.map((seg, i) => {
        // Complete ⟦⟦ ⟧⟧ block — only collapse if it looks like a real command
        if (seg.startsWith('⟦⟦') && seg.endsWith('⟧⟧')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlock key={i} text={seg} />;
          }
          return <MarkdownWithTables key={i} text={seg} />;
        }
        // Unclosed ⟦⟦ block (still streaming or split across messages)
        if (seg.includes('⟦⟦') && !seg.includes('⟧⟧')) {
          const idx = seg.indexOf('⟦⟦');
          const before = seg.slice(0, idx);
          const cmdBlock = seg.slice(idx);
          if (isRealCommandBlock(cmdBlock)) {
            return (
              <span key={i}>
                {before.trim() ? <MarkdownWithTables text={before} /> : null}
                <CollapsibleCommandBlock text={cmdBlock} />
              </span>
            );
          }
          return <MarkdownWithTables key={i} text={seg} />;
        }
        // Dangling ⟧⟧ from a block that started in a previous message
        if (seg.includes('⟧⟧') && !seg.includes('⟦⟦')) {
          const idx = seg.indexOf('⟧⟧') + 2;
          const cmdBlock = seg.slice(0, idx);
          const after = seg.slice(idx);
          return (
            <span key={i}>
              <CollapsibleCommandBlock text={cmdBlock} />
              {after.trim() ? <MarkdownWithTables text={after} /> : null}
            </span>
          );
        }
        if (!seg.trim()) return null;
        return <MarkdownWithTables key={i} text={seg} />;
      })}
    </>
  );
}

/** Detect markdown tables and render them; pass other text to InlineMarkdown */
function MarkdownWithTables({ text }: { text: string }) {
  // Match contiguous lines that look like table rows (start with |)
  const TABLE_RE = /((?:^|\n)\|[^\n]+\|[ \t]*(?:\n\|[^\n]+\|[ \t]*)+)/g;
  const parts = text.split(TABLE_RE);

  return (
    <>
      {parts.map((part, i) => {
        const trimmed = part.trim();
        if (trimmed.startsWith('|') && trimmed.includes('\n')) {
          return <MarkdownTable key={i} raw={trimmed} />;
        }
        if (!trimmed) return null;
        return <InlineMarkdown key={i} text={part} />;
      })}
    </>
  );
}

/** Render a markdown table as an HTML table */
function MarkdownTable({ raw }: { raw: string }) {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return <InlineMarkdown text={raw} />;

  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map((cell) => cell.trim());

  const headerCells = parseRow(lines[0]);
  // Check if line[1] is a separator (e.g., |---|---|)
  const isSeparator = /^\|[\s:?-]+(\|[\s:?-]+)*\|?\s*$/.test(lines[1]);
  const dataStart = isSeparator ? 2 : 1;
  const bodyRows = lines.slice(dataStart).map(parseRow);

  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs font-mono border-collapse border border-th-border w-full">
        <thead>
          <tr className="bg-th-bg-alt">
            {headerCells.map((cell, j) => (
              <th key={j} className="border border-th-border px-2 py-1 text-left text-th-text-alt font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-th-bg/30' : 'bg-th-bg-alt/30'}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-th-border px-2 py-1 text-th-text-alt">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
