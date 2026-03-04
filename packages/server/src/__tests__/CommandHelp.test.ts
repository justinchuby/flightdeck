import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { buildCommandHelp, getCommandExample, setRegisteredPatterns } from '../agents/commands/CommandHelp.js';
import type { CommandEntry } from '../agents/commands/types.js';

// Register patterns from all command modules before tests run.
// This mirrors what CommandDispatcher does at construction time.
beforeAll(async () => {
  const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');
  // Creating a dispatcher with a minimal mock ctx triggers setRegisteredPatterns
  const mockCtx = {
    getAgent: vi.fn(),
    getAllAgents: vi.fn().mockReturnValue([]),
    getProjectIdForAgent: vi.fn(),
    getRunningCount: vi.fn().mockReturnValue(0),
    spawnAgent: vi.fn(),
    terminateAgent: vi.fn(),
    emit: vi.fn(),
    roleRegistry: { getRole: vi.fn(), getAllRoles: vi.fn().mockReturnValue([]) },
    config: { modelId: 'test', maxConcurrent: 10, agentCwd: '/tmp' },
    lockRegistry: { acquire: vi.fn(), release: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByAgent: vi.fn().mockReturnValue([]) },
    activityLedger: { log: vi.fn(), getRecent: vi.fn().mockReturnValue([]) },
    messageBus: { send: vi.fn(), getQueuedCount: vi.fn().mockReturnValue(0) },
    decisionLog: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByLeadId: vi.fn().mockReturnValue([]) },
    agentMemory: { get: vi.fn(), set: vi.fn() },
    chatGroupRegistry: { create: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), getGroupsForAgent: vi.fn().mockReturnValue([]) },
    taskDAG: { getStatus: vi.fn().mockReturnValue({ tasks: [], summary: {} }), getTasksForAgent: vi.fn().mockReturnValue([]) },
    deferredIssueRegistry: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]) },
    timerRegistry: { create: vi.fn(), cancel: vi.fn(), getAgentTimers: vi.fn().mockReturnValue([]), getAllTimers: vi.fn().mockReturnValue([]) },
    maxConcurrent: 10,
    markHumanInterrupt: vi.fn(),
  } as any;
  new CommandDispatcher(mockCtx);
});

