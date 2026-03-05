import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────

export interface PanelConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
}

// ── Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'health',     label: 'Health Summary',  visible: true,  order: 0 },
  { id: 'fleet',      label: 'Agent Fleet',      visible: true,  order: 1 },
  { id: 'tokens',     label: 'Token Economics',  visible: true,  order: 2 },
  { id: 'alerts',     label: 'Alerts',           visible: true,  order: 3 },
  { id: 'activity',   label: 'Activity Feed',    visible: true,  order: 4 },
  { id: 'dag',        label: 'DAG Minimap',      visible: true,  order: 5 },
  { id: 'heatmap',    label: 'Comm Heatmap',     visible: false, order: 6 },
  { id: 'costs',      label: 'Cost Breakdown',   visible: false, order: 7 },
  { id: 'timers',     label: 'Agent Timers',     visible: false, order: 8 },
  { id: 'scorecards', label: 'Performance',      visible: false, order: 9 },
  { id: 'commflow',   label: 'Comm Flow Graph',  visible: true,  order: 10 },
  { id: 'diff',       label: 'Live Diffs',        visible: true,  order: 11 },
];

const STORAGE_KEY = 'dashboard-layout';

// ── Hook ──────────────────────────────────────────────────────────────

export function useDashboardLayout() {
  const [panels, setPanels] = useState<PanelConfig[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PanelConfig[];
        // Merge with defaults to pick up any new panels added since last save
        const savedIds = new Set(parsed.map((p) => p.id));
        const merged = [...parsed];
        for (const def of DEFAULT_PANELS) {
          if (!savedIds.has(def.id)) merged.push(def);
        }
        return merged;
      }
      return DEFAULT_PANELS;
    } catch {
      return DEFAULT_PANELS;
    }
  });

  // Persist on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
  }, [panels]);

  const togglePanel = (id: string) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)),
    );
  };

  const movePanel = (id: string, direction: 'up' | 'down') => {
    setPanels((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((p) => p.id === id);
      if (idx === -1) return prev;

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;

      // Swap orders
      const a = sorted[idx];
      const b = sorted[swapIdx];
      return prev.map((p) => {
        if (p.id === a.id) return { ...p, order: b.order };
        if (p.id === b.id) return { ...p, order: a.order };
        return p;
      });
    });
  };

  /** Reorder: move `dragId` to the position of `targetId` */
  const reorderPanels = (dragId: string, targetId: string) => {
    setPanels((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const dragIdx = sorted.findIndex((p) => p.id === dragId);
      const targetIdx = sorted.findIndex((p) => p.id === targetId);
      if (dragIdx === -1 || targetIdx === -1 || dragIdx === targetIdx) return prev;

      // Remove dragged item and insert at target position
      const item = sorted.splice(dragIdx, 1)[0];
      sorted.splice(targetIdx, 0, item);

      // Re-assign sequential order values
      return sorted.map((p, i) => ({ ...p, order: i }));
    });
  };

  const reset = () => {
    setPanels(DEFAULT_PANELS);
  };

  return {
    /** Visible panels sorted by order — ready to render */
    panels: panels.filter((p) => p.visible).sort((a, b) => a.order - b.order),
    /** All panels including hidden — for the configurator UI */
    allPanels: [...panels].sort((a, b) => a.order - b.order),
    togglePanel,
    movePanel,
    reorderPanels,
    reset,
  };
}
