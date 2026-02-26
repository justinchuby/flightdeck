import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Crown, Send, Users, CheckCircle, AlertCircle, Clock, Loader2, Plus, Trash2, Wrench, MessageSquare, GitBranch, PanelRightClose, PanelRightOpen, ChevronDown, ChevronRight, ChevronUp, Lightbulb, Bot, FolderOpen, Check, X, BarChart3 } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import type { ActivityEvent, AgentComm, ProgressSnapshot, AgentReport } from '../../stores/leadStore';
import type { AcpTextChunk } from '../../types';
import { useAppStore } from '../../stores/appStore';

interface Props {
  api: any;
  ws: any;
}

export function LeadDashboard({ api, ws }: Props) {
  const { projects, selectedLeadId, drafts } = useLeadStore();
  const agents = useAppStore((s) => s.agents);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showProgressDetail, setShowProgressDetail] = useState(false);
  const [expandedReport, setExpandedReport] = useState<AgentReport | null>(null);
  const [reportsExpanded, setReportsExpanded] = useState(true);
  const isResizing = useRef(false);

  const leadAgents = agents.filter((a) => a.role.id === 'lead');
  const currentProject = selectedLeadId ? projects[selectedLeadId] : null;
  const leadAgent = agents.find((a) => a.id === selectedLeadId);
  const isActive = leadAgent && (leadAgent.status === 'running' || leadAgent.status === 'idle');

  // On mount, load existing leads from server
  useEffect(() => {
    fetch('/api/lead').then((r) => r.json()).then((leads: any[]) => {
      if (Array.isArray(leads)) {
        leads.forEach((l) => {
          useLeadStore.getState().addProject(l.id);
        });
        // Auto-select first running lead if none selected
        if (!useLeadStore.getState().selectedLeadId) {
          const running = leads.find((l) => l.status === 'running');
          if (running) useLeadStore.getState().selectLead(running.id);
        }
      }
    }).catch(() => {});
  }, []);

  // Subscribe to selected lead agent WS stream
  useEffect(() => {
    if (!selectedLeadId) return;
    chatInitialScroll.current = false; // reset so we scroll to bottom on lead change
    ws.subscribe(selectedLeadId);
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

  // Poll progress for selected lead
  useEffect(() => {
    if (!selectedLeadId) return;
    const fetchProgress = () => {
      fetch(`/api/lead/${selectedLeadId}/progress`).then((r) => r.json()).then((data) => {
        if (data && !data.error) useLeadStore.getState().setProgress(selectedLeadId, data);
      }).catch(() => {});
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId]);

  // Poll decisions for selected lead
  useEffect(() => {
    if (!selectedLeadId) return;
    const fetchDecisions = () => {
      fetch(`/api/lead/${selectedLeadId}/decisions`).then((r) => r.json()).then((data) => {
        if (Array.isArray(data)) useLeadStore.getState().setDecisions(selectedLeadId, data);
      }).catch(() => {});
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 5000);
    return () => clearInterval(interval);
  }, [selectedLeadId]);

  // Listen for lead-specific WebSocket events
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      const store = useLeadStore.getState();

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

      // Track inter-agent messages
      if (msg.type === 'agent:message_sent') {
        const fromAgent = agents.find((a) => a.id === msg.from);
        const toAgent = agents.find((a) => a.id === msg.to);
        const leadId = selectedLeadId;
        if (leadId && (msg.from === leadId || fromAgent?.parentId === leadId || toAgent?.parentId === leadId)) {
          store.addComm(leadId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fromId: msg.from,
            fromRole: msg.fromRole || fromAgent?.role?.name || 'Unknown',
            toId: msg.to,
            toRole: msg.toRole || toAgent?.role?.name || 'Unknown',
            content: msg.content ?? '',
            timestamp: Date.now(),
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
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [selectedLeadId, agents]);

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

  const startLead = useCallback(async (name: string, task?: string, model?: string, cwd?: string, sessionId?: string) => {
    setStarting(true);
    try {
      const resp = await fetch('/api/lead/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, task, model: model || undefined, cwd: cwd || undefined, sessionId: sessionId || undefined }),
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
      }
    } catch {
      // ignore
    } finally {
      setStarting(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !selectedLeadId) return;
    const text = input.trim();
    setInput('');
    useLeadStore.getState().addMessage(selectedLeadId, { type: 'text', text, sender: 'user', queued: true, timestamp: Date.now() });
    await fetch(`/api/lead/${selectedLeadId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }, [input, selectedLeadId]);

  const messages = currentProject?.messages ?? [];
  const decisions = currentProject?.decisions ?? [];
  const progress = currentProject?.progress ?? null;
  const progressSummary = currentProject?.progressSummary ?? null;
  const progressHistory = currentProject?.progressHistory ?? [];
  const activity = currentProject?.activity ?? [];
  const comms = currentProject?.comms ?? [];
  const agentReports = currentProject?.agentReports ?? [];
  const teamAgents = agents.filter((a) => a.parentId === selectedLeadId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Project list sidebar */}
      <div className="w-56 border-r border-gray-700 flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
          <span className="text-sm font-semibold flex items-center gap-1.5">
            <Crown className="w-4 h-4 text-yellow-400" />
            Projects
          </span>
          <button
            onClick={() => setShowNewProject(true)}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
            title="New Project"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {leadAgents.length === 0 && !showNewProject && (
            <div className="p-4 text-center">
              <Crown className="w-10 h-10 text-yellow-400/50 mx-auto mb-2" />
              <p className="text-xs text-gray-500 font-mono mb-3">No projects yet</p>
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
                className={`w-full text-left px-3 py-2.5 border-b border-gray-700/50 transition-colors ${
                  isSelected
                    ? 'bg-yellow-600/15 border-l-2 border-l-yellow-500'
                    : 'hover:bg-gray-800 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isRunning ? 'bg-green-400' : 'bg-gray-500'}`} />
                  <span className="text-sm font-mono truncate">
                    {lead.projectName || lead.taskId?.slice(0, 40) || lead.id.slice(0, 8)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 pl-4 font-mono">
                  {lead.status} · {lead.childIds.length} agents
                </div>
              </button>
            );
          })}
        </div>

        {/* New project button at bottom of sidebar */}
        {showNewProject ? null : (
          <div className="border-t border-gray-700 p-2">
            <button
              onClick={() => setShowNewProject(true)}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-yellow-400 hover:text-yellow-300 py-1.5 rounded hover:bg-gray-800 transition-colors"
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
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-full max-w-xl flex flex-col"
          >
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-700">
              <Crown className="w-5 h-5 text-yellow-400" />
              <h2 className="text-base font-semibold text-gray-100">New Project</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Feature"
                  className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1 font-medium">Task / Prompt</label>
                <textarea
                  value={newProjectTask}
                  onChange={(e) => setNewProjectTask(e.target.value)}
                  placeholder="Describe what you want the team to work on..."
                  rows={6}
                  className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500 resize-y"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Model</label>
                  <select
                    value={newProjectModel}
                    onChange={(e) => setNewProjectModel(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
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
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Working Directory</label>
                  <input
                    type="text"
                    value={newProjectCwd}
                    onChange={(e) => setNewProjectCwd(e.target.value)}
                    placeholder="/path/to/project"
                    className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1 font-medium">Resume Session <span className="text-gray-600">(optional — paste a session ID to continue previous work)</span></label>
                  <input
                    type="text"
                    value={resumeSessionId}
                    onChange={(e) => setResumeSessionId(e.target.value)}
                    placeholder="session-id-from-previous-lead"
                    className="w-full bg-gray-900 border border-gray-600 rounded-md px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-md hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => startLead(newProjectName || 'Untitled', newProjectTask.trim() || undefined, newProjectModel || undefined, newProjectCwd.trim() || undefined, resumeSessionId.trim() || undefined)}
                disabled={starting}
                className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-black text-sm font-semibold rounded-md flex items-center gap-1.5 transition-colors"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                {starting ? 'Starting...' : resumeSessionId.trim() ? 'Resume Project' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {!selectedLeadId ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Crown className="w-16 h-16 text-yellow-400/30 mx-auto mb-4" />
            <p className="text-gray-500 font-mono text-sm">Select a project or create a new one</p>
          </div>
        </div>
      ) : (
        <>
          {/* Chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Progress banner — clickable to open detail */}
            {progress && progress.totalDelegations > 0 && (
              <div
                className="border-b border-gray-700 px-4 py-2 flex items-center gap-4 text-sm font-mono bg-gray-800/50 cursor-pointer hover:bg-gray-800/80 transition-colors"
                onClick={() => setShowProgressDetail(true)}
                title="Click for detailed progress view"
              >
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span>{progress.teamSize} agents</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-yellow-400" />
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
                <div className="ml-auto">
                  <div className="w-32 bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress.completionPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-gray-400">{progress.completionPct}%</span>
              </div>
            )}
            {progressSummary && (
              <div
                className="border-b border-gray-700 px-4 py-1.5 text-xs text-gray-400 bg-gray-800/30 font-mono truncate cursor-pointer hover:bg-gray-800/50 transition-colors"
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
              <div className="border-b border-gray-700 px-4 py-1 flex items-center gap-2 text-xs font-mono bg-gray-800/20">
                <GitBranch className="w-3 h-3 text-gray-500 shrink-0" />
                <span className="text-gray-500">Session:</span>
                <span className="text-gray-400 truncate" title={leadAgent.sessionId}>{leadAgent.sessionId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(leadAgent.sessionId!);
                    const btn = document.activeElement as HTMLElement;
                    btn.textContent = 'copied!';
                    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
                  }}
                  className="text-gray-500 hover:text-yellow-400 text-[10px] shrink-0 ml-auto"
                >
                  copy
                </button>
              </div>
            )}

            {/* Agent Reports — separate from lead output */}
            {agentReports.length > 0 && (
              <div className="border-b border-indigo-700/40 bg-indigo-950/20">
                <button
                  className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-indigo-400 hover:bg-indigo-900/20 transition-colors"
                  onClick={() => setReportsExpanded(!reportsExpanded)}
                >
                  {reportsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  <MessageSquare className="w-3 h-3" />
                  <span className="font-mono font-medium">Agent Reports</span>
                  <span className="bg-indigo-500/20 px-1.5 rounded text-[10px]">{agentReports.length}</span>
                </button>
                {reportsExpanded && (
                  <div className="max-h-48 overflow-y-auto px-3 pb-2 space-y-1">
                    {agentReports.slice(-20).map((r) => {
                      const time = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div
                          key={r.id}
                          className="flex items-start gap-2 px-2 py-1.5 rounded bg-indigo-900/20 border border-indigo-700/30 cursor-pointer hover:bg-indigo-900/30 transition-colors"
                          onClick={() => setExpandedReport(r)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-xs font-mono font-semibold text-indigo-400">{r.fromRole}</span>
                              <span className="text-[10px] text-gray-600 ml-auto">{time}</span>
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

            {/* Messages with prompt navigation */}
            <div className="flex-1 relative min-h-0">
              <div ref={chatContainerRef} className="absolute inset-0 overflow-y-auto p-4 space-y-1">
              {messages.filter((msg) => msg.sender !== 'system' && msg.text).map((msg, i, filtered) => {
                if (msg.queued) return null; // queued messages rendered below
                const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

                if (msg.sender === 'user') {
                  return (
                    <div key={i} data-user-prompt={i} className="flex justify-end items-start gap-2 py-1">
                      <span className="text-[10px] text-gray-600 mt-1.5 shrink-0">{ts}</span>
                      <div className="max-w-[80%] rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.sender === 'external') {
                  return (
                    <div key={i} className="flex items-start gap-2 py-1">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 bg-indigo-900/40 border border-indigo-700/50 font-mono text-sm whitespace-pre-wrap text-gray-300">
                        <div className="flex items-center gap-1.5 mb-1 text-indigo-400 text-xs font-medium">
                          <MessageSquare className="w-3 h-3" />
                          {msg.fromRole || 'Agent'}
                        </div>
                        <InlineMarkdown text={msg.text} />
                      </div>
                      <span className="text-[10px] text-gray-600 mt-1.5 shrink-0">{ts}</span>
                    </div>
                  );
                }

                // Agent (lead) messages: no bubble, just flowing text
                // Only show timestamp on the first message in a consecutive agent run
                const prevMsg = i > 0 ? filtered[i - 1] : null;
                const isFirstInRun = !prevMsg || prevMsg.sender !== 'agent' || prevMsg.queued;
                const agentTs = isFirstInRun ? ts : '';

                if (msg.contentType && msg.contentType !== 'text') {
                  return (
                    <div key={i} className="py-1">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <RichContentBlock msg={msg} />
                        </div>
                        {agentTs && <span className="text-[10px] text-gray-600 mt-0.5 shrink-0">{agentTs}</span>}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className="py-0.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 font-mono text-sm text-gray-200 whitespace-pre-wrap min-w-0">
                        <AgentTextBlock text={msg.text} />
                      </div>
                      {agentTs && <span className="text-[10px] text-gray-600 mt-0.5 shrink-0">{agentTs}</span>}
                    </div>
                  </div>
                );
              })}
              {isActive && messages.length > 0 && messages[messages.length - 1]?.sender === 'user' && !messages[messages.length - 1]?.queued && (
                <div className="flex justify-start py-1">
                  <div className="text-gray-400 font-mono text-sm flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                    <span>Working...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
              </div>
              {/* Prompt navigation */}
              <PromptNav containerRef={chatContainerRef} messages={messages} />
            </div>

            {/* Queued messages (pending) */}
            {messages.some((m) => m.queued) && (
              <div className="border-t border-dashed border-gray-600 px-4 py-2 bg-gray-800/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Queued
                </div>
                {messages.filter((m) => m.queued).map((msg, i) => (
                  <div key={`q-${i}`} className="flex justify-end items-center gap-2 py-0.5">
                    <span className="text-[10px] text-gray-600">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                    <div className="max-w-[80%] rounded-lg px-3 py-1.5 bg-blue-600/40 text-blue-200 font-mono text-sm whitespace-pre-wrap border border-blue-500/30">
                      {msg.text}
                    </div>
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-gray-700 p-3">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={isActive ? 'Message the Project Lead... (Shift+Enter for new line)' : 'Project Lead is not active'}
                  disabled={!isActive}
                  rows={1}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
                  }}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500 disabled:opacity-50 resize-none overflow-y-auto"
                  style={{ maxHeight: 150 }}
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!isActive || !input.trim()}
                  className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-black px-3 py-2 rounded shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Right sidebar: decisions + comms + activity + team */}
          {sidebarCollapsed ? (
            <div className="border-l border-gray-700 flex flex-col items-center py-2 w-10 shrink-0">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                title="Expand sidebar"
              >
                <PanelRightOpen className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0" style={{ width: sidebarWidth }}>
              {/* Drag handle */}
              <div
                onMouseDown={startResize}
                className="w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0"
              />
              <div className="flex-1 border-l border-gray-700 flex flex-col overflow-hidden min-w-0">
                <div className="px-2 py-1 border-b border-gray-700 flex items-center justify-end shrink-0">
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                    title="Collapse sidebar"
                  >
                    <PanelRightClose className="w-3.5 h-3.5" />
                  </button>
                </div>
                <CollapsibleSection title="Decisions" icon={<Lightbulb className="w-3.5 h-3.5 text-yellow-400" />} badge={decisions.length} defaultHeight={150}>
                  <DecisionPanelContent decisions={decisions} />
                </CollapsibleSection>
                <CollapsibleSection title="Agent Comms" icon={<MessageSquare className="w-3.5 h-3.5 text-purple-400" />} badge={comms.length} defaultHeight={200}>
                  <CommsPanelContent comms={comms} />
                </CollapsibleSection>
                <CollapsibleSection title="Activity" icon={<Wrench className="w-3.5 h-3.5 text-gray-400" />} badge={activity.length} defaultHeight={180}>
                  <ActivityFeedContent activity={activity} agents={agents} />
                </CollapsibleSection>
                <CollapsibleSection title="Team" icon={<Bot className="w-3.5 h-3.5 text-blue-400" />} badge={teamAgents.length} defaultHeight={180}>
                  <TeamStatusContent agents={teamAgents} delegations={progress?.delegations ?? []} comms={comms} activity={activity} allAgents={agents} />
                </CollapsibleSection>
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
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-gray-100">Progress Detail</span>
              </div>
              <button onClick={() => setShowProgressDetail(false)} className="text-gray-400 hover:text-gray-200">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              {/* Delegation stats */}
              {progress && progress.totalDelegations > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-2">Delegation Overview</p>
                  <div className="flex items-center gap-4 text-sm font-mono mb-2">
                    <span className="text-blue-400">{progress.teamSize} agents</span>
                    <span className="text-yellow-400">{progress.active} active</span>
                    <span className="text-green-400">{progress.completed} done</span>
                    {progress.failed > 0 && <span className="text-red-400">{progress.failed} failed</span>}
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2.5 mb-1">
                    <div
                      className="bg-green-500 h-2.5 rounded-full transition-all"
                      style={{ width: `${progress.completionPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 font-mono text-right">{progress.completionPct}% complete</p>
                </div>
              )}

              {/* Agent team roster */}
              {progress && progress.teamAgents && progress.teamAgents.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-2">Team Roster</p>
                  <div className="space-y-1">
                    {progress.teamAgents.map((ta) => (
                      <div key={ta.id} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-700/50 text-xs font-mono">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${ta.status === 'running' ? 'bg-green-400 animate-pulse' : ta.status === 'idle' ? 'bg-yellow-400' : ta.status === 'failed' ? 'bg-red-400' : 'bg-gray-500'}`} />
                        <span className="text-gray-200">{ta.role?.name || 'Agent'}</span>
                        <span className="text-gray-500">{ta.id.slice(0, 8)}</span>
                        <span className="ml-auto text-gray-400">{ta.status}</span>
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
                    <p className="text-xs font-semibold text-gray-400 mb-2">Latest Lead Report</p>
                    <p className="text-sm font-mono text-gray-200 mb-3">{latest.summary}</p>
                    {latest.completed.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs text-green-400 font-semibold mb-1">✓ Completed</p>
                        <ul className="space-y-0.5">
                          {latest.completed.map((item, i) => (
                            <li key={i} className="text-xs font-mono text-gray-300 pl-4 flex items-center gap-1.5">
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
                            <li key={i} className="text-xs font-mono text-gray-300 pl-4 flex items-center gap-1.5">
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
                            <li key={i} className="text-xs font-mono text-gray-300 pl-4 flex items-center gap-1.5">
                              <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-600 font-mono mt-2">
                      {new Date(latest.timestamp).toLocaleString()}
                    </p>
                  </div>
                );
              })()}

              {/* Progress history timeline */}
              {progressHistory.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-2">Progress Timeline</p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {[...progressHistory].reverse().slice(1).map((snap, i) => (
                      <div key={i} className="flex items-start gap-2 border-l-2 border-gray-600 pl-3 py-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono text-gray-300">{snap.summary}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] font-mono text-gray-500">
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
                  <p className="text-xs font-semibold text-gray-400 mb-2">Delegations</p>
                  <div className="space-y-1">
                    {progress.delegations.map((d: any, i: number) => (
                      <div key={d.id || i} className="px-2 py-1.5 rounded bg-gray-700/50 text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${d.status === 'active' ? 'bg-blue-500/20 text-blue-400' : d.status === 'completed' ? 'bg-green-500/20 text-green-400' : d.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>
                            {d.status}
                          </span>
                          <span className="text-gray-300">{d.toRole}</span>
                          <span className="text-gray-500 ml-auto">{d.childId?.slice(0, 8)}</span>
                        </div>
                        {d.task && (
                          <p className="text-gray-400 mt-1 break-words">{d.task.length > 120 ? d.task.slice(0, 120) + '…' : d.task}</p>
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
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-indigo-400">{expandedReport.fromRole}</span>
                <span className="text-xs text-gray-500">→ Project Lead</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">
                  {new Date(expandedReport.timestamp).toLocaleTimeString()}
                </span>
                <button onClick={() => setExpandedReport(null)} className="text-gray-400 hover:text-gray-200">
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

  // Clean output: strip <!-- ... --> fragments and normalize whitespace
  let output = outputMatch ? outputMatch[1].trim() : '';
  output = output.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/g, '').replace(/^[\s\S]*?-->/g, '').trim();
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
    return <span className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-words">{content}</span>;
  }

  // ACK messages: compact inline rendering
  if (parsed.isAck) {
    return (
      <div className="text-xs font-mono flex items-center gap-1.5">
        <Check className="w-3 h-3 text-blue-400 shrink-0" />
        <span className="text-blue-300">{parsed.header}</span>
        {parsed.task && <span className="text-gray-500"> — {compact && parsed.task.length > 60 ? parsed.task.slice(0, 60) + '…' : parsed.task}</span>}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="text-xs font-mono">
        <span className="text-gray-200">{parsed.header}</span>
        {parsed.task && <span className="text-gray-500"> — {parsed.task.length > 80 ? parsed.task.slice(0, 80) + '…' : parsed.task}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm font-mono">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-gray-200 font-semibold">{parsed.header}</span>
      </div>
      {parsed.task && (
        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Task</span>
          <p className="text-gray-300 whitespace-pre-wrap break-words mt-0.5">{parsed.task}</p>
        </div>
      )}
      {parsed.output && (
        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Output</span>
          <pre className="text-gray-300 whitespace-pre-wrap break-words mt-0.5 bg-gray-900/50 rounded p-2 text-xs max-h-60 overflow-y-auto">{parsed.output}</pre>
        </div>
      )}
      {parsed.sessionId && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-500 uppercase tracking-wider">Session</span>
          <code className="text-gray-400 bg-gray-900/50 px-1.5 py-0.5 rounded">{parsed.sessionId}</code>
          <button
            onClick={() => navigator.clipboard.writeText(parsed.sessionId)}
            className="text-gray-500 hover:text-yellow-400"
          >
            copy
          </button>
        </div>
      )}
    </div>
  );
}

function DecisionPanelContent({ decisions }: { decisions: any[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedDecision, setSelectedDecision] = useState<any | null>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [decisions.length]);

  return (
    <>
      <div ref={feedRef} className="h-full overflow-y-auto p-2 space-y-2">
        {decisions.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4 font-mono">No decisions yet</p>
        ) : (
          decisions.map((d: any, i: number) => (
            <div
              key={d.id || `dec-${i}`}
              className="bg-gray-800 border border-gray-700 rounded p-2 cursor-pointer hover:bg-gray-700/50 transition-colors"
              onClick={() => setSelectedDecision(d)}
            >
              <div className="flex items-start gap-2">
                <Lightbulb className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono font-semibold text-gray-200 truncate">{d.title}</p>
                    {d.agentRole && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 shrink-0">{d.agentRole}</span>
                    )}
                  </div>
                  {d.rationale && <p className="text-xs font-mono text-gray-400 mt-1 line-clamp-2">{d.rationale}</p>}
                  <p className="text-xs text-gray-600 mt-1">{new Date(d.timestamp).toLocaleTimeString()}</p>
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
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold text-gray-100">Decision</span>
                {selectedDecision.agentRole && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">by {selectedDecision.agentRole}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">
                  {new Date(selectedDecision.timestamp).toLocaleString()}
                </span>
                <button onClick={() => setSelectedDecision(null)} className="text-gray-400 hover:text-gray-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto">
              <h3 className="text-base font-mono font-semibold text-gray-100 mb-3">{selectedDecision.title}</h3>
              {selectedDecision.rationale && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-400 mb-1">Rationale</p>
                  <p className="text-sm font-mono text-gray-300 whitespace-pre-wrap">{selectedDecision.rationale}</p>
                </div>
              )}
              {selectedDecision.alternatives && selectedDecision.alternatives.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-gray-400 mb-1">Alternatives considered</p>
                  <ul className="list-disc list-inside text-sm font-mono text-gray-400 space-y-1">
                    {selectedDecision.alternatives.map((alt: string, i: number) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selectedDecision.impact && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-1">Impact</p>
                  <p className="text-sm font-mono text-gray-300 whitespace-pre-wrap">{selectedDecision.impact}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TeamStatusContent({ agents, delegations, comms, activity, allAgents }: { agents: any[]; delegations: any[]; comms?: AgentComm[]; activity?: ActivityEvent[]; allAgents?: any[] }) {
  const STATUS_COLOR: Record<string, string> = {
    creating: 'text-gray-400', running: 'text-blue-400', idle: 'text-yellow-400',
    completed: 'text-green-400', failed: 'text-red-400',
  };
  const [selectedAgent, setSelectedAgent] = useState<any | null>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);

  const selectedDelegation = selectedAgent ? delegations.find((d: any) => d.toAgentId === selectedAgent.id) : null;
  const agentComms = selectedAgent ? (comms ?? []).filter((c) => c.fromId === selectedAgent.id || c.toId === selectedAgent.id) : [];
  const agentActivity = selectedAgent ? (activity ?? []).filter((e) => e.agentId === selectedAgent.id) : [];

  return (
    <>
      <div className="h-full overflow-y-auto p-2 space-y-2">
        {agents.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4 font-mono">No team members yet</p>
        ) : (
          agents.map((agent: any) => {
            const delegation = delegations.find((d: any) => d.toAgentId === agent.id);
            const colorClass = STATUS_COLOR[agent.status] || 'text-gray-400';
            return (
              <div
                key={agent.id}
                className="bg-gray-800 border border-gray-700 rounded p-2 cursor-pointer hover:border-gray-500 transition-colors"
                onClick={() => setSelectedAgent(agent)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{agent.role.icon}</span>
                  <span className="text-sm font-mono font-semibold text-gray-200 truncate">{agent.role.name}</span>
                  <span className={`text-xs font-mono ${colorClass} ml-auto`}>{agent.status}</span>
                </div>
                {delegation && (
                  <p className="text-xs font-mono text-gray-400 mt-1 truncate" title={delegation.task}>{delegation.task}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  {(agent.model || agent.role.model) && (
                    <span className="text-[10px] font-mono text-gray-500 bg-gray-700/50 px-1 rounded">{agent.model || agent.role.model}</span>
                  )}
                  <span className="text-xs font-mono text-gray-400 ml-auto">{agent.id.slice(0, 8)}</span>
                </div>
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
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-700">
              <span className="text-2xl">{selectedAgent.role.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-gray-100">{selectedAgent.role.name}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${STATUS_COLOR[selectedAgent.status] || 'text-gray-400'} bg-gray-700`}>
                    {selectedAgent.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 font-mono">
                  <span>{selectedAgent.id.slice(0, 8)}</span>
                  {(selectedAgent.model || selectedAgent.role.model) && (
                    <span className="bg-gray-700/50 px-1.5 rounded">{selectedAgent.model || selectedAgent.role.model}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="text-gray-400 hover:text-white text-lg leading-none p-1"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Assigned Task */}
              {selectedDelegation && (
                <div className="px-5 py-3 border-b border-gray-700">
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Assigned Task</h4>
                  <p className="text-sm font-mono text-gray-200 whitespace-pre-wrap">{selectedDelegation.task}</p>
                  {selectedDelegation.status && (
                    <span className={`inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      selectedDelegation.status === 'completed' ? 'text-green-400 bg-green-900/30' :
                      selectedDelegation.status === 'active' ? 'text-blue-400 bg-blue-900/30' :
                      'text-red-400 bg-red-900/30'
                    }`}>{selectedDelegation.status}</span>
                  )}
                </div>
              )}

              {/* Agent Output Preview */}
              {selectedAgent.outputPreview && (
                <div className="px-5 py-3 border-b border-gray-700">
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Latest Output</h4>
                  <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-900/50 rounded p-2">
                    {selectedAgent.outputPreview}
                  </pre>
                </div>
              )}

              {/* Communications */}
              {agentComms.length > 0 && (
                <div className="px-5 py-3 border-b border-gray-700">
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                    Communications ({agentComms.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {agentComms.slice(-20).map((c) => {
                      const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      const isSender = c.fromId === selectedAgent.id;
                      return (
                        <div
                          key={c.id}
                          className="text-xs font-mono cursor-pointer hover:bg-gray-700/40 rounded px-1 py-0.5 transition-colors"
                          onClick={() => setSelectedComm(c)}
                        >
                          <div className="flex items-center gap-1">
                            <span className={isSender ? 'text-cyan-400' : 'text-green-400'}>{isSender ? c.fromRole : c.toRole}</span>
                            <span className="text-gray-600">{isSender ? '→' : '←'}</span>
                            <span className={isSender ? 'text-green-400' : 'text-cyan-400'}>{isSender ? c.toRole : c.fromRole}</span>
                            <span className="text-gray-600 ml-auto">{time}</span>
                          </div>
                          <p className="text-gray-300 mt-0.5 break-words whitespace-pre-wrap">
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
                  <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-2">
                    Activity ({agentActivity.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {agentActivity.slice(-15).map((evt) => {
                      const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={evt.id} className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-gray-500">{time}</span>
                          <span className="text-gray-300 truncate">{evt.summary}</span>
                          {evt.status && (
                            <span className={`ml-auto shrink-0 text-[10px] ${
                              evt.status === 'completed' ? 'text-green-400' :
                              evt.status === 'in_progress' ? 'text-blue-400' : 'text-gray-500'
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
                <div className="px-5 py-8 text-center text-gray-500 text-xs font-mono">
                  No activity yet for this agent
                </div>
              )}
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
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">
                  {new Date(selectedComm.timestamp).toLocaleTimeString()}
                </span>
                <button onClick={() => setSelectedComm(null)} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <pre className="text-sm font-mono text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
                    {selectedComm.content}
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

function CommsPanelContent({ comms }: { comms: AgentComm[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [comms.length]);

  const recent = comms.slice(-50);

  return (
    <>
      <div ref={feedRef} className="h-full overflow-y-auto">
        {recent.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-4 font-mono">No messages yet</p>
        ) : (
          recent.map((c) => {
            const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return (
              <div
                key={c.id}
                className="px-3 py-1.5 border-b border-gray-700/30 cursor-pointer hover:bg-gray-700/30 transition-colors"
                onClick={() => setSelectedComm(c)}
              >
                <div className="flex items-center gap-1 text-xs">
                  <span className="font-mono font-semibold text-cyan-400">{c.fromRole}</span>
                  <span className="text-gray-500">→</span>
                  <span className="font-mono font-semibold text-green-400">{c.toRole}</span>
                  <span className="text-xs font-mono text-gray-600 ml-auto shrink-0">{time}</span>
                </div>
                <div className="text-xs font-mono text-gray-300 mt-0.5">
                  {c.content.startsWith('[Agent Report]') || c.content.startsWith('[Agent ACK]')
                    ? <AgentReportBlock content={c.content} compact />
                    : <p className="truncate">{c.content.length > 120 ? c.content.slice(0, 120) + '…' : c.content}</p>
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
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500">
                  {new Date(selectedComm.timestamp).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => setSelectedComm(null)}
                  className="text-gray-400 hover:text-white text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <pre className="text-sm font-mono text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
                    {selectedComm.content}
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

function ActivityFeedContent({ activity, agents }: { activity: ActivityEvent[]; agents: any[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [activity.length]);

  const recent = activity.slice(-30);

  const getIcon = (type: string, status?: string) => {
    if (type === 'delegation') return <GitBranch className="w-3 h-3 text-yellow-400 shrink-0" />;
    if (type === 'completion') return <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />;
    if (type === 'message_sent') return <MessageSquare className="w-3 h-3 text-blue-400 shrink-0" />;
    if (type === 'progress') return <BarChart3 className="w-3 h-3 text-purple-400 shrink-0" />;
    if (status === 'in_progress') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
    if (status === 'completed') return <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />;
    return <Wrench className="w-3 h-3 text-gray-400 shrink-0" />;
  };

  return (
    <div ref={feedRef} className="h-full overflow-y-auto">
      {recent.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4 font-mono">No activity yet</p>
      ) : (
        recent.map((evt) => {
          const agent = agents.find((a: any) => a.id === evt.agentId);
          const label = agent?.role?.name ?? evt.agentRole;
          const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return (
            <div key={evt.id} className="px-3 py-1.5 border-b border-gray-700/30 flex items-start gap-2">
              {getIcon(evt.type, evt.status)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-gray-400">{label}</span>
                  <span className="text-[10px] font-mono text-gray-500">{evt.agentId?.slice(0, 8)}</span>
                  <span className="text-xs font-mono text-gray-600 ml-auto shrink-0">{time}</span>
                </div>
                <span className="text-xs font-mono text-gray-300 break-words">{typeof evt.summary === 'string' ? evt.summary : JSON.stringify(evt.summary)}</span>
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
    <div className="border-t border-gray-700 flex flex-col shrink-0" style={collapsed ? undefined : { height }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="px-3 py-1.5 flex items-center gap-2 shrink-0 hover:bg-gray-800/50 transition-colors w-full text-left"
      >
        {collapsed ? <ChevronRight className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
        {icon}
        <span className="text-xs font-semibold">{title}</span>
        {badge !== undefined && <span className="text-[10px] text-gray-500 ml-auto">{badge}</span>}
      </button>
      {!collapsed && (
        <>
          <div className="flex-1 min-h-0">{children}</div>
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
    <div className="border-b border-gray-700 px-4 py-1.5 flex items-center gap-2 text-xs font-mono bg-gray-800/30">
      <FolderOpen className="w-3 h-3 text-gray-500 shrink-0" />
      {editing ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/path/to/project"
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
            autoFocus
          />
          <button onClick={save} className="text-green-400 hover:text-green-300 p-0.5"><Check className="w-3 h-3" /></button>
          <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-200 p-0.5"><X className="w-3 h-3" /></button>
        </>
      ) : (
        <>
          <span className="text-gray-400 truncate flex-1" title={cwd}>{cwd || '(server default)'}</span>
          <button
            onClick={() => setEditing(true)}
            className="text-gray-500 hover:text-yellow-400 text-[10px] shrink-0"
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
        className="p-1 rounded bg-gray-800/80 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        title="Previous prompt"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] font-mono text-gray-500 select-none leading-none py-0.5">
        {currentIdx >= 0 ? currentIdx + 1 : '·'}/{total}
      </span>
      <button
        onClick={goDown}
        className="p-1 rounded bg-gray-800/80 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
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
            <code key={i} className="bg-gray-700 px-1 rounded text-yellow-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Renders agent text, separating <!-- command --> blocks from normal markdown */
function RichContentBlock({ msg }: { msg: AcpTextChunk }) {
  if (msg.contentType === 'image' && msg.data) {
    return (
      <div className="py-1">
        <img
          src={`data:${msg.mimeType || 'image/png'};base64,${msg.data}`}
          alt="Agent image"
          className="max-w-full max-h-96 rounded-lg border border-gray-700"
        />
        {msg.uri && <p className="text-[10px] text-gray-500 mt-1 font-mono">{msg.uri}</p>}
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
          <pre className="text-xs font-mono text-gray-300 bg-gray-800 border border-gray-700 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {msg.text}
          </pre>
        )}
      </div>
    );
  }
  return null;
}

function AgentTextBlock({ text }: { text: string }) {
  // Split on <!-- ... --> blocks (complete) and also detect unclosed <!-- blocks
  const segments = text.split(/(<!--[\s\S]*?-->)/g);
  return (
    <>
      {segments.map((seg, i) => {
        // Complete <!-- --> block
        if (seg.startsWith('<!--') && seg.endsWith('-->')) {
          return (
            <pre key={i} className="my-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-500 whitespace-pre-wrap break-words">
              {seg}
            </pre>
          );
        }
        // Unclosed <!-- block (still streaming or split across messages)
        if (seg.includes('<!--') && !seg.includes('-->')) {
          const idx = seg.indexOf('<!--');
          const before = seg.slice(0, idx);
          const cmdBlock = seg.slice(idx);
          return (
            <span key={i}>
              {before.trim() ? <MarkdownWithTables text={before} /> : null}
              <pre className="my-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-500 whitespace-pre-wrap break-words">
                {cmdBlock}
              </pre>
            </span>
          );
        }
        // Dangling --> from a block that started in a previous message
        if (seg.includes('-->') && !seg.includes('<!--')) {
          const idx = seg.indexOf('-->') + 3;
          const cmdBlock = seg.slice(0, idx);
          const after = seg.slice(idx);
          return (
            <span key={i}>
              <pre className="my-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-[11px] text-gray-500 whitespace-pre-wrap break-words">
                {cmdBlock}
              </pre>
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
      <table className="text-xs font-mono border-collapse border border-gray-700 w-full">
        <thead>
          <tr className="bg-gray-800">
            {headerCells.map((cell, j) => (
              <th key={j} className="border border-gray-700 px-2 py-1 text-left text-gray-300 font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-gray-900/30' : 'bg-gray-800/30'}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-gray-700 px-2 py-1 text-gray-300">
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
