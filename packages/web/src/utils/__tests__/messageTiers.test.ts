import { describe, it, expect } from 'vitest';
import { classifyMessage, tierPassesFilter, TIER_CONFIG, type FeedItem } from '../messageTiers';

function make1to1(content: string, overrides: Record<string, string> = {}): FeedItem {
  return {
    type: '1:1',
    item: {
      id: 'c1',
      fromId: overrides.fromId ?? 'agent-1',
      fromRole: overrides.fromRole ?? 'developer',
      toId: overrides.toId ?? 'agent-2',
      toRole: overrides.toRole ?? 'lead',
      content,
      timestamp: Date.now(),
    },
  };
}

function makeGroup(content: string, fromRole = 'developer'): FeedItem {
  return {
    type: 'group',
    item: {
      id: 'g1',
      groupName: 'test-group',
      leadId: 'lead-1',
      fromAgentId: 'agent-1',
      fromRole,
      content,
      reactions: {},
      timestamp: new Date().toISOString(),
    },
  };
}

describe('classifyMessage', () => {
  describe('critical patterns', () => {
    const criticalPhrases = [
      'build failed on CI',
      'test failure in suite',
      'compilation error found',
      'agent crashed unexpectedly',
      'blocked by dependency',
      'P0 issue detected',
      'URGENT: fix needed',
      'TypeError: cannot read',
      'agent stuck in loop',
      'decision needed for API design',
      'breaking change in v2',
      'timeout after 30s',
      'OOM error',
      'fatal error occurred',
      '502 error on deploy',
      'SIGTERM received',
      'ENOMEM in worker',
      'heap limit exceeded',
      'segfault detected',
      'stack overflow in recursion',
      '❌ deploy failed',
      '🔴 critical issue',
    ];

    it.each(criticalPhrases)('classifies "%s" as critical', (phrase) => {
      expect(classifyMessage(make1to1(phrase))).toBe('critical');
    });

    it('classifies critical group messages', () => {
      expect(classifyMessage(makeGroup('build failed!'))).toBe('critical');
    });
  });

  describe('notable patterns', () => {
    const notablePhrases = [
      'task completed successfully',
      '[Done] all work finished',
      'finished the implementation',
      'all 42 tests pass',
      'build succeeded ✅',
      'merged to main',
      'review complete',
      'progress on feature X',
      'delegated to developer',
      'new feature added',
      'fixed the null pointer bug',
      '✅ all checks pass',
      '🎉 shipped!',
    ];

    it.each(notablePhrases)('classifies "%s" as notable', (phrase) => {
      expect(classifyMessage(make1to1(phrase))).toBe('notable');
    });

    it('classifies [Agent Report] as notable', () => {
      expect(classifyMessage(make1to1('[Agent Report] some data here'))).toBe('notable');
    });
  });

  describe('messages TO the lead', () => {
    it('classifies messages TO leadId as at least notable', () => {
      const entry = make1to1('hello there', { toId: 'lead-1' });
      expect(classifyMessage(entry, 'lead-1')).toBe('notable');
    });

    it('promotes to critical if content matches critical pattern', () => {
      const entry = make1to1('build failed!', { toId: 'lead-1' });
      expect(classifyMessage(entry, 'lead-1')).toBe('critical');
    });
  });

  describe('secretary messages', () => {
    it('classifies secretary messages as routine', () => {
      expect(classifyMessage(make1to1('updated context', { fromRole: 'secretary' }))).toBe('routine');
    });
  });

  describe('default classification', () => {
    it('classifies short generic messages as routine', () => {
      expect(classifyMessage(make1to1('ok'))).toBe('routine');
    });

    it('classifies long generic messages as notable', () => {
      const longText = 'a'.repeat(201);
      expect(classifyMessage(make1to1(longText))).toBe('notable');
    });

    it('classifies messages exactly 200 chars as routine', () => {
      expect(classifyMessage(make1to1('a'.repeat(200)))).toBe('routine');
    });
  });
});

describe('tierPassesFilter', () => {
  it('"all" passes every tier', () => {
    expect(tierPassesFilter('critical', 'all')).toBe(true);
    expect(tierPassesFilter('notable', 'all')).toBe(true);
    expect(tierPassesFilter('routine', 'all')).toBe(true);
  });

  it('"critical" passes only critical', () => {
    expect(tierPassesFilter('critical', 'critical')).toBe(true);
    expect(tierPassesFilter('notable', 'critical')).toBe(false);
    expect(tierPassesFilter('routine', 'critical')).toBe(false);
  });

  it('"notable" passes critical and notable', () => {
    expect(tierPassesFilter('critical', 'notable')).toBe(true);
    expect(tierPassesFilter('notable', 'notable')).toBe(true);
    expect(tierPassesFilter('routine', 'notable')).toBe(false);
  });
});

describe('TIER_CONFIG', () => {
  it('has all three tiers', () => {
    expect(TIER_CONFIG.critical).toBeDefined();
    expect(TIER_CONFIG.notable).toBeDefined();
    expect(TIER_CONFIG.routine).toBeDefined();
  });

  it('has labels and icons', () => {
    expect(TIER_CONFIG.critical.label).toBe('Critical');
    expect(TIER_CONFIG.critical.icon).toBe('🔴');
    expect(TIER_CONFIG.notable.label).toBe('Notable');
    expect(TIER_CONFIG.routine.label).toBe('Routine');
  });
});
