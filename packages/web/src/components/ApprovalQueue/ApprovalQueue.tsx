import { useState, useMemo, useCallback, useEffect } from 'react';
import { Check, X, ChevronDown, ChevronRight, Clock, EyeOff, Eye } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { useSettingsStore, type OversightLevel } from '../../stores/settingsStore';
import { useToastStore } from '../Toast';
import { apiFetch } from '../../hooks/useApi';
import { categoryLabel } from '../../constants/categories';
import type { Decision } from '../../types';

const OVERSIGHT_HINT_OPTIONS: Array<{ level: OversightLevel; label: string; description: string }> = [
  { level: 'supervised', label: '🔍 Supervised', description: 'Review all agent actions' },
  { level: 'balanced', label: '⚖️ Balanced', description: 'Review key decisions only' },
  { level: 'autonomous', label: '🚀 Autonomous', description: 'Agents work autonomously' },
];

// ── Urgency helpers ──────────────────────────────────────────────────

function urgencyLevel(timestamp: string): 'normal' | 'warning' | 'critical' {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  if (ageMs > 50_000) return 'critical';
  if (ageMs > 30_000) return 'warning';
  return 'normal';
}

function urgencyBorder(level: 'normal' | 'warning' | 'critical'): string {
  if (level === 'critical') return 'border-l-red-500';
  if (level === 'warning') return 'border-l-yellow-500';
  return 'border-l-transparent';
}

