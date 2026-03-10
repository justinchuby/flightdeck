/**
 * ProjectOversightPicker — compact oversight level control for project header.
 *
 * Shows the effective oversight level (project override or inherited global).
 * Click to open a popover to change or clear the project-specific override.
 */
import { useState, useRef, useEffect } from 'react';
import { Eye } from 'lucide-react';
import { useSettingsStore, type OversightLevel } from '../../stores/settingsStore';

const LEVELS: Array<{ level: OversightLevel; label: string; short: string }> = [
  { level: 'supervised', label: 'Supervised', short: 'Review all actions' },
  { level: 'balanced', label: 'Balanced', short: 'Review key decisions' },
  { level: 'autonomous',  label: 'Autonomous',  short: 'Autonomous — critical only' },
];

interface Props {
  projectId: string;
}

export function ProjectOversightPicker({ projectId }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const globalLevel = useSettingsStore((s) => s.oversightLevel);
  const overrides = useSettingsStore((s) => s.projectOverrides);
  const setProjectOversight = useSettingsStore((s) => s.setProjectOversight);
  const clearProjectOversight = useSettingsStore((s) => s.clearProjectOversight);

  const projectOverride = overrides[projectId];
  const effectiveLevel = projectOverride ?? globalLevel;
  const isInherited = !projectOverride;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        data-testid="project-oversight-toggle"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-th-bg-alt text-th-text-muted hover:text-th-text hover:bg-th-border transition-colors"
        title={`Oversight: ${effectiveLevel}${isInherited ? ' (global default)' : ' (project override)'}`}
      >
        <Eye size={10} />
        <span className="font-medium capitalize">{effectiveLevel}</span>
        {isInherited && <span className="opacity-50">↑</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 bg-surface-raised rounded-lg border border-th-border shadow-lg py-1 z-50"
          data-testid="project-oversight-picker"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-th-text-muted font-medium border-b border-th-border/50">
            Project Oversight
          </div>
          {LEVELS.map(({ level, label, short }) => {
            const isActive = effectiveLevel === level;
            const isGlobalDefault = globalLevel === level;
            return (
              <button
                key={level}
                data-testid={`project-oversight-${level}`}
                onClick={() => {
                  setProjectOversight(projectId, level);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 transition-colors ${
                  isActive ? 'bg-accent/10 text-accent' : 'text-th-text hover:bg-th-bg-alt'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  <span className={isActive ? 'text-accent' : 'text-th-text-muted'}>
                    {isActive ? '◉' : '○'}
                  </span>
                  {label}
                  {isGlobalDefault && isInherited && (
                    <span className="text-[9px] text-th-text-muted font-normal">(default)</span>
                  )}
                </div>
                <p className="text-[10px] text-th-text-muted mt-0.5 ml-5 leading-snug">{short}</p>
              </button>
            );
          })}
          {!isInherited && (
            <>
              <div className="border-t border-th-border/50 my-1" />
              <button
                data-testid="project-oversight-clear"
                onClick={() => { clearProjectOversight(projectId); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-th-text-muted hover:bg-th-bg-alt transition-colors"
              >
                ↑ Use global default ({globalLevel})
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
