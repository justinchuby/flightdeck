import { Routes, Route } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useApi } from './hooks/useApi';
import { useAppStore } from './stores/appStore';
import { AgentDashboard } from './components/AgentDashboard/AgentDashboard';
import { FleetOverview } from './components/FleetOverview';
import { TaskQueuePanel } from './components/TaskQueue/TaskQueuePanel';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToastStore } from './components/Toast';
import { PermissionDialog } from './components/PermissionDialog';
import { useEffect } from 'react';

export function App() {
  const ws = useWebSocket();
  const api = useApi();
  const { connected, agents, selectedAgentId } = useAppStore();
  const addToast = useToastStore((s) => s.add);

  // Show notifications for agent lifecycle events
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      if (msg.type === 'agent:spawned') {
        addToast('info', `${msg.agent.role.icon} ${msg.agent.role.name} agent spawned`);
      } else if (msg.type === 'agent:exit') {
        addToast(msg.code === 0 ? 'success' : 'error', `Agent ${msg.agentId.slice(0, 8)} ${msg.code === 0 ? 'completed' : 'failed'}`);
      } else if (msg.type === 'agent:sub_spawned') {
        addToast('info', `${msg.child.role.icon} Sub-agent spawned by ${msg.parentId.slice(0, 8)}`);
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [addToast]);

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
            <Route
              path="/"
              element={<AgentDashboard api={api} ws={ws} />}
            />
            <Route path="/overview" element={<FleetOverview api={api} ws={ws} />} />
            <Route path="/tasks" element={<TaskQueuePanel api={api} />} />
            <Route path="/settings" element={<SettingsPanel api={api} />} />
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
