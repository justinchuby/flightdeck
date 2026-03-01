import React from 'react';
import { AgentMentionTooltip, type MentionAgent } from '../components/AgentMentionTooltip';
export type { MentionAgent } from '../components/AgentMentionTooltip';

/** Generate a consistent HSL color from a string (agent ID) */
export function idColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

/** Short ID badge component with consistent color */
export function AgentIdBadge({ id, className = '' }: { id: string; className?: string }) {
  return (
    <span
      className={`font-mono text-[10px] px-1 py-0.5 rounded bg-th-bg-alt/80 ${className}`}
      style={{ color: idColor(id) }}
      title={id}
    >
      {id.slice(0, 8)}
    </span>
  );
}

/** Render text with @mentions as clickable agent badges with detail tooltips */
export function MentionText({ text, agents, onClickAgent }: {
  text: string;
  agents: Array<MentionAgent>;
  onClickAgent?: (agentId: string) => void;
}) {
  const MENTION_RE = /@([a-f0-9]{4,8})\b/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_RE.exec(text)) !== null) {
    const shortId = match[1];
    const agent = agents.find((a) => a.id.startsWith(shortId));
    if (agent) {
      if (match.index > lastIdx) {
        parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx, match.index)}</span>);
      }
      parts.push(
        <AgentMentionTooltip key={`m-${match.index}`} agent={agent}>
          <span
            className="inline-flex items-center gap-0.5 font-mono text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-300 cursor-pointer hover:bg-blue-500/30 transition-colors"
            style={{ borderBottom: `1px solid ${idColor(agent.id)}` }}
            onClick={(e) => { e.stopPropagation(); onClickAgent?.(agent.id); }}
          >
            @{agent.role.name.toLowerCase()}-{shortId.slice(0, 6)}
          </span>
        </AgentMentionTooltip>,
      );
      lastIdx = match.index + match[0].length;
    }
  }

  if (lastIdx === 0) return <>{text}</>;
  if (lastIdx < text.length) {
    parts.push(<span key={`t-${lastIdx}`}>{text.slice(lastIdx)}</span>);
  }
  return <>{parts}</>;
}

/** Mention-aware inline markdown: handles **bold**, *italic*, `code`, and @mentions */
function InlineMarkdownWithMentions({ text, mentionAgents, onMentionClick }: {
  text: string;
  mentionAgents?: Array<MentionAgent>;
  onMentionClick?: (agentId: string) => void;
}) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-th-bg-muted px-1 rounded text-yellow-600 dark:text-yellow-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (mentionAgents && mentionAgents.length > 0 && /@[a-f0-9]{4,8}\b/.test(part)) {
          return <MentionText key={i} text={part} agents={mentionAgents} onClickAgent={onMentionClick} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Render inline markdown: **bold**, *italic*, `code` */
export function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-th-bg-muted px-1 rounded text-yellow-600 dark:text-yellow-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Render a markdown table as an HTML table */
function MarkdownTable({ raw }: { raw: string }) {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return <InlineMarkdown text={raw} />;

  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map((cell) => cell.trim());

  const headerCells = parseRow(lines[0]);
  const isSeparator = /^\|[\s:?-]+(\|[\s:?-]+)*\|?\s*$/.test(lines[1]);
  const dataStart = isSeparator ? 2 : 1;
  const bodyRows = lines.slice(dataStart).map(parseRow);

  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs font-mono border-collapse border border-th-border w-full">
        <thead>
          <tr className="bg-th-bg-alt">
            {headerCells.map((cell, j) => (
              <th key={j} className="border border-th-border px-2 py-1 text-left text-th-text-alt font-semibold">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-th-bg/30' : 'bg-th-bg-alt/30'}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-th-border px-2 py-1 text-th-text-alt">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render text with markdown tables detected and inline markdown, with optional @mention support */
export function MarkdownContent({ text, mentionAgents, onMentionClick }: {
  text: string;
  mentionAgents?: Array<MentionAgent>;
  onMentionClick?: (agentId: string) => void;
}) {
  const TABLE_RE = /((?:^|\n)\|[^\n]+\|[ \t]*(?:\n\|[^\n]+\|[ \t]*)+)/g;
  const parts = text.split(TABLE_RE);

  return (
    <>
      {parts.map((part, i) => {
        const trimmed = part.trim();
        if (trimmed.startsWith('|') && trimmed.includes('\n')) {
          return <MarkdownTable key={i} raw={trimmed} />;
        }
        if (!trimmed) return null;
        // Handle code blocks
        const CODE_BLOCK_RE = /(```[\s\S]*?```)/g;
        const segments = part.split(CODE_BLOCK_RE);
        return (
          <React.Fragment key={i}>
            {segments.map((seg, j) => {
              if (seg.startsWith('```') && seg.endsWith('```')) {
                const content = seg.slice(3, -3).replace(/^[^\n]*\n/, '');
                return (
                  <pre key={j} className="bg-th-bg border border-th-border rounded-md px-3 py-2 my-1 overflow-x-auto text-xs font-mono text-th-text-alt">
                    {content}
                  </pre>
                );
              }
              // Use mention-aware inline markdown when agents are provided
              if (mentionAgents) {
                return <InlineMarkdownWithMentions key={j} text={seg} mentionAgents={mentionAgents} onMentionClick={onMentionClick} />;
              }
              return <InlineMarkdown key={j} text={seg} />;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}
