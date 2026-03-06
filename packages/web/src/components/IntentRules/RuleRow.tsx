import { useState } from 'react';
import { GripVertical, ChevronDown, ChevronRight } from 'lucide-react';
import { ACTION_DISPLAY, type IntentRule } from './types';
import { RuleEditor } from './RuleEditor';

interface RuleRowProps {
  rule: IntentRule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onSave: (rule: IntentRule) => void;
}

function effectivenessColor(score: number | null): string {
  if (score == null) return 'bg-gray-400';
  if (score >= 80) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function RuleRow({ rule, onToggle, onDelete, onSave }: RuleRowProps) {
  const [expanded, setExpanded] = useState(false);
  const action = ACTION_DISPLAY[rule.action];
  const score = rule.metadata.effectivenessScore;
  const hasWarning = score != null && score < 50;

  return (
    <div
      className={`border-b border-th-border/40 transition-colors ${
        hasWarning ? 'border-l-2 border-l-yellow-400' : ''
      } ${!rule.enabled ? 'opacity-50' : ''}`}
      data-testid="rule-row"
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2 hover:bg-th-bg-muted/30 group">
        {/* Drag handle */}
        <GripVertical size={14} className="text-th-text-muted/50 cursor-grab shrink-0" />

        {/* Enable toggle */}
        <button
          onClick={() => onToggle(rule.id, !rule.enabled)}
          className={`shrink-0 w-4 h-4 rounded-full border-2 transition-colors ${
            rule.enabled ? 'bg-green-500 border-green-500' : 'border-th-border'
          }`}
          aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
        />

        {/* Description */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 text-left flex items-center gap-1.5 min-w-0"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className={`text-xs ${rule.enabled ? 'text-th-text-alt' : 'text-th-text-muted line-through'}`}>
            {rule.name}
          </span>
        </button>

        {/* Scope badges */}
        <div className="flex gap-1 shrink-0">
          {rule.match.roles && rule.match.roles.length > 0 ? (
            rule.match.roles.map((r) => (
              <span key={r} className="text-[9px] px-1.5 py-0.5 rounded-full bg-th-bg-alt border border-th-border text-th-text-muted">
                {r}
              </span>
            ))
          ) : (
            <span className="text-[9px] text-th-text-muted">All agents</span>
          )}
        </div>

        {/* Effectiveness bar */}
        <div className="w-16 shrink-0" title={score != null ? `${score}% effective` : 'Gathering data...'}>
          {score != null ? (
            <div className="w-full h-1.5 bg-th-bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${effectivenessColor(score)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          ) : (
            <span className="text-[9px] text-th-text-muted">——</span>
          )}
        </div>

        {/* Match count */}
        <span className="text-[10px] text-th-text-muted w-16 text-right shrink-0">
          {rule.metadata.matchCount} matches
        </span>

        {/* Delete on hover */}
        <button
          onClick={() => onDelete(rule.id)}
          className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
          title="Delete rule"
        >
          ✕
        </button>
      </div>

      {/* Warning */}
      {hasWarning && !expanded && (
        <p className="text-[10px] text-yellow-500 px-10 pb-1.5">
          ⚠ {rule.metadata.issuesAfterMatch} allowed decisions preceded failures
        </p>
      )}

      {/* Expanded editor */}
      {expanded && (
        <div className="px-6 pb-3 border-t border-th-border/30">
          <RuleEditor rule={rule} onSave={onSave} onCancel={() => setExpanded(false)} />
        </div>
      )}
    </div>
  );
}
