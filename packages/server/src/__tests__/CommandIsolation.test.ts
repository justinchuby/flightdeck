/**
 * Tests for command-level project isolation (Issue #69 Step 2).
 *
 * Verifies that AGENT_MESSAGE, DIRECT_MESSAGE, and QUERY_CREW
 * respect project boundaries and prevent cross-project communication.
 */
import { describe, it, expect, vi } from 'vitest';
import { getDirectMessageCommands } from '../agents/commands/DirectMessageCommands.js';
import { getSystemCommands } from '../agents/commands/SystemCommands.js';
import { getCommCommands } from '../agents/commands/CommCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// ── Test helpers ──────────────────────────────────────────────────────

const PROJECT_A = 'project-aaaa-0000-0000-000000000000';
const PROJECT_B = 'project-bbbb-0000-0000-000000000000';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'aaaaaaaa-0000-0000-0000-000000000000',
    parentId: overrides.parentId ?? ('lead-aaaa-0000-0000-000000000000' as string | undefined),
    projectId: overrides.projectId as string | undefined,
    role: overrides.role ?? { id: 'developer', name: 'Developer' },
    status: overrides.status ?? 'running',
    task: overrides.task ?? 'Implement feature',
    childIds: overrides.childIds ?? [],
    model: overrides.model ?? 'test-model',
    sendMessage: vi.fn(),
    queueMessage: vi.fn(),
    humanMessageResponded: true,
    lastHumanMessageAt: null,
    lastHumanMessageText: null,
    ...overrides,
  } as any;
}

function makeCtx(
  agents: any[],
  projectMap?: Map<string, string>,
  overrides: Record<string, any> = {},
): CommandHandlerContext {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  return {
    getAgent: (id: string) => agentMap.get(id),
    getAllAgents: () => agents,
    getProjectIdForAgent: (agentId: string) => {
      if (projectMap) return projectMap.get(agentId);
      const agent = agentMap.get(agentId);
      if (agent?.projectId) return agent.projectId;
      if (agent?.parentId) {
        const parent = agentMap.get(agent.parentId);
        return parent?.projectId;
      }
      return undefined;
    },
    getRunningCount: () => agents.filter((a) => a.status === 'running').length,
    activityLedger: { log: vi.fn() },
    messageBus: { send: vi.fn() },
    emit: vi.fn(),
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    maxConcurrent: 10,
    agentMemory: { getByLead: vi.fn().mockReturnValue([]) },
    decisionLog: { add: vi.fn() },
    chatGroupRegistry: {
      create: vi.fn(),
      addMembers: vi.fn().mockReturnValue([]),
      sendMessage: vi.fn(),
      getGroupsForAgent: vi.fn().mockReturnValue([]),
      getGroupSummary: vi.fn().mockReturnValue({ messageCount: 0, lastMessage: null }),
    },
    ...overrides,
  } as any;
}

// ── AGENT_MESSAGE project isolation ───────────────────────────────────

