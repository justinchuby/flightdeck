import { describe, it, expect } from 'vitest';
import { Agent, type AgentContextInfo } from '../agents/Agent.js';

function makeRole(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'lead',
    name: overrides.name ?? 'Project Lead',
    description: 'Leads the project',
    systemPrompt: 'You are a lead.',
    color: '#3B82F6',
    icon: '👑',
    builtIn: true,
    model: 'test-model',
    receivesStatusUpdates: true,
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

function makePeer(overrides: Partial<AgentContextInfo> = {}): AgentContextInfo {
  return {
    id: overrides.id ?? 'peer-0',
    role: overrides.role ?? 'developer',
    roleName: overrides.roleName ?? 'Developer',
    status: overrides.status ?? 'running',
    task: overrides.task,
    lockedFiles: overrides.lockedFiles ?? [],
    model: overrides.model,
    parentId: overrides.parentId,
    isSystemAgent: overrides.isSystemAgent,
  };
}

describe('Agent.buildContextManifest', () => {
  const LEAD_ID = 'lead-1111-2222-3333';

  function makeLeadAgent(overrides: Record<string, any> = {}) {
    const role = makeRole(overrides);
    const agent = new Agent(role, makeConfig() as any, 'manage the team', undefined, []);
    // Override the auto-generated ID so we can assert on parent filtering
    (agent as any).id = LEAD_ID;
    return agent;
  }

  it('shows children under YOUR AGENTS', () => {
    const lead = makeLeadAgent();
    const child = makePeer({ id: 'child-aaa', parentId: LEAD_ID, task: 'write code' });
    const result = lead.buildContextManifest([child]);
    expect(result).toContain('== YOUR AGENTS ==');
    expect(result).toContain('child-aa');
    expect(result).toContain('write code');
  });

  it('shows sibling leads under OTHER TEAM MEMBERS', () => {
    const lead = makeLeadAgent();
    const child = makePeer({ id: 'child-aaa', parentId: LEAD_ID, task: 'write code' });
    const sibling = makePeer({
      id: 'sibling-bbb',
      role: 'lead',
      roleName: 'Project Lead',
      parentId: 'some-other-parent',
      task: 'handle testing',
    });
    const result = lead.buildContextManifest([child, sibling]);
    expect(result).toContain('== YOUR AGENTS ==');
    expect(result).toContain('== OTHER TEAM MEMBERS ==');
    expect(result).toContain('sibling-');
    expect(result).toContain('handle testing');
  });

  it('does NOT show OTHER TEAM MEMBERS when there are no siblings', () => {
    const lead = makeLeadAgent();
    const child = makePeer({ id: 'child-aaa', parentId: LEAD_ID, task: 'write code' });
    const result = lead.buildContextManifest([child]);
    expect(result).not.toContain('OTHER TEAM MEMBERS');
  });

  it('excludes self from sibling list', () => {
    const lead = makeLeadAgent();
    // Self shows up in the peers list (ContextRefresher filters self later, but
    // buildContextManifest should handle it too)
    const self = makePeer({ id: LEAD_ID, role: 'lead', roleName: 'Project Lead', task: 'manage' });
    const sibling = makePeer({
      id: 'sibling-ccc',
      role: 'lead',
      roleName: 'Project Lead',
      task: 'testing domain',
    });
    const result = lead.buildContextManifest([self, sibling]);
    // Should show sibling but not self in OTHER TEAM MEMBERS
    expect(result).toContain('sibling-');
    expect(result).toContain('== OTHER TEAM MEMBERS ==');
    // Self's task should NOT appear in the sibling section
    const otherSection = result.split('OTHER TEAM MEMBERS')[1]?.split('==')[0] ?? '';
    expect(otherSection).not.toContain(LEAD_ID.slice(0, 8));
  });

  it('non-leads see all peers under ACTIVE CREW MEMBERS (no sibling section)', () => {
    const devRole = makeRole({ id: 'developer', name: 'Developer' });
    const dev = new Agent(devRole, makeConfig() as any, 'code task', undefined, []);
    const peer1 = makePeer({ id: 'peer-aaa', task: 'task A' });
    const peer2 = makePeer({ id: 'peer-bbb', task: 'task B' });
    const result = dev.buildContextManifest([peer1, peer2]);
    expect(result).toContain('== ACTIVE CREW MEMBERS ==');
    expect(result).not.toContain('OTHER TEAM MEMBERS');
    expect(result).not.toContain('YOUR AGENTS');
    expect(result).toContain('peer-aaa');
    expect(result).toContain('peer-bbb');
  });

  it('sibling section shows truncated task (80 chars)', () => {
    const lead = makeLeadAgent();
    const longTask = 'A'.repeat(120);
    const sibling = makePeer({
      id: 'sibling-ddd',
      role: 'developer',
      roleName: 'Developer',
      parentId: 'other-parent',
      task: longTask,
    });
    const result = lead.buildContextManifest([sibling]);
    expect(result).toContain('OTHER TEAM MEMBERS');
    // Task should be truncated to 80 chars
    expect(result).toContain('A'.repeat(80));
    expect(result).not.toContain('A'.repeat(81));
  });

  it('sibling with no task shows idle', () => {
    const lead = makeLeadAgent();
    const sibling = makePeer({
      id: 'sibling-eee',
      role: 'developer',
      roleName: 'Developer',
      parentId: 'other-parent',
    });
    const result = lead.buildContextManifest([sibling]);
    expect(result).toContain('OTHER TEAM MEMBERS');
    expect(result).toContain('idle');
  });
});
