import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { idColor } from '../utils/markdown';
import { agentStatusDot } from '../utils/statusColors';

export interface MentionAgent {
  id: string;
  role: { name: string; icon?: string; id?: string };
  status?: string;
  task?: string;
  model?: string;
}

/**
 * Wraps a mention badge with a hover tooltip showing agent details.
 * Tooltip appears after 200ms delay and positions above the mention.
 * Uses position: fixed so the tooltip escapes overflow: auto/hidden containers
 * (e.g., the scrollable chat panel) and renders above sibling panels like the sidebar.
 */
export function AgentMentionTooltip({
  agent,
  children,
}: {
  agent: MentionAgent;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.top,
          left: rect.left + rect.width / 2,
        });
      }
      setVisible(true);
    }, 200);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
    setPosition(null);
  }, []);

  const statusDot = agentStatusDot(agent.status ?? '');
  const taskPreview = agent.task
    ? agent.task.length > 80
      ? agent.task.slice(0, 80) + '…'
      : agent.task
    : null;

  const TOOLTIP_WIDTH = 256; // w-64 = 16rem = 256px

  return (
    <span
      ref={containerRef}
      className="relative inline"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible && position && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="mention-tooltip"
          className="fixed z-tooltip w-64 rounded-lg border border-th-border bg-th-bg-alt shadow-lg text-xs"
          style={{
            top: position.top - 8,
            left: Math.max(8, Math.min(position.left - TOOLTIP_WIDTH / 2, window.innerWidth - TOOLTIP_WIDTH - 8)),
            transform: 'translateY(-100%)',
            borderTopColor: idColor(agent.id),
            borderTopWidth: 2,
          }}
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
