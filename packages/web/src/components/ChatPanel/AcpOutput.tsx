import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AcpToolCall, AcpPlanEntry, AcpTextChunk } from '../../types';
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';

interface Props {
  agentId: string;
}

const PLAN_ICON: Record<AcpPlanEntry['status'], string> = {
  pending: '⏳',
  in_progress: '🔄',
  completed: '✅',
};

const PRIORITY_BADGE: Record<AcpPlanEntry['priority'], string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-gray-500/20 text-gray-400',
};

const TC_STATUS: Record<AcpToolCall['status'], string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
};

/** Render inline markdown: **bold**, *italic*, `code` */
function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++} className="font-bold text-gray-100">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic text-gray-200">{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<em key={key++} className="italic text-gray-200">{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={key++} className="bg-gray-700/60 text-blue-300 rounded px-1 py-0.5 text-[11px] font-mono">
          {match[5]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

/** Render a single content item — handles text, resource, image, audio, or unknown */
function renderContentItem(c: any): string {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  // Any object with a .text string field — extract it (covers {text: "...", type: "text"} and similar)
  if (typeof c.text === 'string' && (c.type === 'text' || !c.type || c.type === undefined)) return c.text;
  if (c.type === 'text' && typeof c.text === 'string') return c.text;
  if (c.type === 'resource') {
    const uri = c.resource?.uri ?? '';
    const text = c.resource?.text ?? '';
    return uri ? `📎 ${uri}\n${text}` : text;
  }
  if (c.type === 'image') return `[🖼️ image: ${c.mimeType ?? 'unknown'}]`;
  if (c.type === 'audio') return `[🔊 audio: ${c.mimeType ?? 'unknown'}]`;
  // Fallback: extract common fields
  if (typeof c.text === 'string') return c.text;
  if (c.content) return typeof c.content === 'string' ? c.content : JSON.stringify(c.content, null, 2);
  return JSON.stringify(c, null, 2);
}

/** Safely render tool call content — handles string, array, or object */
function stringifyContent(content: any): string {
  if (typeof content === 'string') {
    // Try to parse JSON strings that look like content objects
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return stringifyContent(parsed);
      } catch { /* not JSON, use as-is */ }
    }
    return content.slice(0, 500);
  }
  if (Array.isArray(content)) {
    return content.map(renderContentItem).join('\n').slice(0, 500);
  }
  if (content && typeof content === 'object') {
    return renderContentItem(content).slice(0, 500);
  }
  return String(content).slice(0, 500);
}

