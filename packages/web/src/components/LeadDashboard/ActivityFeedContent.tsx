import { useEffect, useRef } from 'react';
import { GitBranch, CheckCircle, MessageSquare, BarChart3, Loader2, Wrench } from 'lucide-react';
import { EmptyState } from '../Shared';
import type { ActivityEvent } from '../../stores/leadStore';
import { shortAgentId } from '../../utils/agentLabel';

export function ActivityFeedContent({ activity, agents }: { activity: ActivityEvent[]; agents: any[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
    });
  }, [activity.length]);

  const recent = activity.slice(-30);

  const getIcon = (type: string, status?: string) => {
    if (type === 'delegation') return <GitBranch className="w-3 h-3 text-yellow-600 dark:text-yellow-400 shrink-0" />;
    if (type === 'completion') return <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />;
    if (type === 'message_sent') return <MessageSquare className="w-3 h-3 text-blue-400 shrink-0" />;
    if (type === 'progress_update') return <BarChart3 className="w-3 h-3 text-purple-400 shrink-0" />;
    if (status === 'in_progress') return <Loader2 className="w-3 h-3 text-blue-400 animate-spin shrink-0" />;
    if (status === 'completed') return <CheckCircle className="w-3 h-3 text-purple-500 shrink-0" />;
    return <Wrench className="w-3 h-3 text-th-text-muted shrink-0" />;
  };

  return (
    <div ref={feedRef} className="h-full min-h-0 overflow-y-auto">
      {recent.length === 0 ? (
        <EmptyState icon="📡" title="No activity yet" compact />
      ) : (
        recent.map((evt) => {
          const agent = agents.find((a: any) => a.id === evt.agentId);
          const label = agent?.role?.name ?? evt.agentRole;
          const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return (
            <div key={evt.id} className="cv-auto-sm px-3 py-1.5 border-b border-th-border/30 flex items-start gap-2">
              {getIcon(evt.type, evt.status)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono text-th-text-muted">{label}</span>
                  <span className="text-[10px] font-mono text-th-text-muted">{shortAgentId(evt.agentId)}</span>
                  <span className="text-xs font-mono text-th-text-muted ml-auto shrink-0">{time}</span>
                </div>
                <span className="text-xs font-mono text-th-text-alt break-words">{typeof evt.summary === 'string' ? evt.summary : JSON.stringify(evt.summary)}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
