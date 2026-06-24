import { create } from 'zustand';
import type { Decision, LeadProgress, AcpToolCall, ChatGroup, GroupMessage, DagStatus } from '../types';
import { useMessageStore } from './messageStore';

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentRole: string;
  type: 'tool_call' | 'delegation' | 'completion' | 'message_sent' | 'progress_update';
  summary: string;
  detail?: string;
  status?: string;
  timestamp: number;
}

export type CommType = 'delegation' | 'message' | 'group_message' | 'broadcast' | 'report';

export interface AgentComm {
  id: string;
  fromId: string;
  fromRole: string;
  toId: string;
  toRole: string;
  content: string;
  timestamp: number;
  type?: CommType;
}

export interface ProgressSnapshot {
  summary: string;
  completed: string[];
  inProgress: string[];
  blocked: string[];
  timestamp: number;
}

export interface AgentReport {
  id: string;
  fromRole: string;
  fromId: string;
  content: string;
  timestamp: number;
}

interface ProjectState {
  decisions: Decision[];
  progress: LeadProgress | null;
  progressSummary: string | null;
  progressHistory: ProgressSnapshot[];
  agentReports: AgentReport[];
  toolCalls: AcpToolCall[];
  activity: ActivityEvent[];
  comms: AgentComm[];
  groups: ChatGroup[];
  groupMessages: Record<string, GroupMessage[]>;
  dagStatus: DagStatus | null;
}

interface LeadState {
  /** All known lead agent IDs mapped to per-project state */
  projects: Record<string, ProjectState>;
  /** Maps projectId → leadId so consumers can look up by either key */
  projectToLead: Record<string, string>;
  /** Currently selected lead agent ID */
  selectedLeadId: string | null;
  /** Unsent chat drafts per lead */
  drafts: Record<string, string>;

  selectLead: (id: string | null) => void;
  addProject: (leadId: string, projectId?: string) => void;
  /** Register a projectId → leadId alias so resolveProject() finds data by either key */
  linkProjectId: (projectId: string, leadId: string) => void;
  removeProject: (id: string) => void;
  setDraft: (leadId: string, text: string) => void;

  setDecisions: (leadId: string, decisions: Decision[]) => void;
  addDecision: (leadId: string, decision: Decision) => void;
  updateDecision: (leadId: string, decisionId: string, updates: Partial<Decision>) => void;
  setProgress: (leadId: string, progress: LeadProgress) => void;
  setProgressSummary: (leadId: string, summary: string) => void;
  addProgressSnapshot: (leadId: string, snapshot: ProgressSnapshot) => void;
  updateToolCall: (leadId: string, toolCall: AcpToolCall) => void;
  addActivity: (leadId: string, event: ActivityEvent) => void;
  addComm: (leadId: string, comm: AgentComm) => void;
  addAgentReport: (leadId: string, report: AgentReport) => void;
  setGroups: (leadId: string, groups: ChatGroup[]) => void;
  addGroupMessage: (leadId: string, groupName: string, message: GroupMessage) => void;
  setDagStatus: (leadId: string, status: DagStatus) => void;
  reset: () => void;
}

function emptyProject(): ProjectState {
  return { decisions: [], progress: null, progressSummary: null, progressHistory: [], agentReports: [], toolCalls: [], activity: [], comms: [], groups: [], groupMessages: {}, dagStatus: null };
}

/**
 * Resolve project state by any key — works with both leadId and projectId.
 * Use this in zustand selectors instead of direct `s.projects[id]` access.
 */
export function resolveProject(state: LeadState, id: string | null | undefined): ProjectState | undefined {
  if (!id) return undefined;
  const direct = state.projects[id];
  if (direct) return direct;
  const leadId = state.projectToLead[id];
  return leadId ? state.projects[leadId] : undefined;
}

