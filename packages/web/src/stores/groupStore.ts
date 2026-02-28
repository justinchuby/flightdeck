import { create } from 'zustand';
import type { ChatGroup, GroupMessage } from '../types';

interface GroupState {
  groups: ChatGroup[];
  messages: Record<string, GroupMessage[]>; // keyed by `${leadId}:${groupName}`
  selectedGroup: { leadId: string; name: string } | null;
  lastSeenTimestamps: Record<string, string>; // key → ISO timestamp of last view

  setGroups: (groups: ChatGroup[]) => void;
  addGroup: (group: ChatGroup) => void;
  addMessage: (key: string, message: GroupMessage) => void;
  setMessages: (key: string, messages: GroupMessage[]) => void;
  addMember: (leadId: string, groupName: string, agentId: string) => void;
  removeMember: (leadId: string, groupName: string, agentId: string) => void;
  selectGroup: (leadId: string, name: string) => void;
  clearSelection: () => void;
  markGroupSeen: (key: string) => void;
  markAllSeen: () => void;
}

export function groupKey(leadId: string, name: string): string {
  return `${leadId}:${name}`;
}

export const useGroupStore = create<GroupState>((set) => ({
  groups: [],
  messages: {},
  selectedGroup: null,
  lastSeenTimestamps: {},

  setGroups: (groups) => set({ groups }),

  addGroup: (group) =>
    set((s) => {
      if (s.groups.some((g) => g.name === group.name && g.leadId === group.leadId)) return s;
      return { groups: [...s.groups, group] };
    }),

  addMessage: (key, message) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [key]: [...(s.messages[key] ?? []), message],
      },
    })),

  setMessages: (key, messages) =>
    set((s) => ({
      messages: { ...s.messages, [key]: messages },
    })),

  addMember: (leadId, groupName, agentId) =>
    set((s) => ({
      groups: s.groups.map((g) =>
        g.name === groupName && g.leadId === leadId && !g.memberIds.includes(agentId)
          ? { ...g, memberIds: [...g.memberIds, agentId] }
          : g,
      ),
    })),

  removeMember: (leadId, groupName, agentId) =>
    set((s) => ({
      groups: s.groups.map((g) =>
        g.name === groupName && g.leadId === leadId
          ? { ...g, memberIds: g.memberIds.filter((id) => id !== agentId) }
          : g,
      ),
    })),

  selectGroup: (leadId, name) => set({ selectedGroup: { leadId, name } }),
  clearSelection: () => set({ selectedGroup: null }),
  markGroupSeen: (key) =>
    set((s) => ({ lastSeenTimestamps: { ...s.lastSeenTimestamps, [key]: new Date().toISOString() } })),
  markAllSeen: () =>
    set((s) => {
      const now = new Date().toISOString();
      const updated = { ...s.lastSeenTimestamps };
      for (const key of Object.keys(s.messages)) updated[key] = now;
      return { lastSeenTimestamps: updated };
    }),
}));
