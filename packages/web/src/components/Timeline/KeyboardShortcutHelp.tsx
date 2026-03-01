import { useEffect, useRef } from 'react';

interface KeyboardShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['←', '→'], description: 'Pan timeline left / right' },
  { keys: ['↑', '↓'], description: 'Navigate between agent lanes' },
  { keys: ['+', '−'], description: 'Zoom in / out' },
  { keys: ['Ctrl', 'Scroll'], description: 'Zoom at cursor' },
  { keys: ['Home'], description: 'Fit entire timeline' },
  { keys: ['End'], description: 'Jump to latest 20%' },
  { keys: ['Enter', 'Space'], description: 'Expand / collapse focused lane' },
  { keys: ['Tab'], description: 'Next lane' },
  { keys: ['Shift', 'Tab'], description: 'Previous lane' },
  { keys: ['f'], description: 'Focus filter bar' },
  { keys: ['?'], description: 'Toggle this help' },
  { keys: ['Esc'], description: 'Close overlay / unfocus lane' },
] as const;

export function KeyboardShortcutHelp({ isOpen, onClose }: KeyboardShortcutHelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Trap focus inside overlay and close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-label="Keyboard shortcuts"
      aria-modal="true"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-th-bg border border-th-border-muted rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-th-text-alt">Keyboard Shortcuts</h2>
          <button
            className="text-th-text-muted hover:text-th-text-alt text-xs px-1.5 py-0.5 rounded bg-th-bg-alt"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            Esc
          </button>
        </div>
        <dl className="space-y-2">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between text-xs">
              <dd className="text-th-text-muted">{description}</dd>
              <dt className="flex gap-1 ml-4 shrink-0">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 rounded bg-th-bg-alt border border-th-border-muted text-th-text-alt font-mono text-[10px]"
                  >
                    {k}
                  </kbd>
                ))}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
