/**
 * PageTransition — subtle fade+slide animation on route changes.
 *
 * Wraps children and re-triggers a CSS animation when `transitionKey`
 * changes (typically the current route pathname or tab ID).
 *
 * Duration: 150ms, uses opacity + translateY for a fast, subtle feel.
 * Prefers-reduced-motion is respected — animation disabled for a11y.
 */
import { useRef, useEffect, type ReactNode } from 'react';

interface PageTransitionProps {
  transitionKey: string;
  children: ReactNode;
  /** Duration in ms (default: 150) */
  duration?: number;
  className?: string;
}

export function PageTransition({
  transitionKey,
  children,
  duration = 150,
  className = '',
}: PageTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevKeyRef = useRef(transitionKey);

  useEffect(() => {
    if (prevKeyRef.current === transitionKey) return;
    prevKeyRef.current = transitionKey;

    const el = containerRef.current;
    if (!el) return;

    // Respect prefers-reduced-motion
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    // Start from faded + slightly shifted
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    el.style.transition = `opacity ${duration}ms ease-out, transform ${duration}ms ease-out`;

    // Force synchronous reflow so the browser applies the initial opacity/transform
    // before transitioning to the final values. Without this, the browser batches
    // both style assignments and skips the animation entirely.
    el.getBoundingClientRect();

    // Animate to visible
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';

    // Clean up inline styles after animation
    const timer = setTimeout(() => {
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
    }, duration + 10);

    return () => clearTimeout(timer);
  }, [transitionKey, duration]);

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-hidden flex flex-col ${className}`}
      data-testid="page-transition"
    >
      {children}
    </div>
  );
}
