import { Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useApi } from './hooks/useApi';
import { useAppStore } from './stores/appStore';
import { useSettingsStore } from './stores/settingsStore';
import { AgentDashboard } from './components/AgentDashboard/AgentDashboard';
import { FleetOverview } from './components/FleetOverview';
import { TaskQueuePanel } from './components/TaskQueue/TaskQueuePanel';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { LeadDashboard } from './components/LeadDashboard';
import { OrgChart } from './components/OrgChart/OrgChart';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToastStore } from './components/Toast';
import { PermissionDialog } from './components/PermissionDialog';
import { useEffect, useRef } from 'react';
import { playAttentionSound, playCompletionSound } from './utils/notificationSound';

export function App() {
  const ws = useWebSocket();
  const api = useApi();
  const { connected, agents, selectedAgentId } = useAppStore();
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const addToast = useToastStore((s) => s.add);
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map());

  // Show notifications for agent lifecycle events, sound notifications, and context compaction
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      if (msg.type === 'agent:spawned') {
        addToast('info', `${msg.agent.role.icon} ${msg.agent.role.name} agent spawned`);
      } else if (msg.type === 'agent:exit') {
        addToast(msg.code === 0 ? 'success' : 'error', `Agent ${msg.agentId.slice(0, 8)} ${msg.code === 0 ? 'completed' : 'failed'}`);
      } else if (msg.type === 'agent:sub_spawned') {
        addToast('info', `${msg.child.role.icon} Sub-agent spawned by ${msg.parentId.slice(0, 8)}`);
      } else if (msg.type === 'agent:permission_request' && soundEnabled) {
        playAttentionSound();
      } else if (msg.type === 'agent:context_compacted') {
        const pct = msg.percentDrop ? ` (${msg.percentDrop}% reduction)` : '';
        addToast('info', `🔄 Context compacted for agent ${msg.agentId.slice(0, 8)}${pct}`);
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [addToast, soundEnabled]);

  // Detect all-agents-idle and play completion sound
  useEffect(() => {
    const prev = prevAgentStatesRef.current;
    const hadRunning = Array.from(prev.values()).some((s) => s === 'running');
    const allIdle = agents.length > 0 && agents.every((a) => a.status !== 'running' && a.status !== 'creating');

    // Update tracked states
    const next = new Map<string, string>();
    agents.forEach((a) => next.set(a.id, a.status));
    prevAgentStatesRef.current = next;

    if (hadRunning && allIdle && soundEnabled) {
      playCompletionSound();
    }
  }, [agents, soundEnabled]);

  return (
    <div className="flex h-screen bg-surface text-gray-200">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="h-12 border-b border-gray-700 flex items-center px-4 justify-between shrink-0">
            <h1 className="text-lg font-semibold">AI Crew</h1>
            <div className="flex items-center gap-3">
              <span
                className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
              />
              <span className="text-sm text-gray-400">
                {connected ? 'Connected' : 'Reconnecting...'}
              </span>
              <span className="text-sm text-gray-500">{agents.length} agents</span>
            </div>
          </header>

          <Routes>
            <Route path="/" element={<LeadDashboard api={api} ws={ws} />} />
            <Route path="/lead" element={<Navigate to="/" replace />} />
            <Route path="/agents" element={<AgentDashboard api={api} ws={ws} />} />
            <Route path="/overview" element={<FleetOverview api={api} ws={ws} />} />
            <Route path="/org" element={<OrgChart api={api} ws={ws} />} />
            <Route path="/tasks" element={<TaskQueuePanel api={api} />} />
            <Route path="/settings" element={<SettingsPanel api={api} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {selectedAgentId && (
          <div className="w-[500px] border-l border-gray-700 flex flex-col">
            <ChatPanel agentId={selectedAgentId} ws={ws} api={api} />
          </div>
        )}
      </div>
      <ToastContainer />
      <PermissionDialog />
    </div>
  );
}