describe('AGENT_MESSAGE project isolation', () => {
  it('allows messaging within the same project', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Project Lead' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    const target = makeAgent({
      id: 'aaaaaaaa-2222-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
      role: { id: 'code-reviewer', name: 'Code Reviewer' },
    });
    const ctx = makeCtx([leadA, sender, target]);
    const commands = getCommCommands(ctx);
    const agentMsgCmd = commands.find((c) => c.name === 'AGENT_MSG')!;

    agentMsgCmd.handler(sender, `⟦⟦ AGENT_MESSAGE {"to": "${target.id}", "content": "Hello!"} ⟧⟧`);

    expect(ctx.messageBus.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: sender.id, to: target.id }),
    );
  });

  it('blocks messaging to agent in a different project', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    const crossProjectTarget = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: leadB.id,
      projectId: PROJECT_B,
      role: { id: 'developer', name: 'Developer' },
    });

    const ctx = makeCtx([leadA, leadB, sender, crossProjectTarget]);
    const commands = getCommCommands(ctx);
    const agentMsgCmd = commands.find((c) => c.name === 'AGENT_MSG')!;

    agentMsgCmd.handler(sender, `⟦⟦ AGENT_MESSAGE {"to": "${crossProjectTarget.id}", "content": "Spy message"} ⟧⟧`);

    // Message should NOT be sent
    expect(ctx.messageBus.send).not.toHaveBeenCalled();
  });

  it('blocks cross-project messaging by role name resolution', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    // Unique role that only exists in project B
    const targetInB = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: leadB.id,
      projectId: PROJECT_B,
      role: { id: 'architect', name: 'Architect' },
    });

    const ctx = makeCtx([leadA, leadB, sender, targetInB]);
    const commands = getCommCommands(ctx);
    const agentMsgCmd = commands.find((c) => c.name === 'AGENT_MSG')!;

    agentMsgCmd.handler(sender, `⟦⟦ AGENT_MESSAGE {"to": "Architect", "content": "Cross-project attempt"} ⟧⟧`);

    expect(ctx.messageBus.send).not.toHaveBeenCalled();
  });

  it('backward compat: agents without projectId can still message freely', () => {
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: undefined,
      projectId: undefined,
    });
    const target = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: undefined,
      projectId: undefined,
      role: { id: 'code-reviewer', name: 'Code Reviewer' },
    });

    const ctx = makeCtx([sender, target]);
    const commands = getCommCommands(ctx);
    const agentMsgCmd = commands.find((c) => c.name === 'AGENT_MSG')!;

    agentMsgCmd.handler(sender, `⟦⟦ AGENT_MESSAGE {"to": "${target.id}", "content": "Hello"} ⟧⟧`);

    expect(ctx.messageBus.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: sender.id, to: target.id }),
    );
  });
});

// ── DIRECT_MESSAGE project isolation ──────────────────────────────────

describe('DIRECT_MESSAGE project isolation', () => {
  it('allows direct messaging within the same project', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    const target = makeAgent({
      id: 'aaaaaaaa-2222-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
      role: { id: 'code-reviewer', name: 'Code Reviewer' },
      status: 'idle',
    });

    const ctx = makeCtx([leadA, sender, target]);
    const [dmCmd] = getDirectMessageCommands(ctx);

    dmCmd.handler(sender, `⟦⟦ DIRECT_MESSAGE {"to": "${target.id}", "content": "Same project DM"} ⟧⟧`);

    expect(target.queueMessage).toHaveBeenCalledWith(expect.stringContaining('Same project DM'));
    expect(sender.sendMessage).toHaveBeenCalledWith(expect.stringContaining('✉️'));
  });

  it('blocks direct messaging to agent in different project (exact ID)', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    const crossTarget = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: leadB.id,
      projectId: PROJECT_B,
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
    });

    const ctx = makeCtx([leadA, leadB, sender, crossTarget]);
    const [dmCmd] = getDirectMessageCommands(ctx);

    dmCmd.handler(sender, `⟦⟦ DIRECT_MESSAGE {"to": "${crossTarget.id}", "content": "Cross-project DM"} ⟧⟧`);

    expect(crossTarget.queueMessage).not.toHaveBeenCalled();
    expect(sender.sendMessage).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('blocks direct messaging to agent in different project (prefix match)', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
    });
    const crossTarget = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: leadB.id,
      projectId: PROJECT_B,
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
    });

    const ctx = makeCtx([leadA, leadB, sender, crossTarget]);
    const [dmCmd] = getDirectMessageCommands(ctx);

    dmCmd.handler(sender, `⟦⟦ DIRECT_MESSAGE {"to": "bbbbbbbb", "content": "Cross-project prefix DM"} ⟧⟧`);

    expect(crossTarget.queueMessage).not.toHaveBeenCalled();
    expect(sender.sendMessage).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('backward compat: agents without projectId can DM freely', () => {
    const sender = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: undefined,
      projectId: undefined,
    });
    const target = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: undefined,
      projectId: undefined,
      role: { id: 'code-reviewer', name: 'Code Reviewer' },
      status: 'idle',
    });

    const ctx = makeCtx([sender, target]);
    const [dmCmd] = getDirectMessageCommands(ctx);

    dmCmd.handler(sender, `⟦⟦ DIRECT_MESSAGE {"to": "${target.id}", "content": "No project DM"} ⟧⟧`);

    expect(target.queueMessage).toHaveBeenCalledWith(expect.stringContaining('No project DM'));
  });
});