export function AcpOutput({ agentId }: Props) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const [planOpen, setPlanOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const plan = agent?.plan ?? [];
  const toolCalls = agent?.toolCalls ?? [];
  const messages = agent?.messages ?? [];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Plan Section */}
      {plan.length > 0 && (
        <div className="border border-gray-700 rounded-lg bg-surface-raised">
          <button
            onClick={() => setPlanOpen(!planOpen)}
            className="flex items-center gap-1 w-full px-3 py-2 text-xs font-medium text-gray-300"
          >
            {planOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Plan ({plan.filter((e) => e.status === 'completed').length}/{plan.length})
          </button>
          {planOpen && (
            <ul className="px-3 pb-2 space-y-1">
              {plan.map((entry, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                  <span>{PLAN_ICON[entry.status]}</span>
                  <span className="flex-1">{entry.content}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${PRIORITY_BADGE[entry.priority]}`}>
                    {entry.priority}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tool Calls Section */}
      {toolCalls.length > 0 && (
        <div className="space-y-1.5">
          {toolCalls.map((tc) => (
            <div key={tc.toolCallId} className="border border-gray-700 rounded-lg bg-surface-raised p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-200">{typeof tc.title === 'string' ? tc.title : JSON.stringify(tc.title)}</span>
                  <span className="text-[10px] text-gray-500">{typeof tc.kind === 'string' ? tc.kind : JSON.stringify(tc.kind)}</span>
                </div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${TC_STATUS[tc.status]}`}>
                  {tc.status}
                </span>
              </div>
              {tc.content && tc.status === 'completed' && (
                <pre className="mt-1 text-[11px] text-gray-400 font-mono overflow-hidden max-h-24 bg-surface/50 rounded p-1">
                  {stringifyContent(tc.content)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages Section */}
      {messages.length > 0 && (
        <div className="space-y-1">
          {messages.filter((msg) => msg.sender !== 'system' && (msg.text || msg.contentType)).map((msg, i) => {
            const sender = msg.sender ?? 'agent';
            const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            // User messages — right-aligned blue bubble
            if (sender === 'user') {
              return (
                <div key={i} className="flex justify-end items-start gap-2 py-1">
                  <span className="text-[10px] text-gray-600 mt-1.5 shrink-0">{ts}</span>
                  <div className="max-w-[80%] rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
                    {typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text)}
                  </div>
                </div>
              );
            }

            // Rich content (image, audio, resource)
            if (msg.contentType && msg.contentType !== 'text') {
              return (
                <div key={i} className="py-1">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {msg.contentType === 'image' && msg.data && (
                        <div>
                          <img src={`data:${msg.mimeType || 'image/png'};base64,${msg.data}`} alt="Agent image" className="max-w-full max-h-64 rounded-lg border border-gray-700" />
                          {msg.uri && <p className="text-[10px] text-gray-500 mt-1 font-mono">{msg.uri}</p>}
                        </div>
                      )}
                      {msg.contentType === 'audio' && msg.data && (
                        <audio controls className="max-w-full">
                          <source src={`data:${msg.mimeType || 'audio/wav'};base64,${msg.data}`} type={msg.mimeType || 'audio/wav'} />
                        </audio>
                      )}
                      {msg.contentType === 'resource' && (
                        <div>
                          {msg.uri && (
                            <div className="flex items-center gap-1.5 text-xs text-blue-400 mb-1">
                              <FolderOpen size={12} />
                              <span className="font-mono">{msg.uri}</span>
                            </div>
                          )}
                          {msg.text && (
                            <pre className="text-xs font-mono text-gray-300 bg-gray-800 border border-gray-700 rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{msg.text}</pre>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-600 mt-0.5 shrink-0">{ts}</span>
                  </div>
                </div>
              );
            }

            // Agent messages — flowing text, no bubble
            const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text, null, 2);
            return (
              <div key={i} className="py-1">
                <div className="flex items-start gap-2">
                  <div className="flex-1 font-mono text-sm text-gray-200 whitespace-pre-wrap min-w-0">
                    <AgentTextBlockSimple text={text} />
                  </div>
                  <span className="text-[10px] text-gray-600 mt-0.5 shrink-0">{ts}</span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}

/** Collapsed-by-default <!-- command --> block with click to expand */
function CollapsibleCommandBlockSimple({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const nameMatch = text.match(/<!--\s*(\w+)/);
  const label = nameMatch ? nameMatch[1] : 'command';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let preview = '';
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const parts: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') parts.push(`${k}: ${v.length > 60 ? v.slice(0, 57) + '...' : v}`);
      }
      preview = parts.join(', ');
    } catch {
      preview = jsonMatch[0].replace(/[\n\r]+/g, ' ').slice(0, 80);
    }
  }
  return (
    <div
      className="my-1 px-2 py-1 bg-gray-800/80 border border-gray-600 rounded text-[11px] text-gray-300 cursor-pointer hover:border-gray-500 transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1 min-w-0">
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="font-mono text-gray-300 shrink-0">{label}</span>
        {!expanded && preview && <span className="font-mono text-gray-400 truncate ml-1">— {preview}</span>}
      </div>
      {expanded && <pre className="mt-1 whitespace-pre-wrap break-words text-gray-400">{text}</pre>}
    </div>
  );
}

/** Render agent text with <!-- --> blocks separated and inline markdown + tables */
function AgentTextBlockSimple({ text }: { text: string }) {
  const segments = text.split(/(<!--[\s\S]*?-->)/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('<!--') && seg.endsWith('-->')) {
          return <CollapsibleCommandBlockSimple key={i} text={seg} />;
        }
        // Unclosed <!-- block
        if (seg.includes('<!--') && !seg.includes('-->')) {
          const idx = seg.indexOf('<!--');
          const before = seg.slice(0, idx);
          const cmdBlock = seg.slice(idx);
          return (
            <span key={i}>
              {before.trim() ? <InlineMarkdownSimple text={before} /> : null}
              <CollapsibleCommandBlockSimple text={cmdBlock} />
            </span>
          );
        }
        if (!seg.trim()) return null;
        // Check for tables
        const TABLE_RE = /((?:^|\n)\|[^\n]+\|[ \t]*(?:\n\|[^\n]+\|[ \t]*)+)/g;
        const parts = seg.split(TABLE_RE);
        return (
          <span key={i}>
            {parts.map((part, j) => {
              const trimmed = part.trim();
              if (trimmed.startsWith('|') && trimmed.includes('\n')) {
                return <SimpleTable key={j} raw={trimmed} />;
              }
              if (!trimmed) return null;
              return <InlineMarkdownSimple key={j} text={part} />;
            })}
          </span>
        );
      })}
    </>
  );
}

/** Inline markdown: bold, italic, code */
function InlineMarkdownSimple({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="bg-gray-700 px-1 rounded text-yellow-300">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Simple markdown table renderer */
function SimpleTable({ raw }: { raw: string }) {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return <InlineMarkdownSimple text={raw} />;
  const parseRow = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim());
  const headerCells = parseRow(lines[0]);
  const isSep = /^\|[\s:?-]+(\|[\s:?-]+)*\|?\s*$/.test(lines[1]);
  const bodyRows = lines.slice(isSep ? 2 : 1).map(parseRow);
  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs font-mono border-collapse border border-gray-700 w-full">
        <thead>
          <tr className="bg-gray-800">
            {headerCells.map((c, j) => (
              <th key={j} className="border border-gray-700 px-2 py-1 text-left text-gray-300 font-semibold">
                <InlineMarkdownSimple text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-gray-900/30' : 'bg-gray-800/30'}>
              {row.map((c, ci) => (
                <td key={ci} className="border border-gray-700 px-2 py-1 text-gray-300">
                  <InlineMarkdownSimple text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
