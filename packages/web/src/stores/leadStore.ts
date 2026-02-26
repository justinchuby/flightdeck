import { create } from 'zustand';
import type { Decision, LeadProgress, AcpTextChunk, AcpToolCall } from '../types';

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentRole: string;
  type: 'tool_call' | 'delegation' | 'completion' | 'message_sent' | 'progress';
  summary: string;
  detail?: string;
  status?: string;
  timestamp: number;
}

export interface AgentComm {
  id: string;
  fromId: string;
  fromRole: string;
  toId: string;
  toRole: string;
  content: string;
  timestamp: number;
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
  setProgress: (leadId: string, progress: LeadProgress) => void;
  setProgressSummary: (leadId: string, summary: string) => void;
  addProgressSnapshot: (leadId: string, snapshot: ProgressSnapshot) => void;
  addMessage: (leadId: string, msg: AcpTextChunk) => void;
  appendToLastAgentMessage: (leadId: string, text: string) => void;
  promoteQueuedMessages: (leadId: string) => void;
  updateToolCall: (leadId: string, toolCall: AcpToolCall) => void;
  addActivity: (leadId: string, event: ActivityEvent) => void;
  addComm: (leadId: string, comm: AgentComm) => void;
  addAgentReport: (leadId: string, report: AgentReport) => void;
  reset: () => void;
}

function emptyProject(): ProjectState {
  return { messages: [], decisions: [], progress: null, progressSummary: null, progressHistory: [], agentReports: [], toolCalls: [], activity: [], comms: [], lastTextAt: 0, pendingNewline: false };
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

  setProgress: (leadId, progress) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, progress } } };
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

  appendToLastAgentMessage: (leadId, text) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const msgs = [...proj.messages];
      const lastIdx = msgs.length - 1;
      // If the last message has an unclosed <!-- block, always append to keep the command intact
      const lastText = lastIdx >= 0 ? msgs[lastIdx].text : '';
      const hasUnclosedCommand = lastText.lastIndexOf('<!--') > lastText.lastIndexOf('-->');
      if (lastIdx >= 0 && msgs[lastIdx].sender === 'agent' && (!proj.pendingNewline || hasUnclosedCommand)) {
        msgs[lastIdx] = { ...msgs[lastIdx], text: lastText + text, timestamp: msgs[lastIdx].timestamp || Date.now() };
      } else {
        msgs.push({ type: 'text', text: text, sender: 'agent', timestamp: Date.now() });
      }
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: msgs, lastTextAt: Date.now(), pendingNewline: false } } };
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

  reset: () => set({ projects: {}, selectedLeadId: null }),
}));
