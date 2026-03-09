import { useMemo, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { Home, FolderOpen, Users, Settings, ArrowLeft, Plus } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useProjects } from '../hooks/useProjects';
import { NewProjectModal } from './LeadDashboard/NewProjectModal';

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
  const agents = useAppStore((s) => s.agents);
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [showNewProject, setShowNewProject] = useState(false);

  // Detect project context from URL
  const projectMatch = useMatch('/projects/:id/*');
  const activeProjectId = projectMatch?.params.id ?? null;

  const projectName = useMemo(() => {
    if (!activeProjectId) return null;
    const lead = agents.find(
      (a) => a.role?.id === 'lead' && !a.parentId && (a.projectId === activeProjectId || a.id === activeProjectId),
    );
    if (lead?.projectName) return lead.projectName;
    const proj = projects.find((p) => p.id === activeProjectId);
    if (proj?.name) return proj.name;
    return activeProjectId.slice(0, 12);
  }, [activeProjectId, agents, projects]);

  // Recent projects: sorted by updatedAt, max 5, exclude current
  const recentProjects = useMemo(() => {
    return [...projects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .filter((p) => p.id !== activeProjectId)
      .slice(0, 5);
  }, [projects, activeProjectId]);

  return (
    <nav data-tour="sidebar" className="w-[66px] border-r border-th-border flex flex-col items-center py-3 gap-1 shrink-0">
      {/* 1. Home */}
      <NavItem to="/" icon={Home} label="Home" end />

      {/* 2. Active Project or Projects list */}
      {activeProjectId && projectName ? (
        <NavLink
          to={`/projects/${activeProjectId}`}
          className={({ isActive }: { isActive: boolean }) =>
            `flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg w-[58px] transition-colors ${
              isActive
                ? 'bg-accent/20 text-accent'
                : 'text-accent/80 bg-accent/10 hover:bg-accent/20'
            }`
          }
          title={`Project: ${projectName}`}
          data-testid="sidebar-project-indicator"
        >
          <FolderOpen size={18} />
          <span className="text-[10px] leading-tight font-semibold truncate w-full text-center" aria-label={projectName}>
            {projectName}
          </span>
        </NavLink>
      ) : (
        <NavItem to="/projects" icon={FolderOpen} label="Projects" />
      )}

      {/* 3. Recent projects quick-access */}
      {recentProjects.length > 0 && (
        <div className="flex flex-col items-center gap-0.5 w-full px-1">
          <div className="w-10 border-t border-th-border/50 my-0.5" />
          {recentProjects.map((p) => (
            <NavLink
              key={p.id}
              to={`/projects/${p.id}`}
              className={({ isActive }: { isActive: boolean }) =>
                `w-[54px] px-1 py-1 rounded text-center transition-colors truncate ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-th-text-muted hover:text-th-text-alt hover:bg-th-bg-muted/50'
                }`
              }
              title={p.name}
            >
              <span className="text-[9px] leading-tight font-mono block truncate">{p.name}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* 4. + New Project */}
      <button
        onClick={() => setShowNewProject(true)}
        className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg w-[58px] transition-colors text-th-text-muted hover:text-accent hover:bg-accent/10"
        title="New Project"
        data-testid="sidebar-new-project"
      >
        <Plus size={16} />
        <span className="text-[10px] leading-tight font-medium">New</span>
      </button>

      {/* 5. Agents — project agent roster */}
      <NavItem to="/agents" icon={Users} label="Agents" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* 6. Settings — pinned to bottom */}
      <NavItem to="/settings" icon={Settings} label="Settings" />

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </nav>
  );
}
