// @vitest-environment jsdom
/**
 * Coverage tests for generateInsights function in Analytics/types.ts.
 * Lines 52-63 are uncovered — the insight generation logic.
 */
import { describe, it, expect } from 'vitest';
import { generateInsights, type AnalyticsOverview, type SessionSummary } from '../types';

const makeSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  leadId: 'l1',
  projectId: 'p1',
  status: 'completed',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  agentCount: 3,
  taskCount: 5,
  totalInputTokens: 1000,
  totalOutputTokens: 500,
  ...overrides,
});

describe('generateInsights', () => {
  it('returns empty array for fewer than 2 sessions', () => {
    const overview: AnalyticsOverview = {
      totalSessions: 1,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      sessions: [makeSession()],
      roleContributions: [],
    };
    expect(generateInsights(overview)).toEqual([]);
  });

  it('detects token usage decrease when recent sessions use fewer tokens', () => {
    const recent = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `r${i}`, totalInputTokens: 100, totalOutputTokens: 50 }),
    );
    const older = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `o${i}`, totalInputTokens: 1000, totalOutputTokens: 500 }),
    );
    const overview: AnalyticsOverview = {
      totalSessions: 10,
      totalInputTokens: 5500,
      totalOutputTokens: 2750,
      sessions: [...recent, ...older],
      roleContributions: [],
    };
    const insights = generateInsights(overview);
    expect(insights.some(i => i.title === 'Sessions using fewer tokens')).toBe(true);
  });

  it('detects token usage increase when recent sessions use more tokens', () => {
    const recent = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `r${i}`, totalInputTokens: 5000, totalOutputTokens: 3000 }),
    );
    const older = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `o${i}`, totalInputTokens: 100, totalOutputTokens: 50 }),
    );
    const overview: AnalyticsOverview = {
      totalSessions: 10,
      totalInputTokens: 25500,
      totalOutputTokens: 15250,
      sessions: [...recent, ...older],
      roleContributions: [],
    };
    const insights = generateInsights(overview);
    expect(insights.some(i => i.title === 'Token usage increasing')).toBe(true);
  });

  it('generates task count insight when > 10 total tasks', () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSession({ leadId: `s${i}`, taskCount: 5 }),
    );
    const overview: AnalyticsOverview = {
      totalSessions: 4,
      totalInputTokens: 4000,
      totalOutputTokens: 2000,
      sessions,
      roleContributions: [],
    };
    const insights = generateInsights(overview);
    expect(insights.some(i => i.title.includes('20 tasks'))).toBe(true);
  });

  it('generates role imbalance insight when one role > 60%', () => {
    const sessions = Array.from({ length: 3 }, (_, i) => makeSession({ leadId: `s${i}` }));
    const overview: AnalyticsOverview = {
      totalSessions: 3,
      totalInputTokens: 3000,
      totalOutputTokens: 1500,
      sessions,
      roleContributions: [
        { role: 'Developer', taskCount: 80, tokenUsage: 5000 },
        { role: 'Architect', taskCount: 20, tokenUsage: 1000 },
      ],
    };
    const insights = generateInsights(overview);
    expect(insights.some(i => i.title.includes('Developer'))).toBe(true);
  });

  it('does not generate role insight when balanced', () => {
    const sessions = Array.from({ length: 3 }, (_, i) => makeSession({ leadId: `s${i}` }));
    const overview: AnalyticsOverview = {
      totalSessions: 3,
      totalInputTokens: 3000,
      totalOutputTokens: 1500,
      sessions,
      roleContributions: [
        { role: 'Developer', taskCount: 50, tokenUsage: 5000 },
        { role: 'Architect', taskCount: 50, tokenUsage: 5000 },
      ],
    };
    const insights = generateInsights(overview);
    expect(insights.filter(i => i.type === 'role')).toHaveLength(0);
  });

  it('caps insights at 5', () => {
    const recent = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `r${i}`, totalInputTokens: 5000, totalOutputTokens: 3000, taskCount: 10 }),
    );
    const older = Array.from({ length: 5 }, (_, i) =>
      makeSession({ leadId: `o${i}`, totalInputTokens: 100, totalOutputTokens: 50, taskCount: 10 }),
    );
    const overview: AnalyticsOverview = {
      totalSessions: 10,
      totalInputTokens: 25500,
      totalOutputTokens: 15250,
      sessions: [...recent, ...older],
      roleContributions: [
        { role: 'Developer', taskCount: 90, tokenUsage: 20000 },
        { role: 'Tester', taskCount: 10, tokenUsage: 1000 },
      ],
    };
    const insights = generateInsights(overview);
    expect(insights.length).toBeLessThanOrEqual(5);
  });
});
