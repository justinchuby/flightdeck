import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';

interface Tab {
  icon: string;
  label: string;
  route: string;
  badge?: number;
}

/**
 * 5-tab bottom navigation bar for mobile screens.
 * Hidden on desktop (md:hidden). Includes a "More" sheet
 * for additional navigation items that don't fit in the tab bar.
 */
export function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingCount = useAppStore(s => s.pendingDecisions.length);
  const [showMore, setShowMore] = useState(false);

  const tabs: Tab[] = [
    { icon: '🏠', label: 'Home', route: '/overview' },
    { icon: '📋', label: 'Tasks', route: '/tasks' },
    { icon: '👥', label: 'Crews', route: '/crews' },
    { icon: '📊', label: 'Timeline', route: '/timeline' },
  ];

  const isActive = (route: string) =>
    location.pathname === route || location.pathname.startsWith(route + '/');

  // Additional items in the "More" sheet
  const moreItems = [
    { icon: '⚙️', label: 'Canvas', route: '/canvas' },
    { icon: '📈', label: 'Analytics', route: '/analytics' },
    { icon: '💬', label: 'Groups', route: '/groups' },
    { icon: '⚙', label: 'Settings', route: '/settings' },
  ];

  return (
    <>
      {/* More sheet overlay */}
      {showMore && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute bottom-14 left-0 right-0 bg-th-bg border-t border-th-border rounded-t-xl p-4 motion-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-8 h-1 rounded-full bg-th-border mx-auto mb-3" />
            {moreItems.map(item => (
              <button
                key={item.route}
                onClick={() => { navigate(item.route); setShowMore(false); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-th-text hover:bg-th-bg-alt rounded-lg transition-colors"
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 h-14 bg-th-bg border-t border-th-border flex items-center justify-around md:hidden z-30 motion-slide-up"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        role="navigation"
        aria-label="Main navigation"
      >
        {tabs.map(tab => (
          <button
            key={tab.route}
            onClick={() => navigate(tab.route)}
            className={`flex flex-col items-center gap-0.5 relative ${
              isActive(tab.route) ? 'text-accent font-bold' : 'text-th-text-muted'
            }`}
            aria-current={isActive(tab.route) ? 'page' : undefined}
          >
            <span className="text-lg">{tab.icon}</span>
            <span className="text-[10px]">{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span className="absolute -top-1 right-0 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
        {/* Pending decisions badge on More button */}
        <button
          onClick={() => setShowMore(prev => !prev)}
          className={`flex flex-col items-center gap-0.5 relative ${
            showMore ? 'text-accent' : 'text-th-text-muted'
          }`}
        >
          <span className="text-lg">⋯</span>
          <span className="text-[10px]">More</span>
          {pendingCount > 0 && (
            <span className="absolute -top-1 right-0 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </button>
      </nav>
    </>
  );
}
