import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrashForensics } from '../agents/CrashForensics.js';

function baseParams(overrides: Partial<Parameters<CrashForensics['capture']>[0]> = {}) {
  return {
    agentId: 'agent-abc123',
    agentRole: 'developer',
    task: 'implement feature X',
    error: 'TypeError: Cannot read property',
    stackTrace: 'Error: ...\n  at foo (bar.js:1:1)',
    lastMessages: ['msg1', 'msg2', 'msg3'],
    contextUsage: { used: 50_000, total: 200_000 },
    createdAt: Date.now() - 5_000,
    restartCount: 0,
    ...overrides,
  };
}

describe('CrashForensics', () => {
  let forensics: CrashForensics;

  beforeEach(() => {
    vi.useFakeTimers();
    forensics = new CrashForensics(50, 10);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Captures crash report with all fields ─────────────────────────

  it('captures crash report with all fields', () => {
    const before = Date.now();
    const params = baseParams();
    const report = forensics.capture(params);

    expect(report.agentId).toBe('agent-abc123');
    expect(report.agentRole).toBe('developer');
    expect(report.task).toBe('implement feature X');
    expect(report.error).toBe('TypeError: Cannot read property');
    expect(report.stackTrace).toBe('Error: ...\n  at foo (bar.js:1:1)');
    expect(report.lastMessages).toEqual(['msg1', 'msg2', 'msg3']);
    expect(report.contextUsage).toEqual({ used: 50_000, total: 200_000 });
    expect(report.restartCount).toBe(0);
    expect(report.crashedAt).toBeGreaterThanOrEqual(before);
    expect(report.uptime).toBeGreaterThanOrEqual(0);
  });

  // ── 2. Truncates stack trace to 2000 chars ───────────────────────────

  it('truncates stack trace to 2000 chars', () => {
    const longStack = 'x'.repeat(3000);
    const report = forensics.capture(baseParams({ stackTrace: longStack }));
    expect(report.stackTrace).toHaveLength(2000);
  });

  it('preserves stack trace shorter than 2000 chars', () => {
    const shortStack = 'Error at line 1';
    const report = forensics.capture(baseParams({ stackTrace: shortStack }));
    expect(report.stackTrace).toBe(shortStack);
  });

  // ── 3. Keeps only last N messages ────────────────────────────────────

  it('keeps only last N messages (maxLastMessages = 10)', () => {
    const messages = Array.from({ length: 15 }, (_, i) => `msg${i}`);
    const report = forensics.capture(baseParams({ lastMessages: messages }));
    expect(report.lastMessages).toHaveLength(10);
    // Last 10 of 15 → msg5..msg14
    expect(report.lastMessages[0]).toBe('msg5');
    expect(report.lastMessages[9]).toBe('msg14');
  });

  it('keeps all messages when fewer than maxLastMessages', () => {
    const messages = ['a', 'b', 'c'];
    const report = forensics.capture(baseParams({ lastMessages: messages }));
    expect(report.lastMessages).toEqual(['a', 'b', 'c']);
  });

  it('handles missing lastMessages gracefully', () => {
    const params = baseParams({ lastMessages: undefined });
    delete (params as any).lastMessages;
    const report = forensics.capture(params);
    expect(report.lastMessages).toEqual([]);
  });

  // ── 4. Trims old reports beyond maxReports ───────────────────────────

  it('trims old reports beyond maxReports', () => {
    const smallForensics = new CrashForensics(5, 10);

    for (let i = 0; i < 7; i++) {
      smallForensics.capture(baseParams({ agentId: `agent-${i}` }));
    }

    expect(smallForensics.totalCrashes).toBe(5);
    // Should keep the most recent 5 (agent-2 through agent-6)
    const reports = smallForensics.getReports();
    expect(reports[0].agentId).toBe('agent-2');
    expect(reports[4].agentId).toBe('agent-6');
  });

  // ── 5. getReports filters by agentId ────────────────────────────────

  it('getReports filters by agentId', () => {
    forensics.capture(baseParams({ agentId: 'agent-X' }));
    forensics.capture(baseParams({ agentId: 'agent-Y' }));
    forensics.capture(baseParams({ agentId: 'agent-X' }));

    const xReports = forensics.getReports('agent-X');
    expect(xReports).toHaveLength(2);
    expect(xReports.every(r => r.agentId === 'agent-X')).toBe(true);

    const yReports = forensics.getReports('agent-Y');
    expect(yReports).toHaveLength(1);
  });

  it('getReports with no filter returns all', () => {
    forensics.capture(baseParams({ agentId: 'agent-A' }));
    forensics.capture(baseParams({ agentId: 'agent-B' }));
    expect(forensics.getReports()).toHaveLength(2);
  });

  // ── 6. getRecent returns last N ──────────────────────────────────────

  it('getRecent returns last N reports', () => {
    for (let i = 0; i < 8; i++) {
      forensics.capture(baseParams({ agentId: `agent-${i}`, error: `error-${i}` }));
    }

    const recent = forensics.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].error).toBe('error-5');
    expect(recent[1].error).toBe('error-6');
    expect(recent[2].error).toBe('error-7');
  });

  it('getRecent defaults to 10', () => {
    for (let i = 0; i < 15; i++) {
      forensics.capture(baseParams({ agentId: `agent-${i}` }));
    }
    expect(forensics.getRecent().length).toBe(10);
  });

  // ── 7. getCrashStats groups by role ─────────────────────────────────

  it('getCrashStats groups by role', () => {
    forensics.capture(baseParams({ agentRole: 'developer' }));
    forensics.capture(baseParams({ agentRole: 'developer' }));
    forensics.capture(baseParams({ agentRole: 'reviewer' }));

    const stats = forensics.getCrashStats();
    expect(stats['developer'].count).toBe(2);
    expect(stats['reviewer'].count).toBe(1);
  });

  it('getCrashStats tracks lastCrash timestamp', () => {
    vi.setSystemTime(1_000_000);
    forensics.capture(baseParams({ agentRole: 'qa', createdAt: 990_000 }));
    vi.setSystemTime(2_000_000);
    forensics.capture(baseParams({ agentRole: 'qa', createdAt: 1_990_000 }));

    const stats = forensics.getCrashStats();
    expect(stats['qa'].lastCrash).toBe(2_000_000);
  });

  // ── 8. Calculates uptime correctly ──────────────────────────────────

  it('calculates uptime correctly', () => {
    vi.setSystemTime(10_000);
    const createdAt = 5_000; // agent was created 5000ms ago
    const report = forensics.capture(baseParams({ createdAt }));
    expect(report.uptime).toBe(5_000);
  });

  it('uptime is 0 when agent just started', () => {
    const now = Date.now();
    const report = forensics.capture(baseParams({ createdAt: now }));
    expect(report.uptime).toBeGreaterThanOrEqual(0);
    expect(report.uptime).toBeLessThan(100);
  });

  // ── 9. totalCrashes count ────────────────────────────────────────────

  it('totalCrashes increments with each capture', () => {
    expect(forensics.totalCrashes).toBe(0);
    forensics.capture(baseParams());
    expect(forensics.totalCrashes).toBe(1);
    forensics.capture(baseParams());
    expect(forensics.totalCrashes).toBe(2);
  });

  // ── 10. stackTrace is optional ───────────────────────────────────────

  it('handles missing stackTrace', () => {
    const params = baseParams({ stackTrace: undefined });
    delete (params as any).stackTrace;
    const report = forensics.capture(params);
    expect(report.stackTrace).toBeUndefined();
  });
});
