import { Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import { useApi } from './hooks/useApi';
import { useAppStore } from './stores/appStore';
import { useSettingsStore } from './stores/settingsStore';
import { useCommandPalette } from './hooks/useCommandPalette';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { AgentDashboard } from './components/AgentDashboard/AgentDashboard';

import { TaskQueuePanel } from './components/TaskQueue/TaskQueuePanel';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { DataBrowser } from './components/DataBrowser/DataBrowser';
import { LeadDashboard } from './components/LeadDashboard';
import { OrgChart } from './components/OrgChart/OrgChart';
import { OverviewPage } from './components/OverviewPage/OverviewPage';
import { GroupChat } from './components/GroupChat/GroupChat';
import { TimelinePage } from './components/Timeline';
import { MissionControlPage } from './components/MissionControl';
import { SearchDialog } from './components/SearchDialog/SearchDialog';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToastStore } from './components/Toast';
import { PermissionDialog } from './components/PermissionDialog';
import { useEffect, useRef, useState, useCallback } from 'react';
import { playAttentionSound, playCompletionSound } from './utils/notificationSound';
import { Search, Pause, Play } from 'lucide-react';
import { OnboardingWizard, useOnboarding } from './components/Onboarding/OnboardingWizard';
import { useLeadStore } from './stores/leadStore';
import type { AcpTextChunk, Project } from './types';
import { apiFetch } from './hooks/useApi';

export function App() {
  const ws = useWebSocket();
  const api = useApi();
  const { connected, agents, selectedAgentId, systemPaused } = useAppStore();
  const setSystemPaused = useAppStore((s) => s.setSystemPaused);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const addToast = useToastStore((s) => s.add);
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map());

  // Full-text search dialog (separate from command palette)
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Command palette — Cmd/Ctrl+K is handled by the hook
  const { isOpen: cmdOpen, open: openCmd, close: closeCmd } = useCommandPalette();

  const togglePause = useCallback(async () => {
    try {
      const endpoint = systemPaused ? '/system/resume' : '/system/pause';
      await apiFetch(endpoint, { method: 'POST' });
    } catch (err: any) {
      addToast('error', `Failed to ${systemPaused ? 'resume' : 'pause'}: ${err.message}`);
    }
  }, [systemPaused, addToast]);

  // Onboarding wizard — show on first visit
  const { shouldShow } = useOnboarding();
  const [showOnboarding, setShowOnboarding] = useState(shouldShow);

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
      } else if (msg.type === 'activity') {
        const e = msg.entry;
        if (e?.action === 'heartbeat_halted') {
          addToast('info', `⏸️ Heartbeat halted by ${e.agentId?.slice(0, 8) ?? 'agent'}`);
        } else if (e?.action === 'limit_change_requested') {
          addToast('info', `⚙️ Agent limit change requested: ${e.details ?? ''}`);
        }
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

  // On app startup: load active leads + persisted projects into leadStore
  useEffect(() => {
    // Load active leads and their message history
    fetch('/api/lead').then((r) => r.json()).then((leads: any[]) => {
      if (!Array.isArray(leads)) return;
      const store = useLeadStore.getState();
      leads.forEach((l) => {
        store.addProject(l.id);
        // Pre-load message history
        fetch(`/api/agents/${l.id}/messages?limit=200`)
          .then((r) => r.json())
          .then((data: any) => {
            if (Array.isArray(data.messages) && data.messages.length > 0) {
              const msgs: AcpTextChunk[] = data.messages.map((m: any) => ({
                type: 'text' as const,
                text: m.content,
                sender: m.sender as 'agent' | 'user' | 'system',
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
      // Auto-select first running lead
      if (!store.selectedLeadId) {
        const running = leads.find((l) => l.status === 'running');
        if (running) store.selectLead(running.id);
      }
    }).catch(() => {});

    // Load persisted projects and register them in leadStore
    fetch('/api/projects').then((r) => r.json()).then((projects: Project[]) => {
      if (!Array.isArray(projects)) return;
      const store = useLeadStore.getState();
      for (const proj of projects) {
        if (proj.status === 'archived') continue;
        const key = `project:${proj.id}`;
        store.addProject(key);
      }
      // If no lead is selected yet, select the first project
      if (!store.selectedLeadId && projects.length > 0) {
        const first = projects.find((p) => p.status !== 'archived');
        if (first) store.selectLead(`project:${first.id}`);
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen bg-surface text-th-text-alt">
      <Sidebar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <header className="h-12 border-b border-th-border flex items-center px-4 justify-between shrink-0">
            <h1 className="text-lg font-semibold">AI Crew</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={togglePause}
                title={systemPaused ? 'Resume system' : 'Pause system'}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                  systemPaused
                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30'
                    : 'bg-th-bg-alt border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover'
                }`}
              >
                {systemPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{systemPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                onClick={openCmd}
                className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors text-xs"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Commands</span>
                <kbd className="text-[10px] text-th-text-muted border border-th-border rounded px-1 py-0.5 ml-1">⌘K</kbd>
              </button>
              <span
                className={`inline-block w-2 h-2 rounded-full ${connected ? (systemPaused ? 'bg-yellow-400' : 'bg-green-400') : 'bg-red-400'}`}
              />
              <span className="text-sm text-th-text-muted">
                {!connected ? 'Reconnecting...' : systemPaused ? 'Paused' : 'Connected'}
              </span>
              <span className="text-sm text-th-text-muted">{agents.length} agents</span>
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
            <Route path="/data" element={<DataBrowser />} />
            <Route path="/timeline" element={<TimelinePage api={api} ws={ws} />} />
            <Route path="/mission-control" element={<MissionControlPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {selectedAgentId && (
          <div className="w-[500px] border-l border-th-border flex flex-col">
            <ChatPanel agentId={selectedAgentId} ws={ws} api={api} />
          </div>
        )}
      </div>
      <ToastContainer />
      <PermissionDialog />
      <SearchDialog open={searchOpen} onClose={closeSearch} />
      {cmdOpen && <CommandPalette onClose={closeCmd} onOpenSearch={openSearch} />}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
    </div>
  );
}
