import { describe, it, expect, beforeEach } from 'vitest';
import { useGroupStore, groupKey } from '../groupStore';
import type { ChatGroup, GroupMessage } from '../../types';

const LEAD = 'lead-1';
const GROUP = 'test-group';
const KEY = groupKey(LEAD, GROUP);

function makeMsg(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 'msg-1',
    groupName: GROUP,
    leadId: LEAD,
    fromAgentId: 'agent-a',
    fromRole: 'Developer',
    content: 'hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeGroup(overrides: Partial<ChatGroup> = {}): ChatGroup {
  return {
    name: GROUP,
    leadId: LEAD,
    memberIds: ['agent-a'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetStore() {
  useGroupStore.setState({
    groups: [],
    messages: {},
    selectedGroup: null,
    lastSeenTimestamps: {},
  });
}

// ── groupKey helper ──────────────────────────────────────────

describe('groupKey', () => {
  it('creates composite key from leadId and name', () => {
    expect(groupKey('lead-1', 'design')).toBe('lead-1:design');
  });

  it('handles special characters', () => {
    expect(groupKey('lead:1', 'my group')).toBe('lead:1:my group');
  });
});

// ── Core group operations ────────────────────────────────────

describe('groupStore', () => {
  beforeEach(resetStore);

  describe('setGroups', () => {
    it('replaces all groups', () => {
      useGroupStore.getState().setGroups([makeGroup({ name: 'a' }), makeGroup({ name: 'b' })]);
      expect(useGroupStore.getState().groups).toHaveLength(2);
    });
  });

  describe('addGroup', () => {
    it('adds a new group', () => {
      useGroupStore.getState().addGroup(makeGroup());
      expect(useGroupStore.getState().groups).toHaveLength(1);
    });

    it('deduplicates by name + leadId', () => {
      useGroupStore.getState().addGroup(makeGroup());
      useGroupStore.getState().addGroup(makeGroup());
      expect(useGroupStore.getState().groups).toHaveLength(1);
    });

    it('allows same name for different leads', () => {
      useGroupStore.getState().addGroup(makeGroup({ leadId: 'lead-1' }));
      useGroupStore.getState().addGroup(makeGroup({ leadId: 'lead-2' }));
      expect(useGroupStore.getState().groups).toHaveLength(2);
    });
  });

  describe('addMessage', () => {
    it('appends a message to the key', () => {
      useGroupStore.getState().addMessage(KEY, makeMsg({ id: 'msg-1' }));
      useGroupStore.getState().addMessage(KEY, makeMsg({ id: 'msg-2' }));
      expect(useGroupStore.getState().messages[KEY]).toHaveLength(2);
    });

    it('creates new array for unknown key', () => {
      useGroupStore.getState().addMessage('new-key', makeMsg());
      expect(useGroupStore.getState().messages['new-key']).toHaveLength(1);
    });
  });

  describe('setMessages', () => {
    it('replaces messages for a key', () => {
      useGroupStore.getState().addMessage(KEY, makeMsg({ id: 'old' }));
      useGroupStore.getState().setMessages(KEY, [makeMsg({ id: 'new' })]);
      expect(useGroupStore.getState().messages[KEY]).toHaveLength(1);
      expect(useGroupStore.getState().messages[KEY][0].id).toBe('new');
    });
  });

  describe('addMember', () => {
    it('adds a member to an existing group', () => {
      useGroupStore.getState().setGroups([makeGroup({ memberIds: ['agent-a'] })]);
      useGroupStore.getState().addMember(LEAD, GROUP, 'agent-b');
      expect(useGroupStore.getState().groups[0].memberIds).toEqual(['agent-a', 'agent-b']);
    });

    it('prevents duplicate members', () => {
      useGroupStore.getState().setGroups([makeGroup({ memberIds: ['agent-a'] })]);
      useGroupStore.getState().addMember(LEAD, GROUP, 'agent-a');
      expect(useGroupStore.getState().groups[0].memberIds).toEqual(['agent-a']);
    });

    it('does nothing for non-matching group', () => {
      useGroupStore.getState().setGroups([makeGroup()]);
      useGroupStore.getState().addMember(LEAD, 'other-group', 'agent-b');
      expect(useGroupStore.getState().groups[0].memberIds).toEqual(['agent-a']);
    });
  });

  describe('removeMember', () => {
    it('removes a member from a group', () => {
      useGroupStore.getState().setGroups([makeGroup({ memberIds: ['agent-a', 'agent-b'] })]);
      useGroupStore.getState().removeMember(LEAD, GROUP, 'agent-a');
      expect(useGroupStore.getState().groups[0].memberIds).toEqual(['agent-b']);
    });

    it('no-op for non-existent member', () => {
      useGroupStore.getState().setGroups([makeGroup({ memberIds: ['agent-a'] })]);
      useGroupStore.getState().removeMember(LEAD, GROUP, 'agent-x');
      expect(useGroupStore.getState().groups[0].memberIds).toEqual(['agent-a']);
    });
  });

  describe('selectGroup / clearSelection', () => {
    it('selects a group', () => {
      useGroupStore.getState().selectGroup(LEAD, GROUP);
      expect(useGroupStore.getState().selectedGroup).toEqual({ leadId: LEAD, name: GROUP });
    });

    it('clears selection', () => {
      useGroupStore.getState().selectGroup(LEAD, GROUP);
      useGroupStore.getState().clearSelection();
      expect(useGroupStore.getState().selectedGroup).toBeNull();
    });
  });

  describe('markGroupSeen', () => {
    it('records ISO timestamp for the key', () => {
      const before = new Date().toISOString();
      useGroupStore.getState().markGroupSeen(KEY);
      const ts = useGroupStore.getState().lastSeenTimestamps[KEY];
      expect(ts).toBeDefined();
      expect(new Date(ts).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe('markAllSeen', () => {
    it('marks all message keys as seen', () => {
      const key1 = groupKey('lead-1', 'group-a');
      const key2 = groupKey('lead-1', 'group-b');
      useGroupStore.getState().addMessage(key1, makeMsg({ id: 'msg-1' }));
      useGroupStore.getState().addMessage(key2, makeMsg({ id: 'msg-2' }));
      useGroupStore.getState().markAllSeen();
      const ts = useGroupStore.getState().lastSeenTimestamps;
      expect(ts[key1]).toBeDefined();
      expect(ts[key2]).toBeDefined();
    });

    it('does not add keys for groups with no messages', () => {
      useGroupStore.getState().addMessage(KEY, makeMsg());
      useGroupStore.getState().markAllSeen();
      const keys = Object.keys(useGroupStore.getState().lastSeenTimestamps);
      expect(keys).toEqual([KEY]);
    });
  });

  // ── Reactions (existing tests) ──────────────────────────────

  describe('reactions', () => {
    it('addReaction adds an emoji reaction to a message', () => {
      const msg = makeMsg();
      useGroupStore.getState().setMessages(KEY, [msg]);

      useGroupStore.getState().addReaction(KEY, 'msg-1', '👍', 'agent-a');

      const updated = useGroupStore.getState().messages[KEY][0];
      expect(updated.reactions).toEqual({ '👍': ['agent-a'] });
    });

  it('addReaction appends to existing emoji reactions', () => {
    const msg = makeMsg({ reactions: { '👍': ['agent-a'] } });
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().addReaction(KEY, 'msg-1', '👍', 'agent-b');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions?.['👍']).toEqual(['agent-a', 'agent-b']);
  });

  it('addReaction deduplicates same agent on same emoji', () => {
    const msg = makeMsg({ reactions: { '👍': ['agent-a'] } });
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().addReaction(KEY, 'msg-1', '👍', 'agent-a');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions?.['👍']).toEqual(['agent-a']);
  });

  it('addReaction supports multiple emojis on same message', () => {
    const msg = makeMsg();
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().addReaction(KEY, 'msg-1', '👍', 'agent-a');
    useGroupStore.getState().addReaction(KEY, 'msg-1', '🎉', 'agent-b');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions).toEqual({ '👍': ['agent-a'], '🎉': ['agent-b'] });
  });

  it('removeReaction removes an agent from an emoji', () => {
    const msg = makeMsg({ reactions: { '👍': ['agent-a', 'agent-b'] } });
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().removeReaction(KEY, 'msg-1', '👍', 'agent-a');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions?.['👍']).toEqual(['agent-b']);
  });

  it('removeReaction cleans up empty emoji entries', () => {
    const msg = makeMsg({ reactions: { '👍': ['agent-a'], '🎉': ['agent-b'] } });
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().removeReaction(KEY, 'msg-1', '👍', 'agent-a');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions?.['👍']).toBeUndefined();
    expect(updated.reactions?.['🎉']).toEqual(['agent-b']);
  });

  it('removeReaction is a no-op for non-existent agent', () => {
    const msg = makeMsg({ reactions: { '👍': ['agent-a'] } });
    useGroupStore.getState().setMessages(KEY, [msg]);

    useGroupStore.getState().removeReaction(KEY, 'msg-1', '👍', 'agent-x');

    const updated = useGroupStore.getState().messages[KEY][0];
    expect(updated.reactions?.['👍']).toEqual(['agent-a']);
  });

  it('addReaction only affects the targeted message', () => {
    const msg1 = makeMsg({ id: 'msg-1' });
    const msg2 = makeMsg({ id: 'msg-2' });
    useGroupStore.getState().setMessages(KEY, [msg1, msg2]);

    useGroupStore.getState().addReaction(KEY, 'msg-1', '👍', 'agent-a');

    const msgs = useGroupStore.getState().messages[KEY];
    expect(msgs[0].reactions).toEqual({ '👍': ['agent-a'] });
    expect(msgs[1].reactions).toBeUndefined();
  });
  });
});