// ── QUERY_CREW project isolation ──────────────────────────────────────

describe('QUERY_CREW project isolation', () => {
  it('shows only agents from the same project', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const devA = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: leadA.id,
      projectId: PROJECT_A,
      role: { id: 'developer', name: 'Dev A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });
    const devB = makeAgent({
      id: 'bbbbbbbb-1111-0000-0000-000000000000',
      parentId: leadB.id,
      projectId: PROJECT_B,
      role: { id: 'developer', name: 'Dev B' },
    });

    const ctx = makeCtx([leadA, devA, leadB, devB]);
    const systemCmds = getSystemCommands(ctx);
    const queryCrew = systemCmds.find((c) => c.name === 'QUERY_CREW')!;

    queryCrew.handler(leadA, '⟦⟦ QUERY_CREW ⟧⟧');

    const response = (leadA.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(response).toContain('Dev A');
    expect(response).not.toContain('Lead B');
    expect(response).not.toContain('Dev B');
  });

  it('does not include OTHER PROJECTS section', () => {
    const leadA = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Lead A' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });

    const ctx = makeCtx([leadA, leadB]);
    const systemCmds = getSystemCommands(ctx);
    const queryCrew = systemCmds.find((c) => c.name === 'QUERY_CREW')!;

    queryCrew.handler(leadA, '⟦⟦ QUERY_CREW ⟧⟧');

    const response = (leadA.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(response).not.toContain('OTHER PROJECTS');
  });

  it('backward compat: agents without projectId see all agents', () => {
    const lead = makeAgent({
      id: 'lead-0000-0000-0000-000000000000',
      parentId: undefined,
      projectId: undefined,
      role: { id: 'lead', name: 'Lead' },
    });
    const dev = makeAgent({
      id: 'aaaaaaaa-1111-0000-0000-000000000000',
      parentId: lead.id,
      projectId: undefined,
    });

    const ctx = makeCtx([lead, dev]);
    const systemCmds = getSystemCommands(ctx);
    const queryCrew = systemCmds.find((c) => c.name === 'QUERY_CREW')!;

    queryCrew.handler(lead, '⟦⟦ QUERY_CREW ⟧⟧');

    const response = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(response).toContain('Developer');
  });

  it('sub-lead QUERY_CREW is scoped to project and own children', () => {
    const rootLead = makeAgent({
      id: 'lead-aaaa-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Root Lead' },
    });
    const subLead = makeAgent({
      id: 'sublead-aaaa-0000-0000-000000000000',
      parentId: rootLead.id,
      projectId: PROJECT_A,
      role: { id: 'lead', name: 'Sub Lead' },
    });
    const subDev = makeAgent({
      id: 'subdev-aaaa-0000-0000-000000000000',
      parentId: subLead.id,
      projectId: PROJECT_A,
      role: { id: 'developer', name: 'Sub Dev' },
    });
    const leadB = makeAgent({
      id: 'lead-bbbb-0000-0000-000000000000',
      parentId: undefined,
      projectId: PROJECT_B,
      role: { id: 'lead', name: 'Lead B' },
    });

    const ctx = makeCtx([rootLead, subLead, subDev, leadB]);
    const systemCmds = getSystemCommands(ctx);
    const queryCrew = systemCmds.find((c) => c.name === 'QUERY_CREW')!;

    queryCrew.handler(subLead, '⟦⟦ QUERY_CREW ⟧⟧');

    const response = (subLead.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(response).toContain('Sub Dev');
    expect(response).not.toContain('Lead B');
  });
});
