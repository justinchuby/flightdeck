import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────

export interface ErrorEntry {
  /** Unique identifier for scrolling to this error */
  id: string;
  /** Agent role or name that produced the error */
  agentLabel: string;
  /** Short error description */
  message: string;
}

export interface ErrorBannerProps {
  /** List of errors currently below the fold */
  errors: ErrorEntry[];
  /** Called when user clicks an error to scroll to it */
  onScrollToError: (errorId: string) => void;
  /** Called when banner is dismissed by user or auto-dismiss */
  onDismiss?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────

export function ErrorBanner({
  errors,
  onScrollToError,
  onDismiss,
}: ErrorBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const previousErrorCount = useRef(errors.length);

  // Reset dismissed state when new errors arrive
  useEffect(() => {
    if (errors.length > previousErrorCount.current) {
      setIsDismissed(false);
    }
    previousErrorCount.current = errors.length;
  }, [errors.length]);

  // Auto-dismiss: observe the actual error elements in the timeline.
  // When the first error scrolls into the viewport, dismiss the banner.
  useEffect(() => {
    if (errors.length === 0 || isDismissed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsDismissed(true);
            onDismiss?.();
          }
        }
      },
      { threshold: 0 },
    );

    // Observe each error's element in the timeline by convention ID
    const observedElements: Element[] = [];
    for (const error of errors) {
      const el = document.getElementById(`timeline-event-${error.id}`);
      if (el) {
        observer.observe(el);
        observedElements.push(el);
      }
    }

    return () => observer.disconnect();
  }, [errors, isDismissed, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  const handleErrorClick = useCallback(
    (errorId: string) => {
      onScrollToError(errorId);
      setIsDismissed(true);
      onDismiss?.();
    },
    [onScrollToError, onDismiss],
  );

  if (errors.length === 0 || isDismissed) {
    return null;
  }

  const errorCount = errors.length;
  const errorLabel = errorCount === 1 ? '1 error' : `${errorCount} errors`;

  return (
    <div
      ref={bannerRef}
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-20 bg-red-900/30 border-b border-red-800/50 px-4 py-2"
      data-testid="error-banner"
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
          aria-expanded={isExpanded}
          aria-label={`${errorLabel}. ${isExpanded ? 'Collapse' : 'Expand'} error list.`}
        >
          <AlertTriangle size={14} />
          <span className="font-medium">{errorLabel}</span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <button
          onClick={handleDismiss}
          className="text-red-400/60 hover:text-red-300 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded p-0.5"
          aria-label="Dismiss error banner"
        >
          <X size={14} />
        </button>
      </div>

      {isExpanded && (
        <ul className="mt-2 space-y-1" role="list" aria-label="Error list">
          {errors.map((error) => (
            <li key={error.id}>
              <button
                onClick={() => handleErrorClick(error.id)}
                className="w-full text-left px-2 py-1 text-xs text-red-300 hover:bg-red-900/40 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                aria-label={`Scroll to error: ${error.agentLabel} — ${error.message}`}
              >
                <span className="font-medium">{error.agentLabel}</span>
                <span className="text-red-400/70"> — {error.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
