import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { parseAgentReport } from './AgentReportBlock';
import type { AgentReport } from '../../stores/leadStore';
import { formatTime } from '../../utils/format';

interface Props {
  agentReports: AgentReport[];
  reportsScrollRef?: React.RefObject<HTMLDivElement | null>;
  onExpandReport: (report: AgentReport) => void;
}

export function LeadAgentReportsBanner({ agentReports, reportsScrollRef, onExpandReport }: Props) {
  const [reportsExpanded, setReportsExpanded] = useState(true);

  if (agentReports.length === 0) return null;

  return (
    <div className="border-b border-th-border bg-amber-500/5 dark:bg-amber-500/10">
      <button
        className="w-full flex items-center gap-2 px-4 py-1 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
        onClick={() => setReportsExpanded(!reportsExpanded)}
      >
        {reportsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <MessageSquare className="w-3 h-3" />
        <span className="font-mono font-medium">Agent Reports</span>
        <span className="bg-amber-500/20 px-1.5 rounded text-[10px]">{agentReports.length}</span>
      </button>
      {reportsExpanded && (
        <div ref={reportsScrollRef} className="max-h-48 overflow-y-auto px-3 pb-2 space-y-1">
          {agentReports.slice(-20).map((r) => {
            const time = formatTime(r.timestamp);
            const parsed = parseAgentReport(r.content);
            const summary = parsed.isReport
              ? [parsed.header, parsed.task].filter(Boolean).join(' — ')
              : r.content.split('\n')[0];
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 px-2 py-1 rounded bg-amber-500/[0.06] border border-amber-400/20 border-l-2 border-l-amber-500/30 cursor-pointer hover:bg-amber-500/[0.10] transition-colors"
                onClick={() => onExpandReport(r)}
              >
                <span className="text-[10px] font-mono text-th-text-muted shrink-0">{time}</span>
                <span className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400 shrink-0">{r.fromRole}</span>
                <span className="text-xs font-mono text-th-text-alt truncate min-w-0">{summary}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
