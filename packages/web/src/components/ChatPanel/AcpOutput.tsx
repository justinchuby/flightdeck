import { apiFetch } from '../../hooks/useApi';
import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppStore } from '../../stores/appStore';
import { useMessageStore, EMPTY_MESSAGES } from '../../stores/messageStore';
import { useLeadStore, type ActivityEvent } from '../../stores/leadStore';
import type { AcpToolCall, AcpPlanEntry, AcpTextChunk } from '../../types';
import { ChevronDown, ChevronUp, ChevronRight, FolderOpen, Clock, Loader2, X, MessageSquare, Wrench, FolderIcon } from 'lucide-react';
import { InlineMarkdownWithMentions, MentionText } from '../../utils/markdown';
import { splitCommandBlocks } from '../../utils/commandParser';
import { PromptNav, hasUserMention } from '../PromptNav';
import { groupTimeline, type TimelineItem, type GroupedTimelineItem } from './groupTimeline';

interface Props {
  agentId: string;
}

/** Context passed through Virtuoso to Header/Footer — keeps component refs stable */
interface AcpVirtuosoContext {
  plan: AcpPlanEntry[];
  planOpen: boolean;
  setPlanOpen: React.Dispatch<React.SetStateAction<boolean>>;
  queuedMessages: AcpTextChunk[];
  reorderQueuedMessage: (from: number, to: number) => void;
  removeQueuedMessage: (index: number) => void;
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

const _TC_STATUS: Record<AcpToolCall['status'], string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-purple-500/20 text-purple-400',
  cancelled: 'bg-gray-500/20 text-th-text-muted',
};

