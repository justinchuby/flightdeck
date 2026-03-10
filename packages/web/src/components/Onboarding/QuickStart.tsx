import { useState } from 'react';

interface Template {
  id: string;
  name: string;
  icon: string;
  roles: { name: string; count: number }[];
  timeRange: string;
  recommended?: boolean;
}

const TEMPLATES: Template[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    icon: '🔍',
    roles: [{ name: 'Lead', count: 1 }, { name: 'Developer', count: 2 }, { name: 'Reviewer', count: 1 }],
    timeRange: '30–60 min',
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    icon: '🐛',
    roles: [{ name: 'Architect', count: 1 }, { name: 'Developer', count: 2 }, { name: 'QA', count: 1 }],
    timeRange: '30–90 min',
  },
  {
    id: 'quick-fix',
    name: 'Quick Fix',
    icon: '📝',
    roles: [{ name: 'Lead', count: 1 }, { name: 'Developer', count: 1 }],
    timeRange: '15–30 min',
    recommended: true,
  },
  {
    id: 'docs-blitz',
    name: 'Docs Blitz',
    icon: '📚',
    roles: [{ name: 'Writer', count: 1 }, { name: 'Developer', count: 1 }],
    timeRange: '20–45 min',
  },
  {
    id: 'full-build',
    name: 'Full Build',
    icon: '🏗',
    roles: [{ name: 'Lead', count: 1 }, { name: 'Architect', count: 1 }, { name: 'Developer', count: 3 }, { name: 'Reviewer', count: 1 }, { name: 'QA', count: 1 }],
    timeRange: '60–180 min',
  },
];

interface Props {
  onSelectTemplate: (templateId: string) => void;
  onStartFromScratch: () => void;
  onBrowseProjects: () => void;
}

export function QuickStart({ onSelectTemplate, onStartFromScratch, onBrowseProjects }: Props) {
  const [launching, setLaunching] = useState<string | null>(null);

  const handleStart = (id: string) => {
    setLaunching(id);
    onSelectTemplate(id);
  };

  return (
    <div className="min-h-screen bg-th-bg flex items-center justify-center p-8">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-th-text mb-2">🚀 Welcome to Flightdeck</h1>
          <p className="text-th-text-muted text-lg">
            Supervise AI crews building software.<br />
            Pick a template to start your first session.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {TEMPLATES.map(pb => (
            <div
              key={pb.id}
              className={`relative bg-th-bg-alt border rounded-xl p-5 flex flex-col gap-3 transition-all hover:border-accent/50 hover:shadow-lg ${
                launching === pb.id ? 'border-accent ring-2 ring-accent/30' : 'border-th-border'
              }`}
            >
              {pb.recommended && (
                <span className="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-full bg-accent text-white font-semibold">
                  ✨ Recommended
                </span>
              )}

              <div className="flex items-center gap-2">
                <span className="text-2xl">{pb.icon}</span>
                <h2 className="text-sm font-semibold text-th-text">{pb.name}</h2>
              </div>

              <div className="space-y-1">
                {pb.roles.map((r, i) => (
                  <div key={i} className="text-xs text-th-text-muted">
                    {r.count} {r.name}{r.count > 1 ? 's' : ''}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 text-xs text-th-text-muted mt-auto">
                <span>{pb.timeRange}</span>
              </div>

              <button
                onClick={() => handleStart(pb.id)}
                disabled={launching !== null}
                className="mt-2 w-full text-sm px-3 py-2 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors font-medium"
              >
                {launching === pb.id ? 'Launching…' : 'Start →'}
              </button>
            </div>
          ))}
        </div>

        <div className="text-center space-y-3">
          <div className="text-xs text-th-text-muted">— or —</div>
          <button onClick={onStartFromScratch} className="text-sm text-accent hover:text-accent/80 transition-colors">
            Start from scratch — configure your own crew
          </button>
          <div>
            <button onClick={onBrowseProjects} className="text-sm text-th-text-muted hover:text-th-text transition-colors">
              Already have a session? Browse projects →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
