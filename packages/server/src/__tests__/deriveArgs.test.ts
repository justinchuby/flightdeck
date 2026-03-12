import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { deriveArgs, deriveHelp } from '../agents/commands/CommandHelp.js';
import {
  agentMessageSchema,
  interruptSchema,
  broadcastSchema,
  createGroupSchema,
  addToGroupSchema,
  removeFromGroupSchema,
  groupMessageSchema,
  createAgentSchema,
  delegateSchema,
  terminateAgentSchema,
  cancelDelegationSchema,
  lockFileSchema,
  unlockFileSchema,
  activitySchema,
  decisionSchema,
  commitSchema,
  progressSchema,
  requestLimitChangeSchema,
  setTimerSchema,
  cancelTimerSchema,
  acquireCapabilitySchema,
  releaseCapabilitySchema,
  directMessageSchema,
  reactSchema,
  applyTemplateSchema,
  decomposeTaskSchema,
  declareTasksSchema,
  addTaskSchema,
  taskIdSchema,
  completeTaskSchema,
  addDependencySchema,
  assignTaskSchema,
} from '../agents/commands/commandSchemas.js';

// ── deriveArgs unit tests ────────────────────────────────────────────

describe('deriveArgs', () => {
  it('extracts required string fields', () => {
    const args = deriveArgs(agentMessageSchema);
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual({ name: 'to', type: 'string', required: true, description: 'Target agent ID or role name' });
    expect(args[1]).toEqual({ name: 'content', type: 'string', required: true, description: 'Message content' });
  });

  it('extracts optional fields', () => {
    const args = deriveArgs(activitySchema);
    expect(args.every(a => !a.required)).toBe(true);
    expect(args.map(a => a.name)).toEqual(['actionType', 'summary', 'details']);
  });

  it('handles pipe/transform fields (number | string input)', () => {
    const args = deriveArgs(setTimerSchema);
    const delay = args.find(a => a.name === 'delay')!;
    expect(delay.required).toBe(true);
    expect(delay.type).toBe('number | string');
    expect(delay.description).toContain('Delay');
  });

  it('handles optional pipe/transform fields', () => {
    const args = deriveArgs(progressSchema);
    const percent = args.find(a => a.name === 'percent')!;
    expect(percent.required).toBe(false);
    expect(percent.type).toBe('number | string');
  });

  it('handles number fields', () => {
    const args = deriveArgs(assignTaskSchema);
    const taskId = args.find(a => a.name === 'taskId')!;
    expect(taskId).toBeDefined();
    expect(taskId.required).toBe(true);
  });

  it('handles boolean fields', () => {
    const args = deriveArgs(setTimerSchema);
    const repeat = args.find(a => a.name === 'repeat')!;
    expect(repeat.type).toBe('boolean');
    expect(repeat.required).toBe(false);
  });

  it('handles array fields', () => {
    const args = deriveArgs(addDependencySchema);
    const dependsOn = args.find(a => a.name === 'dependsOn')!;
    expect(dependsOn.type).toBe('array');
    expect(dependsOn.required).toBe(true);
  });

  it('handles optional string fields', () => {
    const args = deriveArgs(activitySchema);
    const actionType = args.find(a => a.name === 'actionType')!;
    expect(actionType.type).toBe('string');
    expect(actionType.required).toBe(false);
  });

  it('handles record fields as object', () => {
    const args = deriveArgs(activitySchema);
    const details = args.find(a => a.name === 'details')!;
    expect(details.type).toBe('object');
  });

  it('works with .refine() schemas (createGroupSchema)', () => {
    const args = deriveArgs(createGroupSchema);
    expect(args.map(a => a.name)).toEqual(['name', 'members', 'roles']);
    expect(args[0].required).toBe(true);
    expect(args[1].required).toBe(false);
  });

  it('handles schemas with many fields (createAgentSchema)', () => {
    const args = deriveArgs(createAgentSchema);
    expect(args.length).toBe(9);
    const role = args.find(a => a.name === 'role')!;
    expect(role.required).toBe(true);
    expect(role.description).toBe('Role ID to assign');
  });

  it('falls back to field name when no description', () => {
    const schema = z.object({
      foo: z.string(),
    });
    const args = deriveArgs(schema);
    expect(args[0].description).toBe('foo');
  });

  it('handles ZodDefault wrapper — extracts type and default value', () => {
    const schema = z.object({
      enabled: z.boolean().default(false).describe('Enable feature'),
    });
    const args = deriveArgs(schema);
    expect(args).toHaveLength(1);
    expect(args[0].name).toBe('enabled');
    expect(args[0].type).toBe('boolean');
    expect(args[0].required).toBe(false);
    expect(args[0].default).toBe('false');
    expect(args[0].description).toBe('Enable feature');
  });

  it('handles ZodDefault with string value', () => {
    const schema = z.object({
      mode: z.string().default('auto').describe('Processing mode'),
    });
    const args = deriveArgs(schema);
    expect(args[0].type).toBe('string');
    expect(args[0].default).toBe('auto');
    expect(args[0].required).toBe(false);
  });
});

