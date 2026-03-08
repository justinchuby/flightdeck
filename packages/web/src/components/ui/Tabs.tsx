/**
 * Tabs — unified tab component for consistent tab UI across Flightdeck.
 *
 * Supports icons, count badges, and controlled/uncontrolled usage.
 * Replaces inline tab implementations in FocusPanel, DataBrowser,
 * TeamRoster, and TeamPage.
 */
import { type ReactNode } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface TabItem {
  /** Unique tab identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon element (e.g., lucide-react component rendered as JSX) */
  icon?: ReactNode;
  /** Optional count badge displayed after the label */
  count?: number;
}

export interface TabsProps {
  /** Tab definitions */
  tabs: TabItem[];
  /** Currently active tab ID */
  activeTab: string;
  /** Called when user selects a tab */
  onTabChange: (tabId: string) => void;
  /** Size variant. Default 'md'. */
  size?: 'sm' | 'md';
  /** Additional className for the container */
  className?: string;
}

// ── Styles ──────────────────────────────────────────────────────────

const SIZE_CLASSES = {
  sm: 'px-3 py-2 text-[11px] gap-1',
  md: 'px-3 py-2 text-sm gap-1.5',
} as const;

// ── Component ───────────────────────────────────────────────────────

export function Tabs({ tabs, activeTab, onTabChange, size = 'md', className = '' }: TabsProps) {
  return (
    <div
      className={`flex border-b border-th-border ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center ${SIZE_CLASSES[size]} transition-colors border-b-2 ${
              isActive
                ? 'border-accent text-accent'
                : 'border-transparent text-th-text-muted hover:text-th-text'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.icon}
            {tab.label}
            {tab.count != null && (
              <span className="text-[10px] bg-th-bg-alt text-th-text-muted px-1.5 py-0.5 rounded-full ml-1">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
