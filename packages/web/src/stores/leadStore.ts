import { create } from 'zustand';
import type { Decision, LeadProgress, AcpTextChunk } from '../types';

interface ProjectState {
  messages: AcpTextChunk[];
  decisions: Decision[];
  progress: LeadProgress | null;
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
  reset: () => void;
}

function emptyProject(): ProjectState {
  return { messages: [], decisions: [], progress: null };
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
        msgs[lastIdx] = { ...msgs[lastIdx], text: msgs[lastIdx].text + text };
      } else {
        msgs.push({ type: 'text', text: text.replace(/^\n+/, ''), sender: 'agent' });
      }
      return { projects: { ...s.projects, [leadId]: { ...proj, messages: msgs } } };
    }),

  reset: () => set({ projects: {}, selectedLeadId: null }),
}));
