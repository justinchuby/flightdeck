import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { apiFetch } from './hooks/useApi';
import { ApiProvider } from './contexts/ApiContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { useAppStore } from './stores/appStore';
import { useSettingsStore, shouldNotify } from './stores/settingsStore';
import { useCommandPalette } from './hooks/useCommandPalette';
import { CommandPalette } from './components/CommandPalette/CommandPalette';
import { ContextualCoach } from './components/Onboarding';

import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { LeadDashboard, ReadOnlySession } from './components/LeadDashboard';
import { SearchDialog } from './components/SearchDialog/SearchDialog';
import { Sidebar } from './components/Sidebar';
import { ToastContainer, useToastStore } from './components/Toast';
import { lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { playCompletionSound } from './utils/notificationSound';
import { Search, Pause, Play, Bug } from 'lucide-react';
import { OnboardingWizard, useOnboarding } from './components/Onboarding/OnboardingWizard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SectionErrorBoundary, RouteErrorBoundary } from './components/SectionErrorBoundary';
import { buildFeedbackUrl } from './components/ProvideFeedback';
import { VersionBadge } from './components/VersionBadge';
import { PulseStrip } from './components/Pulse';
import { AttentionBar } from './components/AttentionBar';
import { ApprovalBadge, ApprovalSlideOver } from './components/ApprovalQueue';
import { CatchUpBanner } from './components/CatchUp';
import { StatusPopover } from './components/StatusPopover/StatusPopover';
import { SetupWizard, shouldShowSetupWizard } from './components/SetupWizard';
import { useLeadStore } from './stores/leadStore';
import { useMessageStore } from './stores/messageStore';
import type { AcpTextChunk, Project } from './types';
import { ProjectLayout } from './layouts/ProjectLayout';
import { shortAgentId } from './utils/agentLabel';

// Lazy-loaded route components (~40-50% initial bundle reduction)
const TaskQueuePanel = lazy(() => import('./components/TaskQueue/TaskQueuePanel').then(m => ({ default: m.TaskQueuePanel })));
const SettingsPanel = lazy(() => import('./components/Settings/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const OrgChart = lazy(() => import('./components/OrgChart/OrgChart').then(m => ({ default: m.OrgChart })));
const OverviewPage = lazy(() => import('./components/OverviewPage/OverviewPage').then(m => ({ default: m.OverviewPage })));
const GroupChat = lazy(() => import('./components/GroupChat/GroupChat').then(m => ({ default: m.GroupChat })));
const TimelinePage = lazy(() => import('./components/Timeline').then(m => ({ default: m.TimelinePage })));
const AnalyticsPage = lazy(() => import('./components/Analytics').then(m => ({ default: m.AnalyticsPage })));
const AnalysisPage = lazy(() => import('./components/AnalysisPage').then(m => ({ default: m.AnalysisPage })));
const SharedReplayViewer = lazy(() => import('./components/SessionReplay').then(m => ({ default: m.SharedReplayViewer })));
const ProjectsPanel = lazy(() => import('./components/ProjectsPanel').then(m => ({ default: m.ProjectsPanel })));
const KnowledgePanel = lazy(() => import('./components/KnowledgePanel').then(m => ({ default: m.KnowledgePanel })));
const ArtifactsPanel = lazy(() => import('./components/ArtifactsPanel').then(m => ({ default: m.ArtifactsPanel })));
const HomeDashboard = lazy(() => import('./components/HomeDashboard').then(m => ({ default: m.HomeDashboard })));
const _CrewPage = lazy(() => import('./pages/CrewPage').then(m => ({ default: m.CrewPage })));
const _CrewRoster = lazy(() => import('./components/CrewRoster/CrewRoster').then(m => ({ default: m.CrewRoster })));
const UnifiedCrewPage = lazy(() => import('./components/CrewRoster/UnifiedCrewPage').then(m => ({ default: m.UnifiedCrewPage })));

function RouteSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Redirects from old flat routes to project-scoped routes.
 * Resolves the active project ID from leadStore + live agents.
 */
function ProjectRedirect({ page }: { page: string }) {
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const agents = useAppStore((s) => s.agents);

  const projectId = useMemo(() => {
    if (!selectedLeadId) {
      // Fall back to first live lead's projectId
      const firstLead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
      return firstLead?.projectId ?? firstLead?.id ?? null;
    }
    // If selectedLeadId is a project: prefix, extract the ID
    if (selectedLeadId.startsWith('project:')) {
      return selectedLeadId.slice('project:'.length);
    }
    // Otherwise it's a lead agent ID — find its projectId
    const lead = agents.find((a) => a.id === selectedLeadId);
    return lead?.projectId ?? selectedLeadId;
  }, [selectedLeadId, agents]);

  if (!projectId) return <Navigate to="/projects" replace />;
  return <Navigate to={`/projects/${projectId}/${page}`} replace />;
}

/**
 * Home route: redirect to active project's session or projects list.
 */
function _HomeRedirect() {
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const agents = useAppStore((s) => s.agents);

  const projectId = useMemo(() => {
    if (selectedLeadId) {
      if (selectedLeadId.startsWith('project:')) {
        return selectedLeadId.slice('project:'.length);
      }
      const lead = agents.find((a) => a.id === selectedLeadId);
      return lead?.projectId ?? selectedLeadId;
    }
    // Fall back to first live lead
    const firstLead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
    return firstLead?.projectId ?? firstLead?.id ?? null;
  }, [selectedLeadId, agents]);

  if (!projectId) return <Navigate to="/projects" replace />;
  return <Navigate to={`/projects/${projectId}/session`} replace />;
}

function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-th-text-muted" data-testid="not-found">
      <span className="text-4xl">404</span>
      <p className="text-sm">Page not found</p>
      <Link to="/" className="text-sm text-accent hover:underline">← Back to Home</Link>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <WebSocketProvider>
          <AppContent />
        </WebSocketProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

function AppContent() {
  const _connected = useAppStore((s) => s.connected);
  const agents = useAppStore((s) => s.agents);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const systemPaused = useAppStore((s) => s.systemPaused);
  const _setSystemPaused = useAppStore((s) => s.setSystemPaused);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to ${systemPaused ? 'resume' : 'pause'}: ${message}`);
    }
  }, [systemPaused, addToast]);

  // Onboarding wizard — show on first visit
  const { shouldShow } = useOnboarding();
  const [showOnboarding, setShowOnboarding] = useState(shouldShow);

  // Setup wizard — show if providers not yet configured
  const [showSetupWizard, setShowSetupWizard] = useState(() => shouldShowSetupWizard());

  // Shift+A global shortcut to open approval queue
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'A' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        useAppStore.getState().setApprovalQueueOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Show notifications for agent lifecycle events, sound notifications, and context compaction
  // Gated by Trust Dial oversight level (AC-16.5): detailed=all, standard=exceptions, minimal=critical only
  useEffect(() => {
    const handler = (event: Event) => {
      const msg = JSON.parse((event as MessageEvent).data);
      if (msg.type === 'agent:spawned') {
        if (shouldNotify('info')) addToast('info', `${msg.agent.role.icon} ${msg.agent.role.name} agent spawned`);
      } else if (msg.type === 'agent:exit') {
        const failed = msg.code !== 0;
        // Failures are critical — ALWAYS toast regardless of level
        if (failed) {
          addToast('error', `Agent ${shortAgentId(msg.agentId)} failed`);
        } else if (shouldNotify('info')) {
          addToast('success', `Agent ${shortAgentId(msg.agentId)} completed`);
        }
      } else if (msg.type === 'agent:sub_spawned') {
        if (shouldNotify('info')) addToast('info', `${msg.child.role.icon} Sub-agent spawned by ${shortAgentId(msg.parentId)}`);
      } else if (msg.type === 'agent:context_compacted') {
        if (shouldNotify('info')) {
          const pct = msg.percentDrop ? ` (${msg.percentDrop}% reduction)` : '';
          addToast('info', `🔄 Context compacted for agent ${shortAgentId(msg.agentId)}${pct}`);
        }
      } else if (msg.type === 'activity') {
        const e = msg.entry;
        if (e?.action === 'heartbeat_halted') {
          if (shouldNotify('exception')) addToast('info', `⏸️ Heartbeat halted by ${e.agentId ? shortAgentId(e.agentId) : 'agent'}`);
        } else if (e?.action === 'limit_change_requested') {
          if (shouldNotify('info')) addToast('info', `⚙️ Agent limit change requested: ${e.details ?? ''}`);
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

  // On app startup: load active leads + pre-load their message history
  useQuery({
    queryKey: ['app', 'leads'],
    queryFn: async ({ signal }) => {
      try {
        const leads: Array<{ id: string; status: string; task?: string }> = await apiFetch('/lead', { signal });
        if (!Array.isArray(leads)) return [];
        const store = useLeadStore.getState();
        leads.forEach((l) => {
          store.addProject(l.id);
          useMessageStore.getState().ensureChannel(l.id);
          apiFetch<{ messages: Array<{ sender?: string; text?: string; content?: string; timestamp?: string | number }> }>(`/agents/${l.id}/messages?limit=200`, { signal })
            .then((data) => {
              if (Array.isArray(data.messages) && data.messages.length > 0) {
                const msgs: AcpTextChunk[] = data.messages.map((m) => ({
                  type: 'text' as const,
                  text: m.content || m.text || '',
                  sender: m.sender as 'agent' | 'user' | 'system',
                  timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
                }));
                const ms = useMessageStore.getState();
                ms.mergeHistory(l.id, msgs);
              }
            })
            .catch(() => { /* message history fetch — non-critical, will load via WS */ });
        });
        if (!store.selectedLeadId) {
          const running = leads.find((l) => l.status === 'running');
          if (running) store.selectLead(running.id);
        }
        return leads;
      } catch (err) {
        addToast('error', 'Failed to load sessions — check server connection');
        throw err;
      }
    },
    staleTime: 30_000,
  });

  // On app startup: load persisted projects and register them in leadStore
  useQuery({
    queryKey: ['app', 'projects'],
    queryFn: async ({ signal }) => {
      const projects: Project[] = await apiFetch('/projects', { signal });
      if (!Array.isArray(projects)) return [];
      const store = useLeadStore.getState();
      for (const proj of projects) {
        if (proj.status === 'archived') continue;
        const key = `project:${proj.id}`;
        store.addProject(key);
      }
      if (!store.selectedLeadId && projects.length > 0) {
        const first = projects.find((p) => p.status !== 'archived');
        if (first) store.selectLead(`project:${first.id}`);
      }
      return projects;
    },
    staleTime: 30_000,
  });

  return (
    <div className="flex h-screen bg-surface text-th-text-alt">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-lg focus:text-sm">
        Skip to content
      </a>
      <SectionErrorBoundary name="Sidebar">
      <Sidebar />
      </SectionErrorBoundary>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <SectionErrorBoundary name="Header">
          <header className="h-12 border-b border-th-border flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center gap-2">
              {/* Flightdeck logo */}
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                <path d="M16 3C13 7 11 12 10.5 17L14 19.5V25L16 22L18 25V19.5L21.5 17C21 12 19 7 16 3Z" fill="currentColor" className="text-accent" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                <ellipse cx="16" cy="13" rx="2.2" ry="2.5" fill="currentColor" className="text-th-bg opacity-80"/>
                <path d="M10.5 17L8 21L11.5 19Z" fill="currentColor" className="text-accent opacity-60"/>
                <path d="M21.5 17L24 21L20.5 19Z" fill="currentColor" className="text-accent opacity-60"/>
              </svg>
              <h1 className="text-lg font-semibold">Flightdeck</h1>
              <VersionBadge />
            </div>
            <div className="flex items-center gap-3">
              <a
                href={buildFeedbackUrl({ title: 'User feedback' })}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors text-xs"
                title="Submit Issue"
                data-testid="top-bar-submit-issue"
              >
                <Bug className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Submit Issue</span>
              </a>
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
              <span data-tour="approval-badge"><ApprovalBadge /></span>
              <button
                data-tour="cmd-k"
                onClick={openCmd}
                className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-th-bg-alt border border-th-border text-th-text-muted hover:text-th-text hover:border-th-border-hover transition-colors text-xs"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Commands</span>
                <kbd className="text-[10px] text-th-text-muted border border-th-border rounded px-1 py-0.5 ml-1">⌘K</kbd>
              </button>
              <StatusPopover />
              <span className="text-sm text-th-text-muted">{agents.length} agents</span>
            </div>
          </header>
          </SectionErrorBoundary>

          <AttentionBar />
          <div data-tour="pulse-strip"><PulseStrip /></div>

          <main id="main-content" className="flex-1 overflow-hidden flex flex-col">
          <ErrorBoundary>
          <Suspense fallback={<RouteSpinner />}>
          <Routes>
            {/* ── Project-scoped nested routes ─────────────────── */}
            <Route path="/projects/:id" element={<ProjectLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<RouteErrorBoundary name="Overview"><OverviewPage /></RouteErrorBoundary>} />
              <Route path="session" element={<RouteErrorBoundary name="Session"><LeadDashboard /></RouteErrorBoundary>} />
              <Route path="sessions/:leadId" element={<RouteErrorBoundary name="Session History"><ReadOnlySession /></RouteErrorBoundary>} />
              <Route path="tasks" element={<RouteErrorBoundary name="Tasks"><TaskQueuePanel /></RouteErrorBoundary>} />
              <Route path="crew" element={<RouteErrorBoundary name="Crew"><UnifiedCrewPage scope="project" /></RouteErrorBoundary>} />
              <Route path="agents" element={<Navigate to="../crew" replace />} />
              <Route path="knowledge" element={<RouteErrorBoundary name="Knowledge"><KnowledgePanel /></RouteErrorBoundary>} />
              <Route path="artifacts" element={<RouteErrorBoundary name="Artifacts"><ArtifactsPanel /></RouteErrorBoundary>} />
              <Route path="timeline" element={<RouteErrorBoundary name="Timeline"><TimelinePage /></RouteErrorBoundary>} />
              <Route path="groups" element={<RouteErrorBoundary name="Groups"><GroupChat /></RouteErrorBoundary>} />
              <Route path="org-chart" element={<RouteErrorBoundary name="Org Chart"><OrgChart /></RouteErrorBoundary>} />
              <Route path="analytics" element={<RouteErrorBoundary name="Analytics"><AnalyticsPage /></RouteErrorBoundary>} />
              <Route path="analysis" element={<RouteErrorBoundary name="Analysis"><AnalysisPage /></RouteErrorBoundary>} />
            </Route>

            {/* ── Global (non-project-scoped) routes ───────────── */}
            <Route path="/projects" element={<RouteErrorBoundary name="Projects"><ProjectsPanel /></RouteErrorBoundary>} />
            <Route path="/settings" element={<RouteErrorBoundary name="Settings"><SettingsPanel /></RouteErrorBoundary>} />
            <Route path="/shared/:token" element={<RouteErrorBoundary name="Shared Replay"><SharedReplayViewer /></RouteErrorBoundary>} />

            {/* ── Backward-compat redirects from old flat routes ─ */}
            <Route path="/" element={<RouteErrorBoundary name="Home"><HomeDashboard /></RouteErrorBoundary>} />
            <Route path="/lead" element={<ProjectRedirect page="session" />} />
            <Route path="/overview" element={<ProjectRedirect page="overview" />} />
            <Route path="/agents" element={<Suspense fallback={<RouteSpinner />}><RouteErrorBoundary name="Agents"><UnifiedCrewPage scope="global" /></RouteErrorBoundary></Suspense>} />
            <Route path="/crews" element={<Navigate to="/agents" replace />} />
            <Route path="/team" element={<Navigate to="/agents" replace />} />
            <Route path="/tasks" element={<ProjectRedirect page="tasks" />} />
            <Route path="/knowledge" element={<ProjectRedirect page="knowledge" />} />
            <Route path="/timeline" element={<ProjectRedirect page="timeline" />} />
            <Route path="/groups" element={<ProjectRedirect page="groups" />} />
            <Route path="/org" element={<ProjectRedirect page="org-chart" />} />
            <Route path="/analytics" element={<ProjectRedirect page="analytics" />} />
            <Route path="/mission-control" element={<ProjectRedirect page="overview" />} />
            <Route path="/data" element={<Navigate to="/knowledge?tab=memory" replace />} />

            {/* ── Catch-all ─────────────────────────────────────── */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
          </main>
        </div>

        {/* Desktop: sidebar panel */}
        {selectedAgentId && (
          <div className="w-full max-w-[500px] border-l border-th-border flex flex-col bg-th-bg">
            <ChatPanel agentId={selectedAgentId} />
          </div>
        )}
      </div>
      <ToastContainer />
      <ApprovalSlideOver />
      <CatchUpBanner />
      <SearchDialog open={searchOpen} onClose={closeSearch} />
      {cmdOpen && <CommandPalette onClose={closeCmd} onOpenSearch={openSearch} />}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {showSetupWizard && !showOnboarding && <SetupWizard onComplete={() => setShowSetupWizard(false)} />}
      <ContextualCoach onNavigate={(path) => { const nav = document.querySelector(`a[href="${path}"]`) as HTMLAnchorElement; nav?.click(); }} />
    </div>
  );
}
