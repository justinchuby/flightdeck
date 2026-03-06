import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type ActivityEvent } from '../../stores/leadStore';
import type { AcpPlanEntry, AcpTextChunk } from '../../types';
import { ChevronDown, ChevronUp, ChevronRight, FolderOpen, Clock, Loader2, X, MessageSquare } from 'lucide-react';
import { InlineMarkdownWithMentions, MentionText } from '../../utils/markdown';
import { PromptNav, hasUserMention } from '../PromptNav';
import { groupTimeline, type TimelineItem, type GroupedTimelineItem } from './groupTimeline';

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

export function AcpOutput({ agentId }: Props) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const [planOpen, setPlanOpen] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dismissedPinId, setDismissedPinId] = useState<number | null>(null);

  const plan = agent?.plan ?? [];
  const messages = agent?.messages ?? [];

  // Fetch message history when agent panel opens and no messages are loaded yet
  useEffect(() => {
    if (!agentId || messages.length > 0) return;
    fetch(`/api/agents/${agentId}/messages?limit=200`)
      .then((r) => r.json())
      .then((data: any) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          const existing = useAppStore.getState().agents.find((a) => a.id === agentId);
          // Only load if still no messages (avoid overwriting live data)
          if (!existing?.messages?.length) {
            const msgs: AcpTextChunk[] = data.messages.map((m: any) => ({
              type: 'text' as const,
              text: m.content,
              sender: (m.sender || 'agent') as 'agent' | 'user' | 'system' | 'thinking',
              timestamp: new Date(m.timestamp).getTime(),
            }));
            useAppStore.getState().updateAgent(agentId, { messages: msgs });
          }
        }
      })
      .catch(() => {});
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  agentActivity.forEach((evt) => {
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
    <div ref={containerRef} className="absolute inset-0">
      <Virtuoso
        ref={virtuosoRef}
        data={groupedTimeline}
        overscan={400}
        atBottomThreshold={150}
        atBottomStateChange={setAtBottom}
        followOutput={atBottom ? 'smooth' : false}
        initialTopMostItemIndex={groupedTimeline.length > 0 ? groupedTimeline.length - 1 : 0}
        className="h-full"
        components={{
          Header: () => (
            <div className="p-3 pb-0 space-y-3">
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
            </div>
          ),
          Footer: () => (
            <>
              {messages.some((m) => m.queued) && (
                <div className="border-t border-dashed border-th-border px-3 py-2 bg-th-bg-alt/50 mx-3 mb-3">
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
            </>
          ),
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
    <PromptNav containerRef={containerRef} messages={messages} useOriginalIndices />
    </div>
  );
}

/** Renders a single grouped timeline item — extracted for Virtuoso itemContent */
function TimelineRow({ item }: { item: GroupedTimelineItem }) {
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
            {group.messages.map((m) => {
              const sender = m.msg.sender ?? 'agent';
              const text = typeof m.msg.text === 'string' ? m.msg.text : JSON.stringify(m.msg.text, null, 2);
              if (sender === 'thinking') {
                return (
                  <div key={`msg-${m.index}`} className="font-mono text-xs text-th-text-muted italic whitespace-pre-wrap min-w-0">
                    {text}
                  </div>
                );
              }
              return (
                <div key={`msg-${m.index}`} className="font-mono text-sm whitespace-pre-wrap min-w-0 text-th-text-alt">
                  <AgentTextBlockSimple text={text} />
                </div>
              );
            })}
          </div>
          <span className="text-[10px] text-th-text-muted mt-0.5 shrink-0">{lastTs}</span>
        </div>
        {group.systemEvents.length > 0 && (
          <CollapsibleSystemEvents events={group.systemEvents} />
        )}
      </div>
    );
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
        <div className="max-w-[80%] rounded-lg px-3 py-2 bg-blue-600 text-white font-mono text-sm whitespace-pre-wrap">
          <MentionText text={rawText} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
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
function CollapsibleSystemEvents({ events }: { events: Array<{ kind: 'message'; msg: { text: string; sender?: string; timestamp?: number }; index: number } | { kind: 'activity'; evt: ActivityEvent }> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[10px] text-th-text-muted hover:text-th-text-alt transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {events.length} system event{events.length !== 1 ? 's' : ''}
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
  const segments = text.split(/(⟦⟦[\s\S]*?⟧⟧)/g);
  return (
    <>
      {segments.map((seg, i) => {
        // Complete ⟦⟦ ⟧⟧ block — only collapse if it looks like a real command
        if (seg.startsWith('⟦⟦') && seg.endsWith('⟧⟧')) {
          if (isRealCommandBlock(seg)) {
            return <CollapsibleCommandBlockSimple key={i} text={seg} />;
          }
          // Not a real command — render as plain text
          return <BlockMarkdownSimple key={i} text={seg} />;
        }
        // Unclosed ⟦⟦ block (still streaming or split across messages)
        if (seg.includes('⟦⟦') && !seg.includes('⟧⟧')) {
          const idx = seg.indexOf('⟦⟦');
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
        // Dangling ⟧⟧ from a block that started in a previous message
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
