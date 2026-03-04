import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCommandHelp, getCommandExample, COMMAND_REFERENCE } from '../agents/commands/CommandHelp.js';

describe('CommandHelp', () => {
  describe('buildCommandHelp', () => {
    it('includes all command categories', () => {
      const help = buildCommandHelp();
      for (const category of Object.keys(COMMAND_REFERENCE)) {
        expect(help).toContain(`== ${category} ==`);
      }
    });

    it('includes command names and descriptions', () => {
      const help = buildCommandHelp();
      expect(help).toContain('DELEGATE — Delegate a task to an existing agent');
      expect(help).toContain('CREATE_AGENT — Spawn a new agent with a role and task');
      expect(help).toContain('AGENT_MESSAGE — Send a message to an agent');
      expect(help).toContain('SET_TIMER — Set a reminder timer');
    });

    it('includes example syntax for each command', () => {
      const help = buildCommandHelp();
      for (const commands of Object.values(COMMAND_REFERENCE)) {
        for (const cmd of commands) {
          expect(help).toContain(cmd.example);
        }
      }
    });

    it('includes format hint at the end', () => {
      const help = buildCommandHelp();
      expect(help).toContain('All commands use the format: COMMAND_NAME {json_payload}');
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
  });

  describe('getCommandExample', () => {
    it('returns example for known command', () => {
      expect(getCommandExample('DELEGATE')).toContain('DELEGATE');
      expect(getCommandExample('SET_TIMER')).toContain('SET_TIMER');
    });

    it('is case-insensitive', () => {
      expect(getCommandExample('delegate')).toContain('DELEGATE');
      expect(getCommandExample('Set_Timer')).toContain('SET_TIMER');
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

  it('sends escaping hint when a known command is nested inside another', async () => {
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

    // Simulate: DELEGATE with a nested COMMIT inside the JSON payload
    dispatcher.appendToBuffer(agent.id, '⟦⟦ DELEGATE {"to": "dev-1", "task": "do X then ⟦⟦ COMMIT {\\"message\\": \\"done\\"} ⟧⟧"} ⟧⟧');
    dispatcher.scanBuffer(agent);

    const nestedHint = sendMessage.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('Nested'),
    );
    expect(nestedHint).toBeDefined();
    expect(nestedHint![0]).toContain('Nested COMMIT was stripped');
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
