import { useState, useEffect, useRef, useCallback } from 'react';
import { Crown, Send, Users, CheckCircle, AlertCircle, Clock, Loader2, Plus, Trash2, Wrench, MessageSquare, GitBranch, PanelRightClose, PanelRightOpen, ChevronDown, ChevronRight, Lightbulb, Bot } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import type { ActivityEvent, AgentComm } from '../../stores/leadStore';
import { useAppStore } from '../../stores/appStore';

interface Props {
  api: any;
  ws: any;
}

export function LeadDashboard({ api, ws }: Props) {
  const { projects, selectedLeadId } = useLeadStore();
  const agents = useAppStore((s) => s.agents);
  const [input, setInput] = useState('');
  const [starting, setStarting] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectTask, setNewProjectTask] = useState('');
  const [newProjectModel, setNewProjectModel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
    ws.subscribe(selectedLeadId);
    return () => ws.unsubscribe(selectedLeadId);
  }, [selectedLeadId, ws]);

  // Auto-scroll on new messages only if near bottom
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
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
        store.addDecision(msg.agentId, msg);
      }

      // Stream PL text into chat
      if (msg.type === 'agent:text' && msg.agentId === selectedLeadId) {
        store.appendToLastAgentMessage(msg.agentId, msg.text);
      }

      // When lead goes back to running after idle, start a new message bubble
      if (msg.type === 'agent:status' && msg.agentId === selectedLeadId && msg.status === 'running') {
        const proj = store.projects[msg.agentId];
        const lastMsg = proj?.messages?.[proj.messages.length - 1];
        if (lastMsg?.sender === 'agent') {
          store.addMessage(msg.agentId, { type: 'text', text: '---', sender: 'system' as any });
        }
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
            summary: toolCall.title || toolCall.kind || 'Working...',
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
            content: msg.content?.slice(0, 300) ?? '',
            timestamp: Date.now(),
          });
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

  const startLead = useCallback(async (name: string, task?: string, model?: string) => {
    setStarting(true);
    try {
      const resp = await fetch('/api/lead/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, task, model: model || undefined }),
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
    useLeadStore.getState().addMessage(selectedLeadId, { type: 'text', text, sender: 'user' });
    await fetch(`/api/lead/${selectedLeadId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }, [input, selectedLeadId]);

  const messages = currentProject?.messages ?? [];
  const decisions = currentProject?.decisions ?? [];
  const progress = currentProject?.progress ?? null;
  const activity = currentProject?.activity ?? [];
  const comms = currentProject?.comms ?? [];
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

        {/* New project form */}
        {showNewProject && (
          <div className="border-t border-gray-700 p-3 space-y-2 bg-gray-800/50">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
              autoFocus
            />
            <textarea
              value={newProjectTask}
              onChange={(e) => setNewProjectTask(e.target.value)}
              placeholder="Initial task (optional)"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm font-mono text-gray-200 resize-none h-16 focus:outline-none focus:border-yellow-500"
            />
            <select
              value={newProjectModel}
              onChange={(e) => setNewProjectModel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500"
            >
              <option value="">Model (default)</option>
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
            <div className="flex gap-2">
              <button
                onClick={() => startLead(newProjectName || 'Untitled', newProjectTask.trim() || undefined, newProjectModel || undefined)}
                disabled={starting}
                className="flex-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-black text-sm font-semibold py-1.5 rounded flex items-center justify-center gap-1"
              >
                {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crown className="w-3 h-3" />}
                {starting ? '...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNewProject(false); setNewProjectName(''); setNewProjectTask(''); setNewProjectModel(''); }}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

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
            {/* Progress banner */}
            {progress && progress.totalDelegations > 0 && (
              <div className="border-b border-gray-700 px-4 py-2 flex items-center gap-4 text-sm font-mono bg-gray-800/50">
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

            {/* Messages */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.filter((msg) => msg.sender !== 'system' && msg.text).map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 font-mono text-sm whitespace-pre-wrap ${
                      msg.sender === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-200 border border-gray-700'
                    }`}
                  >
                    {msg.sender === 'agent' && (
                      <div className="flex items-center gap-1.5 mb-1 text-yellow-400 text-xs">
                        <Crown className="w-3 h-3" />
                        Project Lead
                      </div>
                    )}
                    <InlineMarkdown text={msg.text} />
                  </div>
                </div>
              ))}
              {isActive && messages.length > 0 && messages[messages.length - 1]?.sender === 'user' && (
                <div className="flex justify-start">
                  <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-400 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                    <span>Working...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

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
                  <TeamStatusContent agents={teamAgents} delegations={progress?.delegations ?? []} />
                </CollapsibleSection>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DecisionPanelContent({ decisions }: { decisions: any[] }) {
  return (
    <div className="p-2 space-y-2">
      {decisions.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4 font-mono">No decisions yet</p>
      ) : (
        decisions.map((d: any, i: number) => (
          <div key={d.id || `dec-${i}`} className="bg-gray-800 border border-gray-700 rounded p-2">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-mono font-semibold text-gray-200">{d.title}</p>
                {d.rationale && <p className="text-xs font-mono text-gray-400 mt-1">{d.rationale}</p>}
                <p className="text-xs text-gray-600 mt-1">{new Date(d.timestamp).toLocaleTimeString()}</p>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TeamStatusContent({ agents, delegations }: { agents: any[]; delegations: any[] }) {
  const STATUS_COLOR: Record<string, string> = {
    creating: 'text-gray-400', running: 'text-blue-400', idle: 'text-yellow-400',
    completed: 'text-green-400', failed: 'text-red-400',
  };

  return (
    <div className="p-2 space-y-2">
      {agents.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4 font-mono">No team members yet</p>
      ) : (
        agents.map((agent: any) => {
          const delegation = delegations.find((d: any) => d.toAgentId === agent.id);
          const colorClass = STATUS_COLOR[agent.status] || 'text-gray-400';
          return (
            <div key={agent.id} className="bg-gray-800 border border-gray-700 rounded p-2">
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
                <span className="text-xs text-gray-600 ml-auto">{agent.id.slice(0, 8)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function CommsPanelContent({ comms }: { comms: AgentComm[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [comms.length]);

  const recent = comms.slice(-50);

  return (
    <div ref={feedRef}>
      {recent.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4 font-mono">No messages yet</p>
      ) : (
        recent.map((c) => {
          const time = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return (
            <div key={c.id} className="px-3 py-1.5 border-b border-gray-700/30">
              <div className="flex items-center gap-1 text-xs">
                <span className="font-mono font-semibold text-cyan-400">{c.fromRole}</span>
                <span className="text-gray-500">→</span>
                <span className="font-mono font-semibold text-green-400">{c.toRole}</span>
                <span className="text-xs font-mono text-gray-600 ml-auto shrink-0">{time}</span>
              </div>
              <p className="text-xs font-mono text-gray-300 mt-0.5 break-words whitespace-pre-wrap">
                {c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content}
              </p>
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
    const el = feedRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [activity.length]);

  const recent = activity.slice(-30);

  const getIcon = (type: string, status?: string) => {
    if (type === 'delegation') return <GitBranch className="w-3 h-3 text-yellow-400 shrink-0" />;
    if (type === 'completion') return <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />;
    if (type === 'message_sent') return <MessageSquare className="w-3 h-3 text-blue-400 shrink-0" />;
    if (status === 'in_progress') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
    if (status === 'completed') return <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />;
    return <Wrench className="w-3 h-3 text-gray-400 shrink-0" />;
  };

  return (
    <div ref={feedRef}>
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
                  <span className="text-xs font-mono text-gray-600 ml-auto shrink-0">{time}</span>
                </div>
                <span className="text-xs font-mono text-gray-300 break-words">{evt.summary}</span>
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
          <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
          <div
            onMouseDown={startResize}
            className="h-1 cursor-row-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors shrink-0"
          />
        </>
      )}
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
