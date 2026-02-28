import { Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useApi } from './hooks/useApi';
import { useAppStore } from './stores/appStore';
import { useSettingsStore } from './stores/settingsStore';
import { AgentDashboard } from './components/AgentDashboard/AgentDashboard';

import { TaskQueuePanel } from './components/TaskQueue/TaskQueuePanel';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { LeadDashboard } from './components/LeadDashboard';
import { OrgChart } from './components/OrgChart/OrgChart';
import { OverviewPage } from './components/OverviewPage/OverviewPage';
import { GroupChat } from './components/GroupChat/GroupChat';
import { SearchDialog } from './components/SearchDialog/SearchDialog';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToastStore } from './components/Toast';
import { PermissionDialog } from './components/PermissionDialog';
import { useEffect, useRef, useState, useCallback } from 'react';
import { playAttentionSound, playCompletionSound } from './utils/notificationSound';
import { Search } from 'lucide-react';

export function App() {
  const ws = useWebSocket();
  const api = useApi();
  const { connected, agents, selectedAgentId } = useAppStore();
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const addToast = useToastStore((s) => s.add);
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);

  // Cmd/Ctrl+K to open search
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
              <button
                onClick={openSearch}
                className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors text-xs"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search</span>
                <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1 py-0.5 ml-1">⌘K</kbd>
              </button>
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
            <Route path="/overview" element={<OverviewPage api={api} ws={ws} />} />
            <Route path="/groups" element={<GroupChat api={api} ws={ws} />} />
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
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