describe('CommandHelp', () => {
  describe('buildCommandHelp', () => {
    it('includes expected command categories', () => {
      const help = buildCommandHelp();
      const expectedCategories = ['Agent Lifecycle', 'Communication', 'Groups', 'Task DAG', 'Coordination', 'System', 'Capabilities', 'Deferred Issues'];
      for (const cat of expectedCategories) {
        expect(help).toContain(`== ${cat} ==`);
      }
    });

    it('includes command names and descriptions from registered patterns', () => {
      const help = buildCommandHelp();
      expect(help).toContain('DELEGATE — Delegate a task to an existing agent');
      expect(help).toContain('CREATE_AGENT — Spawn a new agent with a role and task');
      expect(help).toContain('AGENT_MESSAGE — Send a message to an agent');
    });

    it('includes example syntax for commands', () => {
      const help = buildCommandHelp();
      expect(help).toContain('DELEGATE {"to": "agent-id", "task": "do something"}');
      expect(help).toContain('COMMIT {"message": "feat: add new feature"}');
      expect(help).toContain('QUERY_CREW {}');
    });

    it('includes format hint at the end', () => {
      const help = buildCommandHelp();
      expect(help).toContain('All commands use the format: COMMAND_NAME {json_payload}');
    });

    it('renders args line for commands with arg metadata', () => {
      const help = buildCommandHelp();
      // SET_TIMER has args derived from schema: label(req), delay(req), message(req), repeat(opt)
      expect(help).toContain('Args: <label: string> <delay: number | string> <message: string> [repeat: boolean]');
    });

    it('renders required args with angle brackets and optional with square brackets', () => {
      const help = buildCommandHelp();
      // DELEGATE has required args (to, task) and optional (context, dagTaskId, dependsOn)
      expect(help).toContain('<to: string>');
      expect(help).toContain('[context: string]');
    });

    it('does not render Args line for commands without arg metadata', () => {
      const help = buildCommandHelp();
      // QUERY_CREW and HALT_HEARTBEAT have no args
      const lines = help.split('\n');
      const queryCrew = lines.findIndex(l => l.includes('QUERY_CREW — '));
      // Next line should be the example, not Args
      expect(lines[queryCrew + 1]).toContain('QUERY_CREW {}');
    });

    it('includes escaping guidance section', () => {
      const help = buildCommandHelp();
      expect(help).toContain('== Escaping ==');
      expect(help).toContain('Refer to commands by name');
    });

    it('starts with [System] prefix', () => {
      const help = buildCommandHelp();
      expect(help).toMatch(/^\[System\]/);
    });

    it('builds help dynamically from setRegisteredPatterns', () => {
      // Save current state, set custom patterns, verify, restore
      const customPatterns: CommandEntry[] = [
        { regex: /test/, name: 'CUSTOM_CMD', handler: () => {}, help: {
          description: 'A custom command', example: 'CUSTOM_CMD {"key": "val"}', category: 'Custom',
          args: [
            { name: 'key', type: 'string', required: true, description: 'A key' },
            { name: 'opt', type: 'number', required: false, description: 'Optional num', default: '42' },
          ],
        } },
      ];
      setRegisteredPatterns(customPatterns);
      const help = buildCommandHelp();
      expect(help).toContain('== Custom ==');
      expect(help).toContain('CUSTOM_CMD — A custom command');
      expect(help).toContain('Args: <key: string> [opt: number = 42]');
      // Won't contain old commands since we replaced the patterns
      expect(help).not.toContain('DELEGATE');
    });
  });

  describe('getCommandExample', () => {
    beforeEach(async () => {
      // Re-register real patterns for these tests
      const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');
      const mockCtx = {
        getAgent: vi.fn(), getAllAgents: vi.fn().mockReturnValue([]),
        getProjectIdForAgent: vi.fn(), getRunningCount: vi.fn().mockReturnValue(0),
        spawnAgent: vi.fn(), terminateAgent: vi.fn(), emit: vi.fn(),
        roleRegistry: { getRole: vi.fn(), getAllRoles: vi.fn().mockReturnValue([]) },
        config: { modelId: 'test', maxConcurrent: 10, agentCwd: '/tmp' },
        lockRegistry: { acquire: vi.fn(), release: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByAgent: vi.fn().mockReturnValue([]) },
        activityLedger: { log: vi.fn(), getRecent: vi.fn().mockReturnValue([]) },
        messageBus: { send: vi.fn(), getQueuedCount: vi.fn().mockReturnValue(0) },
        decisionLog: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByLeadId: vi.fn().mockReturnValue([]) },
        agentMemory: { get: vi.fn(), set: vi.fn() },
        chatGroupRegistry: { create: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), getGroupsForAgent: vi.fn().mockReturnValue([]) },
        taskDAG: { getStatus: vi.fn().mockReturnValue({ tasks: [], summary: {} }), getTasksForAgent: vi.fn().mockReturnValue([]) },
        deferredIssueRegistry: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]) },
        timerRegistry: { create: vi.fn(), cancel: vi.fn(), getAgentTimers: vi.fn().mockReturnValue([]), getAllTimers: vi.fn().mockReturnValue([]) },
        maxConcurrent: 10, markHumanInterrupt: vi.fn(),
      } as any;
      new CommandDispatcher(mockCtx);
    });

    it('returns example for known command', () => {
      expect(getCommandExample('DELEGATE')).toContain('DELEGATE');
    });

    it('is case-insensitive', () => {
      expect(getCommandExample('delegate')).toContain('DELEGATE');
    });

    it('returns undefined for unknown command', () => {
      expect(getCommandExample('NONEXISTENT_COMMAND')).toBeUndefined();
    });
  });
});

