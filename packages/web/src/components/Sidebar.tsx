import { NavLink } from 'react-router-dom';
import { Users, Settings, Crown, Network, History, LayoutDashboard, MessageSquare, Database, GanttChart } from 'lucide-react';
import { Tooltip } from './Tooltip/Tooltip';

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
  return (
    <nav className="w-14 border-r border-gray-700 flex flex-col items-center py-3 gap-1 shrink-0">
      {links.map(({ to, icon: Icon, label }) => (
        <Tooltip key={to} content={label} placement="right">
          <NavLink
            to={to}
            end={to === '/' || to === '/agents'}
            className={({ isActive }: { isActive: boolean }) =>
              `p-2.5 rounded-lg transition-colors ${
                isActive
                  ? 'bg-accent/20 text-accent'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
              }`
            }
          >
            <Icon size={20} />
          </NavLink>
        </Tooltip>
      ))}
    </nav>
  );
}
