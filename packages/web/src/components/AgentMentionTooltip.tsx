import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { idColor } from '../utils/markdown';

export interface MentionAgent {
  id: string;
  role: { name: string; icon?: string; id?: string };
  status?: string;
  task?: string;
  model?: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  idle: 'bg-yellow-500',
  creating: 'bg-blue-500',
  completed: 'bg-gray-500',
  failed: 'bg-red-500',
  terminated: 'bg-gray-600',
};

/**
 * Wraps a mention badge with a hover tooltip showing agent details.
 * Tooltip appears after 200ms delay and positions above the mention.
 */
export function AgentMentionTooltip({
  agent,
  children,
}: {
  agent: MentionAgent;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  // Cleanup timer on unmount to prevent setState on dead component
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 200);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  }, []);

  const statusDot = STATUS_COLORS[agent.status ?? ''] ?? 'bg-gray-400';
  const taskPreview = agent.task
    ? agent.task.length > 80
      ? agent.task.slice(0, 80) + '…'
      : agent.task
    : null;

  return (
    <span
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="mention-tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-lg border border-th-border bg-th-bg-alt shadow-lg text-xs"
          style={{ borderTopColor: idColor(agent.id), borderTopWidth: 2 }}
        >
          <div className="px-3 py-2 space-y-1.5">
            {/* Header: icon + role name + short ID */}
            <div className="flex items-center gap-1.5">
              {agent.role.icon && <span>{agent.role.icon}</span>}
              <span className="font-semibold text-th-text">{agent.role.name}</span>
              <span className="font-mono text-[10px] text-th-text-muted">
                {agent.id.slice(0, 8)}
              </span>
            </div>
            {/* Status + model row */}
            <div className="flex items-center gap-2 text-th-text-alt">
              <span className="flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} />
                {agent.status ?? 'unknown'}
              </span>
              {agent.model && (
                <>
                  <span className="text-th-border">·</span>
                  <span className="truncate">{agent.model}</span>
                </>
              )}
            </div>
            {/* Current task */}
            {taskPreview && (
              <div className="text-th-text-muted leading-snug border-t border-th-border pt-1.5">
                {taskPreview}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
