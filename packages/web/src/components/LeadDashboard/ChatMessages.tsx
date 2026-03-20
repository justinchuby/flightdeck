import React, { useMemo, useCallback, useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { RefreshCw, Loader2 } from 'lucide-react';
import { MentionText } from '../../utils/markdown';
import { CollapsibleReasoningBlock, CollapsibleSystemBlock, RichContentBlock, AgentTextBlock } from './ChatRenderers';
import { PromptNav, hasUserMention } from '../PromptNav';
import { useAppStore } from '../../stores/appStore';
import { hasUnclosedCommandBlock } from '../../utils/commandParser';
import type { AcpTextChunk, AgentInfo } from '../../types';

export interface CatchUpSummary {
  tasksCompleted: number;
  pendingDecisions: number;
  newMessages: number;
  newReports: number;
}

// Pre-computed chat item after filtering and merging
interface ChatItem {
  kind: 'user' | 'system' | 'system-long' | 'separator' | 'thinking' | 'agent-rich' | 'agent-text' | 'working';
  msg: AcpTextChunk;
  ts: string;
  mergedText?: string;
  isFirstInRun?: boolean;
  originalIndex: number;
}

/** Pre-compute the visible chat items: filter, merge consecutive agents, etc. */
function buildChatItems(messages: AcpTextChunk[], isActive: boolean): ChatItem[] {
  const filtered = messages.filter((msg) => msg.text && msg.sender !== 'external' && !msg.queued);
  const items: ChatItem[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < filtered.length; i++) {
    if (mergedIndices.has(i)) continue;
    const msg = filtered[i];
    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (msg.sender === 'user') {
      items.push({ kind: 'user', msg, ts, originalIndex: i });
      continue;
    }

    if (msg.sender === 'system') {
      const sysText = typeof msg.text === 'string' ? msg.text : '';

      if (sysText === '---') {
        items.push({ kind: 'separator', msg, ts, originalIndex: i });
        continue;
      }

      items.push({ kind: sysText.length > 200 ? 'system-long' : 'system', msg, ts, originalIndex: i });
      continue;
    }

    if (msg.sender === 'thinking') {
      items.push({ kind: 'thinking', msg, ts, originalIndex: i });
      continue;
    }

    // Agent messages — merge consecutive text-only
    const prevMsg = i > 0 ? filtered[i - 1] : null;
    const isFirstInRun = !prevMsg || prevMsg.sender !== 'agent' || prevMsg.queued
      || (prevMsg.contentType && prevMsg.contentType !== 'text');

    if (!isFirstInRun && (!msg.contentType || msg.contentType === 'text')) continue;

    if (msg.contentType && msg.contentType !== 'text') {
      items.push({ kind: 'agent-rich', msg, ts: isFirstInRun ? ts : '', isFirstInRun, originalIndex: i });
      continue;
    }

    let mergedText = msg.text;
    if (isFirstInRun) {
      for (let j = i + 1; j < filtered.length; j++) {
        const next = filtered[j];
        if (next.sender !== 'agent' || next.queued || (next.contentType && next.contentType !== 'text')) {
          if (hasUnclosedCommandBlock(mergedText)) continue;
          break;
        }
        mergedText += next.text;
        mergedIndices.add(j);
      }
    }
    items.push({ kind: 'agent-text', msg, ts: isFirstInRun ? ts : '', mergedText, isFirstInRun, originalIndex: i });
  }

  // "Working..." indicator
  if (isActive && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last?.sender === 'user' && !last.queued) {
      items.push({ kind: 'working', msg: last, ts: '', originalIndex: -1 });
    }
  }

  return items;
}

interface ChatMessagesProps {
  messages: AcpTextChunk[];
  agents: AgentInfo[];
  isActive: boolean;
  chatContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  catchUpSummary: CatchUpSummary | null;
  onDismissCatchUp: () => void;
  onScrollToBottom: () => void;
}

/** Context passed to Virtuoso Footer for the working indicator */
interface ChatVirtuosoContext {
  agents: AgentInfo[];
}

/** Stable Footer — Virtuoso requires module-level components to avoid remount */
function ChatVirtuosoFooter(_props: { context?: ChatVirtuosoContext }) {
  // Empty spacer — ensures Virtuoso has a footer slot (needed for followOutput)
  return <div className="h-1" />;
}

