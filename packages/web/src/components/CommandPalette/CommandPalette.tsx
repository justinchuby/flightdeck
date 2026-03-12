import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  PaletteSearchEngine,
  type PaletteItem,
  type PaletteItemType,
} from '../../services/PaletteSearchEngine';
import { generateSuggestions } from '../../services/PaletteSuggestionEngine';
import { getNLPaletteItems, type NLPattern } from '../../services/NLCommandRegistry';
import { apiFetch } from '../../hooks/useApi';
import { useRecentCommands } from '../../hooks/useRecentCommands';
import { shortAgentId } from '../../utils/agentLabel';
import { PreviewPanel, buildPreviewData } from './PreviewPanel';
import type { AgentInfo, DagStatus } from '../../types';

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onOpenSearch?: () => void;
}

// ── Item builders ───────────────────────────────────────────────────────────

function buildNavigationItems(
  navigate: (path: string) => void,
  onClose: () => void,
): PaletteItem[] {
  const routes = [
    { path: '/', label: 'Go to Project Lead', icon: '👑', shortcut: 'G L', keywords: ['lead', 'chat', 'home'] },
    { path: '/overview', label: 'Go to Overview', icon: '📊', shortcut: 'G O', keywords: ['overview', 'dashboard', 'summary'] },
    { path: '/crews', label: 'Go to Crews', icon: '👥', shortcut: 'G A', keywords: ['agents', 'fleet', 'crew', 'crews'] },
    { path: '/groups', label: 'Go to Group Chats', icon: '💬', shortcut: 'G G', keywords: ['groups', 'chat', 'collaboration'] },
    { path: '/org', label: 'Go to Org Chart', icon: '🌐', shortcut: 'G C', keywords: ['org', 'hierarchy', 'chart'] },
    { path: '/tasks', label: 'Go to Task Queue', icon: '📋', shortcut: 'G T', keywords: ['tasks', 'dag', 'queue'] },
    { path: '/data', label: 'Go to Data Browser', icon: '🗄️', shortcut: 'G D', keywords: ['data', 'database', 'browser'] },
    { path: '/timeline', label: 'Go to Timeline', icon: '📅', shortcut: 'G I', keywords: ['timeline', 'history', 'events'] },
    { path: '/mission-control', label: 'Go to Mission Control', icon: '🚀', shortcut: 'G M', keywords: ['mission', 'control', 'dashboard'] },
    { path: '/canvas', label: 'Go to Canvas', icon: '🎨', shortcut: 'G V', keywords: ['canvas', 'flow', 'graph', 'visual'] },
    { path: '/analytics', label: 'Go to Analytics', icon: '📈', shortcut: 'G N', keywords: ['analytics', 'cost', 'metrics'] },
    { path: '/settings', label: 'Go to Settings', icon: '⚙️', shortcut: 'G S', keywords: ['settings', 'preferences', 'config'] },
  ];

  return routes.map((r) => ({
    id: `nav-${r.path}`,
    type: 'navigation' as PaletteItemType,
    label: r.label,
    description: `Navigate to ${r.label.replace('Go to ', '')}`,
    icon: r.icon,
    keywords: r.keywords,
    shortcut: r.shortcut,
    action: () => {
      navigate(r.path);
      onClose();
    },
  }));
}

function buildAgentItems(
  agents: AgentInfo[],
  navigate: (p: string) => void,
  onClose: () => void,
): PaletteItem[] {
  return agents.map((a) => ({
    id: `agent-${a.id}`,
    type: 'agent' as PaletteItemType,
    label: `${a.role?.name ?? 'Agent'} — ${a.task ?? a.status}`,
    description: `${a.status}${a.task ? ` · ${a.task}` : ''}`,
    icon: a.role?.name === 'Lead' ? '👑' : '🤖',
    keywords: [a.role?.name ?? '', a.role?.id ?? '', shortAgentId(a.id), a.status],
    action: () => {
      navigate(`/crews?focus=${a.id}`);
      onClose();
    },
    badge: a.status === 'running' ? '● running' : undefined,
    agentId: a.id,
  }));
}

function buildTaskItems(
  dagStatus: DagStatus | null | undefined,
  onClose: () => void,
): PaletteItem[] {
  if (!dagStatus?.tasks) return [];
  return dagStatus.tasks.slice(0, 20).map((t) => ({
    id: `task-${t.id}`,
    type: 'task' as PaletteItemType,
    label: t.title ?? t.id,
    description: `Status: ${t.dagStatus ?? 'pending'}${t.assignedAgentId ? ` · ${t.assignedAgentId}` : ''}`,
    icon:
      t.dagStatus === 'done' ? '✅' : t.dagStatus === 'running' ? '🔄' : '📋',
    keywords: [t.id, t.title ?? '', t.dagStatus ?? '', t.assignedAgentId ?? ''],
    action: () => {
      onClose();
    },
  }));
}

