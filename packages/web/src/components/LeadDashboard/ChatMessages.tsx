import React from 'react';
import { RefreshCw, Loader2, MessageSquare } from 'lucide-react';
import { MentionText } from '../../utils/markdown';
import { Markdown } from '../ui/Markdown';
import { CollapsibleReasoningBlock, RichContentBlock, AgentTextBlock } from './ChatRenderers';
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

export function ChatMessages({
  messages,
  agents,
  isActive,
  chatContainerRef,
  messagesEndRef,
  catchUpSummary,
  onDismissCatchUp,
  onScrollToBottom,
}: ChatMessagesProps) {
  // Track message indices consumed by forward-merge so they don't render twice
  const mergedIndices = new Set<number>();

  return (
    <div className="flex-1 relative min-h-0">
      <div ref={chatContainerRef} className="absolute inset-0 overflow-y-auto p-4 space-y-1">
        {messages.filter((msg) => msg.text).map((msg, i, filtered) => {
          if (msg.queued) return null;
          if (mergedIndices.has(i)) return null;
          const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

          if (msg.sender === 'user') {
            return (
              <div key={i} data-user-prompt={i} className="flex justify-end items-start gap-2 py-1">
                <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
                <div className="max-w-[80%]">
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
                      {msg.attachments.map((att, ai) => (
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
                    <MentionText text={msg.text} agents={agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                  </div>
                </div>
              </div>
            );
          }

          if (msg.sender === 'external') {
            return (
              <div key={i} className="flex items-start gap-2 py-1 bg-amber-500/[0.06] rounded-md border-l-2 border-amber-500/30 pl-2">
                <div className="max-w-[85%] rounded-lg px-3 py-2 bg-amber-500/10 dark:bg-amber-900/30 border border-amber-400/20 dark:border-amber-600/30 font-mono text-sm whitespace-pre-wrap text-th-text-alt">
                  <div className="flex items-center gap-1.5 mb-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
                    <MessageSquare className="w-3 h-3" />
                    {msg.fromRole || 'Agent'}
                  </div>
                  <Markdown text={msg.text} mentionAgents={agents} onMentionClick={(id) => useAppStore.getState().setSelectedAgent(id)} />
                </div>
                <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
              </div>
            );
          }

          if (msg.sender === 'system') {
            const sysText = typeof msg.text === 'string' ? msg.text : '';
            if (sysText.startsWith('📤')) return null;

            if (sysText.startsWith('💬')) return null;
            if (sysText.startsWith('📢')) return null;
            if (sysText.startsWith('🗣️')) return null;
            return (
              <div key={i} className="flex justify-center py-1">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-th-bg-alt/60 border border-th-border/50 text-xs font-mono text-th-text-muted">
                  <RefreshCw className="w-3 h-3 text-th-text-muted" />
                  <MentionText text={msg.text} agents={agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                  {ts && <span className="text-[10px] text-th-text-muted ml-1">{ts}</span>}
                </div>
              </div>
            );
          }

          if (msg.sender === 'thinking') {
            return <CollapsibleReasoningBlock key={i} text={msg.text} timestamp={ts} />;
          }

          // Agent messages - merge consecutive
          const prevMsg = i > 0 ? filtered[i - 1] : null;
          const isFirstInRun = !prevMsg || prevMsg.sender !== 'agent' || prevMsg.queued
            || (prevMsg.contentType && prevMsg.contentType !== 'text');
          const agentTs = isFirstInRun ? ts : '';

          if (!isFirstInRun && (!msg.contentType || msg.contentType === 'text')) {
            return null;
          }

          let mergedText = msg.text;
          if (isFirstInRun && (!msg.contentType || msg.contentType === 'text')) {
            for (let j = i + 1; j < filtered.length; j++) {
              const next = filtered[j];
              if (next.sender !== 'agent' || next.queued || (next.contentType && next.contentType !== 'text')) {
                // If merged text has an unclosed command block, skip non-agent messages
                // to rejoin split commands (e.g. external DMs interleaved mid-command)
                if (hasUnclosedCommandBlock(mergedText)) {
                  continue;
                }
                break;
              }
              mergedText += next.text;
              mergedIndices.add(j);
            }
          }

          if (msg.contentType && msg.contentType !== 'text') {
            return (
              <div key={i} className="py-1" {...(hasUserMention(msg.text) ? { 'data-user-prompt': i } : {})}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <RichContentBlock msg={msg} />
                  </div>
                  {agentTs && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{agentTs}</span>}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="py-0.5" {...(hasUserMention(msg.text) ? { 'data-user-prompt': i } : {})}>
              <div className="flex items-start gap-2">
                <div className="flex-1 font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
                  <AgentTextBlock text={mergedText} />
                </div>
                {agentTs && <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{agentTs}</span>}
              </div>
            </div>
          );
        })}
        {isActive && messages.length > 0 && messages[messages.length - 1]?.sender === 'user' && !messages[messages.length - 1]?.queued && (
          <div className="flex justify-start py-1">
            <div className="text-th-text-muted font-mono text-sm flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-yellow-600 dark:text-yellow-400" />
              <span>Working...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
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