export function ChatMessages({
  messages,
  agents,
  isActive,
  chatContainerRef,
  messagesEndRef: _messagesEndRef,
  catchUpSummary,
  onDismissCatchUp,
  onScrollToBottom,
}: ChatMessagesProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const items = useMemo(() => buildChatItems(messages, isActive), [messages, isActive]);

  const context = useMemo<ChatVirtuosoContext>(() => ({ agents }), [agents]);

  const handleClickAgent = useCallback((id: string) => {
    useAppStore.getState().setSelectedAgent(id);
  }, []);

  const itemContent = useCallback((index: number, item: ChatItem) => {
    const { agents: ctxAgents } = context;

    if (item.kind === 'user') {
      return (
        <div data-user-prompt={item.originalIndex} className="cv-auto flex justify-end items-start gap-2 py-1">
          <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{item.ts}</span>
          <div className="max-w-[80%]">
            {item.msg.attachments && item.msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
                {item.msg.attachments.map((att, ai) => (
                  <div key={ai} className="rounded-lg overflow-hidden border border-white/20">
                    {att.thumbnailDataUrl ? (
                      <img src={att.thumbnailDataUrl} alt={att.name} className="max-h-24 rounded-lg" />
                    ) : (
                      <div className="px-2 py-1 bg-blue-700 text-xs text-blue-200">{att.name}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
              <MentionText text={item.msg.text} agents={ctxAgents} onClickAgent={handleClickAgent} />
            </div>
          </div>
        </div>
      );
    }

    if (item.kind === 'system-long') {
      return <CollapsibleSystemBlock text={item.msg.text} timestamp={item.ts} />;
    }

    if (item.kind === 'separator') {
      return <div className="border-t border-th-border/50 my-2" />;
    }

    if (item.kind === 'system') {
      return (
        <div className="flex justify-center py-1">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-th-bg-alt/60 border border-th-border/50 text-xs font-mono text-th-text-muted">
            <RefreshCw className="w-3 h-3 text-th-text-muted" />
            <MentionText text={item.msg.text} agents={ctxAgents} onClickAgent={handleClickAgent} />
            {item.ts && <span className="text-[10px] text-th-text-muted ml-1">{item.ts}</span>}
          </div>
        </div>
      );
    }

    if (item.kind === 'thinking') {
      return <CollapsibleReasoningBlock text={item.msg.text} timestamp={item.ts} />;
    }

    if (item.kind === 'agent-rich') {
      return (
        <div className="py-1" {...(hasUserMention(item.msg.text) ? { 'data-user-prompt': item.originalIndex } : {})}>
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <RichContentBlock msg={item.msg} />
            </div>
            {item.ts && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{item.ts}</span>}
          </div>
        </div>
      );
    }

    if (item.kind === 'working') {
      return (
        <div className="flex justify-start py-1">
          <div className="text-th-text-muted font-mono text-sm flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin text-yellow-600 dark:text-yellow-400" />
            <span>Working...</span>
          </div>
        </div>
      );
    }

    // agent-text
    const text = item.mergedText ?? item.msg.text;
    return (
      <div className="cv-auto py-0.5" {...(hasUserMention(item.msg.text) ? { 'data-user-prompt': item.originalIndex } : {})}>
        <div className="flex items-start gap-2">
          <div className="flex-1 font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
            <AgentTextBlock text={text} />
          </div>
          {item.ts && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{item.ts}</span>}
        </div>
      </div>
    );
  }, [context, handleClickAgent]);

  // Auto-scroll to bottom when new messages arrive, unless user scrolled up
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? 'smooth' : false;
  }, []);

  return (
    <div className="flex-1 relative min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        className="absolute inset-0 [&>div]:p-4 [&>div]:space-y-1"
        data={items}
        itemContent={itemContent}
        context={context}
        components={{ Footer: ChatVirtuosoFooter }}
        followOutput={followOutput}
        increaseViewportBy={200}
        defaultItemHeight={32}
        overscan={200}
        scrollerRef={(el) => {
          // Expose scroll container for PromptNav keyboard navigation
          if (chatContainerRef && 'current' in chatContainerRef) {
            (chatContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el as HTMLDivElement;
          }
        }}
        initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
      />
      {/* Prompt navigation */}
      <PromptNav containerRef={chatContainerRef} messages={messages} />
      {/* Catch-up summary overlay */}
      {catchUpSummary && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[420px] max-w-[calc(100%-2rem)] animate-in slide-in-from-bottom fade-in duration-300">
          <div role="status" aria-live="polite" tabIndex={0} className="bg-th-bg/95 backdrop-blur-md border border-th-border rounded-xl shadow-2xl px-4 py-3"
            onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') onDismissCatchUp(); }}>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-xs font-semibold text-th-text-alt">While you were away</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono">
              {catchUpSummary.tasksCompleted > 0 && <span className="text-emerald-400">{catchUpSummary.tasksCompleted} task{catchUpSummary.tasksCompleted !== 1 ? 's' : ''} completed</span>}
              {catchUpSummary.pendingDecisions > 0 && <span className="text-amber-400">⚠ {catchUpSummary.pendingDecisions} decision{catchUpSummary.pendingDecisions !== 1 ? 's' : ''} pending</span>}
              {catchUpSummary.newMessages > 0 && <span className="text-blue-400">{catchUpSummary.newMessages} new message{catchUpSummary.newMessages !== 1 ? 's' : ''}</span>}
              {catchUpSummary.newReports > 0 && <span className="text-amber-600 dark:text-amber-400">{catchUpSummary.newReports} report{catchUpSummary.newReports !== 1 ? 's' : ''}</span>}
            </div>
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => onDismissCatchUp()} className="text-[11px] px-2 py-1 rounded-md bg-th-bg-alt border border-th-border text-th-text-alt hover:bg-th-bg-muted transition-colors">Dismiss</button>
              <button onClick={() => { onDismissCatchUp(); onScrollToBottom(); }} className="text-[11px] px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors">Show All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
