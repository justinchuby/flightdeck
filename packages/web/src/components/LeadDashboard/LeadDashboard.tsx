import { useState, useEffect, useRef, useCallback } from 'react';
import { Crown, Send, Users, CheckCircle, AlertCircle, Clock, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLeadStore } from '../../stores/leadStore';
import { useAppStore } from '../../stores/appStore';
import { DecisionPanel } from './DecisionPanel';
import { TeamStatus } from './TeamStatus';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const leadAgents = agents.filter((a) => a.role.id === 'lead');
  const currentProject = selectedLeadId ? projects[selectedLeadId] : null;
  const leadAgent = agents.find((a) => a.id === selectedLeadId);
  const isActive = leadAgent && leadAgent.status === 'running';

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

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      if (msg.type === 'lead:decision' && msg.agentId) {
        useLeadStore.getState().addDecision(msg.agentId, msg);
      }
      if (msg.type === 'agent:text' && msg.agentId === selectedLeadId) {
        useLeadStore.getState().appendToLastAgentMessage(msg.agentId, msg.text);
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [selectedLeadId]);

  const startLead = useCallback(async (name: string, task?: string) => {
    setStarting(true);
    try {
      const resp = await fetch('/api/lead/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, task }),
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
            <div className="flex gap-2">
              <button
                onClick={() => startLead(newProjectName || 'Untitled', newProjectTask.trim() || undefined)}
                disabled={starting}
                className="flex-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-black text-sm font-semibold py-1.5 rounded flex items-center justify-center gap-1"
              >
                {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crown className="w-3 h-3" />}
                {starting ? '...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNewProject(false); setNewProjectName(''); setNewProjectTask(''); }}
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
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((msg, i) => (
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
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-700 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isActive ? 'Message the Project Lead...' : 'Project Lead is not active'}
                  disabled={!isActive}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm font-mono text-gray-200 focus:outline-none focus:border-yellow-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!isActive || !input.trim()}
                  className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 text-black px-3 py-2 rounded"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Right sidebar: decisions + team */}
          <div className="w-80 border-l border-gray-700 flex flex-col overflow-hidden">
            <DecisionPanel decisions={decisions} />
            <TeamStatus agents={teamAgents} delegations={progress?.delegations ?? []} />
          </div>
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
