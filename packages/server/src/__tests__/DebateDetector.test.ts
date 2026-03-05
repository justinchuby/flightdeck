import { describe, it, expect, vi } from 'vitest';
import { DebateDetector, type Debate } from '../coordination/DebateDetector.js';
import type { GroupMessage, ChatGroup } from '../comms/ChatGroupRegistry.js';

function makeMsg(overrides: Partial<GroupMessage> & { content: string }): GroupMessage {
  return {
    id: `msg-${Math.floor(Math.random() * 100000)}`,
    groupName: 'test-group',
    leadId: 'lead-1',
    fromAgentId: 'agent-1',
    fromRole: 'Developer',
    reactions: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMockRegistry(messages: GroupMessage[], _groups?: ChatGroup[]) {
  return {
    getGroups: vi.fn(() => _groups ?? [{ name: 'test-group', leadId: 'lead-1', memberIds: [], createdAt: new Date().toISOString() }]),
    getMessages: vi.fn(() => messages),
    getMessagesByLead: vi.fn(() => messages),
  };
}

describe('DebateDetector', () => {
  it('detects no debates in empty group', () => {
    const detector = new DebateDetector(createMockRegistry([]) as any);
    expect(detector.detectDebates('lead-1')).toEqual([]);
  });

  it('detects no debates in non-disagreement messages', () => {
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'I finished the implementation' }),
      makeMsg({ fromAgentId: 'a2', content: 'Great work, looks good' }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    expect(detector.detectDebates('lead-1')).toEqual([]);
  });

  it('detects debate with strong disagreement patterns', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'I think we should use SQLite for storage', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'I disagree — PostgreSQL would be better for this use case', timestamp: new Date(now + 1000).toISOString() }),
      makeMsg({ fromAgentId: 'a1', content: 'But I think SQLite is simpler for our needs', timestamp: new Date(now + 2000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    const debates = detector.detectDebates('lead-1');
    expect(debates).toHaveLength(1);
    expect(debates[0].status).toBe('active');
    expect(debates[0].participants).toContain('a1');
    expect(debates[0].participants).toContain('a2');
    expect(debates[0].groupName).toBe('test-group');
    expect(debates[0].confidence).toBeGreaterThanOrEqual(30);
  });

  it('detects resolved debate', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'We should refactor the router', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'I disagree, the current design works fine', timestamp: new Date(now + 1000).toISOString() }),
      makeMsg({ fromAgentId: 'a1', content: 'I don\'t think that\'s right — the router is fragile', timestamp: new Date(now + 2000).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'Fair point, let\'s go with the refactor approach', timestamp: new Date(now + 3000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    const debates = detector.detectDebates('lead-1');
    expect(debates).toHaveLength(1);
    expect(debates[0].status).toBe('resolved');
    expect(debates[0].resolution).toBeDefined();
  });

  it('requires at least 2 participants', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'I disagree with this approach', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a1', content: 'I also push back on this design', timestamp: new Date(now + 1000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    expect(detector.detectDebates('lead-1')).toEqual([]);
  });

  it('detects debate with moderate patterns (needs multiple signals)', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'Let\'s use a monorepo structure', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'But I think separate repos would be cleaner', timestamp: new Date(now + 1000).toISOString() }),
      makeMsg({ fromAgentId: 'a1', content: 'Have you considered the deployment complexity?', timestamp: new Date(now + 2000).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'On the other hand, monorepo does simplify CI', timestamp: new Date(now + 3000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    const debates = detector.detectDebates('lead-1');
    expect(debates).toHaveLength(1);
    expect(debates[0].confidence).toBeGreaterThanOrEqual(40);
  });

  it('positions include agent details from GroupMessage', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', fromRole: 'Architect', content: 'We need microservices', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a2', fromRole: 'Developer', content: 'I disagree — monolith is simpler for this scale', timestamp: new Date(now + 1000).toISOString() }),
      makeMsg({ fromAgentId: 'a1', fromRole: 'Architect', content: 'But I think microservices give us better scaling', timestamp: new Date(now + 2000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    const debates = detector.detectDebates('lead-1');
    expect(debates).toHaveLength(1);
    expect(debates[0].positions.length).toBeGreaterThan(0);
    expect(debates[0].positions[0].agentRole).toBeDefined();
  });

  it('filters low-confidence debates', () => {
    const now = Date.now();
    const messages = [
      makeMsg({ fromAgentId: 'a1', content: 'Proposal A', timestamp: new Date(now).toISOString() }),
      makeMsg({ fromAgentId: 'a2', content: 'What if we tried something else?', timestamp: new Date(now + 1000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages) as any);
    const debates = detector.detectDebates('lead-1');
    for (const d of debates) {
      expect(d.confidence).toBeGreaterThanOrEqual(40);
    }
  });

  it('scans across multiple groups', () => {
    const now = Date.now();
    const groups: ChatGroup[] = [
      { name: 'group-1', leadId: 'lead-1', memberIds: ['a1', 'a2'], createdAt: new Date().toISOString() },
      { name: 'group-2', leadId: 'lead-1', memberIds: ['a3', 'a4'], createdAt: new Date().toISOString() },
    ];
    const messages = [
      makeMsg({ groupName: 'group-1', fromAgentId: 'a1', content: 'I think we should use TypeScript', timestamp: new Date(now).toISOString() }),
      makeMsg({ groupName: 'group-1', fromAgentId: 'a2', content: 'I disagree — plain JS is enough', timestamp: new Date(now + 1000).toISOString() }),
      makeMsg({ groupName: 'group-1', fromAgentId: 'a1', content: 'I don\'t think JS is sufficient for type safety', timestamp: new Date(now + 2000).toISOString() }),
    ];
    const detector = new DebateDetector(createMockRegistry(messages, groups) as any);
    const debates = detector.detectDebates('lead-1');
    // Should find debates (messages returned for each group call)
    expect(debates.length).toBeGreaterThanOrEqual(1);
  });
});
