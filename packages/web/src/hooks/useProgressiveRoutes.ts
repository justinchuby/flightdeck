import { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useLeadStore } from '../stores/leadStore';

export type RouteTier = 'starter' | 'active' | 'collaboration' | 'power';

export interface ProgressiveRoute {
  path: string;
  label: string;
  icon: string;
  tier: RouteTier;
  badge?: number;
}

const TIER_LEVEL: Record<RouteTier, number> = {
  starter: 0,
  active: 1,
  collaboration: 2,
  power: 3,
};

const ALL_ROUTES: ProgressiveRoute[] = [
  // Starter (always visible)
  { path: '/', label: 'Lead', icon: '👑', tier: 'starter' },
  { path: '/overview', label: 'Overview', icon: '📊', tier: 'starter' },
  { path: '/crews', label: 'Crews', icon: '👥', tier: 'starter' },
  { path: '/settings', label: 'Settings', icon: '⚙️', tier: 'starter' },
  // Active session
  { path: '/tasks', label: 'Tasks', icon: '📋', tier: 'active' },
  { path: '/timeline', label: 'Timeline', icon: '📅', tier: 'active' },
  // Collaboration
  { path: '/canvas', label: 'Canvas', icon: '🎨', tier: 'collaboration' },
  { path: '/mission-control', label: 'Mission Control', icon: '🚀', tier: 'collaboration' },
  // Power user
  { path: '/analytics', label: 'Analytics', icon: '📈', tier: 'power' },
  { path: '/groups', label: 'Groups', icon: '💬', tier: 'power' },
  { path: '/org', label: 'Org Chart', icon: '🌐', tier: 'power' },
  { path: '/data', label: 'Database', icon: '🗄️', tier: 'power' },
];

function getSessionCount(): number {
  try { return parseInt(localStorage.getItem('session-count') ?? '0', 10); }
  catch { return 0; }
}

function isManuallyExpanded(): boolean {
  try { return localStorage.getItem('sidebar-routes-expanded') === 'true'; }
  catch { return false; }
}

export function useProgressiveRoutes() {
  const agents = useAppStore(s => s.agents);
  const selectedLeadId = useLeadStore(s => s.selectedLeadId);
  const dagStatus = useLeadStore(s => s.projects[selectedLeadId ?? '']?.dagStatus);
  const tasks = dagStatus?.tasks ?? [];

  const tier = useMemo((): RouteTier => {
    if (isManuallyExpanded() || getSessionCount() >= 3) return 'power';
    if (agents.length >= 3) return 'collaboration';
    if (tasks.length > 0 || agents.length >= 2) return 'active';
    return 'starter';
  }, [agents.length, tasks.length]);

  const visibleRoutes = useMemo(() => {
    const level = TIER_LEVEL[tier];
    return ALL_ROUTES.filter(r => TIER_LEVEL[r.tier] <= level);
  }, [tier]);

  const hiddenRoutes = useMemo(() => {
    const level = TIER_LEVEL[tier];
    return ALL_ROUTES.filter(r => TIER_LEVEL[r.tier] > level);
  }, [tier]);

  const expandAll = () => {
    try { localStorage.setItem('sidebar-routes-expanded', 'true'); } catch {}
  };

  return { tier, visibleRoutes, hiddenRoutes, expandAll, allRoutes: ALL_ROUTES };
}
