import { Check, CheckCircle } from 'lucide-react';
import { formatTokens } from '../../utils/format';

/** Parse [Agent Report] or [Agent ACK] formatted content into structured parts */
export function parseAgentReport(content: string): { header: string; task: string; output: string; sessionId: string; isReport: boolean; isAck: boolean } {
  // Check for ACK first
  const ackMatch = content.match(/^\[Agent ACK\]\s*(.+?)(?:\n|$)/);
  if (ackMatch) {
    const header = ackMatch[1].trim();
    const taskMatch = header.match(/acknowledged task:\s*(.*)/);
    return {
      header: header.replace(/\s*acknowledged task:.*/, ''),
      task: taskMatch ? taskMatch[1].trim() : '',
      output: '',
      sessionId: '',
      isReport: true,
      isAck: true,
    };
  }

  const reportMatch = content.match(/^\[Agent Report\]\s*(.+?)(?:\n|$)/);
  if (!reportMatch) return { header: '', task: '', output: '', sessionId: '', isReport: false, isAck: false };

  const header = reportMatch[1].trim();
  const taskMatch = content.match(/\nTask:\s*(.*?)(?:\n|$)/);
  const sessionMatch = content.match(/\nSession ID:\s*(.*?)(?:\n|$)/);
  const outputMatch = content.match(/\nOutput summary:\s*([\s\S]*)$/);

  // Clean output: strip ⟦⟦ ... ⟧⟧ fragments and normalize whitespace
  let output = outputMatch ? outputMatch[1].trim() : '';
  output = output.replace(/⟦⟦[\s\S]*?⟧⟧/g, '').replace(/⟦⟦[\s\S]*$/g, '').replace(/^[\s\S]*?⟧⟧/g, '').trim();
  output = output.replace(/\n\s(?=\S)/g, ' ');

  return {
    header,
    task: taskMatch ? taskMatch[1].trim() : '',
    output,
    sessionId: sessionMatch ? sessionMatch[1].trim() : '',
    isReport: true,
    isAck: false,
  };
}

/** Render an agent report with structured formatting */
export function AgentReportBlock({ content, compact }: { content: string; compact?: boolean }) {
  const parsed = parseAgentReport(content);
  if (!parsed.isReport) {
    return <span className="text-xs font-mono text-th-text-alt whitespace-pre-wrap break-words">{content}</span>;
  }

  // ACK messages: compact inline rendering
  if (parsed.isAck) {
    return (
      <div className="text-xs font-mono flex items-center gap-1.5">
        <Check className="w-3 h-3 text-amber-500 shrink-0" />
        <span className="text-amber-600 dark:text-amber-400">{parsed.header}</span>
        {parsed.task && <span className="text-th-text-muted"> — {compact && parsed.task.length > 60 ? parsed.task.slice(0, 60) + '…' : parsed.task}</span>}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="text-xs font-mono">
        <span className="text-th-text-alt">{parsed.header}</span>
        {parsed.task && <span className="text-th-text-muted"> — {parsed.task.length > 80 ? parsed.task.slice(0, 80) + '…' : parsed.task}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm font-mono">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-th-text-alt font-semibold">{parsed.header}</span>
      </div>
      {parsed.task && (
        <div>
          <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Task</span>
          <p className="text-th-text-alt whitespace-pre-wrap break-words mt-0.5">{parsed.task}</p>
        </div>
      )}
      {parsed.output && (
        <div>
          <span className="text-[10px] text-th-text-muted uppercase tracking-wider">Output</span>
          <pre className="text-th-text-alt whitespace-pre-wrap break-words mt-0.5 bg-th-bg/50 rounded p-2 text-xs max-h-60 overflow-y-auto">{parsed.output}</pre>
        </div>
      )}
      {parsed.sessionId && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-th-text-muted uppercase tracking-wider">Session</span>
          <code className="text-th-text-muted bg-th-bg/50 px-1.5 py-0.5 rounded">{parsed.sessionId}</code>
          <button
            onClick={() => navigator.clipboard.writeText(parsed.sessionId)}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400"
          >
            copy
          </button>
        </div>
      )}
    </div>
  );
}
