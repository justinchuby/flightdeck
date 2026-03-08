import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Users, Settings, Crown, ListChecks, LayoutDashboard, GanttChart, Activity, MessageSquare, Network, Database, MoreHorizontal, ChevronDown, ChevronRight, Workflow, BarChart3, FolderOpen, Brain, Server, UserCheck } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

const primaryLinks = [
  { to: '/', icon: Crown, label: 'Lead' },
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/agents', icon: Users, label: 'Agents' },
  { to: '/tasks', icon: ListChecks, label: 'Tasks' },
  { to: '/timeline', icon: GanttChart, label: 'Timeline' },
  { to: '/mission-control', icon: Activity, label: 'Mission' },
  { to: '/canvas', icon: Workflow, label: 'Canvas' },
];

const moreLinks = [
  { to: '/projects', icon: FolderOpen, label: 'Projects' },
  { to: '/knowledge', icon: Brain, label: 'Knowledge' },
  { to: '/team', icon: UserCheck, label: 'Team' },
  { to: '/agent-server', icon: Server, label: 'Agent Server' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/groups', icon: MessageSquare, label: 'Groups' },
  { to: '/org', icon: Network, label: 'Org Chart' },
  { to: '/data', icon: Database, label: 'Database' },
];

const SIDEBAR_MORE_KEY = 'sidebar-more-expanded';

function NavItem({ to, icon: Icon, label, badge, end }: {
  to: string; icon: any; label: string; badge?: number | null; end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }: { isActive: boolean }) =>
        `relative flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors w-[58px] ${
          isActive
            ? 'bg-accent/20 text-accent'
            : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50'
        }`
      }
    >
      <div className="relative">
        <Icon size={18} />
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-accent text-[8px] font-bold text-white px-0.5">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[9px] leading-tight font-medium truncate w-full text-center">
        {label}
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  const pendingCount = useAppStore((s) => s.pendingDecisions.length);

  const [moreOpen, setMoreOpen] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_MORE_KEY) === 'true'; } catch { return false; }
  });

  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    try { localStorage.setItem(SIDEBAR_MORE_KEY, String(next)); } catch { /* noop */ }
  };

  return (
    <nav data-tour="sidebar" className="w-[66px] border-r border-th-border flex flex-col items-center py-3 gap-0.5 shrink-0">
      {/* Primary nav */}
      {primaryLinks.map(({ to, icon, label }) => (
        <NavItem
          key={to}
          to={to}
          icon={icon}
          label={label}
          end={to === '/' || to === '/agents'}
          badge={
            to === '/tasks' ? (pendingCount > 0 ? pendingCount : null) :
            null
          }
        />
      ))}

      {/* ··· More section */}
      <button
        onClick={toggleMore}
        className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors w-[58px] text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50"
        aria-label={moreOpen ? 'Collapse more items' : 'Expand more items'}
        data-testid="sidebar-more-toggle"
      >
        {moreOpen ? <ChevronDown size={16} /> : <MoreHorizontal size={16} />}
        <span className="text-[9px] leading-tight font-medium">More</span>
      </button>

      {moreOpen && moreLinks.map(({ to, icon, label }) => (
        <NavItem key={to} to={to} icon={icon} label={label} />
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings at bottom */}
      <NavItem to="/settings" icon={Settings} label="Settings" />
    </nav>
  );
}
