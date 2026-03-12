import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityInjector } from '../agents/capabilities/CapabilityInjector.js';
import type { Agent } from '../agents/Agent.js';
import type { ActivityLedger } from '../coordination/activity/ActivityLedger.js';

/** Minimal Agent stub for testing */
function makeAgent(id = 'agent-001', roleId = 'developer'): Agent {
  return {
    id,
    role: { id: roleId, name: roleId.charAt(0).toUpperCase() + roleId.slice(1) },
    sendMessage: vi.fn(),
  } as unknown as Agent;
}

/** Minimal ActivityLedger stub for testing */
function makeLedger(): ActivityLedger {
  return { log: vi.fn() } as unknown as ActivityLedger;
}

describe('CapabilityInjector', () => {
  let injector: CapabilityInjector;
  let agent: Agent;
  let ledger: ActivityLedger;

  beforeEach(() => {
    injector = new CapabilityInjector();
    agent = makeAgent();
    ledger = makeLedger();
  });

  describe('acquire', () => {
    it('returns ok and message for valid capability', () => {
      const result = injector.acquire(agent, 'code-review', 'found bug during dev', ledger);
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Code Review');
      expect(result.message).toContain('found bug during dev');
      expect(result.message).toContain('ADDITIONAL INSTRUCTIONS');
    });

    it('rejects unknown capability', () => {
      const result = injector.acquire(agent, 'flying', 'want to fly', ledger);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Unknown capability');
      expect(result.message).toContain('flying');
      expect(result.message).toContain('code-review');
    });

    it('prevents duplicate acquisition', () => {
      injector.acquire(agent, 'testing', 'first time', ledger);
      const result = injector.acquire(agent, 'testing', 'second time', ledger);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('already have');
      expect(result.message).toContain('Testing');
    });

    it('logs to the activity ledger on success', () => {
      injector.acquire(agent, 'architecture', 'need system design', ledger);
      expect(ledger.log).toHaveBeenCalledWith(
        agent.id,
        'developer',
        'status_change',
        expect.stringContaining('Architecture'),
        expect.objectContaining({ capability: 'architecture', reason: 'need system design' }),
        expect.any(String),
      );
    });

    it('does not log to ledger on failure', () => {
      injector.acquire(agent, 'nonexistent', 'reason', ledger);
      expect(ledger.log).not.toHaveBeenCalled();
    });
  });

  describe('hasCapability', () => {
    it('returns false before acquisition', () => {
      expect(injector.hasCapability('agent-001', 'code-review')).toBe(false);
    });

    it('returns true after acquisition', () => {
      injector.acquire(agent, 'code-review', 'reason', ledger);
      expect(injector.hasCapability('agent-001', 'code-review')).toBe(true);
    });

    it('returns false for a different agent', () => {
      injector.acquire(agent, 'code-review', 'reason', ledger);
      expect(injector.hasCapability('agent-002', 'code-review')).toBe(false);
    });
  });

  describe('hasCommand', () => {
    it('returns false when agent has no capabilities', () => {
      expect(injector.hasCommand('agent-001', 'DELEGATE')).toBe(false);
    });

    it('returns true when agent has capability with gated command', () => {
      injector.acquire(agent, 'delegation', 'need to delegate', ledger);
      expect(injector.hasCommand('agent-001', 'DELEGATE')).toBe(true);
      expect(injector.hasCommand('agent-001', 'CREATE_AGENT')).toBe(true);
    });

    it('returns false for command not in any acquired capability', () => {
      injector.acquire(agent, 'testing', 'need tests', ledger);
      expect(injector.hasCommand('agent-001', 'DELEGATE')).toBe(false);
    });

    it('checks across multiple acquired capabilities', () => {
      injector.acquire(agent, 'code-review', 'review stuff', ledger);
      injector.acquire(agent, 'devops', 'deploy stuff', ledger);
      expect(injector.hasCommand('agent-001', 'DEFER_ISSUE')).toBe(false);
      expect(injector.hasCommand('agent-001', 'COMMIT')).toBe(true);
    });
  });

  describe('getAgentCapabilities', () => {
    it('returns empty array for unknown agent', () => {
      expect(injector.getAgentCapabilities('unknown')).toEqual([]);
    });

    it('returns list of acquired capabilities', () => {
      injector.acquire(agent, 'code-review', 'r1', ledger);
      injector.acquire(agent, 'testing', 'r2', ledger);
      const caps = injector.getAgentCapabilities('agent-001');
      expect(caps).toContain('code-review');
      expect(caps).toContain('testing');
      expect(caps).toHaveLength(2);
    });
  });

  describe('getAllDefinitions', () => {
    it('returns all built-in capabilities', () => {
      const defs = injector.getAllDefinitions();
      expect(defs.length).toBeGreaterThanOrEqual(5);
      const ids = defs.map(d => d.id);
      expect(ids).toContain('code-review');
      expect(ids).toContain('architecture');
      expect(ids).toContain('delegation');
      expect(ids).toContain('testing');
      expect(ids).toContain('devops');
    });

    it('each definition has required fields', () => {
      for (const def of injector.getAllDefinitions()) {
        expect(def.id).toBeTruthy();
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.instructions).toBeTruthy();
      }
    });
  });

  describe('getCapabilityDef', () => {
    it('returns definition for known id', () => {
      const def = injector.getCapabilityDef('devops');
      expect(def).toBeDefined();
      expect(def!.name).toBe('DevOps');
    });

    it('returns undefined for unknown id', () => {
      expect(injector.getCapabilityDef('nonexistent')).toBeUndefined();
    });
  });

  describe('clearAgent', () => {
    it('removes all capabilities for an agent', () => {
      injector.acquire(agent, 'code-review', 'r1', ledger);
      injector.acquire(agent, 'testing', 'r2', ledger);
      expect(injector.getAgentCapabilities('agent-001')).toHaveLength(2);

      injector.clearAgent('agent-001');

      expect(injector.getAgentCapabilities('agent-001')).toEqual([]);
      expect(injector.hasCapability('agent-001', 'code-review')).toBe(false);
      expect(injector.hasCommand('agent-001', 'DEFER_ISSUE')).toBe(false);
    });

    it('is a no-op for unknown agent', () => {
      // Should not throw
      injector.clearAgent('nonexistent');
    });

    it('allows re-acquisition after clear', () => {
      injector.acquire(agent, 'testing', 'first', ledger);
      injector.clearAgent('agent-001');
      const result = injector.acquire(agent, 'testing', 'second', ledger);
      expect(result.ok).toBe(true);
    });
  });
});
