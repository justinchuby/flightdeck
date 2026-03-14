import { GitBranch, FolderOpen, Download } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { AgentInfo } from '../../types';

interface Props {
  leadAgent: AgentInfo | undefined;
  selectedLeadId: string;
}

export function LeadSessionInfoBar({ leadAgent, selectedLeadId }: Props) {
  return (
    <div className="border-b border-th-border px-4 py-0.5 flex items-center gap-3 text-[11px] font-mono text-th-text-muted bg-th-bg-alt/20 overflow-x-auto">
      {leadAgent?.cwd && (
        <span className="flex items-center gap-1 shrink-0">
          <FolderOpen className="w-3 h-3 shrink-0" />
          {leadAgent.cwd}
        </span>
      )}
      {leadAgent?.sessionId && (
        <span className="flex items-center gap-1 shrink-0 ml-auto">
          <GitBranch className="w-3 h-3 shrink-0" />
          {leadAgent.sessionId}
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(leadAgent.sessionId!);
              const btn = e.currentTarget;
              btn.textContent = '✓';
              setTimeout(() => { btn.textContent = 'copy'; }, 1500);
            }}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0"
          >
            copy
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const data = await apiFetch<{ error?: string; outputDir?: string; files: string[]; agentCount?: number; eventCount?: number }>(`/export/${selectedLeadId}`);
                if (data.error) {
                  alert(`Export failed: ${data.error}`);
                } else {
                  alert(`Session exported to:\n${data.outputDir}\n\n${data.files.length} files · ${data.agentCount} agents · ${data.eventCount} events`);
                }
              } catch {
                alert('Export failed — server may be unavailable');
              }
            }}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0 flex items-center gap-0.5"
            title="Export session to disk"
          >
            <Download className="w-2.5 h-2.5" />
          </button>
        </span>
      )}
    </div>
  );
}
