import { describe, it, expect, beforeEach } from 'vitest';
import { Agent, type AgentContextInfo } from '../agents/Agent.js';
import { asAgentId } from '../types/brandedIds.js';

function makeRole(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'developer',
    name: overrides.name ?? 'Developer',
    description: 'Writes code',
    systemPrompt: 'You are a developer.',
    color: '#3B82F6',
    icon: '💻',
    builtIn: true,
    model: 'test-model',
    receivesStatusUpdates: false,
    ...overrides,
  };
}

function makeConfig() {
  return {
    cliCommand: 'echo',
    cliArgs: [],
    port: 3000,
    maxConcurrent: 10,
  };
}

function makePeers(...overrides: Array<Partial<AgentContextInfo>>): AgentContextInfo[] {
  return overrides.map((o, i) => ({
    id: o.id ?? asAgentId(`peer-${i}`),
    role: o.role ?? 'developer',
    roleName: o.roleName ?? 'Developer',
    status: o.status ?? 'running',
    task: o.task,
    lockedFiles: o.lockedFiles ?? [],
    model: o.model,
    parentId: o.parentId,
  }));
}

describe('CREW_UPDATE content hashing', () => {
  let agent: Agent;

  beforeEach(() => {
    const role = makeRole();
    agent = new Agent(role, makeConfig() as any, 'test task', undefined, []);
    // Don't call start() — we test injectContextUpdate directly without ACP
  });

  it('returns true on first update (always sends)', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'some task' });
    const result = agent.injectContextUpdate(peers, ['activity line 1']);
    expect(result).toBe(true);
  });

  it('returns false when content is identical (skips duplicate)', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'some task' });
    const activity = ['activity line 1'];

    const first = agent.injectContextUpdate(peers, activity);
    const second = agent.injectContextUpdate(peers, activity);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('returns true when peer task changes', () => {
    const peers1 = makePeers({ id: asAgentId('p1'), task: 'original task' });
    const peers2 = makePeers({ id: asAgentId('p1'), task: 'updated task' });
    const activity = ['activity line 1'];

    const first = agent.injectContextUpdate(peers1, activity);
    const second = agent.injectContextUpdate(peers2, activity);

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it('returns true when peer status changes', () => {
    const peers1 = makePeers({ id: asAgentId('p1'), status: 'running', task: 'task' });
    const peers2 = makePeers({ id: asAgentId('p1'), status: 'idle', task: 'task' });

    agent.injectContextUpdate(peers1, []);
    const result = agent.injectContextUpdate(peers2, []);
    expect(result).toBe(true);
  });

  it('returns false when only activity changes (activity excluded from hash)', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'task' });

    agent.injectContextUpdate(peers, ['activity 1']);
    const result = agent.injectContextUpdate(peers, ['activity 1', 'activity 2']);
    expect(result).toBe(false);
  });

  it('returns true when a new peer is added', () => {
    const peers1 = makePeers({ id: asAgentId('p1'), task: 'task 1' });
    const peers2 = makePeers(
      { id: asAgentId('p1'), task: 'task 1' },
      { id: asAgentId('p2'), task: 'task 2' },
    );

    agent.injectContextUpdate(peers1, []);
    const result = agent.injectContextUpdate(peers2, []);
    expect(result).toBe(true);
  });

  it('returns true when health header changes', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'task' });
    const activity: string[] = [];

    agent.injectContextUpdate(peers, activity, 'Health: OK');
    const result = agent.injectContextUpdate(peers, activity, 'Health: WARNING');
    expect(result).toBe(true);
  });

  it('returns false when health header is identical', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'task' });
    const activity: string[] = [];

    agent.injectContextUpdate(peers, activity, 'Health: OK');
    const result = agent.injectContextUpdate(peers, activity, 'Health: OK');
    expect(result).toBe(false);
  });

  it('returns true when locked files change', () => {
    const peers1 = makePeers({ id: asAgentId('p1'), task: 'task', lockedFiles: [] });
    const peers2 = makePeers({ id: asAgentId('p1'), task: 'task', lockedFiles: ['src/index.ts'] });

    agent.injectContextUpdate(peers1, []);
    const result = agent.injectContextUpdate(peers2, []);
    expect(result).toBe(true);
  });

  it('resets hash after dispose, so next update is sent', () => {
    const peers = makePeers({ id: asAgentId('p1'), task: 'task' });

    agent.injectContextUpdate(peers, []);
    agent.dispose();
    const result = agent.injectContextUpdate(peers, []);
    expect(result).toBe(true);
  });

  it('handles lead agent with children correctly', () => {
    const leadRole = makeRole({ id: 'lead', name: 'Project Lead' });
    const lead = new Agent(leadRole, makeConfig() as any, 'coordinate', undefined, []);

    const peers = makePeers(
      { id: asAgentId('child-1'), task: 'task A', parentId: lead.id },
      { id: asAgentId('child-2'), task: 'task B', parentId: lead.id },
    );

    const first = lead.injectContextUpdate(peers, []);
    expect(first).toBe(true);

    // Same content → skip
    const second = lead.injectContextUpdate(peers, []);
    expect(second).toBe(false);

    // Child task changes → send
    peers[0]!.task = 'task A updated';
    const third = lead.injectContextUpdate(peers, []);
    expect(third).toBe(true);
  });

  it('handles budget changes for lead agents', () => {
    const leadRole = makeRole({ id: 'lead', name: 'Project Lead' });
    const lead = new Agent(leadRole, makeConfig() as any, 'coordinate', undefined, []);
    lead.budget = { maxConcurrent: 10, runningCount: 3 };

    const peers = makePeers({ id: asAgentId('child-1'), task: 'task', parentId: lead.id });

    lead.injectContextUpdate(peers, []);

    // Budget changes → new hash
    lead.budget = { maxConcurrent: 10, runningCount: 5 };
    const result = lead.injectContextUpdate(peers, []);
    expect(result).toBe(true);
  });
});
