import { useState, useEffect, useRef } from 'react';
import { apiFetch } from './useApi';
import type { ReplayKeyframe } from './useSessionReplay';
import type { AgentInfo, Project } from '../types';
import type { AgentStatus, Role } from '@flightdeck/shared';
import { getRoleIcon } from '../utils/getRoleIcon';

/** Minimal agent shape derived from keyframe events, structurally compatible with AgentInfo */
export type DerivedAgent = AgentInfo;

/** Build a default Role object from partial data */
function buildRole(partial: { id?: string; name?: string; icon?: string }): Role {
  const id = partial.id ?? 'agent';
  const name = partial.name ?? 'Agent';
  return {
    id,
    name,
    description: '',
    systemPrompt: '',
    color: '#6b7280',
    icon: partial.icon ?? getRoleIcon(id),
    builtIn: false,
  };
}

/**
 * Derives an agent roster from keyframe events when no live WebSocket
 * agents are available. Fetches projects → keyframes → parses spawn/exit
 * events to build a historical agent list.
 *
 * @param liveAgentCount - number of live agents from appStore. When > 0, skips fetch.
 * @param projectId - optional specific project ID to fetch for. If omitted, uses most recent.
 */
export function useHistoricalAgents(liveAgentCount: number, projectId?: string | null) {
  const [agents, setAgents] = useState<DerivedAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (liveAgentCount > 0) return;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // When no specific project requested, try /api/agents for global data
        if (!projectId) {
          const apiAgents = await apiFetch<any[]>('/agents').catch(() => []);
          const arr = Array.isArray(apiAgents) ? apiAgents : [];
          if (arr.length > 0) {
            if (!cancelled && mountedRef.current) {
              setAgents(arr.map(normalize));
              setLoading(false);
            }
            return;
          }
        }

        // Derive from per-project keyframes
        const id = projectId ?? await getFirstProjectId();
        if (!id) { setLoading(false); return; }

        const kfData = await apiFetch<{ keyframes: ReplayKeyframe[] }>(
          `/replay/${id}/keyframes`,
        ).catch(() => ({ keyframes: [] }));
        const kf: ReplayKeyframe[] = kfData.keyframes ?? [];

        if (!cancelled && mountedRef.current) {
          setAgents(deriveAgentsFromKeyframes(kf));
          setLoading(false);
        }
      } catch {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [liveAgentCount, projectId]);

  return { agents, loading };
}

/** Fetch the most recent project ID */
async function getFirstProjectId(): Promise<string | null> {
  try {
    const ps = await apiFetch<Project[]>('/projects');
    const active = Array.isArray(ps) ? ps.filter((p) => p.status !== 'archived') : [];
    return active.length > 0 ? active[0].id : null;
  } catch {
    return null;
  }
}

/** Normalize a raw API agent object to DerivedAgent shape */
function normalize(a: any): DerivedAgent {
  const roleId = a.role?.id ?? 'agent';
  return {
    id: a.id ?? 'unknown',
    status: (a.status ?? 'completed') as AgentStatus,
    role: buildRole({
      id: roleId,
      name: a.role?.name,
      icon: a.role?.icon,
    }),
    model: a.model ?? '',
    inputTokens: a.inputTokens ?? 0,
    outputTokens: a.outputTokens ?? 0,
    createdAt: a.createdAt ?? new Date().toISOString(),
    messages: [],
    childIds: [],
    contextWindowSize: a.contextWindowSize ?? 0,
    contextWindowUsed: a.contextWindowUsed ?? 0,
    outputPreview: a.outputPreview ?? '',
  };
}

/** Derive agent roster from spawn/exit keyframe events */
export function deriveAgentsFromKeyframes(kf: ReplayKeyframe[]): DerivedAgent[] {
  const agents: DerivedAgent[] = [];
  const exitedRoles = new Map<string, number>(); // role → count of exits

  // First pass: collect exits by role
  for (const frame of kf) {
    if (frame.type === 'agent_exit') {
      const match = frame.label.match(/^Terminated\s+(.+?)(?:\s+\(|$)/);
      const role = match?.[1] ?? '';
      if (role) exitedRoles.set(role, (exitedRoles.get(role) ?? 0) + 1);
    }
  }

  // Second pass: create agents from spawns
  const roleExitCounts = new Map(exitedRoles);
  for (const frame of kf) {
    if (frame.type === 'spawn') {
      if (!frame.agentId) continue; // skip spawn events without a real agent ID

      const roleMatch = frame.label.match(/^Spawned\s+(.+?)(?::\s|$)/);
      const roleName = roleMatch?.[1] ?? 'Agent';
      const roleId = roleName.toLowerCase().replace(/\s+/g, '-');

      // Check if this agent was later terminated
      const remainingExits = roleExitCounts.get(roleName) ?? 0;
      const status: AgentStatus = remainingExits > 0 ? 'terminated' : 'idle';
      if (remainingExits > 0) roleExitCounts.set(roleName, remainingExits - 1);

      agents.push({
        id: frame.agentId,
        status,
        role: buildRole({ id: roleId, name: roleName }),
        model: '',
        inputTokens: 0,
        outputTokens: 0,
        createdAt: frame.timestamp ?? new Date().toISOString(),
        messages: [],
        childIds: [],
        contextWindowSize: 0,
        contextWindowUsed: 0,
        outputPreview: '',
      });
    }
  }

  return agents;
}