// ── deriveHelp tests ─────────────────────────────────────────────────

describe('deriveHelp', () => {
  it('returns description, args, and category', () => {
    const help = deriveHelp(agentMessageSchema, 'Send a message', 'Communication');
    expect(help.description).toBe('Send a message');
    expect(help.category).toBe('Communication');
    expect(help.args).toHaveLength(2);
  });
});

// ── Drift detection: all described schemas produce args ──────────────

describe('schema-arg drift detection', () => {
  const schemas = {
    agentMessageSchema,
    interruptSchema,
    broadcastSchema,
    createGroupSchema,
    addToGroupSchema,
    removeFromGroupSchema,
    groupMessageSchema,
    createAgentSchema,
    delegateSchema,
    terminateAgentSchema,
    cancelDelegationSchema,
    lockFileSchema,
    unlockFileSchema,
    activitySchema,
    decisionSchema,
    commitSchema,
    progressSchema,
    requestLimitChangeSchema,
    setTimerSchema,
    cancelTimerSchema,
    acquireCapabilitySchema,
    releaseCapabilitySchema,
    directMessageSchema,
    reactSchema,
    applyTemplateSchema,
    decomposeTaskSchema,
    declareTasksSchema,
    addTaskSchema,
    taskIdSchema,
    completeTaskSchema,
    addDependencySchema,
    assignTaskSchema,
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} — all fields have descriptions from .describe()`, () => {
      const args = deriveArgs(schema);
      for (const arg of args) {
        // Every field should have a description from .describe(), not just the field name
        expect(arg.description).toBeTruthy();
        expect(arg.description).not.toBe('');
      }
    });
  }
});

// ── Pin test for Zod internal structure ──────────────────────────────

describe('Zod _def structure (pin test)', () => {
  it('string field has _def.type = "string"', () => {
    const field = z.string();
    expect((field._def as any).type).toBe('string');
  });

  it('optional wraps with _def.type = "optional" and _def.innerType', () => {
    const field = z.string().optional();
    const def = field._def as any;
    expect(def.type).toBe('optional');
    expect(def.innerType).toBeDefined();
  });

  it('pipe has _def.type = "pipe" with _def.in and _def.out', () => {
    const field = z.union([z.number(), z.string()]).transform(v => Number(v)).pipe(z.number());
    const def = field._def as any;
    expect(def.type).toBe('pipe');
    expect(def.in).toBeDefined();
    expect(def.out).toBeDefined();
  });

  it('.describe() sets .description on the field', () => {
    const field = z.string().describe('hello');
    expect(field.description).toBe('hello');
  });

  it('.isOptional() returns true for optional fields', () => {
    expect(z.string().isOptional()).toBe(false);
    expect(z.string().optional().isOptional()).toBe(true);
  });

  it('default has _def.type = "default" with _def.defaultValue and _def.innerType', () => {
    const field = z.boolean().default(false);
    const def = field._def as any;
    expect(def.type).toBe('default');
    expect(def.defaultValue).toBe(false);
    expect(def.innerType._def.type).toBe('boolean');
    expect(field.isOptional()).toBe(true);
  });
});
