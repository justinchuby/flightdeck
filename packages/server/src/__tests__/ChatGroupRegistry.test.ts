import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { ChatGroupRegistry } from '../comms/ChatGroupRegistry.js';

const TEST_DB = ':memory:';

describe('ChatGroupRegistry', () => {
  let db: Database;
  let registry: ChatGroupRegistry;

  beforeEach(() => {
    db = new Database(TEST_DB);
    registry = new ChatGroupRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a group with lead auto-included', () => {
      const group = registry.create('lead-1', 'config-team', ['agent-a', 'agent-b']);
      expect(group.name).toBe('config-team');
      expect(group.leadId).toBe('lead-1');
      expect(group.memberIds).toContain('lead-1');
      expect(group.memberIds).toContain('agent-a');
      expect(group.memberIds).toContain('agent-b');
      expect(group.memberIds).toHaveLength(3);
    });

    it('emits group:created event', () => {
      let emitted: any = null;
      registry.on('group:created', (data) => { emitted = data; });
      registry.create('lead-1', 'test-group', ['agent-a']);
      expect(emitted).not.toBeNull();
      expect(emitted.name).toBe('test-group');
      expect(emitted.leadId).toBe('lead-1');
    });

    it('deduplicates lead if included in memberIds', () => {
      const group = registry.create('lead-1', 'team', ['lead-1', 'agent-a']);
      expect(group.memberIds).toHaveLength(2);
      expect(group.memberIds).toContain('lead-1');
      expect(group.memberIds).toContain('agent-a');
    });

    it('is idempotent (INSERT OR IGNORE)', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      // Creating again with same name + lead should not throw
      const _group2 = registry.create('lead-1', 'team', ['agent-b']);
      // Should now have 3 members: lead, agent-a (from first), agent-b (from second)
      const members = registry.getMembers('team', 'lead-1');
      expect(members).toContain('lead-1');
      expect(members).toContain('agent-a');
      expect(members).toContain('agent-b');
    });
  });

  describe('addMembers', () => {
    it('adds new members to an existing group', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const added = registry.addMembers('lead-1', 'team', ['agent-b', 'agent-c']);
      expect(added).toEqual(['agent-b', 'agent-c']);
      expect(registry.getMembers('team', 'lead-1')).toHaveLength(4);
    });

    it('returns empty array for already-existing members', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const added = registry.addMembers('lead-1', 'team', ['agent-a']);
      expect(added).toEqual([]);
    });

    it('emits group:member_added for each new member', () => {
      registry.create('lead-1', 'team', []);
      const events: any[] = [];
      registry.on('group:member_added', (data) => events.push(data));
      registry.addMembers('lead-1', 'team', ['agent-a', 'agent-b']);
      expect(events).toHaveLength(2);
      expect(events[0].agentId).toBe('agent-a');
      expect(events[1].agentId).toBe('agent-b');
    });
  });

  describe('removeMembers', () => {
    it('removes members from a group', () => {
      registry.create('lead-1', 'team', ['agent-a', 'agent-b']);
      const removed = registry.removeMembers('lead-1', 'team', ['agent-a']);
      expect(removed).toEqual(['agent-a']);
      expect(registry.getMembers('team', 'lead-1')).not.toContain('agent-a');
    });

    it('does NOT allow removing the lead', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const removed = registry.removeMembers('lead-1', 'team', ['lead-1']);
      expect(removed).toEqual([]);
      expect(registry.getMembers('team', 'lead-1')).toContain('lead-1');
    });

    it('emits group:member_removed for removed members', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const events: any[] = [];
      registry.on('group:member_removed', (data) => events.push(data));
      registry.removeMembers('lead-1', 'team', ['agent-a']);
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('agent-a');
    });

    it('returns empty for non-existent members', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const removed = registry.removeMembers('lead-1', 'team', ['agent-z']);
      expect(removed).toEqual([]);
    });
  });

  describe('sendMessage', () => {
    it('stores and returns a message when sender is a member', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const msg = registry.sendMessage('team', 'lead-1', 'agent-a', 'Developer', 'hello');
      expect(msg).not.toBeNull();
      expect(msg!.groupName).toBe('team');
      expect(msg!.fromAgentId).toBe('agent-a');
      expect(msg!.fromRole).toBe('Developer');
      expect(msg!.content).toBe('hello');
      expect(msg!.id).toMatch(/^gmsg-/);
    });

    it('returns null when sender is NOT a member', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const msg = registry.sendMessage('team', 'lead-1', 'agent-z', 'Unknown', 'nope');
      expect(msg).toBeNull();
    });

    it('emits group:message with recipientIds (excluding sender)', () => {
      registry.create('lead-1', 'team', ['agent-a', 'agent-b']);
      let emitted: any = null;
      registry.on('group:message', (data) => { emitted = data; });
      registry.sendMessage('team', 'lead-1', 'agent-a', 'Developer', 'test');
      expect(emitted).not.toBeNull();
      expect(emitted.recipientIds).not.toContain('agent-a');
      expect(emitted.recipientIds).toContain('lead-1');
      expect(emitted.recipientIds).toContain('agent-b');
    });

    it('persists messages that can be retrieved', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      registry.sendMessage('team', 'lead-1', 'agent-a', 'Developer', 'msg1');
      registry.sendMessage('team', 'lead-1', 'lead-1', 'Lead', 'msg2');
      const msgs = registry.getMessages('team', 'lead-1');
      expect(msgs).toHaveLength(2);
      const contents = msgs.map((m) => m.content).sort();
      expect(contents).toEqual(['msg1', 'msg2']);
    });
  });

  describe('getGroups', () => {
    it('returns groups for a lead', () => {
      registry.create('lead-1', 'team-a', ['agent-a']);
      registry.create('lead-1', 'team-b', ['agent-b']);
      const groups = registry.getGroups('lead-1');
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name)).toEqual(['team-a', 'team-b']);
    });

    it('returns empty array for unknown lead', () => {
      expect(registry.getGroups('nonexistent')).toEqual([]);
    });

    it('scopes groups to the lead', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      registry.create('lead-2', 'team', ['agent-b']);
      expect(registry.getGroups('lead-1')).toHaveLength(1);
      expect(registry.getGroups('lead-2')).toHaveLength(1);
    });
  });

  describe('getGroupsForAgent', () => {
    it('returns all groups an agent belongs to', () => {
      registry.create('lead-1', 'team-a', ['agent-a', 'agent-b']);
      registry.create('lead-1', 'team-b', ['agent-a']);
      registry.create('lead-1', 'team-c', ['agent-b']);
      const groups = registry.getGroupsForAgent('agent-a');
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name)).toEqual(['team-a', 'team-b']);
    });

    it('returns empty for agent in no groups', () => {
      expect(registry.getGroupsForAgent('agent-z')).toEqual([]);
    });
  });

  describe('getMembers', () => {
    it('returns members in order of added_at', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      registry.addMembers('lead-1', 'team', ['agent-b']);
      const members = registry.getMembers('team', 'lead-1');
      expect(members).toContain('lead-1');
      expect(members).toContain('agent-a');
      expect(members).toContain('agent-b');
    });
  });

  describe('getMessages', () => {
    it('respects the limit parameter', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      for (let i = 0; i < 10; i++) {
        registry.sendMessage('team', 'lead-1', 'agent-a', 'Dev', `msg-${i}`);
      }
      const msgs = registry.getMessages('team', 'lead-1', 3);
      expect(msgs).toHaveLength(3);
    });

    it('returns empty for non-existent group', () => {
      expect(registry.getMessages('nope', 'lead-1')).toEqual([]);
    });
  });

  describe('isMember', () => {
    it('returns true for a group member', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      expect(registry.isMember('team', 'lead-1', 'agent-a')).toBe(true);
    });

    it('returns true for the lead (auto-included)', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      expect(registry.isMember('team', 'lead-1', 'lead-1')).toBe(true);
    });

    it('returns false for a non-member', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      expect(registry.isMember('team', 'lead-1', 'agent-z')).toBe(false);
    });

    it('returns false for non-existent group', () => {
      expect(registry.isMember('nope', 'lead-1', 'agent-a')).toBe(false);
    });
  });

  describe('findGroupForAgent', () => {
    it('finds a group the agent belongs to', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      const group = registry.findGroupForAgent('team', 'agent-a');
      expect(group).not.toBeUndefined();
      expect(group!.name).toBe('team');
      expect(group!.leadId).toBe('lead-1');
    });

    it('returns undefined when agent is not a member', () => {
      registry.create('lead-1', 'team', ['agent-a']);
      expect(registry.findGroupForAgent('team', 'agent-z')).toBeUndefined();
    });

    it('returns undefined for non-existent group', () => {
      expect(registry.findGroupForAgent('nope', 'agent-a')).toBeUndefined();
    });
  });

  describe('exists', () => {
    it('returns true for existing group', () => {
      registry.create('lead-1', 'team', []);
      expect(registry.exists('team', 'lead-1')).toBe(true);
    });

    it('returns false for non-existent group', () => {
      expect(registry.exists('nope', 'lead-1')).toBe(false);
    });

    it('scopes to lead', () => {
      registry.create('lead-1', 'team', []);
      expect(registry.exists('team', 'lead-2')).toBe(false);
    });
  });

  describe('role-based groups', () => {
    it('create persists roles criteria', () => {
      registry.create('lead-1', 'dev-team', ['agent-1'], undefined, ['developer', 'designer']);
      const groups = registry.getGroupsWithRoles('lead-1');
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('dev-team');
      expect(groups[0].roles).toEqual(['developer', 'designer']);
    });

    it('getGroupsWithRoles excludes groups without roles', () => {
      registry.create('lead-1', 'manual-team', ['agent-1']);
      registry.create('lead-1', 'role-team', ['agent-1'], undefined, ['developer']);
      const groups = registry.getGroupsWithRoles('lead-1');
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('role-team');
    });

    it('getGroupsWithRoles excludes archived groups', () => {
      registry.create('lead-1', 'old-team', ['agent-1'], undefined, ['developer']);
      registry.archiveGroup('old-team', 'lead-1');
      const groups = registry.getGroupsWithRoles('lead-1');
      expect(groups).toHaveLength(0);
    });

    it('getGroupsWithRoles scopes to lead', () => {
      registry.create('lead-1', 'team-a', ['agent-1'], undefined, ['developer']);
      registry.create('lead-2', 'team-b', ['agent-2'], undefined, ['developer']);
      const groups = registry.getGroupsWithRoles('lead-1');
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('team-a');
    });
  });
});

