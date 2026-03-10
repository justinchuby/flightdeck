import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernancePipeline } from '../GovernancePipeline.js';
import type { GovernanceAction, HookContext, PreActionHook, PostActionHook } from '../types.js';

// ── Test helpers ──

function makeAction(overrides: Partial<GovernanceAction> = {}): GovernanceAction {
  return {
    commandName: 'CREATE_AGENT',
    rawText: '⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧',
    payload: { role: 'developer' },
    agent: { id: 'agent-1', roleId: 'lead', roleName: 'Project Lead', status: 'running' },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    getAgent: () => undefined,
    getAllAgents: () => [],
    getRunningCount: () => 1,
    maxConcurrent: 10,
    lockRegistry: { getLocksForAgent: () => [], isLocked: () => false } as any,
    taskDAG: { getTasks: () => [] } as any,
    ...overrides,
  };
}

function makePreHook(overrides: Partial<PreActionHook> & { name: string; priority: number }): PreActionHook {
  return {
    match: () => true,
    evaluate: () => ({ decision: 'allow' }),
    ...overrides,
  };
}

function makePostHook(overrides: Partial<PostActionHook> & { name: string; priority: number }): PostActionHook {
  return {
    match: () => true,
    afterExecute: () => {},
    ...overrides,
  };
}

// ── Tests ──

