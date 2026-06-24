/**
 * ProjectLayout — wrapper for all project-scoped pages.
 *
 * Reads projectId from route params, renders a header with project name,
 * status badge, and agent count. Primary tabs use the unified Tabs
 * component; secondary tabs live in an overflow menu.
 *
 * Provides ProjectContext so child routes can access projectId.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Outlet, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  LayoutDashboard,
  Crown,
  ListChecks,
  Users,
  Brain,
  ScrollText,
  GanttChart,
  MessageSquare,
  Network,
  BarChart3,
  MoreHorizontal,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useLeadStore } from '../stores/leadStore';
import { useNavigationStore } from '../stores/navigationStore';
import { ProjectOversightPicker } from '../components/ProjectOversightPicker/ProjectOversightPicker';
import { useProjects } from '../hooks/useProjects';
import { ProjectContext } from '../contexts/ProjectContext';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageTransition } from '../components/PageTransition';
import { apiFetch } from '../hooks/useApi';
import { shortAgentId } from '../utils/agentLabel';

// ── Types ─────────────────────────────────────────────────────────

interface ProjectDetails {
  id: string;
  name: string;
  status: string;
  agentCount?: number;
}

// ── Tab definitions ───────────────────────────────────────────────

const PRIMARY_TABS: TabItem[] = [
  { id: 'overview',   label: 'Overview',   icon: <LayoutDashboard size={14} /> },
  { id: 'session',    label: 'Session',    icon: <Crown size={14} /> },
  { id: 'tasks',      label: 'Tasks',      icon: <ListChecks size={14} /> },
  { id: 'crew',       label: 'Crew',       icon: <Users size={14} /> },
  { id: 'artifacts',  label: 'Artifacts',  icon: <ScrollText size={14} /> },
  { id: 'knowledge',  label: 'Knowledge',  icon: <Brain size={14} /> },
  { id: 'timeline',   label: 'Timeline',   icon: <GanttChart size={14} /> },
  { id: 'analysis',   label: 'Analysis',   icon: <TrendingUp size={14} /> },
  { id: 'groups',     label: 'Groups',     icon: <MessageSquare size={14} /> },
  { id: 'org-chart',  label: 'Org Chart',  icon: <Network size={14} /> },
];

interface OverflowItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const OVERFLOW_ITEMS: OverflowItem[] = [
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={14} /> },
];

const ALL_TAB_IDS = new Set([
  ...PRIMARY_TABS.map(t => t.id),
  ...OVERFLOW_ITEMS.map(t => t.id),
]);

const TAB_STORAGE_KEY = 'flightdeck-project-tab';
const MAX_STORED_PROJECTS = 50;

// ── Helpers ───────────────────────────────────────────────────────

function projectStatusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'active':
    case 'running':   return 'success';
    case 'paused':    return 'warning';
    case 'completed': return 'info';
    case 'error':     return 'error';
    case 'archived':
    default:          return 'neutral';
  }
}

function activeTabFromPath(pathname: string, projectId: string): string {
  const prefix = `/projects/${projectId}/`;
  if (!pathname.startsWith(prefix)) return 'overview';
  const segment = pathname.slice(prefix.length).split('/')[0];
  if (segment && ALL_TAB_IDS.has(segment)) return segment;
  return 'overview';
}

// ── Component ─────────────────────────────────────────────────────

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const agents = useAppStore((s) => s.agents);
  const { projects } = useProjects();

  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const activeTab = activeTabFromPath(location.pathname, id ?? '');
  const isOverflowTabActive = OVERFLOW_ITEMS.some(item => item.id === activeTab);

  // Resolve project name from live agents, REST projects, or fetched details
  const projectName = useMemo(() => {
    const lead = agents.find(
      (a) =>
        a.role?.id === 'lead' &&
        !a.parentId &&
        (a.projectId === id || a.id === id),
    );
    if (lead?.projectName) return lead.projectName;

    const proj = projects.find((p) => p.id === id);
    if (proj?.name) return proj.name;

    if (details?.name) return details.name;

    return (id ? shortAgentId(id) : '') ?? 'Project';
  }, [id, agents, projects, details]);

  // Live status indicator
  const isLive = useMemo(() => {
    return agents.some(
      (a) =>
        a.role?.id === 'lead' &&
        !a.parentId &&
        (a.projectId === id || a.id === id) &&
        (a.status === 'running' || a.status === 'creating' || a.status === 'idle'),
    );
  }, [id, agents]);

  // Fetch project details for status + agent count
  const fetchDetails = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<ProjectDetails>(`/projects/${id}`);
      setDetails(data);
    } catch {
      // Non-critical — header degrades gracefully without details
    }
  }, [id]);

  useEffect(() => { fetchDetails(); }, [fetchDetails]);

  // Sync URL project ID → leadStore.selectedLeadId so child components
  // (LeadDashboard, TaskQueuePanel, etc.) pick up the correct project
  useEffect(() => {
    if (!id) return;
    const store = useLeadStore.getState();

    // Find lead agent matching this project's ID
    const lead = agents.find(
      (a) => a.role?.id === 'lead' && !a.parentId && (a.projectId === id || a.id === id),
    );

    if (lead) {
      // Live lead found — register with both leadId and projectId keys
      store.addProject(lead.id, id);
      if (store.selectedLeadId !== lead.id) {
        store.selectLead(lead.id);
      }
    }
    // If no live lead found, do nothing — selectedLeadId stays null
    // until the lead agent spawns and agents list updates
  }, [id, agents]);

  // Sync project context → navigationStore
  useEffect(() => {
    const nav = useNavigationStore.getState();
    nav.setProject(id ?? null, projectName);
    nav.setActiveTab(activeTab);
    nav.pushEntry({
      path: location.pathname,
      projectId: id,
      tab: activeTab,
      label: projectName,
    });
  }, [id, projectName, activeTab, location.pathname]);
  useEffect(() => {
    if (!overflowOpen) return;
    function handleClick(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [overflowOpen]);

  // Navigation
  const handleTabChange = useCallback((tabId: string) => {
    navigate(`/projects/${id}/${tabId}`);
  }, [navigate, id]);

  const handleOverflowSelect = (itemId: string) => {
    setOverflowOpen(false);
    handleTabChange(itemId);
  };

  // B-10: Persist last active tab per project to localStorage
  useEffect(() => {
    if (!id || activeTab === 'overview') return;
    try {
      const stored = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY) ?? '{}');
      stored[id] = activeTab;
      // Evict oldest entries if too many projects stored
      const keys = Object.keys(stored);
      if (keys.length > MAX_STORED_PROJECTS) {
        for (const k of keys.slice(0, keys.length - MAX_STORED_PROJECTS)) {
          delete stored[k];
        }
      }
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(stored));
    } catch { /* Gracefully ignore corrupt localStorage */ }
  }, [id, activeTab]);

  // Restore last tab once when first entering a project (not on every overview visit)
  const restoredForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || restoredForRef.current === id) return;
    const isDefaultLanding =
      location.pathname === `/projects/${id}` ||
      location.pathname === `/projects/${id}/` ||
      location.pathname === `/projects/${id}/overview`;
    if (!isDefaultLanding) {
      // User navigated directly to a specific tab — mark as restored
      restoredForRef.current = id;
      return;
    }
    restoredForRef.current = id;
    try {
      const stored = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY) ?? '{}');
      const lastTab = stored[id];
      if (lastTab && ALL_TAB_IDS.has(lastTab) && lastTab !== 'overview') {
        navigate(`/projects/${id}/${lastTab}`, { replace: true });
      }
    } catch { /* Gracefully ignore corrupt localStorage */ }
  }, [id, location.pathname, navigate]);

  // B-11: Keyboard shortcuts — Alt+1-5 for primary tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= PRIMARY_TABS.length) {
        e.preventDefault();
        handleTabChange(PRIMARY_TABS[num - 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleTabChange]);

  if (!id) return null;

  // Runtime state (isLive) overrides stale DB status to avoid showing
  // "active" badge when no agents are actually running (B-ON-1).
  const projectStatus = isLive ? 'active' : (details?.status === 'active' ? 'idle' : (details?.status ?? 'idle'));

  // Agent status breakdown for this project (replaces PulseStrip on project pages)
  const agentStats = useMemo(() => {
    const projectAgents = agents.filter(
      (a) => a.projectId === id || a.id === id,
    );
    let running = 0;
    let idle = 0;
    let failed = 0;
    for (const a of projectAgents) {
      switch (a.status) {
        case 'running':
        case 'creating':
          running++;
          break;
        case 'idle':
          idle++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }
    return { total: projectAgents.length, running, idle, failed };
  }, [agents, id]);

  return (
    <ProjectContext.Provider value={{ projectId: id }}>
      <div className="flex flex-col flex-1 overflow-hidden" data-testid="project-layout">
        {/* Project header */}
        <div className="border-b border-th-border bg-surface shrink-0">
          <div className="flex items-center gap-2 px-4 pt-2 pb-1">
            <button
              onClick={() => navigate('/projects')}
              className="p-1 rounded hover:bg-th-bg-alt text-th-text-alt transition-colors shrink-0"
              aria-label="Back to projects"
              data-testid="back-button"
            >
              <ArrowLeft size={14} />
            </button>

            {isLive && (
              <span
                className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0"
                title="Project has running agents"
              />
            )}

            <h2
              className="text-sm font-semibold text-th-text-alt truncate"
              data-testid="project-name"
            >
              {projectName}
            </h2>

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <ProjectOversightPicker projectId={id} />
              <StatusBadge
                variant={projectStatusVariant(projectStatus)}
                label={projectStatus}
                dot
                size="sm"
              />
              {agentStats.total > 0 && (
                <span className="text-xs text-th-text-muted flex items-center gap-1.5 font-mono" data-testid="agent-count">
                  <Users size={12} className="text-blue-400" />
                  {agentStats.running > 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-green-400">{agentStats.running}</span>
                    </span>
                  )}
                  {agentStats.idle > 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      <span className="text-yellow-400">{agentStats.idle}</span>
                    </span>
                  )}
                  {agentStats.failed > 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-red-400">{agentStats.failed}</span>
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Tab bar — horizontal scroll on mobile, hide scrollbar */}
          <div className="flex items-center px-2" data-testid="project-tab-bar">
            <div
              className="flex items-center flex-nowrap overflow-x-auto flex-1 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
            >
              <Tabs
                tabs={PRIMARY_TABS}
                activeTab={isOverflowTabActive ? '' : activeTab}
                onTabChange={handleTabChange}
                size="sm"
                className="border-b-0 flex-1"
              />
            </div>

            {/* Separator */}
            <div className="w-px h-5 bg-th-border mx-1 shrink-0" />

            {/* Overflow menu — outside scroll container so dropdown isn't clipped */}
            <div className="relative shrink-0" ref={overflowRef}>
              <button
                onClick={() => setOverflowOpen(!overflowOpen)}
                className={`p-2 rounded transition-colors ${
                  isOverflowTabActive
                    ? 'text-accent bg-accent/10'
                    : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-alt'
                }`}
                aria-label="More tabs"
                data-testid="overflow-menu"
              >
                <MoreHorizontal size={14} />
              </button>

              {overflowOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-40 bg-surface-raised rounded-lg border border-th-border shadow-lg py-1 z-50"
                  data-testid="overflow-dropdown"
                >
                  {OVERFLOW_ITEMS.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleOverflowSelect(item.id)}
                      className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors ${
                        activeTab === item.id
                          ? 'text-accent bg-accent/10'
                          : 'text-th-text hover:bg-th-bg-alt'
                      }`}
                      data-testid={`overflow-item-${item.id}`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Route content with transition animation */}
        <PageTransition transitionKey={activeTab}>
          <Outlet />
        </PageTransition>
      </div>
    </ProjectContext.Provider>
  );
}
