import type { AgentInfo } from '../../types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PreviewData {
  type: string;
  title: string;
  subtitle?: string;
  fields: { label: string; value: string }[];
  actions?: { label: string; onClick: () => void }[];
}

interface Props {
  data: PreviewData | null;
}

// ── Preview Panel ───────────────────────────────────────────────────────────

export function PreviewPanel({ data }: Props) {
  if (!data) return null;

  return (
    <div
      className="w-[280px] border-l border-th-border bg-th-bg-alt p-4 overflow-y-auto"
      role="complementary"
      aria-label="Preview details for selected item"
    >
      <div className="text-sm font-semibold text-th-text mb-1">{data.title}</div>
      {data.subtitle && (
        <div className="text-xs text-th-text-muted mb-3">{data.subtitle}</div>
      )}
      <div className="space-y-2">
        {data.fields.map((f, i) => (
          <div key={i} className="flex justify-between text-xs">
            <span className="text-th-text-muted">{f.label}</span>
            <span className="text-th-text font-medium">{f.value}</span>
          </div>
        ))}
      </div>
      {data.actions && data.actions.length > 0 && (
        <div className="mt-4 flex gap-2">
          {data.actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className="text-xs px-3 py-1.5 rounded-md bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Build preview data from palette items ───────────────────────────────────

export function buildPreviewData(
  item: { type: string; label: string; description?: string; agentId?: string },
  agents: AgentInfo[],
): PreviewData | null {
  // Agent preview — rich detail from live agent state
  if (item.type === 'agent' && item.agentId) {
    const agent = agents.find((a) => a.id === item.agentId);
    if (!agent) return null;
    const ctxPct =
      agent.contextWindowSize && agent.contextWindowUsed
        ? Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100) + '%'
        : '—';
    return {
      type: 'agent',
      title: agent.role?.name ?? 'Agent',
      subtitle: `Status: ${agent.status}`,
      fields: [
        { label: 'Task', value: agent.task ?? 'None' },
        { label: 'Context', value: ctxPct },
        { label: 'Status', value: agent.status },
        ...(agent.provider ? [{ label: 'Provider', value: agent.provider }] : []),
        ...(agent.model ? [{ label: 'Model', value: agent.model }] : []),
      ],
    };
  }

  // Task preview
  if (item.type === 'task') {
    return {
      type: 'task',
      title: item.label,
      subtitle: item.description,
      fields: [],
    };
  }

  // Navigation preview
  if (item.type === 'navigation') {
    return {
      type: 'navigation',
      title: item.label,
      subtitle: item.description ?? 'Navigate to this page',
      fields: [],
    };
  }

  // NL command preview
  if (item.type === 'nl-command') {
    return {
      type: 'nl-command',
      title: item.label,
      subtitle: item.description ?? 'Execute this command',
      fields: [],
    };
  }

  // Suggestion preview
  if (item.type === 'suggestion') {
    return {
      type: 'suggestion',
      title: item.label,
      subtitle: item.description,
      fields: [],
    };
  }

  return null;
}
