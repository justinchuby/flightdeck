import { create } from 'zustand';
import type { Decision, LeadProgress, AcpTextChunk, AcpToolCall, ChatGroup, GroupMessage, DagStatus } from '../types';
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
  messages: AcpTextChunk[];
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
  /** Timestamp of last text received — used to show "working" indicator */
  lastTextAt: number;
  /** When true, the next appended text should start on a new line */
  pendingNewline: boolean;
}

interface LeadState {
  /** All known lead agent IDs mapped to per-project state */
  projects: Record<string, ProjectState>;
  /** Currently selected lead agent ID */
  selectedLeadId: string | null;
  /** Unsent chat drafts per lead */
  drafts: Record<string, string>;

  selectLead: (id: string | null) => void;
  addProject: (id: string) => void;
  migrateProject: (fromId: string, toId: string) => void;
  removeProject: (id: string) => void;
  setDraft: (leadId: string, text: string) => void;

  setDecisions: (leadId: string, decisions: Decision[]) => void;
  addDecision: (leadId: string, decision: Decision) => void;
  updateDecision: (leadId: string, decisionId: string, updates: Partial<Decision>) => void;
  setProgress: (leadId: string, progress: LeadProgress) => void;
  setProgressSummary: (leadId: string, summary: string) => void;
  addProgressSnapshot: (leadId: string, snapshot: ProgressSnapshot) => void;
  addMessage: (leadId: string, msg: AcpTextChunk) => void;
  setMessages: (leadId: string, messages: AcpTextChunk[]) => void;
  appendToLastAgentMessage: (leadId: string, text: string) => void;
  appendToThinkingMessage: (leadId: string, text: string) => void;
  promoteQueuedMessages: (leadId: string) => void;
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
  return { messages: [], decisions: [], progress: null, progressSummary: null, progressHistory: [], agentReports: [], toolCalls: [], activity: [], comms: [], groups: [], groupMessages: {}, dagStatus: null, lastTextAt: 0, pendingNewline: false };
}

export const useLeadStore = create<LeadState>((set) => ({
  projects: {},
  selectedLeadId: null,
  drafts: {},

  selectLead: (id) => set({ selectedLeadId: id }),

  addProject: (id) =>
    set((s) => {
      if (s.projects[id]) return s;
      return { projects: { ...s.projects, [id]: emptyProject() } };
    }),

  migrateProject: (fromId, toId) =>
    set((s) => {
      const source = s.projects[fromId];
      if (!source || fromId === toId) return s;
      const target = s.projects[toId] ?? emptyProject();
      // Merge: keep target data if non-empty, otherwise take from source
      const merged: ProjectState = {
        ...source,
        messages: target.messages.length > 0 ? target.messages : source.messages,
        decisions: target.decisions.length > 0 ? target.decisions : source.decisions,
        activity: target.activity.length > 0 ? target.activity : source.activity,
        comms: target.comms.length > 0 ? target.comms : source.comms,
        agentReports: target.agentReports.length > 0 ? target.agentReports : source.agentReports,
        groups: target.groups.length > 0 ? target.groups : source.groups,
        groupMessages: Object.keys(target.groupMessages).length > 0 ? target.groupMessages : source.groupMessages,
        dagStatus: target.dagStatus ?? source.dagStatus,
        progress: target.progress ?? source.progress,
        progressSummary: target.progressSummary ?? source.progressSummary,
        progressHistory: target.progressHistory.length > 0 ? target.progressHistory : source.progressHistory,
      };
      const { [fromId]: _, ...rest } = s.projects;
      return { projects: { ...rest, [toId]: merged } };
    }),

  removeProject: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.projects;
      const { [id]: _d, ...restDrafts } = s.drafts;
      return {
        projects: rest,
        drafts: restDrafts,
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

  addMessage: (leadId, msg) => {
    const ms = useMessageStore.getState();
    ms.ensureChannel(leadId);
    ms.addMessage(leadId, msg);
    const ch = useMessageStore.getState().channels[leadId];
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: ch?.messages ?? [] } } };
    });
  },

  setMessages: (leadId, messages) => {
    const ms = useMessageStore.getState();
    ms.ensureChannel(leadId);
    ms.setMessages(leadId, messages);
    const ch = useMessageStore.getState().channels[leadId];
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: ch?.messages ?? [] } } };
    });
  },

  appendToLastAgentMessage: (leadId, text) => {
    const ms = useMessageStore.getState();
    ms.ensureChannel(leadId);
    ms.appendToLastAgentMessage(leadId, text);
    const ch = useMessageStore.getState().channels[leadId];
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: ch?.messages ?? [], lastTextAt: ch?.lastTextAt ?? proj.lastTextAt, pendingNewline: ch?.pendingNewline ?? proj.pendingNewline } } };
    });
  },

  appendToThinkingMessage: (leadId, text) => {
    const ms = useMessageStore.getState();
    ms.ensureChannel(leadId);
    ms.appendToThinkingMessage(leadId, text);
    const ch = useMessageStore.getState().channels[leadId];
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: ch?.messages ?? [], pendingNewline: true } } };
    });
  },

  promoteQueuedMessages: (leadId) => {
    const ms = useMessageStore.getState();
    ms.ensureChannel(leadId);
    ms.promoteQueuedMessages(leadId);
    const ch = useMessageStore.getState().channels[leadId];
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: ch?.messages ?? [] } } };
    });
  },

  updateToolCall: (leadId, toolCall) =>
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
      return { projects: { ...s.projects, [leadId]: { ...proj, toolCalls, pendingNewline: true } } };
    }),

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
    set({ projects: {}, selectedLeadId: null });
  },
}));