/** Stable module-level Header for Virtuoso — receives data via context prop */
function AcpVirtuosoHeader({ context }: { context?: AcpVirtuosoContext }) {
  if (!context) return null;
  const { plan, planOpen, setPlanOpen } = context;
  return (
    <div className="p-3 pb-0 space-y-3">
      {plan.length > 0 && (
        <div className="border border-th-border rounded-lg bg-surface-raised">
          <button
            onClick={() => setPlanOpen((o) => !o)}
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
    </div>
  );
}

/** Stable module-level Footer for Virtuoso — receives data via context prop */
function AcpVirtuosoFooter({ context }: { context?: AcpVirtuosoContext }) {
  if (!context) return null;
  const { queuedMessages, reorderQueuedMessage, removeQueuedMessage } = context;
  if (queuedMessages.length === 0) return null;
  return (
    <div className="border-t border-dashed border-th-border px-3 py-2 bg-th-bg-alt/50 mx-3 mb-3 max-h-48 overflow-y-auto">
      <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1 sticky top-0 bg-th-bg-alt/50">
        <Clock className="w-3 h-3" />
        Queued ({queuedMessages.length})
      </div>
      {queuedMessages.map((msg, i, arr) => (
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
  );
}

/** ACP content block — can be text, image, audio, resource, or a plain string */
interface ContentItem {
  type?: string;
  text?: string;
  data?: string;
  content?: unknown;
  mimeType?: string;
  resource?: { uri?: string; text?: string };
}

function renderContentItem(c: ContentItem | string): string {
  if (typeof c === 'string') return c;
  if (c == null) return '';
  if (typeof c.text === 'string' && (c.type === 'text' || !c.type || c.type === undefined)) return c.text;
  if (c.type === 'text' && typeof c.text === 'string') return c.text;
  if (c.type === 'resource') {
    const uri = c.resource?.uri ?? '';
    const text = c.resource?.text ?? '';
    return uri ? `📎 ${uri}\n${text}` : text;
  }
  if (c.type === 'image') return `[🖼️ image: ${c.mimeType ?? 'unknown'}]`;
  if (c.type === 'audio') return `[🔊 audio: ${c.mimeType ?? 'unknown'}]`;
  if (typeof c.text === 'string') return c.text;
  if (c.content) return typeof c.content === 'string' ? c.content : JSON.stringify(c.content, null, 2);
  return JSON.stringify(c, null, 2);
}

/** Safely render tool call content — handles string, array, or object */
function _stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        return _stringifyContent(parsed);
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
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dismissedPinId, setDismissedPinId] = useState<number | null>(null);

  const plan = agent?.plan ?? [];
  const messages = useMessageStore((s) => s.channels[agentId]?.messages ?? EMPTY_MESSAGES);

  // Fetch message history when agent panel opens — always merge with live WS messages
  const historyFetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!agentId || historyFetchedRef.current === agentId) return;
    historyFetchedRef.current = agentId;
    apiFetch<{ messages: Array<{ sender?: string; content?: string; text?: string; timestamp?: number }> }>(`/agents/${agentId}/messages?limit=200`)
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          const msgs: AcpTextChunk[] = data.messages.map((m) => ({
            type: 'text' as const,
            text: m.content || m.text || '',
            sender: (m.sender || 'agent') as 'agent' | 'user' | 'system' | 'thinking',
            timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          }));
          useMessageStore.getState().mergeHistory(agentId, msgs);
        }
      })
      .catch(() => { /* data will load on next poll */ });
  }, [agentId]);

  // Get activity events for this agent from leadStore
  const allProjects = useLeadStore((s) => s.projects);
  const agentActivity: ActivityEvent[] = [];
  for (const proj of Object.values(allProjects)) {
    for (const evt of proj.activity) {
      if (evt.agentId === agentId) agentActivity.push(evt);
    }
  }

  // Build merged timeline of messages + activity
  const timeline: TimelineItem[] = [];
  messages.forEach((msg, i) => {
    if ((msg.text || msg.contentType) && !msg.queued) {
      timeline.push({ kind: 'message', msg, index: i });
    }
  });
  // Filter out tool_call activity events — those are already represented by
  // sender='tool' messages injected from the WebSocket tool_call handler
  agentActivity.forEach((evt) => {
    if (evt.type === 'tool_call') return;
    timeline.push({ kind: 'activity', evt });
  });
  // Sort by timestamp
  timeline.sort((a, b) => {
    const tA = a.kind === 'message' ? (a.msg.timestamp || 0) : a.evt.timestamp;
    const tB = b.kind === 'message' ? (b.msg.timestamp || 0) : b.evt.timestamp;
    return tA - tB;
  });

  // Group consecutive agent messages, collecting interleaved system events
  const groupedTimeline = groupTimeline(timeline);

  // Find the latest non-queued user message for the pinned banner
  const latestUserMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender === 'user' && !m.queued) return { msg: m, index: i };
    }
    return null;
  }, [messages]);

  // Check if the latest user message is the very last message (agent hasn't responded yet)
  const isLatestUserPending = latestUserMsg && messages.length > 0 &&
    messages[messages.length - 1].sender === 'user' && !messages[messages.length - 1].queued;

  // Find which groupedTimeline index contains the latest user message
  const pinnedTargetIndex = useMemo(() => {
    if (!latestUserMsg) return -1;
    for (let i = groupedTimeline.length - 1; i >= 0; i--) {
      const item = groupedTimeline[i];
      if (item.kind === 'message' && item.msg === latestUserMsg.msg) return i;
    }
    return -1;
  }, [groupedTimeline, latestUserMsg]);

  // Show pinned banner when: user msg exists, agent has responded after it (so it's buried),
  // user hasn't dismissed it, and we're not at bottom (where it's already visible)
  const showPinnedBanner = latestUserMsg && !isLatestUserPending &&
    dismissedPinId !== latestUserMsg.index && !atBottom && pinnedTargetIndex >= 0;

  // Reset dismissal when a new user message arrives
  useEffect(() => {
    if (latestUserMsg) setDismissedPinId(null);
  }, [latestUserMsg?.index]);

  // Build mapping: original message index → groupedTimeline index (for PromptNav)
  const msgIndexToVirtuosoIndex = useMemo(() => {
    const map = new Map<number, number>();
    groupedTimeline.forEach((item, vIdx) => {
      if (item.kind === 'agent-group') {
        item.messages.forEach((m) => map.set(m.index, vIdx));
      } else if (item.kind === 'message') {
        map.set(item.index, vIdx);
      }
    });
    return map;
  }, [groupedTimeline]);

  // PromptNav callback: scroll Virtuoso to the item containing the target message
  const handlePromptJump = useCallback((messageIndex: number) => {
    const vIdx = msgIndexToVirtuosoIndex.get(messageIndex);
    if (vIdx != null) {
      virtuosoRef.current?.scrollToIndex({ index: vIdx, align: 'center', behavior: 'smooth' });
    }
  }, [msgIndexToVirtuosoIndex]);

  // Promote queued messages when agent responds (new agent message after queued user messages)
  useEffect(() => {
    if (!messages.some(m => m.queued)) return;
    const lastNonQueued = [...messages].reverse().find(m => !m.queued);
    if (lastNonQueued && lastNonQueued.sender !== 'user') {
      // Agent has responded — promote all queued messages
      useMessageStore.getState().promoteQueuedMessages(agentId);
    }
  }, [messages, agentId]);

  const removeQueuedMessage = useCallback(async (queueIndex: number) => {
    try {
      await apiFetch(`/agents/${agentId}/queue/${queueIndex}`, { method: 'DELETE' });
      let seen = 0;
      const updated = messages.filter((m) => {
        if (!m.queued) return true;
        return seen++ !== queueIndex;
      });
      useMessageStore.getState().setMessages(agentId, updated);
    } catch { /* ignore */ }
  }, [agentId, messages]);

  const reorderQueuedMessage = useCallback(async (fromIndex: number, toIndex: number) => {
    try {
      await apiFetch(`/agents/${agentId}/queue/reorder`, {
        method: 'POST',
        body: JSON.stringify({ from: fromIndex, to: toIndex }),
      });
      const queued = messages.filter((m) => m.queued);
      const nonQueued = messages.filter((m) => !m.queued);
      if (fromIndex < queued.length && toIndex < queued.length) {
        const [moved] = queued.splice(fromIndex, 1);
        queued.splice(toIndex, 0, moved);
        useMessageStore.getState().setMessages(agentId, [...nonQueued, ...queued]);
      }
    } catch { /* ignore */ }
  }, [agentId, messages]);

  const queuedMessages = useMemo(() => messages.filter((m) => m.queued), [messages]);

  // Context object passed to stable module-level Header/Footer via Virtuoso
  const virtuosoContext: AcpVirtuosoContext = useMemo(() => ({
    plan, planOpen, setPlanOpen,
    queuedMessages, reorderQueuedMessage, removeQueuedMessage,
  }), [plan, planOpen, setPlanOpen, queuedMessages, reorderQueuedMessage, removeQueuedMessage]);

  return (
    <div className="flex-1 relative min-h-0">
    <div ref={containerRef} className="absolute inset-0">
      <Virtuoso
        ref={virtuosoRef}
        data={groupedTimeline}
        context={virtuosoContext}
        overscan={400}
        atBottomThreshold={150}
        atBottomStateChange={setAtBottom}
        followOutput={atBottom ? 'smooth' : false}
        initialTopMostItemIndex={groupedTimeline.length > 0 ? groupedTimeline.length - 1 : 0}
        className="h-full"
        components={{
          Header: AcpVirtuosoHeader,
          Footer: AcpVirtuosoFooter,
        }}
        itemContent={(index, item) => (
          <div className="px-3">
            <TimelineRow item={item} />
          </div>
        )}
      />
    </div>
    {/* Pinned user message banner — stays visible until dismissed or scrolled to */}
    {showPinnedBanner && latestUserMsg && (
      <div className="absolute top-0 left-0 right-0 z-10 mx-3 mt-1 animate-in fade-in slide-in-from-top-2 duration-200">
        <div className="bg-blue-600/95 backdrop-blur-sm border border-blue-500/50 rounded-lg px-3 py-2 shadow-lg flex items-start gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-blue-200 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-blue-200/80 font-medium uppercase tracking-wider mb-0.5">Latest User Message</div>
            <div className="text-sm text-white font-mono whitespace-pre-wrap line-clamp-3">
              {typeof latestUserMsg.msg.text === 'string' ? latestUserMsg.msg.text : JSON.stringify(latestUserMsg.msg.text)}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                virtuosoRef.current?.scrollToIndex({ index: pinnedTargetIndex, align: 'center', behavior: 'smooth' });
                setDismissedPinId(latestUserMsg.index);
              }}
              className="text-[10px] px-2 py-1 rounded bg-blue-500/50 hover:bg-blue-500/70 text-white transition-colors"
            >
              Jump
            </button>
            <button
              onClick={() => setDismissedPinId(latestUserMsg.index)}
              className="p-0.5 rounded hover:bg-blue-500/50 text-blue-200 transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    )}
    <PromptNav containerRef={containerRef} messages={messages} useOriginalIndices onJump={handlePromptJump} />
    </div>
  );
}

