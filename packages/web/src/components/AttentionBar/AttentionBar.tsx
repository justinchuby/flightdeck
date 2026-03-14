import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, MessageSquareWarning, Users, Eye, WifiOff } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useSettingsStore, type OversightLevel } from '../../stores/settingsStore';
import { useAttentionItems, type AttentionItem, type EscalationLevel } from './useAttentionItems';

const LEVEL_LABELS: Record<OversightLevel, string> = {
  supervised: 'Supervised',
  balanced: 'Balanced',
  autonomous: 'Autonomous',
};

const OVERSIGHT_PICKER_OPTIONS: Array<{ level: OversightLevel; label: string; description: string }> = [
  { level: 'supervised', label: 'Supervised', description: 'Review all agent actions — new agents, commits, and task changes require your approval' },
  { level: 'balanced', label: 'Balanced', description: 'Review key decisions — new agents and first few commits need approval, routine work runs automatically' },
  { level: 'autonomous', label: 'Autonomous', description: 'Agents work autonomously — only critical resets require your approval' },
];

// ── Escalation Styles ───────────────────────────────────────────────

const ESCALATION_STYLES: Record<EscalationLevel, {
  bar: string;
  height: string;
  border: string;
  textColor: string;
}> = {
  green: {
    bar: 'bg-th-bg-alt/40',
    height: 'h-7',
    border: 'border-b border-th-border',
    textColor: 'text-th-text-muted',
  },
  yellow: {
    bar: 'bg-amber-500/5',
    height: 'h-9',
    border: 'border-b border-amber-500/30',
    textColor: 'text-amber-600 dark:text-amber-400',
  },
  red: {
    bar: 'bg-red-500/5',
    height: 'h-12',
    border: 'border-b border-red-500/40',
    textColor: 'text-red-600 dark:text-red-400',
  },
};

const ITEM_ICONS: Record<AttentionItem['kind'], typeof XCircle> = {
  failed: XCircle,
  blocked: Clock,
  decision: MessageSquareWarning,
};

const ITEM_COLORS: Record<AttentionItem['kind'], string> = {
  failed: 'text-red-400',
  blocked: 'text-amber-400',
  decision: 'text-blue-400',
};

// ── Component ───────────────────────────────────────────────────────

