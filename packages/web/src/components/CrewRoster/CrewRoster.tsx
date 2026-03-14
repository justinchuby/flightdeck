import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, Cpu } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import type { RosterStatus, RosterAgent, CrewSummary, CrewInfo } from './types';
import { CrewGroup } from './CrewGroup';
import { ProfilePanel } from './ProfilePanel';
import { RosterFilterBar } from './RosterFilterBar';

export function CrewRoster() {
  const addToast = useToastStore(s => s.add);
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [crewSummaries, setCrewSummaries] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RosterStatus | 'all'>('all');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Resolve crewId for the profile panel
  const selectedAgentCrewId = agents.find(a => a.agentId === selectedAgent)?.teamId ?? 'default';

  const fetchAll = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      // Fetch crew summaries + all crew agents in parallel
      const [summaryResult, crewsResult] = await Promise.allSettled([
        apiFetch<CrewSummary[]>('/crews/summary'),
        apiFetch<{ crews: CrewInfo[] }>('/crews'),
      ]);

      // Crew summaries (for project names, session counts)
      const summaries = summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value)
        ? summaryResult.value : [];
      setCrewSummaries(summaries);

      // Fetch agents from all crews (gives full data with crewId for profile lookups)
      const crewList = crewsResult.status === 'fulfilled' ? (crewsResult.value.crews ?? []) : [];
      const statusQ = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const agentResults = await Promise.allSettled(
        crewList.map(t => apiFetch<RosterAgent[]>(`/crews/${t.crewId}/agents${statusQ}`))
      );

      const allAgents: RosterAgent[] = [];
      let failCount = 0;
      for (const r of agentResults) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          allAgents.push(...r.value);
        } else {
          failCount++;
        }
      }

      if (failCount === agentResults.length && agentResults.length > 0) {
        const firstFail = agentResults.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw new Error(firstFail?.reason?.message ?? 'Failed to fetch agents');
      }

      setAgents(allAgents);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message ?? 'Failed to fetch crew roster');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleDeleteCrew = useCallback(async (leadId: string) => {
    try {
      await apiFetch(`/crews/${leadId}`, { method: 'DELETE' });
      addToast('success', 'Crew deleted');
      // Remove deleted agents from local state and deselect if needed
      setAgents(prev => {
        const remaining = prev.filter(a => {
          if (a.agentId === leadId) return false;
          const meta = a.parentId;
          return meta !== leadId;
        });
        return remaining;
      });
      if (selectedAgent) {
        const deletedAgent = agents.find(a => a.agentId === selectedAgent);
        if (deletedAgent && (deletedAgent.agentId === leadId || deletedAgent.parentId === leadId)) {
          setSelectedAgent(null);
        }
      }
      setCrewSummaries(prev => prev.filter(s => s.leadId !== leadId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to delete crew: ${message}`);
    }
  }, [addToast, agents, selectedAgent]);

  // Filter agents
  const filtered = agents.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.role.toLowerCase().includes(q)
      || a.agentId.toLowerCase().includes(q)
      || (a.lastTaskSummary?.toLowerCase().includes(q) ?? false);
  });

  // Group by lead (parentId). Leads group under themselves; members under their parent.
  const crewGroups = (() => {
    const map = new Map<string, RosterAgent[]>();
    for (const a of filtered) {
      const leadId = a.role === 'lead' ? a.agentId : (a.parentId ?? 'unassigned');
      if (!map.has(leadId)) map.set(leadId, []);
      map.get(leadId)!.push(a);
    }
    // Sort: active crews first, then by last activity
    return [...map.entries()].sort((a, b) => {
      const aActive = a[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      const bActive = b[1].some(ag => ag.liveStatus === 'running' || ag.liveStatus === 'idle');
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aTime = a[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      const bTime = b[1].reduce((max, ag) => ag.updatedAt > max ? ag.updatedAt : max, '');
      return bTime.localeCompare(aTime);
    });
  })();

  // Build summary lookup by leadId
  const summaryMap = new Map(crewSummaries.map(s => [s.leadId, s]));

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading crew roster…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        <AlertTriangle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-6 max-w-screen-2xl mx-auto w-full">
      <RosterFilterBar
        crewCount={crewGroups.length}
        agentCount={filtered.length}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={() => fetchAll()}
      />

      {/* Content: Grouped List + Profile */}
      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0 overflow-y-auto mt-4">
        {/* Crew Groups — stable width at desktop/tablet, full-width responsive on mobile */}
        <div className={`space-y-3 min-w-0 ${selectedAgent ? 'flex-1' : 'w-full'}`}>
          {crewGroups.length === 0 ? (
            <div className="text-center py-8 text-th-text-alt text-sm bg-surface-raised rounded-lg border border-th-border">
              <Cpu className="w-8 h-8 mx-auto mb-2 opacity-50" />
              {search ? 'No agents match your search' : 'No agents in any crew'}
            </div>
          ) : (
            crewGroups.map(([leadId, groupAgents]) => (
              <div key={leadId} className="cv-auto-lg">
              <CrewGroup
                leadId={leadId}
                agents={groupAgents}
                summary={summaryMap.get(leadId) ?? null}
                defaultExpanded
                onSelectAgent={setSelectedAgent}
                selectedAgentId={selectedAgent}
                onDeleteCrew={handleDeleteCrew}
              />
              </div>
            ))
          )}
        </div>

        {/* Profile Panel */}
        {selectedAgent && (
          <div className="w-full max-w-full md:w-[400px] lg:w-[480px] shrink-0">
            <ProfilePanel
              agentId={selectedAgent}
              crewId={selectedAgentCrewId}
              onClose={() => setSelectedAgent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