/** Renders a single grouped timeline item — memoized for Virtuoso performance */
const TimelineRow = memo(function TimelineRow({ item }: { item: GroupedTimelineItem }) {
  if (item.kind === 'agent-group') {
    const group = item;
    const lastMsg = group.messages[group.messages.length - 1];
    const lastTs = lastMsg.msg.timestamp ? new Date(lastMsg.msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const hasMention = group.messages.some((m) => hasUserMention(typeof m.msg.text === 'string' ? m.msg.text : ''));
    const mentionAttr = hasMention ? { 'data-user-prompt': group.messages[0].index } : {};

    return (
      <div className="py-1" {...mentionAttr}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {/* Merge adjacent agent text messages so split command blocks render correctly.
                NOTE: Parallel merge logic exists in LeadDashboard.tsx (agent message rendering). */}
            {(() => {
              const runs: { kind: 'agent' | 'thinking'; text: string; key: string }[] = [];
              for (const m of group.messages) {
                const sender = m.msg.sender ?? 'agent';
                const text = typeof m.msg.text === 'string' ? m.msg.text : JSON.stringify(m.msg.text, null, 2);
                if (sender === 'thinking') {
                  runs.push({ kind: 'thinking', text, key: `msg-${m.index}` });
                } else {
                  const last = runs[runs.length - 1];
                  if (last?.kind === 'agent') {
                    last.text += text;
                  } else {
                    runs.push({ kind: 'agent', text, key: `msg-${m.index}` });
                  }
                }
              }
              return runs.map((run) => {
                if (run.kind === 'thinking') {
                  return (
                    <div key={run.key} className="font-mono text-xs text-th-text-muted italic whitespace-pre-wrap min-w-0">
                      {run.text}
                    </div>
                  );
                }
                return (
                  <div key={run.key} className="font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
                    <AgentTextBlockSimple text={run.text} />
                  </div>
                );
              });
            })()}
          </div>
          <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{lastTs}</span>
        </div>
        {/* Render 📨 DM notifications from system events with proper orange styling */}
        {group.systemEvents
          .filter((e) => e.kind === 'message' && typeof e.msg.text === 'string' && e.msg.text.startsWith('📨'))
          .map((e, i) => {
            const msg = (e as { kind: 'message'; msg: { text: string; timestamp?: number }; index: number }).msg;
            const dmTs = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return <CollapsibleIncomingMessage key={`dm-${i}`} text={msg.text} timestamp={dmTs} />;
          })}
        {/* Remaining system events in collapsible toggle */}
        {(() => {
          const nonDm = group.systemEvents.filter(
            (e) => !(e.kind === 'message' && typeof e.msg.text === 'string' && e.msg.text.startsWith('📨')),
          );
          return nonDm.length > 0 ? <CollapsibleSystemEvents events={nonDm} /> : null;
        })()}
      </div>
    );
  }

  if (item.kind === 'tool-group') {
    return <CollapsibleToolGroup tools={item.tools} />;
  }

  if (item.kind === 'activity') {
    const evt = item.evt;
    const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="flex items-center gap-2 py-0.5 px-1">
        <span className="text-[10px] text-th-text-muted">{time}</span>
        <span className="text-[10px] text-th-text-muted italic">
          {evt.type === 'tool_call' ? '🔧' : evt.type === 'delegation' ? '📋' : evt.type === 'completion' ? '✅' : evt.type === 'message_sent' ? '💬' : '📊'}
          {' '}{evt.summary}
        </span>
      </div>
    );
  }

  // Standalone message rendering
  const msg = item.msg;
  const sender = msg.sender ?? 'agent';
  const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  if (sender === 'user') {
    const rawText = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
    if (rawText.startsWith('📨')) {
      return <CollapsibleIncomingMessage text={rawText} timestamp={ts} />;
    }
    return (
      <div data-user-prompt={item.index} className="flex justify-end items-start gap-2 py-1">
        <span className="text-[10px] text-th-text-muted mt-1.5 shrink-0">{ts}</span>
        <div className="max-w-[80%]">
          <div className="rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
            <MentionText text={rawText} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-1.5 text-xs text-blue-200 flex items-center gap-1">
                <span>📷</span> {msg.attachments.length} image{msg.attachments.length > 1 ? 's' : ''} attached
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (sender === 'thinking') {
    const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
    return (
      <div className="py-0.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 font-mono text-xs text-th-text-muted italic whitespace-pre-wrap min-w-0">
            {text}
          </div>
          <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{ts}</span>
        </div>
      </div>
    );
  }

  if (sender === 'system') {
    const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
    if (text.startsWith('📤')) return null;
    if (text === '---') {
      return <hr className="border-th-border/50 my-1" />;
    }
    return (
      <div className="flex justify-center py-1">
        <div className="max-w-[85%] rounded-lg px-3 py-1.5 bg-th-bg-alt/60 border border-th-border/50 text-xs text-th-text-muted whitespace-pre-wrap">
          <MentionText text={text} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
        </div>
      </div>
    );
  }

  if (sender === 'tool') {
    return <ToolCallBadge msg={msg} />;
  }

  if (msg.contentType && msg.contentType !== 'text') {
    const mentionAttr = hasUserMention(typeof msg.text === 'string' ? msg.text : '') ? { 'data-user-prompt': item.index } : {};
    return (
      <div className="py-1" {...mentionAttr}>
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
    <div className="py-1" {...agentMentionAttr}>
      <div className="flex items-start gap-2">
        <div className="flex-1 font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
          <AgentTextBlockSimple text={text} />
        </div>
        <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{ts}</span>
      </div>
    </div>
  );
});

/** Styled tool call badge — renders with proper icon, status color, and tool kind.
 *  Collapsible via <details> when tool call content is available. */
function ToolCallBadge({ msg }: { msg: AcpTextChunk }) {
  const status = msg.toolStatus ?? 'in_progress';
  const kind = msg.toolKind ?? '';
  const title = typeof msg.text === 'string' ? msg.text : String(msg.text);
  const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // Look up tool call content from the agent's live toolCalls array
  const agents = useAppStore((s) => s.agents);
  const content = useMemo(() => {
    if (!msg.toolCallId) return undefined;
    for (const agent of agents) {
      const tc = agent.toolCalls?.find((t) => t.toolCallId === msg.toolCallId);
      if (tc?.content) return tc.content;
    }
    return undefined;
  }, [agents, msg.toolCallId]);

  const statusColors: Record<string, string> = {
    pending: 'text-yellow-500',
    in_progress: 'text-blue-400',
    completed: 'text-emerald-500',
    cancelled: 'text-gray-400',
  };
  const color = statusColors[status] || 'text-th-text-muted';

  const badge = (
    <div className="flex items-center gap-1.5 py-0.5 px-1">
      {content && <ChevronRight className="w-3 h-3 shrink-0 text-th-text-muted details-open-rotate" />}
      <Wrench size={11} className={`shrink-0 ${color}`} />
      <span className={`text-[10px] font-mono ${color}`}>{title}</span>
      {kind && <span className="text-[9px] text-th-text-muted bg-th-bg-alt px-1 rounded">{kind}</span>}
      {ts && <span className="text-[10px] text-th-text-muted ml-auto shrink-0">{ts}</span>}
    </div>
  );

  if (!content) return badge;

  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer select-none list-none">{badge}</summary>
      <pre className="ml-5 mt-0.5 mb-1 text-[10px] text-th-text-muted font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
        {content.length > 2000 ? content.slice(0, 2000) + '…' : content}
      </pre>
    </details>
  );
}

/** Collapsed-by-default group of consecutive tool calls */
function CollapsibleToolGroup({ tools }: { tools: Array<{ msg: AcpTextChunk; index: number }> }) {
  const [expanded, setExpanded] = useState(false);
  const completedCount = tools.filter((t) => t.msg.toolStatus === 'completed').length;
  const label = completedCount === tools.length
    ? `${tools.length} tool use${tools.length !== 1 ? 's' : ''} ✓`
    : `${tools.length} tool use${tools.length !== 1 ? 's' : ''}`;

  return (
    <div className="py-0.5">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[10px] text-th-text-muted hover:text-th-text-alt transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench size={11} className="shrink-0" />
        {label}
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0">
          {tools.map((t, i) => (
            <ToolCallBadge key={`tg-${i}`} msg={t.msg} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Collapsed-by-default incoming DM with click to expand */
function CollapsibleIncomingMessage({ text, timestamp }: { text: string; timestamp: string }) {
  const [expanded, setExpanded] = useState(false);
  const headerMatch = text.match(/^📨\s*\[From\s+(.+?)\]\s*/);
  const sender = headerMatch ? headerMatch[1] : 'Agent';
  const body = headerMatch ? text.slice(headerMatch[0].length) : text;
  const preview = body.replace(/[\n\r]+/g, ' ').slice(0, 80);

  return (
    <div className="py-0.5">
      <div
        className="my-0.5 px-2 py-1 bg-amber-500/10 border border-amber-400/20 rounded text-[11px] text-th-text-alt cursor-pointer hover:border-amber-400/40 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-1 min-w-0">
          {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <MessageSquare className="w-3 h-3 shrink-0 text-amber-500" />
          <span className="font-mono text-amber-600 dark:text-amber-400 shrink-0">{sender}</span>
          {!expanded && preview && <span className="font-mono text-th-text-muted truncate ml-1">— {preview}</span>}
          {timestamp && <span className="text-[10px] text-th-text-muted ml-auto shrink-0">{timestamp}</span>}
        </div>
        {expanded && (
          <div className="mt-1 whitespace-pre-wrap break-words text-th-text-alt font-mono text-xs">
            <MentionText text={body} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsed-by-default section showing system events that occurred during an agent turn */
function CollapsibleSystemEvents({ events }: { events: Array<{ kind: 'message'; msg: AcpTextChunk; index: number } | { kind: 'activity'; evt: ActivityEvent }> }) {
  // Count tool calls separately for a better label
  const toolCount = events.filter((e) => e.kind === 'message' && e.msg.sender === 'tool').length;
  const otherCount = events.length - toolCount;
  const label = toolCount > 0 && otherCount === 0
    ? `${toolCount} tool use${toolCount !== 1 ? 's' : ''}`
    : toolCount > 0
      ? `${toolCount} tool use${toolCount !== 1 ? 's' : ''}, ${otherCount} event${otherCount !== 1 ? 's' : ''}`
      : `${events.length} system event${events.length !== 1 ? 's' : ''}`;

  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[10px] text-th-text-muted hover:text-th-text-alt transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {label}
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {events.map((item, i) => {
            if (item.kind === 'activity') {
              const evt = item.evt;
              const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={`sysevt-${i}`} className="flex items-center gap-2 text-[10px] text-th-text-muted">
                  <span>{time}</span>
                  <span className="italic">
                    {evt.type === 'tool_call' ? '🔧' : evt.type === 'delegation' ? '📋' : evt.type === 'completion' ? '✅' : evt.type === 'message_sent' ? '💬' : '📊'}
                    {' '}{evt.summary}
                  </span>
                </div>
              );
            }
            const msg = item.msg;
            // Tool messages get proper badge rendering
            if (msg.sender === 'tool') {
              return <ToolCallBadge key={`sysevt-${i}`} msg={msg} />;
            }
            const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
            const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return (
              <div key={`sysevt-${i}`} className="flex items-center gap-2 text-[10px] text-th-text-muted">
                <span>{ts}</span>
                <span className="whitespace-pre-wrap">{text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tool output parsing for "Info:" lines ──────────────────────────────

type TextPart = { type: 'text'; text: string } | { type: 'tool-output'; lines: string[] };

/** Split agent text into alternating plain-text and consecutive "Info:" line groups */
export function splitToolOutput(text: string): TextPart[] {
  const lines = text.split('\n');
  const parts: TextPart[] = [];
  let textLines: string[] = [];
  let infoLines: string[] = [];

  const INFO_RE = /^Info:\s+.+$/;
  const PATH_RE = /^\/\S+$/;

  const flushText = () => {
    if (textLines.length > 0) {
      parts.push({ type: 'text', text: textLines.join('\n') });
      textLines = [];
    }
  };
  const flushInfo = () => {
    if (infoLines.length > 0) {
      parts.push({ type: 'tool-output', lines: infoLines });
      infoLines = [];
    }
  };

  for (const line of lines) {
    if (INFO_RE.test(line) || PATH_RE.test(line)) {
      flushText();
      infoLines.push(line);
    } else {
      flushInfo();
      textLines.push(line);
    }
  }

  flushText();
  flushInfo();

  return parts;
}

/** Find the longest common directory prefix across an array of paths */
export function findCommonPrefix(paths: string[]): string {
  if (paths.length <= 1) return '';
  const splits = paths.map((p) => p.split('/'));
  const minLen = Math.min(...splits.map((s) => s.length));
  let depth = 0;
  for (let i = 0; i < minLen; i++) {
    if (splits.every((s) => s[i] === splits[0][i])) {
      depth = i + 1;
    } else {
      break;
    }
  }
  if (depth <= 1) return '';
  return splits[0].slice(0, depth).join('/') + '/';
}

/** Collapsed-by-default block for consecutive Info:/path lines */
function CollapsibleToolOutput({ lines }: { lines: string[] }) {
  const paths = lines.map((l) => l.replace(/^Info:\s+/, ''));
  const prefix = findCommonPrefix(paths);
  const shortPaths = paths.map((p) => (prefix ? p.slice(prefix.length) : p));

  const summary =
    lines.length === 1 ? `📁 ${shortPaths[0]}` : `📁 ${lines.length} files`;

  return (
    <details className="my-0.5 text-[11px]">
      <summary className="cursor-pointer text-th-text-muted hover:text-th-text-alt select-none list-none flex items-center gap-1">
        <ChevronRight className="w-3 h-3 shrink-0 details-open-rotate" />
        <span>{summary}</span>
      </summary>
      <div className="ml-4 mt-0.5 text-th-text-muted font-mono">
        {shortPaths.map((p, i) => (
          <div key={i} className="truncate">
            {p}
          </div>
        ))}
      </div>
    </details>
  );
}

/** Collapsed-by-default ⟦⟦ command ⟧⟧ block with click to expand */
function CollapsibleCommandBlockSimple({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const nameMatch = text.match(/⟦⟦\s*(\w+)/);
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

/** Check if a ⟦⟦ ... ⟧⟧ block looks like a real command (ALL_CAPS name after ⟦⟦) */
function isRealCommandBlock(text: string): boolean {
  return /^⟦⟦\s*[A-Z][A-Z_]{2,}/.test(text);
}

/** Render agent text with ⟦⟦ ⟧⟧ blocks separated and inline markdown + tables */
function AgentTextBlockSimple({ text }: { text: string }) {
  // First: split out consecutive "Info:" / path-only line groups
  const topParts = splitToolOutput(text);
  return (
    <>
      {topParts.map((part, pi) => {
        if (part.type === 'tool-output') {
          return <CollapsibleToolOutput key={`to-${pi}`} lines={part.lines} />;
        }
        return <AgentTextSegment key={`ts-${pi}`} text={part.text} />;
      })}
    </>
  );
}

/** Render a text segment with ⟦⟦ ⟧⟧ command blocks, tables, and inline markdown */
function AgentTextSegment({ text }: { text: string }) {
  const segments = splitCommandBlocks(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith('⟦⟦') && seg.endsWith('⟧⟧')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlockSimple key={i} text={seg} />;
          }
          return <BlockMarkdownSimple key={i} text={seg} />;
        }
        if (seg.startsWith('⟦⟦')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlockSimple key={i} text={seg} />;
          }
          return seg.trim() ? <BlockMarkdownSimple key={i} text={seg} /> : null;
        }
        if (seg.includes('⟧⟧') && !seg.includes('⟦⟦')) {
          const idx = seg.indexOf('⟧⟧') + 2;
          const cmdBlock = seg.slice(0, idx);
          const after = seg.slice(idx);
          return (
            <span key={i}>
              <CollapsibleCommandBlockSimple text={cmdBlock} />
              {after.trim() ? <BlockMarkdownSimple text={after} /> : null}
            </span>
          );
        }
        if (!seg.trim()) return null;
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
