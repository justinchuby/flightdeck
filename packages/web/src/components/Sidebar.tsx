import { NavLink } from 'react-router-dom';
import { Users, Settings, Crown, Network } from 'lucide-react';

const links = [
  { to: '/', icon: Crown, label: 'Project Lead' },
  { to: '/agents', icon: Users, label: 'Agents' },
  { to: '/org', icon: Network, label: 'Org Chart' },
  { to: '/tasks', icon: Network, label: 'Sessions' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <nav className="w-14 border-r border-gray-700 flex flex-col items-center py-3 gap-1 shrink-0">
      {links.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/' || to === '/agents'}
          className={({ isActive }: { isActive: boolean }) =>
            `p-2.5 rounded-lg transition-colors ${
              isActive
                ? 'bg-accent/20 text-accent'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
            }`
          }
          title={label}
        >
          <Icon size={20} />
        </NavLink>
      ))}
    </nav>
  );
}
