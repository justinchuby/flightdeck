import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTimelineData } from './useTimelineData';
import { TimelineContainer } from './TimelineContainer';

interface Props {
  api: any;
  ws: any;
  agents?: Array<{ id: string; role: string; parentId?: string }>;
}

/** Timeline visualization page — shows agent activity over time using visx. */
export function TimelinePage({ api, ws, agents = [] }: Props) {
  // Find lead agents for selection
  const leads = agents.filter(a => !a.parentId || a.role === 'lead');
  const [selectedLead, setSelectedLead] = useState<string | null>(leads[0]?.id ?? null);
  const { data, loading, error, refetch } = useTimelineData(selectedLead);

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Team Collaboration Timeline</h1>
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 min-h-[400px] flex items-center justify-center">
          <RefreshCw size={24} className="animate-spin text-zinc-500" />
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 rounded-lg border border-red-800 p-4">
          <p className="text-red-400 text-sm">Error: {error}</p>
        </div>
      )}

      {data && (
        <div className="flex-1 min-h-0">
          <TimelineContainer data={data} />
        </div>
      )}
    </div>
  );
}