describe('AgentManager group command regexes', () => {
  // Regex patterns copied from AgentManager.ts (module-level constants, not exported)
  const CREATE_GROUP_REGEX = /⟦⟦\s*CREATE_GROUP\s*(\{.*?\})\s*⟧⟧/s;
  const ADD_TO_GROUP_REGEX = /⟦⟦\s*ADD_TO_GROUP\s*(\{.*?\})\s*⟧⟧/s;
  const REMOVE_FROM_GROUP_REGEX = /⟦⟦\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*⟧⟧/s;
  const GROUP_MESSAGE_REGEX = /⟦⟦\s*GROUP_MESSAGE\s*(\{.*?\})\s*⟧⟧/s;
  const LIST_GROUPS_REGEX = /⟦⟦\s*LIST_GROUPS\s*⟧⟧/s;

  describe('CREATE_GROUP_REGEX', () => {
    it('matches and extracts JSON payload', () => {
      const input = '⟦⟦ CREATE_GROUP {"name": "config-team", "members": ["abc12345", "def67890"]} ⟧⟧';
      const match = input.match(CREATE_GROUP_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.name).toBe('config-team');
      expect(parsed.members).toEqual(['abc12345', 'def67890']);
    });

    it('matches with extra whitespace', () => {
      const input = '⟦⟦   CREATE_GROUP   {"name": "team", "members": []}   ⟧⟧';
      expect(input.match(CREATE_GROUP_REGEX)).not.toBeNull();
    });

    it('does NOT match plain text', () => {
      expect('CREATE_GROUP {"name": "team"}'.match(CREATE_GROUP_REGEX)).toBeNull();
    });
  });

  describe('ADD_TO_GROUP_REGEX', () => {
    it('matches and extracts JSON payload', () => {
      const input = '⟦⟦ ADD_TO_GROUP {"group": "config-team", "members": ["agent-id-3"]} ⟧⟧';
      const match = input.match(ADD_TO_GROUP_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.group).toBe('config-team');
      expect(parsed.members).toEqual(['agent-id-3']);
    });
  });

  describe('REMOVE_FROM_GROUP_REGEX', () => {
    it('matches and extracts JSON payload', () => {
      const input = '⟦⟦ REMOVE_FROM_GROUP {"group": "config-team", "members": ["agent-id-2"]} ⟧⟧';
      const match = input.match(REMOVE_FROM_GROUP_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.group).toBe('config-team');
      expect(parsed.members).toEqual(['agent-id-2']);
    });
  });

  describe('GROUP_MESSAGE_REGEX', () => {
    it('matches and extracts JSON payload', () => {
      const input = '⟦⟦ GROUP_MESSAGE {"group": "config-team", "content": "coordinate before editing"} ⟧⟧';
      const match = input.match(GROUP_MESSAGE_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.group).toBe('config-team');
      expect(parsed.content).toBe('coordinate before editing');
    });
  });

  describe('LIST_GROUPS_REGEX', () => {
    it('matches the LIST_GROUPS command', () => {
      expect('⟦⟦ LIST_GROUPS ⟧⟧'.match(LIST_GROUPS_REGEX)).not.toBeNull();
    });

    it('matches with extra whitespace', () => {
      expect('⟦⟦   LIST_GROUPS   ⟧⟧'.match(LIST_GROUPS_REGEX)).not.toBeNull();
    });

    it('does NOT match plain text', () => {
      expect('LIST_GROUPS'.match(LIST_GROUPS_REGEX)).toBeNull();
    });
  });

  describe('cross-matching', () => {
    it('each regex only matches its own command type', () => {
      const createGroup = '⟦⟦ CREATE_GROUP {"name": "t", "members": []} ⟧⟧';
      const addToGroup = '⟦⟦ ADD_TO_GROUP {"group": "t", "members": []} ⟧⟧';
      const removeFromGroup = '⟦⟦ REMOVE_FROM_GROUP {"group": "t", "members": []} ⟧⟧';
      const groupMsg = '⟦⟦ GROUP_MESSAGE {"group": "t", "content": "hi"} ⟧⟧';
      const listGroups = '⟦⟦ LIST_GROUPS ⟧⟧';

      expect(createGroup.match(CREATE_GROUP_REGEX)).not.toBeNull();
      expect(createGroup.match(ADD_TO_GROUP_REGEX)).toBeNull();
      expect(createGroup.match(GROUP_MESSAGE_REGEX)).toBeNull();

      expect(addToGroup.match(ADD_TO_GROUP_REGEX)).not.toBeNull();
      expect(addToGroup.match(CREATE_GROUP_REGEX)).toBeNull();

      expect(removeFromGroup.match(REMOVE_FROM_GROUP_REGEX)).not.toBeNull();
      expect(removeFromGroup.match(ADD_TO_GROUP_REGEX)).toBeNull();

      expect(groupMsg.match(GROUP_MESSAGE_REGEX)).not.toBeNull();
      expect(groupMsg.match(CREATE_GROUP_REGEX)).toBeNull();

      expect(listGroups.match(LIST_GROUPS_REGEX)).not.toBeNull();
      expect(listGroups.match(CREATE_GROUP_REGEX)).toBeNull();
    });
  });
});
