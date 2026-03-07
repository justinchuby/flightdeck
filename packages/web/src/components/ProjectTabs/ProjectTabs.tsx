import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjects } from '../../hooks/useProjects';

// ── Types ─────────────────────────────────────────────────────────────

interface ProjectTabsProps {
  /** Currently active project/lead ID */
  activeId: string | null;
  /** Callback when user selects a different project */
  onChange: (id: string) => void;
  /** Optional className for the nav container */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Shared horizontal tab bar for project selection.
 * Shows live lead agents first, falls back to historical projects from REST API.
 * A green dot indicates the currently active/live project.
 */
export function ProjectTabs({ activeId, onChange, className }: ProjectTabsProps) {
  const liveAgents = useAppStore((s) => s.agents);
  const { projects } = useProjects();

  // Live lead agents (root leads only)
  const leads = useMemo(
    () => liveAgents.filter((a) => a.role?.id === 'lead' && !a.parentId),
    [liveAgents],
  );

  // Build unified tab list: live leads first, then historical projects (excluding dups).
  // Use lead.projectId (project registry UUID) as the tab ID when available so that
  // replay fetches match the projectId stored in activity events.
  const tabs = useMemo(() => {
    const items: Array<{ id: string; label: string; isLive: boolean }> = [];
    const seen = new Set<string>();

    for (const lead of leads) {
      const tabId = lead.projectId || lead.id;
      seen.add(tabId);
      // Track agent ID too so historical projects keyed by agent UUID are also deduped
      seen.add(lead.id);
      const active = lead.status === 'running' || lead.status === 'creating' || lead.status === 'idle';
      items.push({
        id: tabId,
        label: lead.projectName || lead.role?.name || lead.id.slice(0, 8),
        isLive: active,
      });
    }

    for (const proj of projects) {
      if (!seen.has(proj.id)) {
        items.push({
          id: proj.id,
          label: proj.name || proj.id.slice(0, 8),
          isLive: false,
        });
      }
    }

    return items;
  }, [leads, projects]);

  // Auto-select first tab when nothing is selected or selection is stale
  useEffect(() => {
    if (tabs.length === 0) return;
    if (!activeId || !tabs.some((t) => t.id === activeId)) {
      onChange(tabs[0].id);
    }
  }, [activeId, tabs, onChange]);

  if (tabs.length === 0) return null;

  return (
    <nav
      className={`flex items-center gap-1 overflow-x-auto ${className ?? ''}`}
      role="tablist"
      aria-label="Project selection"
      data-testid="project-tabs"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          aria-selected={activeId === tab.id}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs whitespace-nowrap transition-colors border-b-2 -mb-px ${
            activeId === tab.id
              ? 'border-accent text-accent font-medium bg-th-bg'
              : 'border-transparent text-th-text-muted hover:text-th-text hover:border-th-border'
          }`}
        >
          {tab.isLive && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" title="Live session" />
          )}
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