describe('GovernancePipeline', () => {
  let pipeline: GovernancePipeline;

  beforeEach(() => {
    pipeline = new GovernancePipeline();
  });

  describe('evaluatePre', () => {
    it('returns allow when no hooks registered', () => {
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('allow');
    });

    it('returns allow when no hooks match', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'never-matches',
        priority: 100,
        match: () => false,
        evaluate: () => ({ decision: 'block', reason: 'should not run' }),
      }));
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('allow');
    });

    it('returns block when a hook blocks', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'blocker',
        priority: 100,
        evaluate: () => ({ decision: 'block', reason: 'nope' }),
      }));
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('nope');
    });

    it('short-circuits on first block (skips remaining hooks)', () => {
      const secondHook = vi.fn(() => ({ decision: 'allow' as const }));
      pipeline.registerPreHook(makePreHook({
        name: 'blocker',
        priority: 100,
        evaluate: () => ({ decision: 'block', reason: 'blocked' }),
      }));
      pipeline.registerPreHook(makePreHook({
        name: 'never-reached',
        priority: 200,
        evaluate: secondHook,
      }));
      pipeline.evaluatePre(makeAction(), makeContext());
      expect(secondHook).not.toHaveBeenCalled();
    });

    it('runs hooks in priority order (lower first)', () => {
      const order: string[] = [];
      pipeline.registerPreHook(makePreHook({
        name: 'high-priority',
        priority: 300,
        evaluate: () => { order.push('300'); return { decision: 'allow' }; },
      }));
      pipeline.registerPreHook(makePreHook({
        name: 'low-priority',
        priority: 100,
        evaluate: () => { order.push('100'); return { decision: 'allow' }; },
      }));
      pipeline.registerPreHook(makePreHook({
        name: 'mid-priority',
        priority: 200,
        evaluate: () => { order.push('200'); return { decision: 'allow' }; },
      }));
      pipeline.evaluatePre(makeAction(), makeContext());
      expect(order).toEqual(['100', '200', '300']);
    });

    it('returns modify result with modified text', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'modifier',
        priority: 100,
        evaluate: () => ({
          decision: 'modify',
          modifiedText: 'modified-text',
          modifiedPayload: { modified: true },
        }),
      }));
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('modify');
      expect(result.modifiedText).toBe('modified-text');
    });

    it('returns allow when pipeline is disabled', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'blocker',
        priority: 100,
        evaluate: () => ({ decision: 'block', reason: 'should not fire' }),
      }));
      pipeline.setEnabled(false);
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('allow');
    });

    it('preserves the hook reason in the block result', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'my-custom-hook',
        priority: 100,
        evaluate: () => ({ decision: 'block', reason: 'bad action' }),
      }));
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('bad action');
    });

    it('continues on hook error (fail-open)', () => {
      pipeline.registerPreHook(makePreHook({
        name: 'broken',
        priority: 100,
        evaluate: () => { throw new Error('hook crashed'); },
      }));
      pipeline.registerPreHook(makePreHook({
        name: 'blocker-after-broken',
        priority: 200,
        evaluate: () => ({ decision: 'block', reason: 'second hook' }),
      }));
      const result = pipeline.evaluatePre(makeAction(), makeContext());
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('second hook');
    });
  });

  describe('runPost', () => {
    it('runs all matching post-hooks', () => {
      const calls: string[] = [];
      pipeline.registerPostHook(makePostHook({
        name: 'hook-a',
        priority: 100,
        afterExecute: () => { calls.push('a'); },
      }));
      pipeline.registerPostHook(makePostHook({
        name: 'hook-b',
        priority: 200,
        afterExecute: () => { calls.push('b'); },
      }));
      pipeline.runPost(makeAction(), makeContext());
      expect(calls).toEqual(['a', 'b']);
    });

    it('continues on post-hook errors', () => {
      const calls: string[] = [];
      pipeline.registerPostHook(makePostHook({
        name: 'broken',
        priority: 100,
        afterExecute: () => { throw new Error('broken'); },
      }));
      pipeline.registerPostHook(makePostHook({
        name: 'survivor',
        priority: 200,
        afterExecute: () => { calls.push('survived'); },
      }));
      pipeline.runPost(makeAction(), makeContext());
      expect(calls).toEqual(['survived']);
    });

    it('handles async post-hooks without blocking', () => {
      const calls: string[] = [];
      pipeline.registerPostHook(makePostHook({
        name: 'async-hook',
        priority: 100,
        afterExecute: async () => { calls.push('async'); },
      }));
      pipeline.runPost(makeAction(), makeContext());
      expect(calls).toEqual(['async']);
    });

    it('skips post-hooks when pipeline is disabled', () => {
      const calls: string[] = [];
      pipeline.registerPostHook(makePostHook({
        name: 'skipped',
        priority: 100,
        afterExecute: () => { calls.push('should-not-run'); },
      }));
      pipeline.setEnabled(false);
      pipeline.runPost(makeAction(), makeContext());
      expect(calls).toEqual([]);
    });
  });

  describe('registration', () => {
    it('sorts pre-hooks by priority on register', () => {
      pipeline.registerPreHook(makePreHook({ name: 'c', priority: 300 }));
      pipeline.registerPreHook(makePreHook({ name: 'a', priority: 100 }));
      pipeline.registerPreHook(makePreHook({ name: 'b', priority: 200 }));
      expect(pipeline.getPreHookNames()).toEqual(['a', 'b', 'c']);
    });

    it('sorts post-hooks by priority on register', () => {
      pipeline.registerPostHook(makePostHook({ name: 'z', priority: 900 }));
      pipeline.registerPostHook(makePostHook({ name: 'x', priority: 100 }));
      expect(pipeline.getPostHookNames()).toEqual(['x', 'z']);
    });

    it('removePreHook removes by name', () => {
      pipeline.registerPreHook(makePreHook({ name: 'removeme', priority: 100 }));
      expect(pipeline.removePreHook('removeme')).toBe(true);
      expect(pipeline.getPreHookNames()).toEqual([]);
    });

    it('removePreHook returns false for missing hook', () => {
      expect(pipeline.removePreHook('nonexistent')).toBe(false);
    });

    it('removePostHook removes by name', () => {
      pipeline.registerPostHook(makePostHook({ name: 'removeme', priority: 100 }));
      expect(pipeline.removePostHook('removeme')).toBe(true);
      expect(pipeline.getPostHookNames()).toEqual([]);
    });
  });

  describe('buildAction', () => {
    it('extracts JSON payload from raw text', () => {
      const action = GovernancePipeline.buildAction(
        'CREATE_AGENT',
        '⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧',
        { id: 'a1', role: { id: 'lead', name: 'Lead' }, status: 'running' },
      );
      expect(action.commandName).toBe('CREATE_AGENT');
      expect(action.payload).toEqual({ role: 'developer' });
      expect(action.agent.id).toBe('a1');
      expect(action.agent.roleId).toBe('lead');
    });

    it('handles raw text without JSON payload', () => {
      const action = GovernancePipeline.buildAction(
        'TASK_STATUS',
        '⟦⟦ TASK_STATUS ⟧⟧',
        { id: 'a2', role: { id: 'dev', name: 'Developer' }, status: 'running' },
      );
      expect(action.payload).toBeNull();
    });
  });
});
