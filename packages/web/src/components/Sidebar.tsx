import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, FolderOpen, Users, Settings, Plus } from 'lucide-react';
import { NewProjectModal } from './LeadDashboard/NewProjectModal';
import { SubmitIssueButton } from './ProvideFeedback';

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
          <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white px-0.5">
            {badge}
          </span>
        )}
      </div>
      <span className="text-[11px] leading-tight font-medium truncate w-full text-center" title={label}>
        {label}
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  const [showNewProject, setShowNewProject] = useState(false);

  return (
    <nav data-tour="sidebar" className="w-[66px] border-r border-th-border flex flex-col items-center py-3 gap-1 shrink-0">
      <NavItem to="/" icon={Home} label="Home" end />
      <NavItem to="/projects" icon={FolderOpen} label="Projects" />
      <NavItem to="/crews" icon={Users} label="Crews" />

      <button
        onClick={() => setShowNewProject(true)}
        className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg w-[58px] transition-colors text-th-text-muted hover:text-accent hover:bg-accent/10"
        title="New Project"
        data-testid="sidebar-new-project"
      >
        <Plus size={16} />
        <span className="text-[10px] leading-tight font-medium">New</span>
      </button>

      <div className="flex-1" />
      <SubmitIssueButton />
      <NavItem to="/settings" icon={Settings} label="Settings" />

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </nav>
  );
}
