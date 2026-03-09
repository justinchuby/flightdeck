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
  Workflow,
  MoreHorizontal,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useLeadStore } from '../stores/leadStore';
import { useNavigationStore } from '../stores/navigationStore';
import { useProjects } from '../hooks/useProjects';
import { ProjectContext } from '../contexts/ProjectContext';
import { Tabs, type TabItem } from '../components/ui/Tabs';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTransition } from '../components/PageTransition';
import { apiFetch } from '../hooks/useApi';

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
  { id: 'artifacts',  label: 'Artifacts',  icon: <ScrollText size={14} /> },
  { id: 'knowledge',  label: 'Knowledge',  icon: <Brain size={14} /> },
  { id: 'timeline',   label: 'Timeline',   icon: <GanttChart size={14} /> },
  { id: 'groups',     label: 'Groups',     icon: <MessageSquare size={14} /> },
  { id: 'org-chart',  label: 'Org Chart',  icon: <Network size={14} /> },
];

interface OverflowItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const OVERFLOW_ITEMS: OverflowItem[] = [
  { id: 'agents',    label: 'Agents',    icon: <Users size={14} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={14} /> },
  { id: 'canvas',    label: 'Canvas',    icon: <Workflow size={14} /> },
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

    return id?.slice(0, 8) ?? 'Project';
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

    // Find matching leadStore key: either a lead agent ID with this projectId,
    // or the `project:${id}` key for persisted projects
    const lead = agents.find(
      (a) => a.role?.id === 'lead' && !a.parentId && (a.projectId === id || a.id === id),
    );
    const storeKey = lead?.id ?? `project:${id}`;

    // Ensure the project exists in the store
    store.addProject(storeKey);

    // Select it if not already selected
    if (store.selectedLeadId !== storeKey) {
      store.selectLead(storeKey);
    }
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

  // Restore last tab on initial navigation to project root
  useEffect(() => {
    if (!id) return;
    const isProjectRoot = location.pathname === `/projects/${id}` || location.pathname === `/projects/${id}/overview`;
    if (!isProjectRoot) return;
    try {
      const stored = JSON.parse(localStorage.getItem(TAB_STORAGE_KEY) ?? '{}');
      const lastTab = stored[id];
      if (lastTab && ALL_TAB_IDS.has(lastTab) && lastTab !== 'overview') {
        navigate(`/projects/${id}/${lastTab}`, { replace: true });
      }
    } catch { /* Gracefully ignore corrupt localStorage */ }
  // Only run on project ID change, not on every location change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  const projectStatus = details?.status ?? (isLive ? 'active' : 'idle');
  const agentCount = details?.agentCount;

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
              <StatusBadge
                variant={projectStatusVariant(projectStatus)}
                label={projectStatus}
                dot
                size="sm"
              />
              {agentCount != null && (
                <span className="text-xs text-th-text-muted flex items-center gap-1" data-testid="agent-count">
                  <Users size={12} />
                  {agentCount}
                </span>
              )}
            </div>
          </div>

          {/* Tab bar — horizontal scroll on mobile, hide scrollbar */}
          <div
            className="flex items-center flex-nowrap overflow-x-auto px-2 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
            data-testid="project-tab-bar"
          >
            <Tabs
              tabs={PRIMARY_TABS}
              activeTab={isOverflowTabActive ? '' : activeTab}
              onTabChange={handleTabChange}
              size="sm"
              className="border-b-0 flex-1"
            />

            {/* Separator */}
            <div className="w-px h-5 bg-th-border mx-1 shrink-0" />

            {/* Overflow menu */}
            <div className="relative" ref={overflowRef}>
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

        {/* Breadcrumb trail */}
        <Breadcrumb />

        {/* Route content with transition animation */}
        <PageTransition transitionKey={activeTab}>
          <Outlet />
        </PageTransition>
      </div>
    </ProjectContext.Provider>
  );
}
