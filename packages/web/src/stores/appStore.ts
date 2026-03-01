import { create } from 'zustand';
import type { AgentInfo, Role, ServerConfig } from '../types';

interface AppState {
  agents: AgentInfo[];
  roles: Role[];
  config: ServerConfig | null;
  selectedAgentId: string | null;
  connected: boolean;
  loading: boolean;
  systemPaused: boolean;

  setAgents: (agents: AgentInfo[]) => void;
  addAgent: (agent: AgentInfo) => void;
  updateAgent: (id: string, patch: Partial<AgentInfo>) => void;
  removeAgent: (id: string) => void;

  setRoles: (roles: Role[]) => void;
  setConfig: (config: ServerConfig) => void;
  setSelectedAgent: (id: string | null) => void;
  clearPermission: (agentId: string) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setSystemPaused: (paused: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  agents: [],
  roles: [],
  config: null,
  selectedAgentId: null,
  connected: false,
  loading: true,
  systemPaused: false,

  setAgents: (agents) => set({ agents }),
  addAgent: (agent) =>
    set((s) =>
      s.agents.some((a) => a.id === agent.id)
        ? { agents: s.agents.map((a) => (a.id === agent.id ? agent : a)) }
        : { agents: [...s.agents, agent] },
    ),
  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  removeAgent: (id) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      selectedAgentId: s.selectedAgentId === id ? null : s.selectedAgentId,
    })),

  clearPermission: (agentId) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === agentId ? { ...a, pendingPermission: undefined } : a,
      ),
    })),
  setRoles: (roles) => set({ roles }),
  setConfig: (config) => set({ config }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  setConnected: (connected) => set({ connected }),
  setLoading: (loading) => set({ loading }),
  setSystemPaused: (systemPaused) => set({ systemPaused }),
}));
