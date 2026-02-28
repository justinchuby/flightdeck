import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, delay = 400, placement = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback(() => {
    timer.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    let x: number, y: number;
    switch (placement) {
      case 'bottom':
        x = rect.left + rect.width / 2;
        y = rect.bottom + pad;
        break;
      case 'left':
        x = rect.left - pad;
        y = rect.top + rect.height / 2;
        break;
      case 'right':
        x = rect.right + pad;
        y = rect.top + rect.height / 2;
        break;
      default: // top
        x = rect.left + rect.width / 2;
        y = rect.top - pad;
    }
    setPos({ x, y });
  }, [visible, placement]);

  // Clamp to viewport after render
  useEffect(() => {
    if (!visible || !tipRef.current) return;
    const el = tipRef.current;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0, dy = 0;
    if (r.right > vw - 8) dx = vw - 8 - r.right;
    if (r.left < 8) dx = 8 - r.left;
    if (r.bottom > vh - 8) dy = vh - 8 - r.bottom;
    if (r.top < 8) dy = 8 - r.top;
    if (dx || dy) {
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }, [visible, pos]);

  const placementStyles: Record<string, React.CSSProperties> = {
    top: { left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' },
    bottom: { left: pos.x, top: pos.y, transform: 'translate(-50%, 0)' },
    left: { left: pos.x, top: pos.y, transform: 'translate(-100%, -50%)' },
    right: { left: pos.x, top: pos.y, transform: 'translate(0, -50%)' },
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>
      {visible && content && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            zIndex: 9999,
            pointerEvents: 'none',
            ...placementStyles[placement],
          }}
          className="tooltip-container"
        >
          <div className="tooltip-inner">
            {content}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