export const useLeadStore = create<LeadState>((set) => ({
  projects: {},
  projectToLead: {},
  selectedLeadId: null,
  drafts: {},

  selectLead: (id) => set({ selectedLeadId: id }),

  addProject: (id, projectId) =>
    set((s) => {
      const updates: Partial<LeadState> = {};
      if (!s.projects[id]) {
        updates.projects = { ...s.projects, [id]: emptyProject() };
      }
      if (projectId && s.projectToLead[projectId] !== id) {
        updates.projectToLead = { ...s.projectToLead, [projectId]: id };
      }
      return Object.keys(updates).length > 0 ? updates : s;
    }),

  linkProjectId: (projectId, leadId) =>
    set((s) => {
      if (s.projectToLead[projectId] === leadId) return s;
      return { projectToLead: { ...s.projectToLead, [projectId]: leadId } };
    }),

  removeProject: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.projects;
      const { [id]: _d, ...restDrafts } = s.drafts;
      // Remove any alias pointing to this leadId
      const projectToLead = { ...s.projectToLead };
      for (const [pid, lid] of Object.entries(projectToLead)) {
        if (lid === id) delete projectToLead[pid];
      }
      return {
        projects: rest,
        drafts: restDrafts,
        projectToLead,
        selectedLeadId: s.selectedLeadId === id ? null : s.selectedLeadId,
      };
    }),

  setDraft: (leadId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [leadId]: text } })),

  setDecisions: (leadId, decisions) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, decisions } } };
    }),

  addDecision: (leadId, decision) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, decisions: [...proj.decisions, decision] } } };
    }),

  updateDecision: (leadId, decisionId, updates) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const decisions = proj.decisions.map((d) =>
        d.id === decisionId ? { ...d, ...updates } : d,
      );
      return { projects: { ...s.projects, [leadId]: { ...proj, decisions } } };
    }),

  setProgress: (leadId, progress) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      // Normalize server-side property names (team→crew rename, Phase 1)
      const raw = progress as LeadProgress & { teamAgents?: LeadProgress['crewAgents']; teamSize?: number };
      const normalized: LeadProgress = {
        ...progress,
        crewAgents: progress.crewAgents ?? raw.teamAgents ?? [],
        crewSize: progress.crewSize ?? raw.teamSize ?? 0,
      };
      return { projects: { ...s.projects, [leadId]: { ...proj, progress: normalized } } };
    }),

  setProgressSummary: (leadId, summary) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, progressSummary: summary } } };
    }),

  addProgressSnapshot: (leadId, snapshot) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, progressHistory: [...proj.progressHistory, snapshot] } } };
    }),

  updateToolCall: (leadId, toolCall) => {
    useMessageStore.getState().setPendingNewline(leadId, true);
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const existing = proj.toolCalls.findIndex((t) => t.toolCallId === toolCall.toolCallId);
      let toolCalls: AcpToolCall[];
      if (existing >= 0) {
        toolCalls = [...proj.toolCalls];
        toolCalls[existing] = toolCall;
      } else {
        toolCalls = [...proj.toolCalls, toolCall];
      }
      // Keep only last 50
      if (toolCalls.length > 50) toolCalls = toolCalls.slice(-50);
      return { projects: { ...s.projects, [leadId]: { ...proj, toolCalls } } };
    });
  },

  addActivity: (leadId, event) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      let activity = [...proj.activity, event];
      // Keep only last 100
      if (activity.length > 100) activity = activity.slice(-100);
      return { projects: { ...s.projects, [leadId]: { ...proj, activity } } };
    }),

  addComm: (leadId, comm) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      let comms = [...proj.comms, comm];
      if (comms.length > 200) comms = comms.slice(-200);
      return { projects: { ...s.projects, [leadId]: { ...proj, comms } } };
    }),

  addAgentReport: (leadId, report) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      let reports = [...proj.agentReports, report];
      if (reports.length > 100) reports = reports.slice(-100);
      return { projects: { ...s.projects, [leadId]: { ...proj, agentReports: reports } } };
    }),

  setGroups: (leadId, groups) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, groups } } };
    }),

  addGroupMessage: (leadId, groupName, message) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const existing = proj.groupMessages[groupName] ?? [];
      // Deduplicate by message id
      if (existing.some((m) => m.id === message.id)) return s;
      let msgs = [...existing, message];
      if (msgs.length > 500) msgs = msgs.slice(-500);
      return {
        projects: {
          ...s.projects,
          [leadId]: {
            ...proj,
            groupMessages: { ...proj.groupMessages, [groupName]: msgs },
          },
        },
      };
    }),

  setDagStatus: (leadId, status) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, dagStatus: status } } };
    }),

  reset: () => {
    useMessageStore.getState().reset();
    set({ projects: {}, projectToLead: {}, selectedLeadId: null });
  },
}));
