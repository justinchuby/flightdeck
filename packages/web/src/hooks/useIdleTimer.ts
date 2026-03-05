import { useEffect, useRef, useCallback } from 'react';

export interface UseIdleTimerOptions {
  /** Milliseconds of inactivity before `onIdle` fires. Default: 60_000 (60s). */
  timeout?: number;
  /** Called once when user becomes idle. */
  onIdle?: () => void;
  /** Called once when user returns from idle state. */
  onReturn?: () => void;
  /** Disable the timer entirely. */
  disabled?: boolean;
}

const INTERACTION_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/**
 * Detects user inactivity and return-from-idle.
 * Listens for mouse, keyboard, scroll, touch, and visibility change events.
 * Fires onIdle after `timeout` ms of no interaction, then onReturn when
 * the user interacts again.
 */
export function useIdleTimer({
  timeout = 60_000,
  onIdle,
  onReturn,
  disabled = false,
}: UseIdleTimerOptions = {}) {
  const isIdleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refs for callbacks to avoid re-registering listeners
  const onIdleRef = useRef(onIdle);
  const onReturnRef = useRef(onReturn);
  onIdleRef.current = onIdle;
  onReturnRef.current = onReturn;

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isIdleRef.current) {
        isIdleRef.current = true;
        onIdleRef.current?.();
      }
    }, timeout);
  }, [timeout]);

  const handleActivity = useCallback(() => {
    if (isIdleRef.current) {
      isIdleRef.current = false;
      onReturnRef.current?.();
    }
    resetTimer();
  }, [resetTimer]);

  const handleVisibility = useCallback(() => {
    if (document.visibilityState === 'visible') {
      handleActivity();
    }
  }, [handleActivity]);

  useEffect(() => {
    if (disabled) return;

    // Start the idle timer immediately
    resetTimer();

    for (const event of INTERACTION_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const event of INTERACTION_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [disabled, handleActivity, handleVisibility, resetTimer]);

  return { isIdle: isIdleRef };
}
