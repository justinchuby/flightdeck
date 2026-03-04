import { describe, it, expect } from 'vitest';
import {
  spawnAgentSchema,
  sendMessageSchema,
  leadMessageSchema,
  configPatchSchema,
  dagDeclareSchema,
  dagStartSchema,
  dagActionParamsSchema,
  registerRoleSchema,
  agentInputSchema,
  acquireLockSchema,
  decisionActionParamsSchema,
} from '../validation/schemas.js';

// ---------------------------------------------------------------------------
// spawnAgentSchema
// ---------------------------------------------------------------------------
describe('spawnAgentSchema', () => {
  it('accepts valid body', () => {
    const result = spawnAgentSchema.safeParse({ roleId: 'dev', task: 'write code' });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = spawnAgentSchema.safeParse({
      roleId: 'dev',
      task: 'write code',
      model: 'claude-sonnet-4-20250514',
      sessionId: 'abc-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing roleId', () => {
    const result = spawnAgentSchema.safeParse({ task: 'write code' });
    expect(result.success).toBe(false);
  });

  it('rejects missing task', () => {
    const result = spawnAgentSchema.safeParse({ roleId: 'dev' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string roleId', () => {
    const result = spawnAgentSchema.safeParse({ roleId: 123, task: 'x' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sendMessageSchema
// ---------------------------------------------------------------------------
describe('sendMessageSchema', () => {
  it('accepts valid body with text only', () => {
    const result = sendMessageSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts text + mode', () => {
    const result = sendMessageSchema.safeParse({ text: 'hello', mode: 'interrupt' });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = sendMessageSchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('accepts missing text (for interrupt-only)', () => {
    const result = sendMessageSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts mode interrupt without text', () => {
    const result = sendMessageSchema.safeParse({ mode: 'interrupt' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = sendMessageSchema.safeParse({ text: 'hi', mode: 'invalid' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// leadMessageSchema
// ---------------------------------------------------------------------------
describe('leadMessageSchema', () => {
  it('accepts valid body', () => {
    const result = leadMessageSchema.safeParse({ text: 'update me' });
    expect(result.success).toBe(true);
  });

  it('accepts queue mode', () => {
    const result = leadMessageSchema.safeParse({ text: 'update me', mode: 'queue' });
    expect(result.success).toBe(true);
  });

  it('accepts missing text (for interrupt-only)', () => {
    const result = leadMessageSchema.safeParse({ mode: 'queue' });
    expect(result.success).toBe(true);
  });

  it('accepts interrupt mode without text', () => {
    const result = leadMessageSchema.safeParse({ mode: 'interrupt' });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// configPatchSchema
// ---------------------------------------------------------------------------
describe('configPatchSchema', () => {
  it('accepts maxConcurrentAgents', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: 5 });
    expect(result.success).toBe(true);
  });

  it('accepts host', () => {
    const result = configPatchSchema.safeParse({ host: '0.0.0.0' });
    expect(result.success).toBe(true);
  });

  it('accepts both fields', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: 3, host: 'localhost' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (no valid fields)', () => {
    const result = configPatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-integer maxConcurrentAgents', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: 2.5 });
    expect(result.success).toBe(false);
  });

  it('rejects zero maxConcurrentAgents', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative maxConcurrentAgents', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects empty host string', () => {
    const result = configPatchSchema.safeParse({ host: '' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string host', () => {
    const result = configPatchSchema.safeParse({ host: 123 });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = configPatchSchema.safeParse({ maxConcurrentAgents: 5, port: 9999 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('port');
    }
  });
});

// ---------------------------------------------------------------------------
// dagDeclareSchema
// ---------------------------------------------------------------------------
describe('dagDeclareSchema', () => {
  it('accepts valid task list', () => {
    const result = dagDeclareSchema.safeParse({
      tasks: [
        { id: 'task-1', role: 'dev' },
        { id: 'task-2', role: 'tester', description: 'test it', dependsOn: ['task-1'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts task with all optional fields', () => {
    const result = dagDeclareSchema.safeParse({
      tasks: [{
        id: 'task-1',
        role: 'dev',
        description: 'do stuff',
        files: ['src/index.ts'],
        dependsOn: [],
        priority: 10,
        model: 'claude-sonnet-4-20250514',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing tasks array', () => {
    const result = dagDeclareSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects task without id', () => {
    const result = dagDeclareSchema.safeParse({ tasks: [{ role: 'dev' }] });
    expect(result.success).toBe(false);
  });

  it('rejects task without role', () => {
    const result = dagDeclareSchema.safeParse({ tasks: [{ id: 'x' }] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dagStartSchema
// ---------------------------------------------------------------------------
describe('dagStartSchema', () => {
  it('accepts valid agentId', () => {
    const result = dagStartSchema.safeParse({ agentId: 'agent-123' });
    expect(result.success).toBe(true);
  });

  it('rejects missing agentId', () => {
    const result = dagStartSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dagActionParamsSchema
// ---------------------------------------------------------------------------
describe('dagActionParamsSchema', () => {
  const validActions = ['start', 'complete', 'fail', 'pause', 'resume', 'retry', 'skip', 'cancel'] as const;

  for (const action of validActions) {
    it(`accepts action "${action}"`, () => {
      const result = dagActionParamsSchema.safeParse({ id: 'lead-1', taskId: 'task-1', action });
      expect(result.success).toBe(true);
    });
  }

  it('rejects invalid action', () => {
    const result = dagActionParamsSchema.safeParse({ id: 'lead-1', taskId: 'task-1', action: 'delete' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerRoleSchema
// ---------------------------------------------------------------------------
describe('registerRoleSchema', () => {
  it('accepts valid minimal role', () => {
    const result = registerRoleSchema.safeParse({ id: 'my-role', name: 'My Role' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe('');
      expect(result.data.systemPrompt).toBe('');
      expect(result.data.color).toBe('#888');
      expect(result.data.icon).toBe('🤖');
    }
  });

  it('accepts full role', () => {
    const result = registerRoleSchema.safeParse({
      id: 'my-role',
      name: 'My Role',
      description: 'Does things',
      systemPrompt: 'You are a helper',
      color: '#ff0000',
      icon: '🔧',
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-kebab-case id', () => {
    const result = registerRoleSchema.safeParse({ id: 'MyRole', name: 'My Role' });
    expect(result.success).toBe(false);
  });

  it('rejects id with underscores', () => {
    const result = registerRoleSchema.safeParse({ id: 'my_role', name: 'My Role' });
    expect(result.success).toBe(false);
  });

  it('accepts single-word kebab id', () => {
    const result = registerRoleSchema.safeParse({ id: 'dev', name: 'Developer' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = registerRoleSchema.safeParse({ id: 'dev', name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = registerRoleSchema.safeParse({ name: 'Dev' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agentInputSchema
// ---------------------------------------------------------------------------
describe('agentInputSchema', () => {
  it('accepts valid text', () => {
    const result = agentInputSchema.safeParse({ text: 'some input' });
    expect(result.success).toBe(true);
  });

  it('rejects missing text', () => {
    const result = agentInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string text', () => {
    const result = agentInputSchema.safeParse({ text: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// acquireLockSchema
// ---------------------------------------------------------------------------
describe('acquireLockSchema', () => {
  it('accepts valid lock request', () => {
    const result = acquireLockSchema.safeParse({ agentId: 'a1', filePath: 'src/index.ts' });
    expect(result.success).toBe(true);
  });

  it('accepts optional reason', () => {
    const result = acquireLockSchema.safeParse({ agentId: 'a1', filePath: 'src/index.ts', reason: 'editing' });
    expect(result.success).toBe(true);
  });

  it('rejects missing agentId', () => {
    const result = acquireLockSchema.safeParse({ filePath: 'src/index.ts' });
    expect(result.success).toBe(false);
  });

  it('rejects missing filePath', () => {
    const result = acquireLockSchema.safeParse({ agentId: 'a1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty agentId', () => {
    const result = acquireLockSchema.safeParse({ agentId: '', filePath: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects empty filePath', () => {
    const result = acquireLockSchema.safeParse({ agentId: 'a1', filePath: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decisionActionParamsSchema
// ---------------------------------------------------------------------------
describe('decisionActionParamsSchema', () => {
  it('accepts confirm', () => {
    const result = decisionActionParamsSchema.safeParse({ id: 'd1', action: 'confirm' });
    expect(result.success).toBe(true);
  });

  it('accepts reject', () => {
    const result = decisionActionParamsSchema.safeParse({ id: 'd1', action: 'reject' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = decisionActionParamsSchema.safeParse({ id: 'd1', action: 'approve' });
    expect(result.success).toBe(false);
  });
});