function buildActionItems(
  onClose: () => void,
  setApprovalQueueOpen: (o: boolean) => void,
): PaletteItem[] {
  return [
    {
      id: 'action-theme',
      type: 'action' as PaletteItemType,
      label: 'Toggle Light / Dark Theme',
      description: 'Switch between light and dark mode',
      icon: '🌗',
      keywords: ['theme', 'dark', 'light', 'mode'],
      action: () => {
        const store = useSettingsStore.getState();
        store.setThemeMode(store.resolvedTheme === 'dark' ? 'light' : 'dark');
        onClose();
      },
    },
    {
      id: 'action-export',
      type: 'action' as PaletteItemType,
      label: 'Export Session',
      description: 'Export current project session to disk',
      icon: '📦',
      keywords: ['export', 'save', 'download', 'session'],
      action: async () => {
        const leadId = useLeadStore.getState().selectedLeadId;
        if (!leadId || leadId.startsWith('project:')) {
          alert('Select an active project first');
          onClose();
          return;
        }
        onClose();
        try {
          const res = await fetch(`/api/export/${leadId}`);
          const data = await res.json();
          if (data.error) alert(`Export failed: ${data.error}`);
          else
            alert(
              `Session exported to:\n${data.outputDir}\n\n${data.files.length} files`,
            );
        } catch {
          alert('Export failed — server may be unavailable');
        }
      },
    },
    {
      id: 'action-approvals',
      type: 'action' as PaletteItemType,
      label: 'Open Approval Queue',
      description: 'Review pending decisions',
      icon: '🎯',
      keywords: ['approve', 'approval', 'decisions', 'review', 'pending'],
      action: () => {
        setApprovalQueueOpen(true);
        onClose();
      },
    },
  ];
}

function buildSettingItems(
  navigate: (p: string) => void,
  onClose: () => void,
): PaletteItem[] {
  const settings = [
    {
      id: 'setting-notifications',
      label: 'Notification Preferences',
      description: 'Configure notification channels',
      keywords: ['notifications', 'alerts', 'channels'],
    },
    {
      id: 'setting-model',
      label: 'Model Configuration',
      description: 'Agent model settings',
      keywords: ['model', 'llm', 'ai', 'gpt', 'claude'],
    },
  ];
  return settings.map((s) => ({
    ...s,
    type: 'setting' as PaletteItemType,
    icon: '⚙',
    action: () => {
      navigate('/settings');
      onClose();
    },
  }));
}

// ── Main Component ──────────────────────────────────────────────────────────

