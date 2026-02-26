import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AcpToolCall, AcpPlanEntry } from '../../types';
import { ChevronDown, ChevronRight, User, Bot } from 'lucide-react';

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

/** Safely render tool call content — handles string, array, or object */
function stringifyContent(content: any): string {
  if (typeof content === 'string') return content.slice(0, 500);
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c?.text) return c.text;
        if (c?.content) return typeof c.content === 'string' ? c.content : JSON.stringify(c.content, null, 2);
        return JSON.stringify(c, null, 2);
      })
      .join('\n')
      .slice(0, 500);
  }
  if (content && typeof content === 'object') {
    if (content.text) return String(content.text).slice(0, 500);
    if (content.content) return typeof content.content === 'string' ? content.content.slice(0, 500) : JSON.stringify(content.content, null, 2).slice(0, 500);
    return JSON.stringify(content, null, 2).slice(0, 500);
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
        <div className="space-y-2">
          {messages.filter((msg) => msg.sender !== 'system' && msg.text).map((msg, i) => {
            const sender = msg.sender ?? 'agent';
            return (
              <div
                key={i}
                className={`flex gap-2 ${sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {sender === 'agent' && (
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot size={14} className="text-accent" />
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 max-w-[85%] text-sm font-mono whitespace-pre-wrap ${
                    sender === 'user'
                      ? 'bg-accent/20 text-gray-200 border border-accent/30'
                      : 'bg-surface-raised text-gray-300 border border-gray-700'
                  }`}
                >
                  {(typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text, null, 2)).split('\n').map((line, j) => (
                    <span key={j}>
                      {j > 0 && <br />}
                      {renderMarkdown(line)}
                    </span>
                  ))}
                </div>
                {sender === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-1">
                    <User size={14} className="text-blue-400" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}
    </div>
  );
}
