interface TaskPillProps {
  id: string;
  title: string;
  status: 'running' | 'pending' | 'done' | 'blocked' | string;
}

const STATUS_ICONS: Record<string, string> = {
  running: '●',
  pending: '◐',
  done: '✅',
  blocked: '⊘',
};

export function TaskPill({ id, title, status }: TaskPillProps) {
  const icon = STATUS_ICONS[status] ?? '○';
  const truncated = title.length > 18 ? title.slice(0, 18) + '…' : title;

  return (
    <div
      className="flex items-center gap-1.5 pl-2 border-l border-dotted border-th-border"
      title={`${id}: ${title} (${status})`}
    >
      <span className="text-[10px] font-mono text-th-text-muted">{id.slice(0, 8)}</span>
      <span className="text-[11px] text-th-text-alt truncate">{truncated}</span>
      <span className="text-[10px] shrink-0">{icon}</span>
    </div>
  );
}
