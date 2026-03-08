/**
 * Breadcrumb — navigation trail showing current location.
 *
 * Renders: Home > Project Name > Tab
 * Each segment is clickable for navigation.
 * Reads from navigationStore for project/tab context.
 */
import { ChevronRight, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNavigationStore } from '../../stores/navigationStore';
import { TAB_LABELS } from '../../utils/tabLabels';

interface BreadcrumbSegment {
  label: string;
  path: string;
  icon?: React.ReactNode;
}

export function Breadcrumb() {
  const navigate = useNavigate();
  const projectId = useNavigationStore((s) => s.currentProjectId);
  const projectName = useNavigationStore((s) => s.currentProjectName);
  const activeTab = useNavigationStore((s) => s.activeTab);

  // Build segments
  const segments: BreadcrumbSegment[] = [
    { label: 'Home', path: '/', icon: <Home size={12} /> },
  ];

  if (projectId) {
    segments.push({
      label: projectName || projectId.slice(0, 8),
      path: `/projects/${projectId}/overview`,
    });

    if (activeTab && activeTab !== 'overview') {
      segments.push({
        label: TAB_LABELS[activeTab] ?? activeTab,
        path: `/projects/${projectId}/${activeTab}`,
      });
    }
  }

  // Don't render breadcrumb if we're just at Home
  if (segments.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 px-4 py-1.5 text-xs text-th-text-muted bg-th-bg border-b border-th-border shrink-0"
      data-testid="breadcrumb"
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={seg.path} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={10} className="text-th-text-muted/50" />}
            {isLast ? (
              <span
                className="text-th-text-alt font-medium flex items-center gap-1"
                aria-current="page"
              >
                {seg.icon}
                {seg.label}
              </span>
            ) : (
              <button
                onClick={() => navigate(seg.path)}
                className="hover:text-th-text hover:underline underline-offset-2 transition-colors flex items-center gap-1"
              >
                {seg.icon}
                {seg.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
