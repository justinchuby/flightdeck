import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

type CommandCategory = 'navigation' | 'action' | 'search';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: string;
  shortcut?: string;
  category: CommandCategory;
  action: () => void;
}

interface Props {
  onClose: () => void;
  /** Optional callback to open the full-text search dialog. */
  onOpenSearch?: () => void;
}

// ─── Category display labels ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  action: 'Actions',
  search: 'Search',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ onClose, onOpenSearch }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Commands ────────────────────────────────────────────────────────────────
  // Defined inside the component so they can close over navigate / onClose.

  const commands: Command[] = useMemo(
    () => [
      // Navigation — routes come from the <Routes> config in App.tsx
      {
        id: 'nav-lead',
        label: 'Go to Project Lead',
        icon: '👑',
        category: 'navigation',
        shortcut: 'G L',
        action: () => { navigate('/'); onClose(); },
      },
      {
        id: 'nav-overview',
        label: 'Go to Overview',
        icon: '📊',
        category: 'navigation',
        shortcut: 'G O',
        action: () => { navigate('/overview'); onClose(); },
      },
      {
        id: 'nav-agents',
        label: 'Go to Agents',
        icon: '🤖',
        category: 'navigation',
        shortcut: 'G A',
        action: () => { navigate('/agents'); onClose(); },
      },
      {
        id: 'nav-groups',
        label: 'Go to Group Chats',
        icon: '💬',
        category: 'navigation',
        shortcut: 'G G',
        action: () => { navigate('/groups'); onClose(); },
      },
      {
        id: 'nav-org',
        label: 'Go to Org Chart',
        icon: '🌐',
        category: 'navigation',
        shortcut: 'G C',
        action: () => { navigate('/org'); onClose(); },
      },
      {
        id: 'nav-tasks',
        label: 'Go to Task Queue',
        icon: '📋',
        category: 'navigation',
        shortcut: 'G T',
        action: () => { navigate('/tasks'); onClose(); },
      },
      {
        id: 'nav-data',
        label: 'Go to Data Browser',
        icon: '🗄️',
        category: 'navigation',
        shortcut: 'G D',
        action: () => { navigate('/data'); onClose(); },
      },
      {
        id: 'nav-timeline',
        label: 'Go to Timeline',
        icon: '📅',
        category: 'navigation',
        shortcut: 'G I',
        action: () => { navigate('/timeline'); onClose(); },
      },
      {
        id: 'nav-mission-control',
        label: 'Go to Mission Control',
        icon: '🚀',
        category: 'navigation',
        shortcut: 'G M',
        action: () => { navigate('/mission-control'); onClose(); },
      },
      {
        id: 'nav-settings',
        label: 'Go to Settings',
        icon: '⚙️',
        category: 'navigation',
        shortcut: 'G S',
        action: () => { navigate('/settings'); onClose(); },
      },

      // Actions
      {
        id: 'action-theme',
        label: 'Toggle Light / Dark Theme',
        icon: '🌗',
        category: 'action',
        action: () => {
          const isDark = document.documentElement.classList.contains('dark');
          document.documentElement.classList.toggle('dark', !isDark);
          document.documentElement.classList.toggle('light', isDark);
          localStorage.setItem('theme', isDark ? 'light' : 'dark');
          onClose();
        },
      },

      // Search
      ...(onOpenSearch
        ? [
            {
              id: 'search-history',
              label: 'Search Chat History…',
              description: 'Full-text search across messages, tasks, decisions',
              icon: '🔎',
              category: 'search' as CommandCategory,
              shortcut: '/',
              action: () => { onClose(); onOpenSearch(); },
            },
          ]
        : []),
    ],
    [navigate, onClose, onOpenSearch],
  );

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.category.includes(q),
    );
  }, [commands, query]);

  // ── Grouping ────────────────────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<CommandCategory, Command[]>();
    for (const cmd of filtered) {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return map;
  }, [filtered]);

  // ── Keyboard handling ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        filtered[selectedIndex]?.action();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selectedIndex, onClose]);

  // Reset selection to top whenever the query changes
  useEffect(() => { setSelectedIndex(0); }, [query]);

  // Scroll the selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Auto-focus the input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  // We track a flat index as we render grouped items so keyboard selection maps
  // correctly to visual position.
  let flatIdx = 0;

  return (
    // Backdrop — click outside to close
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg bg-th-bg-alt border border-th-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-th-border px-4 py-3">
          <span className="text-th-text-muted text-sm select-none" aria-hidden>⌘K</span>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-th-text placeholder-th-text-muted outline-none text-sm"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Command search"
            aria-autocomplete="list"
          />
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2" role="listbox">
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-th-text-muted">
              No matching commands
            </p>
          )}

          {[...grouped.entries()].map(([category, cmds]) => (
            <div key={category} role="group" aria-label={CATEGORY_LABELS[category]}>
              {/* Category header */}
              <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-th-text-muted select-none">
                {CATEGORY_LABELS[category]}
              </div>

              {cmds.map((cmd) => {
                const myIdx = flatIdx++;
                const isSelected = myIdx === selectedIndex;

                return (
                  <button
                    key={cmd.id}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      isSelected
                        ? 'bg-accent/20 text-accent'
                        : 'text-th-text hover:bg-th-bg-muted'
                    }`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(myIdx)}
                  >
                    <span className="text-base w-6 text-center shrink-0" aria-hidden>
                      {cmd.icon}
                    </span>
                    <span className="flex-1 font-medium text-sm">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-th-bg-muted text-th-text-muted border border-th-border-muted shrink-0">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div className="border-t border-th-border px-4 py-2 flex gap-4 text-[10px] text-th-text-muted select-none">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
