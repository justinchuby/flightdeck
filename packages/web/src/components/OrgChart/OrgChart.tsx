import { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type AgentComm } from '../../stores/leadStore';
import type { AgentInfo } from '../../types';
import { Network, MessageSquare, Grid3X3, Users, BarChart3 } from 'lucide-react';
import { idColor } from '../../utils/markdown';
import { CommHeatmap } from '../FleetOverview/CommHeatmap';
import type { HeatmapMessage, CommType as HeatmapCommType } from '../FleetOverview/CommHeatmap';

// Unified message entry covering both 1:1 comms and group messages
interface CommEntry {
  id: string;
  fromId: string;
  fromRole: string;
  toId: string;     // empty for group messages
  toRole: string;   // empty for group messages
  content: string;
  timestamp: number;
  groupName?: string; // present for group messages
  commType?: HeatmapCommType;
}

// ---------------------------------------------------------------------------
// Status colors shared by the agent node
// ---------------------------------------------------------------------------
const statusStyle: Record<string, { border: string; badge: string }> = {
  running:   { border: 'border-blue-500 bg-blue-500/10',   badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-300' },
  idle:      { border: 'border-green-500 bg-green-500/10', badge: 'bg-green-500/20 text-green-600 dark:text-green-300' },
  creating:  { border: 'border-yellow-500 bg-yellow-500/10', badge: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-300' },
  completed: { border: 'border-gray-500 bg-gray-500/10',  badge: 'bg-gray-500/20 text-th-text-muted' },
  failed:    { border: 'border-red-500 bg-red-500/10',    badge: 'bg-red-500/20 text-red-600 dark:text-red-300' },
};

const fallbackStatus = { border: 'border-th-border', badge: 'bg-gray-500/20 text-th-text-muted' };

// ---------------------------------------------------------------------------
// AgentNode — a single card in the tree
// ---------------------------------------------------------------------------
function AgentNode({ agent }: { agent: AgentInfo }) {
  const s = statusStyle[agent.status] ?? fallbackStatus;
  const roleName = agent.role?.name ?? agent.role?.id ?? 'Unknown';
  const shortId = agent.id.slice(0, 8);
  // Show last segment of model string (e.g. "sonnet-4" from "claude-sonnet-4")
  const modelLabel = agent.model?.split('/').pop()?.split('-').slice(-2).join('-') ?? '';

  return (
    <div className={`border-2 rounded-lg px-3 py-2 text-center min-w-[140px] ${s.border}`}>
      {agent.role?.icon && <span className="mr-1">{agent.role.icon}</span>}
      <span className="text-sm font-medium text-th-text">{roleName}</span>
      <div className="text-xs font-mono" style={{ color: idColor(agent.id) }}>{shortId}</div>
      {modelLabel && <div className="text-xs text-th-text-muted mt-0.5">{modelLabel}</div>}
      <div className={`text-[10px] mt-1 px-1.5 py-0.5 rounded-full inline-block ${s.badge}`}>
        {agent.status}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HierarchyTree — top-down tree of agents
// ---------------------------------------------------------------------------
function HierarchyTree({ agents }: { agents: AgentInfo[] }) {
  // Index children by parentId
  const byParent = new Map<string, AgentInfo[]>();
  const rootAgents: AgentInfo[] = [];

  for (const agent of agents) {
    if (!agent.parentId || !agents.some((a) => a.id === agent.parentId)) {
      rootAgents.push(agent);
    } else {
      const list = byParent.get(agent.parentId) ?? [];
      list.push(agent);
      byParent.set(agent.parentId, list);
    }
  }

  const renderSubtree = (parent: AgentInfo): React.ReactNode => {
    const children = byParent.get(parent.id);
    return (
      <div key={parent.id} className="flex flex-col items-center gap-2">
        <AgentNode agent={parent} />
        {children && children.length > 0 && (
          <>
            <div className="w-px h-4 bg-th-bg-hover" />
            {/* horizontal connector when >1 child */}
            {children.length > 1 && (
              <div className="flex items-start">
                <div className="border-t border-th-border" style={{ width: `${(children.length - 1) * 160}px` }} />
              </div>
            )}
            <div className="flex flex-wrap gap-6 justify-center">
              {children.map((child) => (
                <div key={child.id} className="flex flex-col items-center gap-2">
                  <div className="w-px h-4 bg-th-bg-hover" />
                  {renderSubtree(child)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  if (agents.length === 0) {
    return <div className="text-th-text-muted text-sm text-center py-6">No agents running</div>;
  }

  return (
    <div className="flex flex-wrap gap-8 justify-center py-4 overflow-x-auto">
      {rootAgents.map((root) => renderSubtree(root))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role color helper for comms list
// ---------------------------------------------------------------------------
const roleColorMap: Record<string, string> = {
  'Project Lead': 'text-yellow-600 dark:text-yellow-400',
  Developer:      'text-blue-400',
  Architect:      'text-purple-400',
  'Code Reviewer': 'text-green-400',
  'Critical Reviewer': 'text-red-400',
  'QA Tester':    'text-amber-400',
  Secretary:      'text-teal-400',
};
function roleColor(role: string): string {
  return roleColorMap[role] ?? 'text-th-text-alt';
}

// ---------------------------------------------------------------------------
// CommsList — chronological message list (1:1 + group)
// ---------------------------------------------------------------------------
function CommsList({ entries }: { entries: CommEntry[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (entries.length === 0) {
    return <div className="text-th-text-muted text-sm text-center py-4">No messages yet</div>;
  }

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-1 max-h-[400px] overflow-y-auto">
      {entries
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((c) => {
          const time = new Date(c.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const isLong = c.content?.length > 120;
          const isExpanded = expandedIds.has(c.id);
          const preview = isLong && !isExpanded ? `${c.content.slice(0, 120)}…` : c.content;
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className="w-full text-left text-xs px-2 py-1.5 hover:bg-th-bg-muted/30 rounded cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-1">
                <span className="text-th-text-muted shrink-0">[{time}]</span>
                <span className={`shrink-0 ${roleColor(c.fromRole)}`}>
                  {c.fromRole} ({c.fromId?.slice(0, 6)})
                </span>
                {c.groupName ? (
                  <>
                    <span className="text-th-text-muted"> → </span>
                    <span className="inline-flex items-center gap-0.5 text-purple-400 shrink-0">
                      <Users className="w-2.5 h-2.5 inline" />
                      {c.groupName}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-th-text-muted"> → </span>
                    <span className={`shrink-0 ${roleColor(c.toRole)}`}>
                      {c.toRole} ({c.toId?.slice(0, 6)})
                    </span>
                  </>
                )}
                {isLong && (
                  <span className="ml-auto text-th-text-muted text-[10px] shrink-0">
                    {isExpanded ? '▾' : '▸'} {c.content.length} chars
                  </span>
                )}
              </div>
              <div className={`text-th-text-muted mt-0.5 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                {preview}
              </div>
            </button>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommsMatrix — from/to message count table
// ---------------------------------------------------------------------------
interface AgentLabel {
  id: string;
  role: string;
  shortId: string;
}

function CommsMatrix({ entries, agents }: { entries: CommEntry[]; agents: AgentInfo[] }) {
  // Only include 1:1 messages in the matrix (group messages don't have a single target)
  const directComms = entries.filter((c) => !c.groupName);
  // Build a deduplicated list of participants
  const seen = new Map<string, AgentLabel>();
  for (const a of agents) {
    seen.set(a.id, { id: a.id, role: a.role?.name ?? 'Unknown', shortId: a.id.slice(0, 6) });
  }
  for (const c of directComms) {
    if (!seen.has(c.fromId)) seen.set(c.fromId, { id: c.fromId, role: c.fromRole, shortId: c.fromId.slice(0, 6) });
    if (!seen.has(c.toId)) seen.set(c.toId, { id: c.toId, role: c.toRole, shortId: c.toId.slice(0, 6) });
  }

  const participants = Array.from(seen.values());

  if (participants.length === 0) {
    return <div className="text-th-text-muted text-sm text-center py-4">No communication data</div>;
  }

  // Count messages per pair
  const counts = new Map<string, number>();
  for (const c of directComms) {    const key = `${c.fromId}:${c.toId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1 text-th-text-muted text-left">From ↓ / To →</th>
            {participants.map((a) => (
              <th key={a.id} className="px-2 py-1 text-th-text-muted text-center whitespace-nowrap">
                {a.role}
                <br />
                <span className="font-mono text-th-text-muted">{a.shortId}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {participants.map((from) => (
            <tr key={from.id}>
              <td className="px-2 py-1 text-th-text-alt whitespace-nowrap">
                {from.role} <span className="font-mono text-th-text-muted">{from.shortId}</span>
              </td>
              {participants.map((to) => {
                const isSelf = from.id === to.id;
                const count = counts.get(`${from.id}:${to.id}`) ?? 0;
                const intensity = Math.min(count * 10, 50);
                return (
                  <td
                    key={to.id}
                    className={`px-2 py-1 text-center border border-th-border/50 ${
                      isSelf ? 'bg-th-bg-alt' : count > 0 ? `bg-blue-500/${intensity}` : ''
                    }`}
                  >
                    {isSelf ? (
                      <span className="text-th-text-muted">—</span>
                    ) : count > 0 ? (
                      <span className="text-blue-600 dark:text-blue-300 font-medium">{count}</span>
                    ) : (
                      <span className="text-th-text-muted">0</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main OrgChart page
// ---------------------------------------------------------------------------
interface Props {
  api: any;
  ws: any;
}

export function OrgChart({ api, ws }: Props) {
  const agents = useAppStore((s) => s.agents);
  const projects = useLeadStore((s) => s.projects);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [commView, setCommView] = useState<'list' | 'matrix' | 'heatmap'>('list');

  // Identify leads (role.id === 'lead' with no parent)
  const leads = agents.filter((a) => a.role?.id === 'lead' && !a.parentId);

  // Auto-select first lead when none selected
  useEffect(() => {
    if (!selectedLeadId && leads.length > 0) {
      setSelectedLeadId(leads[0].id);
    }
    // If selected lead disappeared, reset
    if (selectedLeadId && !leads.some((l) => l.id === selectedLeadId)) {
      setSelectedLeadId(leads[0]?.id ?? null);
    }
  }, [leads, selectedLeadId]);

  const project = selectedLeadId ? projects[selectedLeadId] : null;
  const comms: AgentComm[] = project?.comms ?? [];
  const groupMessages = project?.groupMessages ?? {};

  // Merge 1:1 comms and group messages into unified CommEntry list
  const allEntries: CommEntry[] = useMemo(() => {
    const entries: CommEntry[] = comms.map((c) => ({
      id: c.id,
      fromId: c.fromId,
      fromRole: c.fromRole,
      toId: c.toId,
      toRole: c.toRole,
      content: c.content,
      timestamp: c.timestamp,
      commType: c.type,
    }));
    // Flatten group messages from all groups
    for (const [groupName, msgs] of Object.entries(groupMessages)) {
      for (const gm of msgs) {
        entries.push({
          id: gm.id,
          fromId: gm.fromAgentId,
          fromRole: gm.fromRole,
          toId: '',
          toRole: '',
          content: gm.content,
          timestamp: typeof gm.timestamp === 'string' ? new Date(gm.timestamp).getTime() : gm.timestamp,
          groupName,
        });
      }
    }
    return entries;
  }, [comms, groupMessages]);

  const groupMsgCount = allEntries.filter((e) => e.groupName).length;

  // Build team: lead + any agent whose parentId chain leads to the selected lead
  const teamAgents: AgentInfo[] = selectedLeadId
    ? agents.filter((a) => {
        if (a.id === selectedLeadId) return true;
        if (a.parentId === selectedLeadId) return true;
        // grandchildren
        return agents.some((p) => p.parentId === selectedLeadId && a.parentId === p.id);
      })
    : agents; // Show all when no lead selected

  // Derive heatmap data from allEntries for the CommHeatmap view
  const heatmapAgents = useMemo(
    () => teamAgents.map(a => ({
      id: a.id,
      role: a.role?.name ?? 'Unknown',
      name: `${a.role?.icon ?? ''}${a.id.slice(0, 5)}`,
    })),
    [teamAgents],
  );

  const heatmapMessages: HeatmapMessage[] = useMemo(() => {
    const result: HeatmapMessage[] = [];
    for (const entry of allEntries) {
      if (!entry.fromId) continue;
      const type: HeatmapCommType | undefined = entry.commType ?? (entry.groupName ? 'group_message' : 'message');
      if (entry.toId) {
        result.push({ from: entry.fromId, to: entry.toId, count: 1, type });
      } else if (entry.groupName) {
        // Group messages: count as message from sender to all team members
        for (const a of teamAgents) {
          if (a.id !== entry.fromId) {
            result.push({ from: entry.fromId, to: a.id, count: 1, type: 'group_message' });
          }
        }
      }
    }
    return result;
  }, [allEntries, teamAgents]);

  return (
    <div className="flex-1 overflow-y-auto space-y-0">
      {/* Project tabs — always visible */}
      {leads.length > 0 && (
        <nav className="flex items-center gap-1 px-4 pt-2 overflow-x-auto border-b border-th-border-muted" role="tablist" aria-label="Project selection">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedLeadId(l.id)}
              role="tab"
              aria-selected={selectedLeadId === l.id}
              className={`px-4 py-2 text-xs whitespace-nowrap transition-colors border-b-2 -mb-px ${
                selectedLeadId === l.id
                  ? 'border-accent text-accent font-medium bg-th-bg'
                  : 'border-transparent text-th-text-muted hover:text-th-text hover:border-th-border'
              }`}
            >
              {l.projectName || l.role?.name || l.id.slice(0, 8)}
            </button>
          ))}
        </nav>
      )}

      <div className="p-4 space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Org Chart</h2>
      </div>

      {/* Hierarchy section */}
      <section className="bg-th-bg-alt/50 rounded-lg border border-th-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Network className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-medium text-th-text">Agent Hierarchy</h3>
          <span className="text-xs text-th-text-muted">{teamAgents.length} agents</span>
        </div>
        <HierarchyTree agents={teamAgents} />
      </section>

      {/* Communication section */}
      <section className="bg-th-bg-alt/50 rounded-lg border border-th-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-medium text-th-text">Communication Flow</h3>
          <span className="text-xs text-th-text-muted">
            {allEntries.length} messages
            {groupMsgCount > 0 && <> ({groupMsgCount} group)</>}
          </span>
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setCommView('list')}
              className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors ${
                commView === 'list' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300' : 'text-th-text-muted hover:text-th-text'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              List
            </button>
            <button
              onClick={() => setCommView('matrix')}
              className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors ${
                commView === 'matrix' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300' : 'text-th-text-muted hover:text-th-text'
              }`}
            >
              <Grid3X3 className="w-3 h-3" />
              Matrix
            </button>
            <button
              onClick={() => setCommView('heatmap')}
              className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 transition-colors ${
                commView === 'heatmap' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-300' : 'text-th-text-muted hover:text-th-text'
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              Heatmap
            </button>
          </div>
        </div>
        {commView === 'list' ? (
          <CommsList entries={allEntries} />
        ) : commView === 'matrix' ? (
          <CommsMatrix entries={allEntries} agents={teamAgents} />
        ) : (
          <CommHeatmap agents={heatmapAgents} messages={heatmapMessages} />
        )}
      </section>
      </div>
    </div>
  );
}
