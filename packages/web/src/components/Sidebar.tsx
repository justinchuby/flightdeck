import { NavLink, useLocation } from 'react-router-dom';
import { Users, Settings, Crown, Network, History, LayoutDashboard, MessageSquare, Database, GanttChart } from 'lucide-react';
import { Tooltip } from './Tooltip/Tooltip';
import { useGroupStore } from '../stores/groupStore';
import { useEffect, useMemo } from 'react';

const links = [
  { to: '/', icon: Crown, label: 'Project Lead' },
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/tasks', icon: History, label: 'Tasks' },
  { to: '/agents', icon: Users, label: 'Agents' },
  { to: '/groups', icon: MessageSquare, label: 'Group Chats' },
  { to: '/org', icon: Network, label: 'Org Chart' },
  { to: '/data', icon: Database, label: 'Database' },
  { to: '/timeline', icon: GanttChart, label: 'Timeline' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const location = useLocation();
  const messages = useGroupStore((s) => s.messages);
  const lastSeen = useGroupStore((s) => s.lastSeenTimestamps);
  const markAllSeen = useGroupStore((s) => s.markAllSeen);

  // Mark all groups seen when user is on /groups
  useEffect(() => {
    if (location.pathname.startsWith('/groups')) markAllSeen();
  }, [location.pathname, messages, markAllSeen]);

  const unreadCount = useMemo(() => {
    let count = 0;
    for (const [key, msgs] of Object.entries(messages)) {
      const seen = lastSeen[key];
      if (!seen) { count += msgs.length; continue; }
      count += msgs.filter((m) => m.timestamp > seen).length;
    }
    return count;
  }, [messages, lastSeen]);

  return (
    <nav className="w-14 border-r border-gray-700 flex flex-col items-center py-3 gap-1 shrink-0">
      {links.map(({ to, icon: Icon, label }) => (
        <Tooltip key={to} content={label} placement="right">
          <NavLink
            to={to}
            end={to === '/' || to === '/agents'}
            className={({ isActive }: { isActive: boolean }) =>
              `relative p-2.5 rounded-lg transition-colors ${
                isActive
                  ? 'bg-accent/20 text-accent'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
              }`
            }
          >
            <Icon size={20} />
            {to === '/groups' && unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-blue-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        </Tooltip>
      ))}
    </nav>
  );
}
