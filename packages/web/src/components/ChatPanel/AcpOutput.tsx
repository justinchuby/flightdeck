import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type ActivityEvent } from '../../stores/leadStore';
import type { AcpToolCall, AcpPlanEntry, AcpTextChunk } from '../../types';
import { ChevronDown, ChevronUp, ChevronRight, FolderOpen, Clock, Loader2, X } from 'lucide-react';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { InlineMarkdownWithMentions } from '../../utils/markdown';
import { PromptNav, hasUserMention } from '../PromptNav';

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
  medium: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  low: 'bg-gray-500/20 text-th-text-muted',
};

const TC_STATUS: Record<AcpToolCall['status'], string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-purple-500/20 text-purple-400',
  cancelled: 'bg-gray-500/20 text-th-text-muted',
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
      parts.push(<strong key={key++} className="font-bold text-th-text">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++} className="italic text-th-text-alt">{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<em key={key++} className="italic text-th-text-alt">{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={key++} className="bg-th-bg-muted/60 text-blue-600 dark:text-blue-300 rounded px-1 py-0.5 text-[11px] font-mono">
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

  // Get activity events for this agent from leadStore
  const allProjects = useLeadStore((s) => s.projects);
  const agentActivity: ActivityEvent[] = [];
  for (const proj of Object.values(allProjects)) {
    for (const evt of proj.activity) {
      if (evt.agentId === agentId) agentActivity.push(evt);
    }
  }

  // Build merged timeline of messages + activity
  type TimelineItem =
    | { kind: 'message'; msg: (typeof messages)[0]; index: number }
    | { kind: 'activity'; evt: ActivityEvent };

  const timeline: TimelineItem[] = [];
  messages.forEach((msg, i) => {
    if ((msg.text || msg.contentType) && !msg.queued) {
      timeline.push({ kind: 'message', msg, index: i });
    }
  });
  agentActivity.forEach((evt) => {
    timeline.push({ kind: 'activity', evt });
  });
  // Sort by timestamp
  timeline.sort((a, b) => {
    const tA = a.kind === 'message' ? (a.msg.timestamp || 0) : a.evt.timestamp;
    const tB = b.kind === 'message' ? (b.msg.timestamp || 0) : b.evt.timestamp;
    return tA - tB;
  });

  useAutoScroll(containerRef, messagesEndRef, [messages], { resetKey: agentId });

  // Promote queued messages when agent responds (new agent message after queued user messages)
  useEffect(() => {
    if (!messages.some(m => m.queued)) return;
    const lastNonQueued = [...messages].reverse().find(m => !m.queued);
    if (lastNonQueued && lastNonQueued.sender !== 'user') {
      // Agent has responded — promote all queued messages
      const updated = messages.map(m => m.queued ? { ...m, queued: false } : m);
      useAppStore.getState().updateAgent(agentId, { messages: updated });
    }
  }, [messages, agentId]);

  const removeQueuedMessage = useCallback(async (queueIndex: number) => {
    const resp = await fetch(`/api/agents/${agentId}/queue/${queueIndex}`, { method: 'DELETE' });
    if (resp.ok) {
      let seen = 0;
      const updated = messages.filter((m) => {
        if (!m.queued) return true;
        return seen++ !== queueIndex;
      });
      useAppStore.getState().updateAgent(agentId, { messages: updated });
    }
  }, [agentId, messages]);

  const reorderQueuedMessage = useCallback(async (fromIndex: number, toIndex: number) => {
    const resp = await fetch(`/api/agents/${agentId}/queue/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromIndex, to: toIndex }),
    });
    if (resp.ok) {
      const queued = messages.filter((m) => m.queued);
      const nonQueued = messages.filter((m) => !m.queued);
      if (fromIndex < queued.length && toIndex < queued.length) {
        const [moved] = queued.splice(fromIndex, 1);
        queued.splice(toIndex, 0, moved);
        useAppStore.getState().updateAgent(agentId, { messages: [...nonQueued, ...queued] });
      }
    }
  }, [agentId, messages]);

  return (
    <div className="flex-1 relative min-h-0">
    <div ref={containerRef} className="absolute inset-0 overflow-y-auto p-3 space-y-3">
      {/* Plan Section */}
      {plan.length > 0 && (
        <div className="border border-th-border rounded-lg bg-surface-raised">
          <button
            onClick={() => setPlanOpen(!planOpen)}
            className="flex items-center gap-1 w-full px-3 py-2 text-xs font-medium text-th-text-alt"
          >
            {planOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Plan ({plan.filter((e) => e.status === 'completed').length}/{plan.length})
          </button>
          {planOpen && (
            <ul className="px-3 pb-2 space-y-1">
              {plan.map((entry, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-th-text-alt">
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
            <div key={tc.toolCallId} className="border border-th-border rounded-lg bg-surface-raised p-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-th-text-alt">{typeof tc.title === 'string' ? tc.title : JSON.stringify(tc.title)}</span>
                  <span className="text-[10px] text-th-text-muted">{typeof tc.kind === 'string' ? tc.kind : JSON.stringify(tc.kind)}</span>
                </div>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${TC_STATUS[tc.status]}`}>
                  {tc.status}
                </span>
              </div>
              {tc.content && tc.status === 'completed' && (
                <pre className="mt-1 text-[11px] text-th-text-muted font-mono overflow-hidden max-h-24 bg-surface/50 rounded p-1">
                  {stringifyContent(tc.content)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages + Activity Timeline */}
      {timeline.length > 0 && (
        <div className="space-y-1">
          {timeline.map((item, i) => {
            if (item.kind === 'activity') {
              const evt = item.evt;
              const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={`act-${evt.id}`} className="flex items-center gap-2 py-0.5 px-1">
                  <span className="text-[10px] text-th-text-muted">{time}</span>
                  <span className="text-[10px] text-th-text-muted italic">
                    {evt.type === 'tool_call' ? '🔧' : evt.type === 'delegation' ? '📋' : evt.type === 'completion' ? '✅' : evt.type === 'message_sent' ? '💬' : '📊'}
                    {' '}{evt.summary}
                  </span>
                </div>
              );
            }
            // Message rendering
            const msg = item.msg;
            const sender = msg.sender ?? 'agent';
            const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            // User messages — right-aligned blue bubble
            if (sender === 'user') {
              return (
                <div key={`msg-${item.index}`} data-user-prompt={item.index} className="flex justify-end items-start gap-2 py-1">
                  <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
                  <div className="max-w-[80%] rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
                    {typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text)}
                  </div>
                </div>
              );
            }

            // Thinking/reasoning — italic, lighter color
            if (sender === 'thinking') {
              const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
              return (
                <div key={`msg-${item.index}`} className="py-0.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 font-mono text-xs text-th-text-muted italic whitespace-pre-wrap min-w-0">
                      {text}
                    </div>
                    <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{ts}</span>
                  </div>
                </div>
              );
            }

            // System messages — centered, muted, smaller
            if (sender === 'system') {
              const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
              if (text === '---') {
                return <hr key={`msg-${item.index}`} className="border-th-border/50 my-1" />;
              }
              return (
                <div key={`msg-${item.index}`} className="flex justify-center py-1">
                  <div className="max-w-[85%] rounded-lg px-3 py-1.5 bg-th-bg-alt/60 border border-th-border/50 text-xs text-th-text-muted whitespace-pre-wrap">
                    {text}
                  </div>
                </div>
              );
            }

            // Rich content (image, audio, resource)
            if (msg.contentType && msg.contentType !== 'text') {
              const mentionAttr = hasUserMention(typeof msg.text === 'string' ? msg.text : '') ? { 'data-user-prompt': item.index } : {};
              return (
                <div key={`msg-${item.index}`} className="py-1" {...mentionAttr}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {msg.contentType === 'image' && msg.data && (
                        <div>
                          <img src={`data:${msg.mimeType || 'image/png'};base64,${msg.data}`} alt="Agent image" className="max-w-full max-h-64 rounded-lg border border-th-border" />
                          {msg.uri && <p className="text-[10px] text-th-text-muted mt-1 font-mono">{msg.uri}</p>}
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
                            <pre className="text-xs font-mono text-th-text-alt bg-th-bg-alt border border-th-border rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">{msg.text}</pre>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{ts}</span>
                  </div>
                </div>
              );
            }

            // Agent messages — flowing text, no bubble
            const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text, null, 2);
            const agentMentionAttr = hasUserMention(text) ? { 'data-user-prompt': item.index } : {};
            return (
              <div key={`msg-${item.index}`} className="py-1" {...agentMentionAttr}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
                    <AgentTextBlockSimple text={text} />
                  </div>
                  <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{ts}</span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Queued messages — sent but not yet processed by agent */}
      {messages.some((m) => m.queued) && (
        <div className="border-t border-dashed border-th-border px-3 py-2 bg-th-bg-alt/50">
          <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Queued ({messages.filter((m) => m.queued).length})
          </div>
          {messages.filter((m) => m.queued).map((msg, i, arr) => (
            <div key={`q-${i}`} className="flex justify-end items-center gap-1.5 py-0.5 group">
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {i > 0 && (
                  <button onClick={() => reorderQueuedMessage(i, i - 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move up">
                    <ChevronUp className="w-3 h-3" />
                  </button>
                )}
                {i < arr.length - 1 && (
                  <button onClick={() => reorderQueuedMessage(i, i + 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move down">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                )}
                <button onClick={() => removeQueuedMessage(i)} className="p-0.5 rounded hover:bg-red-500/20 text-th-text-muted hover:text-red-400" title="Remove">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[10px] text-th-text-muted">
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <div className="max-w-[70%] rounded-lg px-3 py-1.5 bg-blue-600/40 text-blue-600 dark:text-blue-200 font-mono text-sm whitespace-pre-wrap border border-blue-500/30">
                {typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text)}
              </div>
              <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
    <PromptNav containerRef={containerRef} messages={messages} useOriginalIndices />
    </div>
  );
}

/** Collapsed-by-default ⟦ command ⟧ block with click to expand */
function CollapsibleCommandBlockSimple({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const nameMatch = text.match(/⟦\s*(\w+)/);
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
      className="my-1 px-2 py-1 bg-th-bg-alt/80 border border-th-border rounded text-[11px] text-th-text-alt cursor-pointer hover:border-th-border-hover transition-colors"
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center gap-1 min-w-0">
        {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="font-mono text-th-text-alt shrink-0">{label}</span>
        {!expanded && preview && <span className="font-mono text-th-text-muted truncate ml-1">— {preview}</span>}
      </div>
      {expanded && <pre className="mt-1 whitespace-pre-wrap break-words text-th-text-muted">{text}</pre>}
    </div>
  );
}

/** Check if a ⟦ ... ⟧ block looks like a real command (ALL_CAPS name after ⟦) */
function isRealCommandBlock(text: string): boolean {
  return /^⟦\s*[A-Z][A-Z_]{2,}/.test(text);
}

/** Render agent text with ⟦ ⟧ blocks separated and inline markdown + tables */
function AgentTextBlockSimple({ text }: { text: string }) {
  const segments = text.split(/(⟦[\s\S]*?⟧)/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('⟦') && seg.endsWith('⟧')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlockSimple key={i} text={seg} />;
          }
          // Not a real command — render as plain text
          return <BlockMarkdownSimple key={i} text={seg} />;
        }
        // Unclosed ⟦ block
        if (seg.includes('⟦') && !seg.includes('⟧')) {
          const idx = seg.indexOf('⟦');
          const before = seg.slice(0, idx);
          const cmdBlock = seg.slice(idx);
          if (isRealCommandBlock(cmdBlock)) {
            return (
              <span key={i}>
                {before.trim() ? <BlockMarkdownSimple text={before} /> : null}
                <CollapsibleCommandBlockSimple text={cmdBlock} />
              </span>
            );
          }
          // Not a real command — render entire segment as text
          return seg.trim() ? <BlockMarkdownSimple key={i} text={seg} /> : null;
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
              return <BlockMarkdownSimple key={j} text={part} />;
            })}
          </span>
        );
      })}
    </>
  );
}

/** Inline markdown with @mention support — delegates to shared component */
function InlineMarkdownSimple({ text }: { text: string }) {
  const agents = useAppStore((s) => s.agents);
  return <InlineMarkdownWithMentions text={text} mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />;
}

/** Block-level markdown: splits on fenced code blocks, delegates non-code to InlineMarkdownSimple */
function BlockMarkdownSimple({ text }: { text: string }) {
  const CODE_BLOCK_RE = /(```[\s\S]*?```)/g;
  const segments = text.split(CODE_BLOCK_RE);
  if (segments.length === 1) return <InlineMarkdownSimple text={text} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('```') && seg.endsWith('```')) {
          const inner = seg.slice(3, -3);
          const newlineIdx = inner.indexOf('\n');
          const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : '';
          const content = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
          return (
            <pre key={i} className="bg-th-bg-alt border border-th-border rounded-md px-3 py-2 my-1.5 overflow-x-auto text-xs font-mono text-th-text-alt whitespace-pre" data-lang={lang || undefined}>
              <code>{content}</code>
            </pre>
          );
        }
        if (!seg.trim()) return null;
        return <InlineMarkdownSimple key={i} text={seg} />;
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
      <table className="text-xs font-mono border-collapse border border-th-border w-full">
        <thead>
          <tr className="bg-th-bg-alt">
            {headerCells.map((c, j) => (
              <th key={j} className="border border-th-border px-2 py-1 text-left text-th-text-alt font-semibold">
                <InlineMarkdownSimple text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-th-bg/30' : 'bg-th-bg-alt/30'}>
              {row.map((c, ci) => (
                <td key={ci} className="border border-th-border px-2 py-1 text-th-text-alt">
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