export function AttentionBar() {
  const state = useAttentionItems();
  const navigate = useNavigate();
  const connected = useAppStore((s) => s.connected);
  const openApprovalQueue = useAppStore((s) => s.setApprovalQueueOpen);
  const oversightLevel = useSettingsStore((s) => s.oversightLevel);
  const setOversightLevel = useSettingsStore((s) => s.setOversightLevel);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(0);
  const [oversightOpen, setOversightOpen] = useState(false);
  const oversightRef = useRef<HTMLDivElement>(null);

  const handleItemClick = useCallback((item: AttentionItem) => {
    if (item.action.type === 'navigate') {
      navigate(item.action.to);
    } else if (item.action.key === 'openApprovalQueue') {
      openApprovalQueue(true);
    }
  }, [navigate, openApprovalQueue]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setDismissedVersion(state.items.length);
  }, [state.items.length]);

  // Re-show if new exceptions arrive after dismissal
  useEffect(() => {
    if (dismissed && state.items.length > dismissedVersion) {
      setDismissed(false);
    }
  }, [dismissed, state.items.length, dismissedVersion]);

  // Close oversight popover on outside click
  useEffect(() => {
    if (!oversightOpen) return;
    function handleClick(e: MouseEvent) {
      if (oversightRef.current && !oversightRef.current.contains(e.target as Node)) {
        setOversightOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [oversightOpen]);

  const _isVisible = !dismissed || state.items.length > dismissedVersion;

  // Don't render if no agents active
  if (state.agentCount === 0) return null;

  const { escalation, items, progressText, runningCount, pendingDecisionCount } = state;

  // Hide the bar entirely when everything is healthy — StatusPopover
  // in the header already covers the "all good" case. Only render when
  // there are actual problems (yellow/red), disconnection, or pending decisions.
  if (escalation === 'green' && connected && pendingDecisionCount === 0) return null;

  const styles = ESCALATION_STYLES[escalation];

  // Build aria label for screen readers (AC-13.15)
  const ariaLabel = escalation === 'green'
    ? `All healthy. ${progressText || `${state.agentCount} agents active`}`
    : `Attention: ${items.map((i) => i.label).join(', ')}. ${progressText}`;

  return (
    <div
      data-testid="attention-bar"
      data-escalation={escalation}
      role={escalation === 'red' ? 'alert' : 'status'}
      aria-label={ariaLabel}
      aria-live={escalation === 'red' ? 'assertive' : 'polite'}
      className={`${styles.height} ${styles.bar} ${styles.border} flex items-center px-4 gap-4 text-xs shrink-0 overflow-x-auto transition-all duration-300`}
    >
      {/* Escalation indicator dot */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          data-testid="escalation-dot"
          className={`w-2 h-2 rounded-full ${
            escalation === 'red' ? 'bg-red-500 animate-pulse' :
            escalation === 'yellow' ? 'bg-amber-400' :
            'bg-emerald-400'
          }`}
        />
        {!connected && (
          <span
            className="flex items-center gap-1 text-th-text-muted opacity-70"
            title="Connection lost — data may be stale"
            data-testid="connection-lost"
          >
            <WifiOff className="w-3 h-3" />
            <span className="text-[10px]">Reconnecting…</span>
          </span>
        )}
        {connected && escalation === 'green' && (
          <span className="text-th-text-muted flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            All healthy
          </span>
        )}
      </div>

      {/* Exception items (yellow/red only) */}
      {escalation !== 'green' && items.length > 0 && (
        <div className="flex items-center gap-3 overflow-x-auto">
          {items.slice(0, escalation === 'red' ? 5 : 3).map((item) => {
            const Icon = ITEM_ICONS[item.kind];
            return (
              <button
                key={item.id}
                data-testid={`attention-item-${item.kind}`}
                onClick={() => handleItemClick(item)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-th-bg-alt/60 transition-colors cursor-pointer whitespace-nowrap ${styles.textColor}`}
                title={item.label}
              >
                <Icon className={`w-3.5 h-3.5 ${ITEM_COLORS[item.kind]}`} />
                <span className="max-w-[200px] truncate">{item.label}</span>
              </button>
            );
          })}
          {items.length > (escalation === 'red' ? 5 : 3) && (
            <span className="text-th-text-muted whitespace-nowrap">
              +{items.length - (escalation === 'red' ? 5 : 3)} more
            </span>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent count */}
      {runningCount > 0 && (
        <div className="flex items-center gap-1 text-th-text-muted shrink-0">
          <Users className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-mono">{runningCount}</span>
          <span className="hidden sm:inline">active</span>
        </div>
      )}

      {/* Pending decisions badge */}
      {pendingDecisionCount > 0 && (
        <button
          data-testid="attention-decisions"
          onClick={() => openApprovalQueue(true)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors shrink-0"
        >
          <MessageSquareWarning className="w-3.5 h-3.5" />
          <span className="font-mono font-medium">{pendingDecisionCount}</span>
          <span className="hidden sm:inline">pending</span>
        </button>
      )}

      {/* Separator */}
      {progressText && <div className="w-px h-4 bg-th-border/50 shrink-0" />}

      {/* Progress summary */}
      {progressText && (
        <span className="text-th-text-muted font-mono shrink-0">
          {progressText}
        </span>
      )}

      {/* Dismiss button (yellow/red only) */}
      {escalation !== 'green' && (
        <button
          data-testid="attention-dismiss"
          onClick={handleDismiss}
          className="text-th-text-muted hover:text-th-text transition-colors shrink-0 px-1"
          title="Dismiss (re-appears on new exceptions)"
        >
          ×
        </button>
      )}

      {/* Trust Dial picker (AC-16.6) */}
      <div className="relative shrink-0" ref={oversightRef}>
        <button
          data-testid="trust-dial-toggle"
          onClick={() => setOversightOpen(!oversightOpen)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-th-bg-alt text-th-text-muted hover:text-th-text hover:bg-th-border transition-colors"
          title="Change oversight level"
        >
          <Eye size={10} />
          <span className="font-medium">◉ {LEVEL_LABELS[oversightLevel]}</span>
        </button>

        {oversightOpen && (
          <div className="absolute right-0 bottom-full mb-1 w-72 bg-surface-raised rounded-lg border border-th-border shadow-lg py-1 z-50" data-testid="oversight-picker">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-th-text-muted font-medium border-b border-th-border/50">
              Oversight Level
            </div>
            {OVERSIGHT_PICKER_OPTIONS.map(({ level, label, description }) => (
              <button
                key={level}
                data-testid={`oversight-option-${level}`}
                onClick={() => { setOversightLevel(level); setOversightOpen(false); }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  oversightLevel === level
                    ? 'bg-accent/10 text-accent'
                    : 'text-th-text hover:bg-th-bg-alt'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className={oversightLevel === level ? 'text-accent' : 'text-th-text-muted'}>
                    {oversightLevel === level ? '◉' : '○'}
                  </span>
                  {label}
                </div>
                <p className="text-[10px] text-th-text-muted mt-0.5 ml-5 leading-snug">{description}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
