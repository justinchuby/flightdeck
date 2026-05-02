import { useState, useEffect, useMemo, useRef } from 'react';
import { Users, Filter } from 'lucide-react';
import { EmptyState } from '../Shared';
import type { AgentComm } from '../../stores/leadStore';
import type { GroupMessage } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { MentionText } from '../../utils/markdown';
import { classifyMessage, tierPassesFilter, TIER_CONFIG, type TierFilter, type FeedItem } from '../../utils/messageTiers';
import { AgentReportBlock } from './AgentReportBlock';
import { Markdown } from '../ui/Markdown';
import { formatTime } from '../../utils/format';

export function roleColor(role: string): string {
  const colors = [
    'text-cyan-400',
    'text-violet-400',
    'text-emerald-400',
    'text-amber-400',
    'text-red-400',
    'text-blue-400',
    'text-fuchsia-400',
    'text-orange-400',
  ];
  let hash = 0;
  for (let i = 0; i < role.length; i++) hash = (hash * 31 + role.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function CommsPanelContent({ comms, groupMessages, leadId }: { comms: AgentComm[]; groupMessages: Record<string, GroupMessage[]>; leadId?: string }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  const [selectedGroupMsg, setSelectedGroupMsg] = useState<GroupMessage | null>(null);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  // Merge 1:1 comms and group messages into a unified feed sorted by timestamp
  const feed = useMemo(() => {
    const items: FeedItem[] = comms.map(c => ({ type: '1:1' as const, item: c }));
    for (const msgs of Object.values(groupMessages)) {
      for (const m of msgs) {
        items.push({ type: 'group' as const, item: m });
      }
    }
    items.sort((a, b) => {
      const ta = typeof a.item.timestamp === 'string' ? new Date(a.item.timestamp).getTime() : a.item.timestamp;
      const tb = typeof b.item.timestamp === 'string' ? new Date(b.item.timestamp).getTime() : b.item.timestamp;
      return ta - tb;
    });
    return items.slice(-50);
  }, [comms, groupMessages]);

  // Classify and filter
  const classifiedFeed = useMemo(() => {
    return feed
      .map(entry => ({ entry, tier: classifyMessage(entry, leadId) }))
      .filter(({ tier }) => tierPassesFilter(tier, tierFilter));
  }, [feed, leadId, tierFilter]);

  // Count by tier for filter bar
  const tierCounts = useMemo(() => {
    const counts = { critical: 0, notable: 0, routine: 0 };
    for (const entry of feed) {
      counts[classifyMessage(entry, leadId)]++;
    }
    return counts;
  }, [feed, leadId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    });
  }, [classifiedFeed.length]);

  const FILTER_OPTIONS: { value: TierFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'notable', label: `Important (${tierCounts.critical + tierCounts.notable})` },
    { value: 'critical', label: `Critical (${tierCounts.critical})` },
  ];

  return (
    <>
      {/* Tier filter bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-th-border/50 bg-th-bg/50">
        <Filter className="w-3 h-3 text-th-text-muted shrink-0" />
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${tierFilter === opt.value ? 'bg-th-bg-muted text-th-text-alt' : 'text-th-text-muted hover:text-th-text-alt hover:bg-th-bg-alt'}`}
            onClick={() => setTierFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div ref={feedRef} className="h-full overflow-y-auto">
        {classifiedFeed.length === 0 ? (
          <EmptyState
            icon="💬"
            title={feed.length === 0 ? 'No messages yet' : 'No messages match this filter'}
            compact
          />
        ) : (
          classifiedFeed.map(({ entry, tier }, i) => {
            const tierStyle = TIER_CONFIG[tier];

            if (entry.type === 'group') {
              const gm = entry.item;
              const time = formatTime(gm.timestamp, { seconds: true });
              return (
                <div
                  key={gm.id || `gm-${i}`}
                  className={`px-3 py-1.5 border-b border-l-2 cursor-pointer transition-colors ${tier === 'critical' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-red-500/[0.12]` : tier === 'routine' ? 'border-b-emerald-400/10 border-l-emerald-400/15 opacity-60 hover:opacity-100 hover:bg-emerald-500/[0.06]' : 'border-b-emerald-400/20 bg-emerald-500/[0.04] border-l-emerald-400/30 hover:bg-emerald-500/[0.08]'}`}
                  onClick={() => setSelectedGroupMsg(gm)}
                >
                  <div className="flex items-center gap-1 text-xs">
                    <Users className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="font-mono font-semibold text-emerald-400 truncate">{gm.groupName}</span>
                    <span className="text-th-text-muted">·</span>
                    <span className="font-mono text-cyan-400">{gm.fromRole}</span>
                    {tier === 'critical' && <span className="ml-1 text-red-400 animate-pulse motion-reduce:animate-none text-[10px]">●</span>}
                    <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                  </div>
                  <div className="text-xs font-mono text-th-text-alt mt-0.5">
                    <p className="truncate">
                      <MentionText text={gm.content.length > 120 ? gm.content.slice(0, 120) + '…' : gm.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                    </p>
                  </div>
                </div>
              );
            }
            const c = entry.item as AgentComm;
            const time = formatTime(c.timestamp, { seconds: true });
            const isToUser = leadId && c.toId === leadId;
            return (
              <div
                key={c.id}
                className={`px-3 py-1.5 border-b border-l-2 cursor-pointer transition-colors ${tier === 'critical' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-red-500/[0.12]` : tier === 'notable' ? `${tierStyle.bgClass} ${tierStyle.borderBClass} ${tierStyle.borderClass} hover:bg-blue-500/[0.08]` : `${isToUser ? 'bg-blue-500/[0.04] border-b-blue-400/15 border-l-blue-400/20' : 'border-b-gray-700/30 border-l-transparent'} opacity-60 hover:opacity-100 hover:bg-th-bg-muted/30`}`}
                onClick={() => setSelectedComm(c)}
              >
                <div className="flex items-center gap-1 text-xs">
                  <span className="font-mono font-semibold text-cyan-400">{c.fromRole}</span>
                  <span className="text-th-text-muted">→</span>
                  <span className="font-mono font-semibold text-green-400">{c.toRole}</span>
                  {tier === 'critical' && <span className="ml-1 text-red-400 animate-pulse motion-reduce:animate-none text-[10px]">●</span>}
                  <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                </div>
                <div className="text-xs font-mono text-th-text-alt mt-0.5">
                  {c.content.startsWith('[Agent Report]') || c.content.startsWith('[Agent ACK]')
                    ? <AgentReportBlock content={c.content} compact />
                    : <p className="truncate">
                        <MentionText text={c.content.length > 120 ? c.content.slice(0, 120) + '…' : c.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                      </p>
                  }
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Full message popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedComm(null); }}
        >
          <div
            className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-th-text-muted">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {formatTime(selectedComm.timestamp)}
                </span>
                <button
                  onClick={() => setSelectedComm(null)}
                  className="text-th-text-muted hover:text-th-text text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <Markdown
                    text={selectedComm.content}
                    mentionAgents={useAppStore.getState().agents}
                    onMentionClick={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedComm(null); }}
                    monospace
                  />
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* Group message popup */}
      {selectedGroupMsg && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedGroupMsg(null); }}
        >
          <div className="bg-th-bg-alt border border-emerald-600/40 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-700/40">
              <div className="flex items-center gap-2 text-sm">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="font-mono font-semibold text-emerald-400">{selectedGroupMsg.groupName}</span>
                <span className="text-th-text-muted">·</span>
                <span className="font-mono text-cyan-400">{selectedGroupMsg.fromRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {formatTime(selectedGroupMsg.timestamp)}
                </span>
                <button
                  onClick={() => setSelectedGroupMsg(null)}
                  className="text-th-text-muted hover:text-th-text text-lg leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              <Markdown
                text={selectedGroupMsg.content}
                mentionAgents={useAppStore.getState().agents}
                onMentionClick={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedGroupMsg(null); }}
                monospace
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
