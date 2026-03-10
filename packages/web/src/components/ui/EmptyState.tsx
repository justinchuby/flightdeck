/**
 * EmptyState — Friendly placeholder for pages/panels with no data.
 *
 * Extends the Shared/EmptyState pattern with ReactNode icon support
 * (lucide-react icons, SVGs) alongside emoji strings.
 */
import type { ReactNode } from 'react';

// ── Types ───────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** Emoji string (e.g., '📊') or ReactNode icon (e.g., lucide-react element) */
  icon?: string | ReactNode;
  /** Primary message — one sentence explaining what's missing */
  title: string;
  /** Optional secondary description */
  description?: string;
  /** Optional CTA button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional content below the action */
  children?: ReactNode;
  /** Compact mode for inline panels (smaller spacing) */
  compact?: boolean;
  /** Additional className for the container */
  className?: string;
}

// ── Component ───────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  compact,
  className = '',
}: EmptyStateProps) {
  const isEmoji = typeof icon === 'string';

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'py-8 px-4' : 'py-16 px-6'
      } ${className}`}
      role="status"
      data-testid="empty-state"
    >
      {icon && (
        isEmoji ? (
          <span
            className={`block ${compact ? 'text-4xl mb-3' : 'text-6xl mb-4'}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : (
          <div
            className={`${compact ? 'mb-3' : 'mb-4'} text-th-text-muted`}
            aria-hidden="true"
          >
            {icon}
          </div>
        )
      )}
      <h3
        className={`font-medium text-[rgb(var(--th-text))] ${compact ? 'text-sm' : 'text-base'}`}
      >
        {title}
      </h3>
      {description && (
        <p
          className={`mt-1 text-[rgb(var(--th-text-muted))] max-w-sm ${compact ? 'text-xs' : 'text-sm'}`}
        >
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[rgb(var(--th-accent))] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--th-accent))]"
          data-testid="empty-state-action"
        >
          {action.label}
        </button>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
