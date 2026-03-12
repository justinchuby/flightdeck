import { create } from 'zustand';
import type { Decision, LeadProgress, AcpTextChunk, AcpToolCall, ChatGroup, GroupMessage, DagStatus } from '../types';
import { hasUnclosedCommandBlock } from '../utils/commandParser';

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
      const raw = progress as any;
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

  addMessage: (leadId, msg) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const withTs = { ...msg, timestamp: msg.timestamp ?? Date.now() };
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: [...proj.messages, withTs] } } };
    }),

  setMessages: (leadId, messages) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages } } };
    }),

  appendToLastAgentMessage: (leadId, text) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const msgs = [...proj.messages];
      // Find the last agent message (may not be the very last message if thinking interleaved)
      let agentIdx = -1;
      for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].sender === 'agent') { agentIdx = k; break; }
        // Only look past thinking messages — stop at user/system/external boundaries
        if (msgs[k].sender !== 'thinking') break;
      }
      const agentText = agentIdx >= 0 ? msgs[agentIdx].text : '';
      // Use depth-aware check — the old `lastIndexOf('⟦⟦') > lastIndexOf('⟧⟧')` heuristic
      // fails when nested ⟦⟦ ⟧⟧ appear inside command JSON (e.g. DELEGATE with example commands)
      const unclosedCommand = hasUnclosedCommandBlock(agentText);
      if (agentIdx >= 0 && (!proj.pendingNewline || unclosedCommand)) {
        msgs[agentIdx] = { ...msgs[agentIdx], text: agentText + text, timestamp: msgs[agentIdx].timestamp || Date.now() };
      } else {
        msgs.push({ type: 'text', text: text, sender: 'agent', timestamp: Date.now() });
      }
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: msgs, lastTextAt: Date.now(), pendingNewline: false } } };
    }),

  appendToThinkingMessage: (leadId, text) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const msgs = [...proj.messages];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].sender === 'thinking') {
        msgs[lastIdx] = { ...msgs[lastIdx], text: (msgs[lastIdx].text || '') + text };
      } else {
        msgs.push({ type: 'text', text, sender: 'thinking', timestamp: Date.now() });
      }
      // Set pendingNewline so next agent text starts a new message (paragraph break after reasoning)
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: msgs, pendingNewline: true } } };
    }),

  promoteQueuedMessages: (leadId) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const updated = proj.messages.map((m) => m.queued ? { ...m, queued: false } : m);
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: updated } } };
    }),

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

  reset: () => set({ projects: {}, selectedLeadId: null }),
}));