export function CommandPalette({ onClose, onOpenSearch }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Store selectors (granular) ──────────────────────────────────────────
  const agents = useAppStore((s) => s.agents);
  const pendingDecisions = useAppStore((s) => s.pendingDecisions);
  const setApprovalQueueOpen = useAppStore((s) => s.setApprovalQueueOpen);

  // leadStore uses `projects` (not `projectStates`)
  const dagStatus = useLeadStore(
    (s) => s.projects[s.selectedLeadId ?? '']?.dagStatus,
  );

  const { recent, addRecent } = useRecentCommands();

  // ── Search engine (singleton for this mount) ────────────────────────────
  const engine = useMemo(() => new PaletteSearchEngine(), []);

  // ── Build all palette items from live state ─────────────────────────────
  const allItems = useMemo(() => {
    const navItems = buildNavigationItems(navigate, onClose);
    const agentItems = buildAgentItems(agents, navigate, onClose);
    const taskItems = buildTaskItems(dagStatus, onClose);
    const actionItems = buildActionItems(onClose, setApprovalQueueOpen);
    const settingItems = buildSettingItems(navigate, onClose);

    // NL commands — execute via backend
    const nlItems = getNLPaletteItems(async (pattern: NLPattern) => {
      try {
        await apiFetch('/nl/execute', {
          method: 'POST',
          body: JSON.stringify({ commandId: pattern.id, input: pattern.phrases[0] }),
        });
      } catch {}
      onClose();
    });

    // Context-aware suggestions
    const rawSuggestions = generateSuggestions({
      agents,
      pendingDecisions,
      dagTasks: dagStatus?.tasks,
    });
    const suggestionItems: PaletteItem[] = rawSuggestions.map((s) => ({
      id: s.id,
      type: 'suggestion' as PaletteItemType,
      label: s.label,
      description: s.description,
      icon: s.icon,
      keywords: [],
      score: s.score,
      action: () => {
        if (s.actionType === 'open-approvals') setApprovalQueueOpen(true);
        else if (s.actionType === 'view-agents') navigate('/crews');
        else if (s.actionType === 'export') navigate('/settings');
        onClose();
      },
    }));

    // Recent commands
    const recentItems: PaletteItem[] = recent.slice(0, 5).map((r) => ({
      id: `recent-${r.id}`,
      type: 'recent' as PaletteItemType,
      label: r.label,
      description: 'Recently used',
      icon: r.icon,
      keywords: [],
      action: () => {
        // Find the actual item and execute its action
        const actual = [...navItems, ...actionItems, ...settingItems].find(
          (i) => i.id === r.id,
        );
        actual?.action();
      },
    }));

    // Search item (if onOpenSearch provided)
    const searchItems: PaletteItem[] = onOpenSearch
      ? [
          {
            id: 'search-history',
            type: 'action' as PaletteItemType,
            label: 'Search Chat History…',
            description: 'Full-text search across messages, tasks, decisions',
            icon: '🔎',
            keywords: ['search', 'find', 'history', 'messages'],
            shortcut: '/',
            action: () => {
              onClose();
              onOpenSearch();
            },
          },
        ]
      : [];

    return [
      ...suggestionItems,
      ...recentItems,
      ...navItems,
      ...agentItems,
      ...taskItems,
      ...actionItems,
      ...settingItems,
      ...nlItems,
      ...searchItems,
    ];
  }, [
    agents,
    pendingDecisions,
    dagStatus,
    navigate,
    onClose,
    onOpenSearch,
    setApprovalQueueOpen,
    recent,
  ]);

  // Update Fuse index whenever items change
  useEffect(() => {
    engine.updateItems(allItems);
  }, [engine, allItems]);

  // ── Search & grouping ───────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query.trim()) return allItems;
    return engine.search(query);
  }, [query, engine, allItems]);

  const grouped = useMemo(() => {
    if (!query.trim()) return PaletteSearchEngine.groupAll(results);
    return PaletteSearchEngine.groupResults(results);
  }, [results, query]);

  // Flat list for keyboard navigation
  const flatResults = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped],
  );

  const selectedItem = flatResults[selectedIndex] ?? null;

  // Preview data for selected item
  const previewData = useMemo(() => {
    if (!selectedItem || !showPreview) return null;
    return buildPreviewData(selectedItem, agents);
  }, [selectedItem, showPreview, agents]);

  // ── Execute selected item ───────────────────────────────────────────────
  const executeSelected = useCallback(() => {
    if (selectedItem) {
      addRecent(selectedItem.id, selectedItem.label, selectedItem.icon);
      selectedItem.action();
    }
  }, [selectedItem, addRecent]);

  // ── Keyboard handling ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeSelected();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setShowPreview((p) => !p);
      } else if (e.key === 'Escape') {
        if (query) setQuery('');
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flatResults, executeSelected, onClose, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(
      '[data-selected="true"]',
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────
  // Track a flat index as we render grouped items so keyboard selection maps
  // correctly to visual position.
  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-[640px] bg-th-bg-alt border border-th-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-th-border px-4 py-3">
          <span className="text-th-text-muted text-sm select-none" aria-hidden>
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-th-text placeholder-th-text-muted outline-none text-lg"
            placeholder="Type a command, search, or ask..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Command search"
            aria-autocomplete="list"
            role="combobox"
            aria-expanded="true"
            aria-activedescendant={
              selectedItem ? `palette-item-${selectedItem.id}` : undefined
            }
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-th-bg-muted text-th-text-muted border border-th-border-muted shrink-0">
            ⌘K
          </kbd>
        </div>

        {/* Content area: results + optional preview */}
        <div className="flex flex-1 min-h-0">
          {/* Results list */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto py-2"
            role="listbox"
          >
            {flatResults.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-th-text-muted">
                No matching commands
              </p>
            )}

            {grouped.map((group) => (
              <div
                key={group.type}
                role="group"
                aria-label={group.label}
              >
                <div
                  className={`px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest select-none ${
                    group.type === 'suggestion'
                      ? 'text-amber-500'
                      : 'text-th-text-muted'
                  }`}
                >
                  {group.label}
                </div>

                {group.items.map((item) => {
                  const myIdx = flatIdx++;
                  const isSelected = myIdx === selectedIndex;

                  return (
                    <button
                      key={item.id}
                      id={`palette-item-${item.id}`}
                      role="option"
                      aria-selected={isSelected}
                      data-selected={isSelected}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-accent/20 text-accent'
                          : 'text-th-text hover:bg-th-bg-muted'
                      }`}
                      onClick={() => {
                        addRecent(item.id, item.label, item.icon);
                        item.action();
                      }}
                      onMouseEnter={() => setSelectedIndex(myIdx)}
                    >
                      <span
                        className="text-base w-6 text-center shrink-0"
                        aria-hidden
                      >
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {item.label}
                        </div>
                        {item.description && item.type !== 'recent' && (
                          <div className="text-[11px] text-th-text-muted truncate">
                            {item.description}
                          </div>
                        )}
                      </div>
                      {item.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 shrink-0">
                          {item.badge}
                        </span>
                      )}
                      {item.shortcut && (
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-th-bg-muted text-th-text-muted border border-th-border-muted shrink-0">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}

                {query.trim() && group.total > group.items.length && (
                  <button className="w-full px-4 py-1.5 text-[11px] text-accent hover:text-accent/80 text-left">
                    Show all {group.total} results…
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Preview panel */}
          {showPreview && previewData && <PreviewPanel data={previewData} />}
        </div>

        {/* Footer hints */}
        <div className="border-t border-th-border px-4 py-2 flex gap-4 text-[10px] text-th-text-muted select-none">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>⇥ Preview</span>
          <span>esc Close</span>
        </div>
      </div>
    </div>
  );
}
