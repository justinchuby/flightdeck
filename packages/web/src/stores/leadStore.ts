import { create } from 'zustand';
import type { Decision, LeadProgress, AcpTextChunk, AcpToolCall } from '../types';

export interface ActivityEvent {
  id: string;
  agentId: string;
  agentRole: string;
  type: 'tool_call' | 'delegation' | 'completion' | 'message_sent';
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

interface ProjectState {
  messages: AcpTextChunk[];
  decisions: Decision[];
  progress: LeadProgress | null;
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

  selectLead: (id: string | null) => void;
  addProject: (id: string) => void;
  removeProject: (id: string) => void;

  setDecisions: (leadId: string, decisions: Decision[]) => void;
  addDecision: (leadId: string, decision: Decision) => void;
  setProgress: (leadId: string, progress: LeadProgress) => void;
  addMessage: (leadId: string, msg: AcpTextChunk) => void;
  appendToLastAgentMessage: (leadId: string, text: string) => void;
  updateToolCall: (leadId: string, toolCall: AcpToolCall) => void;
  addActivity: (leadId: string, event: ActivityEvent) => void;
  addComm: (leadId: string, comm: AgentComm) => void;
  reset: () => void;
}

function emptyProject(): ProjectState {
  return { messages: [], decisions: [], progress: null, toolCalls: [], activity: [], comms: [], lastTextAt: 0, pendingNewline: false };
}

export const useLeadStore = create<LeadState>((set) => ({
  projects: {},
  selectedLeadId: null,

  selectLead: (id) => set({ selectedLeadId: id }),

  addProject: (id) =>
    set((s) => {
      if (s.projects[id]) return s;
      return { projects: { ...s.projects, [id]: emptyProject() } };
    }),

  removeProject: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.projects;
      return {
        projects: rest,
        selectedLeadId: s.selectedLeadId === id ? null : s.selectedLeadId,
      };
    }),

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

  addMessage: (leadId, msg) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: [...proj.messages, msg] } } };
    }),

  appendToLastAgentMessage: (leadId, text) =>
    set((s) => {
      const proj = s.projects[leadId] || emptyProject();
      const msgs = [...proj.messages];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].sender === 'agent') {
        const separator = proj.pendingNewline ? '\n' : '';
        msgs[lastIdx] = { ...msgs[lastIdx], text: msgs[lastIdx].text + separator + text };
      } else {
        msgs.push({ type: 'text', text: text, sender: 'agent' });
      }
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: msgs, lastTextAt: Date.now(), pendingNewline: false } } };
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

  reset: () => set({ projects: {}, selectedLeadId: null }),
}));
