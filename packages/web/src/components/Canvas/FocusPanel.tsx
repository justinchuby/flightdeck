import { useState, useEffect } from 'react';
import { X, Info, ListChecks, MessageSquare, BarChart3, GitBranch } from 'lucide-react';
import { useFocusAgent } from '../../hooks/useFocusAgent';
import { DiffPreview } from '../DiffPreview';
import { EmptyState, SkeletonCard } from '../Shared';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { shortAgentId } from '../../utils/agentLabel';

/** Safely convert any API value to a human-readable string */
function safeText(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  // Format activity-like objects nicely
  if (typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    // Common activity patterns: show type/action + summary/details
    const label = obj.type ?? obj.action ?? obj.command ?? obj.event;
    const detail = obj.summary ?? obj.message ?? obj.details ?? obj.description ?? obj.text;
    if (typeof label === 'string' && typeof detail === 'string') {
      return `${label}: ${detail}`;
    }
    if (typeof label === 'string') return label;
    if (typeof detail === 'string') return detail;
  }
  return JSON.stringify(val);
}

interface FocusPanelProps {
  agentId: string;
  onClose: () => void;
}

type Tab = 'overview' | 'tasks' | 'messages' | 'metrics' | 'diff';

const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', icon: <Info size={12} /> },
  { id: 'tasks', label: 'Tasks', icon: <ListChecks size={12} /> },
  { id: 'messages', label: 'Messages', icon: <MessageSquare size={12} /> },
  { id: 'metrics', label: 'Metrics', icon: <BarChart3 size={12} /> },
  { id: 'diff', label: 'Diff', icon: <GitBranch size={12} /> },
];

export function FocusPanel({ agentId, onClose }: FocusPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { data, loading, error } = useFocusAgent(agentId);

  // Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const agent = data?.agent;

  return (
    <div
      className="w-[400px] h-full border-l border-th-border bg-th-bg flex flex-col animate-slide-in-right shrink-0"
      data-testid="canvas-focus-panel"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-th-border shrink-0">
        {agent?.role?.icon && <span className="text-lg">{agent.role.icon}</span>}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-th-text-alt truncate">
            {agent?.role?.name ?? 'Agent'} ({shortAgentId(agentId)})
          </h3>
          <p className="text-[10px] text-th-text-muted capitalize">{agent?.status ?? 'unknown'}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-th-text-muted hover:text-th-text hover:bg-th-bg-hover transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as Tab)}
        size="sm"
        className="shrink-0"
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !data && (
          <SkeletonCard lines={2} showHeader={false} className="mx-2" />
        )}
        {error && (
          <p className="text-xs text-red-400 text-center py-8">{error}</p>
        )}

        {activeTab === 'overview' && agent && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {agent.provider && (
                <div className="text-[11px]">
                  <span className="text-th-text-muted">Provider:</span>{' '}
                  <span className="text-blue-400">{agent.provider}</span>
                </div>
              )}
              <div className="text-[11px]">
                <span className="text-th-text-muted">Model:</span>{' '}
                <span className="text-th-text-alt">{agent.model ?? 'default'}</span>
              </div>
              <div className="text-[11px]">
                <span className="text-th-text-muted">Status:</span>{' '}
                <span className="text-th-text-alt capitalize">{agent.status}</span>
              </div>
              {agent.contextBurnRate != null && (
                <div className="text-[11px]">
                  <span className="text-th-text-muted">Burn rate:</span>{' '}
                  <span className="text-th-text-alt">{agent.contextBurnRate.toFixed(1)} tok/s</span>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tasks' && data?.decisions && (
          <div className="space-y-2">
            {data.decisions.length === 0 ? (
              <EmptyState icon="📋" title="No decisions recorded" compact />
            ) : (
              data.decisions.slice(0, 20).map((d) => (
                <div key={d.id} className="text-[11px] border-b border-th-border/40 pb-1.5">
                  <span className="font-medium text-th-text-alt">{safeText(d.title)}</span>
                  <p className="text-th-text-muted truncate">{safeText(d.rationale)}</p>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="space-y-2">
            {data?.activities && data.activities.length > 0 ? (
              data.activities.slice(0, 20).map((a, i) => (
                <div key={i} className="text-[11px] text-th-text-muted border-b border-th-border/40 pb-1.5">
                  {safeText(a.details ?? a.action)}
                </div>
              ))
            ) : (
              <EmptyState icon="💬" title="No recent messages" compact />
            )}
          </div>
        )}

        {activeTab === 'metrics' && agent && (
          <div className="space-y-3">
            <div className="text-[11px] text-th-text-muted">
              <p>Token usage and cost metrics will appear here when the agent is active.</p>
            </div>
          </div>
        )}

        {activeTab === 'diff' && data?.diff && (
          <DiffPreview diff={data.diff} />
        )}
        {activeTab === 'diff' && !data?.diff && (
          <p className="text-xs text-th-text-muted text-center py-4">No uncommitted changes</p>
        )}
      </div>
    </div>
  );
}
