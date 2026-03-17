import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '../agents/Agent.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';
import { getLifecycleCommands } from '../agents/commands/AgentLifecycle.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}): Agent {
  return {
    id: 'agent-lead-001',
    parentId: undefined,
    role: { id: 'lead', name: 'Project Lead' },
    status: 'running',
    cwd: '/fake/repo',
    projectId: 'proj-1',
    hierarchyLevel: 0,
    childIds: [],
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeChild(overrides: Record<string, any> = {}): Agent {
  return {
    id: 'agent-child-001',
    parentId: 'agent-lead-001',
    role: { id: 'developer', name: 'Developer' },
    status: 'idle',
    cwd: '/fake/repo',
    projectId: 'proj-1',
    sessionId: 'session-1',
    hierarchyLevel: 1,
    childIds: [],
    sendMessage: vi.fn(),
    dagTaskId: null,
    task: null,
    taskOutputStartIndex: 0,
    messages: [],
    ...overrides,
  } as any;
}

function makeCtx(agents: Agent[] = [], overrides: Record<string, any> = {}): CommandHandlerContext {
  const spawnedChild = makeChild();
  return {
    getAgent: vi.fn().mockImplementation((id: string) => agents.find(a => a.id === id)),
    getAllAgents: vi.fn().mockReturnValue(agents),
    emit: vi.fn(),
    lockRegistry: { getByAgent: vi.fn().mockReturnValue([]) },
    activityLedger: { log: vi.fn() },
    getProjectIdForAgent: vi.fn().mockReturnValue('proj-1'),
    delegations: new Map(),
    reportedCompletions: new Set(),
    taskDAG: {
      getTaskByAgent: vi.fn().mockReturnValue(null),
      getStatus: vi.fn().mockReturnValue({ summary: { pending: 0, ready: 0, running: 0 } }),
      completeTask: vi.fn().mockReturnValue([]),
    },
    roleRegistry: {
      get: vi.fn().mockImplementation((id: string) => {
        if (id === 'developer') return { id: 'developer', name: 'Developer' };
        if (id === 'architect') return { id: 'architect', name: 'Architect' };
        return undefined;
      }),
      getAll: vi.fn().mockReturnValue([
        { id: 'lead', name: 'Project Lead' },
        { id: 'developer', name: 'Developer' },
        { id: 'architect', name: 'Architect' },
      ]),
    },
    spawnAgent: vi.fn().mockReturnValue(spawnedChild),
    capabilityInjector: { hasCommand: vi.fn().mockReturnValue(false) },
    agentMemory: { store: vi.fn(), retrieve: vi.fn() },
    activeDelegationRepository: { create: vi.fn() },
    _spawnedChild: spawnedChild, // for test access
    ...overrides,
  } as any;
}

function getCreateAgentHandler(ctx: CommandHandlerContext) {
  const commands = getLifecycleCommands(ctx);
  return commands.find(c => c.name === 'CREATE_AGENT')!.handler;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentLifecycle idle-role reminder', () => {
  let lead: Agent;
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    lead = makeAgent();
  });

  it('sends system message when idle same-role agent exists in roster', () => {
    const idleDev = makeChild({ id: 'agent-idle-dev', role: { id: 'developer', name: 'Developer' }, status: 'idle', parentId: lead.id });
    ctx = makeCtx([lead, idleDev]);

    const handler = getCreateAgentHandler(ctx);
    const command = '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature"} ⟧⟧';
    handler(lead, command);

    // Lead should receive the idle reminder
    const calls = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const reminderCall = calls.find((c: any[]) => c[0].includes('idle Developer agent'));
    expect(reminderCall).toBeDefined();
    expect(reminderCall![0]).toContain('agent-id');
    expect(reminderCall![0]).toContain('DELEGATE');

    // Agent should still be spawned (not blocked)
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('does NOT send reminder when no idle same-role agents exist', () => {
    ctx = makeCtx([lead]);

    const handler = getCreateAgentHandler(ctx);
    const command = '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature"} ⟧⟧';
    handler(lead, command);

    const calls = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const reminderCall = calls.find((c: any[]) => c[0].includes('idle'));
    // The only sendMessage should be the creation ack, not an idle reminder
    expect(reminderCall).toBeUndefined();
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('does NOT include idle agents from other leads in reminder', () => {
    const otherLeadChild = makeChild({
      id: 'agent-other-dev',
      role: { id: 'developer', name: 'Developer' },
      status: 'idle',
      parentId: 'other-lead-999', // different parent
    });
    ctx = makeCtx([lead, otherLeadChild]);

    const handler = getCreateAgentHandler(ctx);
    const command = '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature"} ⟧⟧';
    handler(lead, command);

    const calls = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const reminderCall = calls.find((c: any[]) => c[0].includes('idle'));
    expect(reminderCall).toBeUndefined();
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });

  it('does NOT include running agents of same role in reminder', () => {
    const runningDev = makeChild({
      id: 'agent-running-dev',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      parentId: lead.id,
    });
    ctx = makeCtx([lead, runningDev]);

    const handler = getCreateAgentHandler(ctx);
    const command = '⟦⟦ CREATE_AGENT {"role": "developer", "task": "implement feature"} ⟧⟧';
    handler(lead, command);

    const calls = (lead.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    const reminderCall = calls.find((c: any[]) => c[0].includes('idle'));
    expect(reminderCall).toBeUndefined();
    expect(ctx.spawnAgent).toHaveBeenCalled();
  });
});
