import { describe, it, expect } from 'vitest';
import { classifyEvent, type EventTier } from '../coordination/events/SynthesisEngine.js';
import type { ActivityEntry } from '../coordination/activity/ActivityLedger.js';

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-001',
    agentRole: 'developer',
    actionType: 'message_sent',
    summary: 'some message',
    details: {},
    timestamp: new Date().toISOString(),
    projectId: '',
    ...overrides,
  };
}

describe('classifyEvent', () => {
  // ── Critical patterns ──────────────────────────────────────────────
  const criticalCases: [string, Partial<ActivityEntry>][] = [
    ['build failure', { summary: 'Build failed with 3 errors' }],
    ['test failure', { summary: 'Test failed: auth.test.ts' }],
    ['compile error', { summary: 'Compilation error in module X' }],
    ['crash', { summary: 'Agent crashed unexpectedly' }],
    ['agent stuck', { summary: 'agent stuck on long task' }],
    ['blocked task', { summary: 'Task blocked by missing dependency' }],
    ['P0 issue', { summary: 'P0: database migration broken' }],
    ['URGENT', { summary: 'URGENT: production down' }],
    ['TypeError', { summary: 'TypeError: cannot read property of undefined' }],
    ['OOM', { summary: 'Process OOM killed' }],
    ['timeout', { summary: 'Request timeout after 30s' }],
    ['fatal error', { summary: 'fatal error in build pipeline' }],
    ['SIGTERM', { summary: 'Process received SIGTERM' }],
    ['decision needed', { summary: 'Decision needed: increase agent limit' }],
    ['error action type', { actionType: 'error', summary: 'something happened' }],
  ];

  it.each(criticalCases)('classifies %s as critical', (_label, overrides) => {
    expect(classifyEvent(makeEntry(overrides))).toBe('critical' as EventTier);
  });

  // ── Notable patterns ───────────────────────────────────────────────
  const notableCases: [string, Partial<ActivityEntry>][] = [
    ['task completed', { summary: 'task completed successfully' }],
    ['all tests pass', { summary: 'all 247 tests pass' }],
    ['build passes', { summary: 'build passes with 0 warnings' }],
    ['merged', { summary: 'PR merged into main' }],
    ['review done', { summary: 'review complete — approved' }],
    ['delegation', { summary: 'delegated to developer-002' }],
    ['fixed bug', { summary: 'fixed the auth regression' }],
    ['[Done] marker', { summary: '[Done] Completed all tests' }],
    ['task_completed action', { actionType: 'task_completed', summary: 'short' }],
    ['delegated action', { actionType: 'delegated', summary: 'short' }],
  ];

  it.each(notableCases)('classifies %s as notable', (_label, overrides) => {
    expect(classifyEvent(makeEntry(overrides))).toBe('notable' as EventTier);
  });

  // ── Routine patterns ───────────────────────────────────────────────
  const routineCases: [string, Partial<ActivityEntry>][] = [
    ['lock acquired', { actionType: 'lock_acquired', summary: 'Locked file.ts' }],
    ['lock released', { actionType: 'lock_released', summary: 'Released file.ts' }],
    ['status change', { actionType: 'status_change', summary: 'idle → running' }],
    ['short message', { summary: 'ok' }],
  ];

  it.each(routineCases)('classifies %s as routine', (_label, overrides) => {
    expect(classifyEvent(makeEntry(overrides))).toBe('routine' as EventTier);
  });

  // ── Edge cases ─────────────────────────────────────────────────────
  it('classifies long messages as notable by default', () => {
    const longText = 'a'.repeat(201);
    expect(classifyEvent(makeEntry({ summary: longText }))).toBe('notable');
  });

  it('critical patterns override notable action types', () => {
    // delegated action type is notable, but 'build fail' in summary is critical
    expect(classifyEvent(makeEntry({ actionType: 'delegated', summary: 'build fail during delegation' }))).toBe('critical');
  });

  it('routine action types override notable patterns', () => {
    // lock_acquired is routine, even if summary contains 'progress'
    expect(classifyEvent(makeEntry({ actionType: 'lock_acquired', summary: 'progress lock on file' }))).toBe('routine');
  });
});
