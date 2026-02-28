import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Menu,
  X,
  Crown,
  LayoutDashboard,
  History,
  Users,
  MessageSquare,
  Network,
  Database,
  GanttChart,
  Activity,
  Settings,
} from 'lucide-react';

// ── Nav link definitions (mirrors Sidebar) ─────────────────────────────────
const links = [
  { to: '/', icon: Crown, label: 'Project Lead' },
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/tasks', icon: History, label: 'Tasks' },
  { to: '/agents', icon: Users, label: 'Agents' },
  { to: '/groups', icon: MessageSquare, label: 'Group Chats' },
  { to: '/org', icon: Network, label: 'Org Chart' },
  { to: '/data', icon: Database, label: 'Database' },
  { to: '/timeline', icon: GanttChart, label: 'Timeline' },
  { to: '/mission-control', icon: Activity, label: 'Mission Control' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

// ── MobileNav ──────────────────────────────────────────────────────────────
/**
 * Hamburger button + slide-out navigation panel for mobile screens.
 * Visible only on screens narrower than the `md` breakpoint (< 768 px).
 * Uses th-* theme tokens so it respects light/dark mode.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close panel on ESC key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Prevent body scroll while panel is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — hidden on md+ screens */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-th-bg border border-th-border text-th-text shadow-sm hover:bg-th-bg-hover transition-colors"
        onClick={() => setOpen(prev => !prev)}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Slide-out panel */}
      <nav
        id="mobile-nav-panel"
        aria-label="Mobile navigation"
        className={[
          'md:hidden fixed top-0 left-0 z-40 h-full w-64',
          'bg-th-bg border-r border-th-border shadow-xl',
          'flex flex-col pt-16 pb-6 overflow-y-auto',
          open ? 'mobile-sidebar-visible' : 'mobile-sidebar-hidden',
        ].join(' ')}
      >
        <ul className="flex flex-col gap-1 px-3">
          {links.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/' || to === '/agents'}
                onClick={close}
                className={({ isActive }: { isActive: boolean }) =>
                  [
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent/20 text-accent'
                      : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted/50',
                  ].join(' ')
                }
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
