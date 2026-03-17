import { create } from 'zustand';
import type { AgentInfo, Role, ServerConfig, Decision } from '../types';

interface AppState {
  agents: AgentInfo[];
  roles: Role[];
  config: ServerConfig | null;
  selectedAgentId: string | null;
  connected: boolean;
  loading: boolean;
  systemPaused: boolean;

  // Approval Queue
  pendingDecisions: Decision[];
  approvalQueueOpen: boolean;

  setAgents: (agents: AgentInfo[]) => void;
  addAgent: (agent: AgentInfo) => void;
  updateAgent: (id: string, patch: Partial<AgentInfo>) => void;
  removeAgent: (id: string) => void;

  setRoles: (roles: Role[]) => void;
  setConfig: (config: ServerConfig) => void;
  setSelectedAgent: (id: string | null) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setSystemPaused: (paused: boolean) => void;

  // Approval Queue actions
  addPendingDecision: (decision: Decision) => void;
  removePendingDecision: (id: string) => void;
  updatePendingDecision: (id: string, updates: Partial<Decision>) => void;
  setPendingDecisions: (decisions: Decision[]) => void;
  setApprovalQueueOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  agents: [],
  roles: [],
  config: null,
  selectedAgentId: null,
  connected: false,
  loading: true,
  systemPaused: false,
  pendingDecisions: [],
  approvalQueueOpen: false,

  setAgents: (incoming) =>
    set((s) => {
      // Preserve client-only fields (messages, plan) that aren't in server's toJSON()
      const byId = new Map(s.agents.map((a) => [a.id, a]));
      return {
        agents: incoming.map((a) => {
          const prev = byId.get(a.id);
          if (!prev) return a;
          // Use new value if explicitly provided; fall back to previous if new is undefined
          const messages = a.messages !== undefined ? a.messages : prev.messages;
          const plan = a.plan !== undefined ? a.plan : prev.plan;
          return { ...a, messages, plan };
        }),
      };
    }),
  addAgent: (agent) =>
    set((s) => {
      const prev = s.agents.find((a) => a.id === agent.id);
      if (prev) {
        // Merge: keep client-only fields (messages, plan) only when new agent doesn't provide them
        const messages = agent.messages !== undefined ? agent.messages : prev.messages;
        const plan = agent.plan !== undefined ? agent.plan : prev.plan;
        return { agents: s.agents.map((a) => (a.id === agent.id ? { ...agent, messages, plan } : a)) };
      }
      return { agents: [...s.agents, agent] };
    }),
  updateAgent: (id, patch) =>
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  removeAgent: (id) =>
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      selectedAgentId: s.selectedAgentId === id ? null : s.selectedAgentId,
    })),

  setRoles: (roles) => set({ roles }),
  setConfig: (config) => set({ config }),
  setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
  setConnected: (connected) => set({ connected }),
  setLoading: (loading) => set({ loading }),
  setSystemPaused: (systemPaused) => set({ systemPaused }),

  // Approval Queue
  addPendingDecision: (decision) =>
    set((s) => {
      if (s.pendingDecisions.some((d) => d.id === decision.id)) return s;
      return { pendingDecisions: [...s.pendingDecisions, decision] };
    }),
  removePendingDecision: (id) =>
    set((s) => ({
      pendingDecisions: s.pendingDecisions.filter((d) => d.id !== id),
    })),
  updatePendingDecision: (id, updates) =>
    set((s) => ({
      pendingDecisions: s.pendingDecisions.map((d) =>
        d.id === id ? { ...d, ...updates } : d,
      ),
    })),
  setPendingDecisions: (decisions) => set({ pendingDecisions: decisions }),
  setApprovalQueueOpen: (approvalQueueOpen) => set({ approvalQueueOpen }),
}));
