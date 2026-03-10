import { useRef, useCallback } from 'react';
import type React from 'react';

/**
 * Generic drag-resize hook for sidebar panels.
 * @param axis 'x' for horizontal (col-resize), 'y' for vertical (row-resize)
 * @param currentValue Current size in px
 * @param setValue Setter for the size
 * @param min Minimum size
 * @param max Maximum size
 * @param invert If true, positive mouse delta decreases the value (e.g. right sidebar)
 */
export function useDragResize(
  axis: 'x' | 'y',
  currentValue: number,
  setValue: (v: number) => void,
  min: number,
  max: number,
  invert = false,
) {
  const dragging = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const startVal = currentValue;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const pos = axis === 'x' ? ev.clientX : ev.clientY;
      const rawDelta = pos - startPos;
      const delta = invert ? -rawDelta : rawDelta;
      setValue(Math.min(max, Math.max(min, startVal + delta)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [axis, currentValue, setValue, min, max, invert]);

  return startResize;
}