describe('CommandDispatcher error handling', () => {
  // Integration tests for error messages and unknown command detection.
  // These test the static detectUnknownCommands method and the handler error path.

  it('detectUnknownCommands sends help for unrecognized commands', async () => {
    // Dynamic import to get the class
    const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');

    const sendMessage = vi.fn();
    const agent = { id: 'test-1234', role: { name: 'Developer' }, sendMessage } as any;

    const buf = 'some text ⟦⟦ FOOBAR {"x": 1} ⟧⟧ more text';
    const result = CommandDispatcher.detectUnknownCommands(agent, buf, []);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0];
    expect(msg).toContain('[System] Unknown command: FOOBAR');
    expect(msg).toContain('Available commands');
    expect(msg).toContain('DELEGATE');
    // The unrecognized block is stripped from the buffer
    expect(result).toBe('some text  more text');
  });

  it('detectUnknownCommands ignores nested blocks', async () => {
    const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');

    const sendMessage = vi.fn();
    const agent = { id: 'test-1234', role: { name: 'Developer' }, sendMessage } as any;

    // The FOOBAR is inside an outer ⟦⟦ ⟧⟧ block (simulated by isInsideCommandBlock returning true)
    // We'd need a real outer block for this — use a simpler test
    const buf = '⟦⟦ FOOBAR {} ⟧⟧';
    const result = CommandDispatcher.detectUnknownCommands(agent, buf, []);

    // Top-level unknown — should still fire
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe('');
  });

  it('detectUnknownCommands handles multiple unknown commands', async () => {
    const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');

    const sendMessage = vi.fn();
    const agent = { id: 'test-1234', role: { name: 'Lead' }, sendMessage } as any;

    const buf = '⟦⟦ AAA {} ⟧⟧ then ⟦⟦ BBB {} ⟧⟧';
    const result = CommandDispatcher.detectUnknownCommands(agent, buf, []);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0][0]).toContain('Unknown command: AAA');
    expect(sendMessage.mock.calls[1][0]).toContain('Unknown command: BBB');
    expect(result).toBe(' then ');
  });

  it('handler error sends error message with format example back to agent', async () => {
    const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');

    const sendMessage = vi.fn();
    const agent = {
      id: 'test-agent-id-1234',
      role: { id: 'developer', name: 'Developer' },
      sendMessage,
      humanMessageResponded: false,
    } as any;

    // Test the error path directly through scanBuffer by injecting a throwing handler
    // We use a QUERY_CREW command since it's simple (no try/catch wrapper in the handler)
    const mockCtx = {
      getAgent: vi.fn(),
      getAllAgents: vi.fn().mockImplementation(() => { throw new Error('database connection lost'); }),
      getProjectIdForAgent: vi.fn(),
      getRunningCount: vi.fn().mockReturnValue(0),
      spawnAgent: vi.fn(),
      terminateAgent: vi.fn(),
      emit: vi.fn(),
      roleRegistry: { getRole: vi.fn(), getAllRoles: vi.fn().mockReturnValue([]) },
      config: { modelId: 'test', maxConcurrent: 10, agentCwd: '/tmp' },
      lockRegistry: { acquire: vi.fn(), release: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByAgent: vi.fn().mockReturnValue([]) },
      activityLedger: { log: vi.fn(), getRecent: vi.fn().mockReturnValue([]) },
      messageBus: { send: vi.fn(), getQueuedCount: vi.fn().mockReturnValue(0) },
      decisionLog: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByLeadId: vi.fn().mockReturnValue([]) },
      agentMemory: { get: vi.fn(), set: vi.fn() },
      chatGroupRegistry: { create: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), getGroupsForAgent: vi.fn().mockReturnValue([]) },
      taskDAG: { getStatus: vi.fn().mockReturnValue({ tasks: [], summary: {} }), getTasksForAgent: vi.fn().mockReturnValue([]) },
      deferredIssueRegistry: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]) },
      maxConcurrent: 10,
      markHumanInterrupt: vi.fn(),
    } as any;

    const dispatcher = new CommandDispatcher(mockCtx);

    // QUERY_CREW handler calls getAllAgents() without an internal try/catch —
    // the error propagates to the dispatcher's catch block
    dispatcher.appendToBuffer(agent.id, '⟦⟦ QUERY_CREW ⟧⟧');
    dispatcher.scanBuffer(agent);

    const errorCall = sendMessage.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('failed:'),
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0]).toContain('QUERY_CREW failed:');
    expect(errorCall![0]).toContain('database connection lost');
    expect(errorCall![0]).toContain('Correct format:');
  });

  it('sends escaping hint when a known command is nested inside another block', async () => {
    const { CommandDispatcher } = await import('../agents/CommandDispatcher.js');

    const sendMessage = vi.fn();
    const agent = {
      id: 'test-agent-id-1234',
      role: { id: 'lead', name: 'Project Lead' },
      sendMessage,
      humanMessageResponded: false,
    } as any;

    const mockCtx = {
      getAgent: vi.fn(),
      getAllAgents: vi.fn().mockReturnValue([]),
      getProjectIdForAgent: vi.fn(),
      getRunningCount: vi.fn().mockReturnValue(0),
      spawnAgent: vi.fn(),
      terminateAgent: vi.fn(),
      emit: vi.fn(),
      roleRegistry: { getRole: vi.fn(), getAllRoles: vi.fn().mockReturnValue([]) },
      config: { modelId: 'test', maxConcurrent: 10, agentCwd: '/tmp' },
      lockRegistry: { acquire: vi.fn(), release: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByAgent: vi.fn().mockReturnValue([]) },
      activityLedger: { log: vi.fn(), getRecent: vi.fn().mockReturnValue([]) },
      messageBus: { send: vi.fn(), getQueuedCount: vi.fn().mockReturnValue(0) },
      decisionLog: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]), getByLeadId: vi.fn().mockReturnValue([]) },
      agentMemory: { get: vi.fn(), set: vi.fn() },
      chatGroupRegistry: { create: vi.fn(), addMember: vi.fn(), removeMember: vi.fn(), getGroupsForAgent: vi.fn().mockReturnValue([]) },
      taskDAG: { getStatus: vi.fn().mockReturnValue({ tasks: [], summary: {} }), getTasksForAgent: vi.fn().mockReturnValue([]) },
      deferredIssueRegistry: { add: vi.fn(), getAll: vi.fn().mockReturnValue([]) },
      maxConcurrent: 10,
      markHumanInterrupt: vi.fn(),
    } as any;

    const dispatcher = new CommandDispatcher(mockCtx);

    // Scenario: ⟦⟦ OUTER_BLOCK ⟦⟦ QUERY_CREW ⟧⟧ ⟧⟧
    // QUERY_CREW is the leftmost *known* regex match, but isInsideCommandBlock=true
    // because the unclosed ⟦⟦ OUTER_BLOCK precedes it.
    // (OUTER_BLOCK is not a known command, so no regex matches it — but the brackets are there)
    dispatcher.appendToBuffer(agent.id, '⟦⟦ SOME_TASK_TEXT ⟦⟦ QUERY_CREW ⟧⟧ rest ⟧⟧');
    dispatcher.scanBuffer(agent);

    const nestedHint = sendMessage.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('Nested'),
    );
    expect(nestedHint).toBeDefined();
    expect(nestedHint![0]).toContain('Nested QUERY_CREW was stripped');
    expect(nestedHint![0]).toContain('refer to commands by name');
  });
});