function ageLabel(timestamp: string): string {
  const ageSeconds = Math.round((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  return `${Math.round(ageSeconds / 60)}m ago`;
}

// ── Component ────────────────────────────────────────────────────────

export function ApprovalQueue() {
  const pendingDecisions = useAppStore((s) => s.pendingDecisions);
  const addToast = useToastStore((s) => s.add);
  const oversightLevel = useSettingsStore((s) => s.oversightLevel);
  const setOversightLevel = useSettingsStore((s) => s.setOversightLevel);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [showOversightPicker, setShowOversightPicker] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'a' && !e.metaKey && !e.ctrlKey) {
        // 'a' to approve selected
        if (selectedIds.size > 0) {
          e.preventDefault();
          batchResolve('confirm');
        }
      } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        // 'r' to reject selected
        if (selectedIds.size > 0) {
          e.preventDefault();
          batchResolve('reject');
        }
      } else if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        // 'd' to dismiss selected
        if (selectedIds.size > 0) {
          e.preventDefault();
          batchResolve('dismiss');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds]);

  // Group decisions by category
  const grouped = useMemo(() => {
    const groups = new Map<string, Decision[]>();
    for (const decision of pendingDecisions) {
      const cat = decision.category ?? 'general';
      const existing = groups.get(cat) ?? [];
      existing.push(decision);
      groups.set(cat, existing);
    }
    // Sort categories by count descending
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [pendingDecisions]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const selectAllInCategory = useCallback((decisions: Decision[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const d of decisions) next.add(d.id);
      return next;
    });
  }, []);

  // Resolve a single decision
  const resolveDecision = useCallback(async (id: string, action: 'confirm' | 'reject' | 'dismiss') => {
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      await apiFetch(`/decisions/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      useAppStore.getState().removePendingDecision(id);
      // Also update leadStore
      const leadState = useLeadStore.getState();
      const leadId = leadState.selectedLeadId;
      if (leadId) {
        leadState.updateDecision(leadId, id, {
          status: action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'dismissed',
          confirmedAt: new Date().toISOString(),
        });
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      addToast('error', `Failed to ${action} decision: ${err.message}`);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [addToast]);

  // Batch resolve selected decisions
  const batchResolve = useCallback(async (action: 'confirm' | 'reject' | 'dismiss') => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setProcessingIds(new Set(ids));

    try {
      try {
        await apiFetch<{ updated: number }>('/decisions/batch', {
          method: 'POST',
          body: JSON.stringify({ ids, action }),
        });
      } catch {
        // Batch endpoint may not exist yet — fall back to individual calls
        await Promise.all(
          ids.map((id) =>
            apiFetch(`/decisions/${id}/${action}`, {
              method: 'POST',
              body: JSON.stringify({}),
            }),
          ),
        );
      }

      // Remove from pending
      const store = useAppStore.getState();
      for (const id of ids) {
        store.removePendingDecision(id);
      }

      // Update leadStore
      const leadState = useLeadStore.getState();
      const leadId = leadState.selectedLeadId;
      if (leadId) {
        for (const id of ids) {
          leadState.updateDecision(leadId, id, {
            status: action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'dismissed',
            confirmedAt: new Date().toISOString(),
          });
        }
      }

      setSelectedIds(new Set());
      const verb = action === 'confirm' ? 'approved' : action === 'reject' ? 'rejected' : 'dismissed';
      addToast('success', `${ids.length} decision${ids.length > 1 ? 's' : ''} ${verb}`);
    } catch (err: any) {
      addToast('error', `Batch ${action} failed: ${err.message}`);
    } finally {
      setProcessingIds(new Set());
    }
  }, [selectedIds, addToast]);

  // Empty state — don't auto-close (critical reviewer requirement)
  if (pendingDecisions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-th-text-muted p-8">
        <div className="text-center space-y-2">
          <Check className="w-10 h-10 mx-auto text-green-400/60" />
          <p className="text-sm font-medium">All clear</p>
          <p className="text-xs">No decisions waiting for approval.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-th-bg-alt/60 border-b border-th-border shrink-0">
          <span className="text-xs text-th-text-muted">{selectedIds.size} selected</span>
          <div className="flex-1" />
          <button
            onClick={() => batchResolve('dismiss')}
            className="px-3 py-1 text-xs font-medium rounded-md bg-gray-600/20 text-gray-400 border border-gray-600/30 hover:bg-gray-600/30 transition-colors"
          >
            Dismiss Selected
          </button>
          <button
            onClick={() => batchResolve('reject')}
            className="px-3 py-1 text-xs font-medium rounded-md bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors"
          >
            Reject Selected
          </button>
          <button
            onClick={() => batchResolve('confirm')}
            className="px-3 py-1 text-xs font-medium rounded-md bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors"
          >
            Approve Selected
          </button>
        </div>
      )}

      {/* Decision list grouped by category */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {grouped.map(([category, decisions]) => (
          <div key={category}>
            {/* Category header */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => toggleCategory(category)}
                className="flex items-center gap-1 text-xs font-semibold text-th-text-alt hover:text-th-text transition-colors"
              >
                {collapsedCategories.has(category) ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                {categoryLabel(category)}
                <span className="text-th-text-muted font-normal">({decisions.length})</span>
              </button>
              <div className="flex-1" />
              <button
                onClick={() => selectAllInCategory(decisions)}
                className="text-[10px] text-th-text-muted hover:text-th-text-alt transition-colors"
              >
                Select all
              </button>
              <button
                onClick={() => {
                  selectAllInCategory(decisions);
                  // Immediately batch approve the category
                  const ids = decisions.map((d) => d.id);
                  setSelectedIds(new Set(ids));
                  setTimeout(() => batchResolve('confirm'), 0);
                }}
                className="text-[10px] text-green-400 hover:text-green-300 transition-colors"
              >
                Approve all
              </button>
            </div>

            {/* Decision cards */}
            {!collapsedCategories.has(category) && (
              <div className="space-y-1.5">
                {decisions.map((decision) => {
                  const urgency = urgencyLevel(decision.timestamp);
                  const isSelected = selectedIds.has(decision.id);
                  const isExpanded = expandedIds.has(decision.id);
                  const isProcessing = processingIds.has(decision.id);

                  return (
                    <div
                      key={decision.id}
                      className={`border-l-2 ${urgencyBorder(urgency)} rounded-md border border-th-border/50 bg-th-bg transition-colors ${
                        isSelected ? 'ring-1 ring-accent/40 bg-accent/5' : ''
                      } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      <div className="flex items-start gap-2 px-3 py-2">
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(decision.id)}
                          className="mt-0.5 rounded border-th-border bg-th-bg-alt text-accent focus:ring-accent/30"
                        />

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => toggleExpand(decision.id)}
                            className="text-left w-full"
                          >
                            <div className="text-xs font-medium text-th-text-alt truncate">
                              {decision.title}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-th-text-muted">
                                {decision.agentRole}
                              </span>
                              <span className="text-[10px] text-th-text-muted flex items-center gap-0.5">
                                <Clock className="w-2.5 h-2.5" />
                                {ageLabel(decision.timestamp)}
                              </span>
                            </div>
                          </button>

                          {/* Expanded detail */}
                          {isExpanded && decision.rationale && (
                            <div className="mt-2 text-[11px] text-th-text-muted bg-th-bg-alt/50 rounded px-2 py-1.5">
                              {decision.rationale}
                            </div>
                          )}
                        </div>

                        {/* Quick action buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => resolveDecision(decision.id, 'dismiss')}
                            title="Dismiss (d)"
                            className="p-1 rounded hover:bg-gray-500/20 text-th-text-muted hover:text-gray-400 transition-colors"
                          >
                            <EyeOff className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => resolveDecision(decision.id, 'reject')}
                            title="Reject (r)"
                            className="p-1 rounded hover:bg-red-500/20 text-th-text-muted hover:text-red-400 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => resolveDecision(decision.id, 'confirm')}
                            title="Approve (a)"
                            className="p-1 rounded hover:bg-green-500/20 text-th-text-muted hover:text-green-400 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Oversight level hint — shown when approvals are pending */}
      {pendingDecisions.length > 0 && (
        <div className="shrink-0 border-t border-th-border px-4 py-2 bg-th-bg-alt/30" data-testid="oversight-hint">
          {!showOversightPicker ? (
            <p className="text-[10px] text-th-text-muted">
              Seeing too many approvals?{' '}
              <button
                onClick={() => setShowOversightPicker(true)}
                className="text-accent hover:underline font-medium"
              >
                Change oversight level
              </button>
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-th-text-muted font-medium flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Oversight Level
                </span>
                <button
                  onClick={() => setShowOversightPicker(false)}
                  className="text-[10px] text-th-text-muted hover:text-th-text"
                >
                  ✕
                </button>
              </div>
              {OVERSIGHT_HINT_OPTIONS.map(({ level, label, description }) => (
                <button
                  key={level}
                  onClick={() => { setOversightLevel(level); setShowOversightPicker(false); addToast('success', `Oversight level changed to ${label}`); }}
                  className={`w-full text-left px-2 py-1.5 rounded transition-colors ${
                    oversightLevel === level
                      ? 'bg-accent/10 border border-accent/30'
                      : 'bg-th-bg border border-transparent hover:border-th-border'
                  }`}
                >
                  <span className="text-xs font-medium text-th-text flex items-center gap-1.5">
                    <span className={oversightLevel === level ? 'text-accent' : 'text-th-text-muted'}>
                      {oversightLevel === level ? '◉' : '○'}
                    </span>
                    {label}
                  </span>
                  <p className="text-[10px] text-th-text-muted ml-5">{description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Teach Me prompt removed — Intent Rules feature was removed */}
    </div>
  );
}
