import { describe, it, expect, vi } from 'vitest';
import { getCommCommands } from '../agents/commands/CommCommands.js';
import type { Agent } from '../agents/Agent.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{
  id: string;
  role: { id: string; name: string };
  status: string;
  parentId: string | undefined;
  projectId: string;
}> = {}): Agent & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? { id: 'lead', name: 'Project Lead' },
    status: overrides.status ?? 'running',
    parentId: overrides.parentId ?? undefined,
    projectId: overrides.projectId ?? 'proj-1',
    sendMessage: vi.fn(),
  } as unknown as Agent & { sendMessage: ReturnType<typeof vi.fn> };
}

function createMockContext(agents: Agent[]): CommandHandlerContext {
  return {
    getAllAgents: vi.fn(() => agents),
    getAgent: vi.fn((id: string) => agents.find(a => a.id === id)),
    messageBus: { send: vi.fn() },
    emit: vi.fn(),
    activityLedger: { log: vi.fn() },
    chatGroupRegistry: {
      create: vi.fn(),
      addMembers: vi.fn(() => []),
      getGroupsForAgent: vi.fn(() => []),
      sendMessage: vi.fn(),
      getMembers: vi.fn(() => []),
      getMessages: vi.fn(() => []),
      getGroupSummary: vi.fn(() => ({ messageCount: 0 })),
      findGroupForAgent: vi.fn(),
    },
  } as unknown as CommandHandlerContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Broadcast — empty audience warning', () => {
  it('sends warning when broadcast has 0 recipients', () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Project Lead' },
      status: 'running',
    });
    const ctx = createMockContext([lead]);
    const commands = getCommCommands(ctx);
    const broadcastCmd = commands.find(c => c.name === 'BROADCAST')!;

    const data = '⟦⟦ BROADCAST {"content": "Hello team!"} ⟧⟧';
    broadcastCmd.handler(lead as unknown as Agent, data);

    expect(lead.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Broadcast sent to 0 agents'),
    );
  });

  it('does not send warning when broadcast has recipients', () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Project Lead' },
      status: 'running',
    });
    const dev = makeAgent({
      id: 'dev-1',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      parentId: 'lead-1',
    });
    const ctx = createMockContext([lead, dev]);
    const commands = getCommCommands(ctx);
    const broadcastCmd = commands.find(c => c.name === 'BROADCAST')!;

    const data = '⟦⟦ BROADCAST {"content": "Hello team!"} ⟧⟧';
    broadcastCmd.handler(lead as unknown as Agent, data);

    // The lead should NOT have received a warning
    const warningCalls = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('Warning: Broadcast sent to 0 agents'),
    );
    expect(warningCalls.length).toBe(0);

    // The dev should have received the broadcast
    expect(dev.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Broadcast from'),
    );
  });

  it('excludes the lead from broadcast recipients (lead sees via WebSocket)', () => {
    const lead = makeAgent({
      id: 'lead-1',
      role: { id: 'lead', name: 'Project Lead' },
      status: 'running',
    });
    const dev1 = makeAgent({
      id: 'dev-1',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      parentId: 'lead-1',
    });
    const dev2 = makeAgent({
      id: 'dev-2',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      parentId: 'lead-1',
    });
    const ctx = createMockContext([lead, dev1, dev2]);
    const commands = getCommCommands(ctx);
    const broadcastCmd = commands.find(c => c.name === 'BROADCAST')!;

    const data = '\u27E6\u27E6 BROADCAST {"content": "Hello team!"} \u27E7\u27E7';
    broadcastCmd.handler(dev1 as unknown as Agent, data);

    // dev2 should receive the broadcast
    expect(dev2.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Broadcast from'),
    );

    // Lead should NOT receive via ACP prompt injection
    expect(lead.sendMessage).not.toHaveBeenCalled();
  });
});