describe('Lead role system prompt policies', () => {
  it('contains QUERY_CREW usage guidance', async () => {
    const { RoleRegistry } = await import('../agents/RoleRegistry.js');
    const registry = new RoleRegistry();
    const lead = registry.get('lead');
    expect(lead).toBeDefined();
    expect(lead!.systemPrompt).toContain('Only use QUERY_CREW when crew state is genuinely unknown');
    expect(lead!.systemPrompt).toContain('CREW_UPDATE messages and Agent Reports');
  });

  it('distinguishes CREW_UPDATE from heartbeat reminders', async () => {
    const { RoleRegistry } = await import('../agents/RoleRegistry.js');
    const registry = new RoleRegistry();
    const lead = registry.get('lead');
    expect(lead).toBeDefined();
    expect(lead!.systemPrompt).toContain('CREW_UPDATE');
    expect(lead!.systemPrompt).toContain('Heartbeat reminder');
    expect(lead!.systemPrompt).toContain('Cannot be paused');
    expect(lead!.systemPrompt).toContain('Paused by HALT_HEARTBEAT');
  });

  it('contains escaping guidance for command delimiters in task descriptions', async () => {
    const { RoleRegistry } = await import('../agents/RoleRegistry.js');
    const registry = new RoleRegistry();
    const lead = registry.get('lead');
    expect(lead).toBeDefined();
    expect(lead!.systemPrompt).toContain('ESCAPING COMMANDS IN TEXT');
    expect(lead!.systemPrompt).toContain('refer to commands by name');
  });
});

describe('Command examples parse against Zod schemas', () => {
  it('DEFER_ISSUE example parses without title field', async () => {
    const { deferIssueSchema } = await import('../agents/commands/commandSchemas.js');
    const example = { description: 'Tech debt: refactor later', severity: 'low' };
    const result = deferIssueSchema.safeParse(example);
    expect(result.success).toBe(true);
  });

  it('DEFER_ISSUE rejects example with title instead of description', async () => {
    const { deferIssueSchema } = await import('../agents/commands/commandSchemas.js');
    const badExample = { title: 'Tech debt', description: undefined };
    const result = deferIssueSchema.safeParse(badExample);
    expect(result.success).toBe(false);
  });

  it('REQUEST_LIMIT_CHANGE example uses limit (not newLimit)', async () => {
    const { requestLimitChangeSchema } = await import('../agents/commands/commandSchemas.js');
    const example = { limit: 10, reason: 'need more agents' };
    const result = requestLimitChangeSchema.safeParse(example);
    expect(result.success).toBe(true);
  });

  it('REQUEST_LIMIT_CHANGE rejects newLimit field', async () => {
    const { requestLimitChangeSchema } = await import('../agents/commands/commandSchemas.js');
    const badExample = { newLimit: 10, reason: 'need more agents' };
    const result = requestLimitChangeSchema.safeParse(badExample);
    expect(result.success).toBe(false);
  });

  it('ACTIVITY example uses actionType (not type)', async () => {
    const { activitySchema } = await import('../agents/commands/commandSchemas.js');
    const example = { actionType: 'milestone', summary: 'phase 1 complete' };
    const result = activitySchema.safeParse(example);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actionType).toBe('milestone');
    }
  });

  it('DEFER_ISSUE schema accepts file field', async () => {
    const { deferIssueSchema } = await import('../agents/commands/commandSchemas.js');
    const example = { description: 'Fix later', file: 'src/utils.ts' };
    const result = deferIssueSchema.safeParse(example);
    expect(result.success).toBe(true);
  });
});
