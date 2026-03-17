import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatAgentId, relativeTime, formatDuration, formatTokens, formatDate, formatDateTime } from '../format';

describe('formatAgentId', () => {
  it('formats role + first 4 chars', () => {
    expect(formatAgentId('Developer', 'abc12345-6789')).toBe('developer-abc1');
  });

  it('lowercases multi-word role and uses first word', () => {
    expect(formatAgentId('Code Reviewer', 'f1e2d3c4-5678')).toBe('code-f1e2');
  });

  it('falls back to first 8 chars when role is empty', () => {
    expect(formatAgentId('', 'abcd1234-5678')).toBe('abcd1234');
  });

  it('falls back to first 8 chars when role is undefined', () => {
    expect(formatAgentId(undefined, 'abcd1234-5678')).toBe('abcd1234');
  });

  it('returns unknown for empty id', () => {
    expect(formatAgentId('Dev', '')).toBe('unknown');
  });
});

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('returns "just now" for very recent times', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:05:00Z'));
    expect(relativeTime('2025-01-01T00:00:00Z')).toBe('5 minutes ago');
    vi.useRealTimers();
  });

  it('returns singular minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:01:30Z'));
    expect(relativeTime('2025-01-01T00:00:00Z')).toBe('1 minute ago');
    vi.useRealTimers();
  });

  it('returns hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T03:00:00Z'));
    expect(relativeTime('2025-01-01T00:00:00Z')).toBe('3 hours ago');
    vi.useRealTimers();
  });

  it('returns days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-04T00:00:00Z'));
    expect(relativeTime('2025-01-01T00:00:00Z')).toBe('3 days ago');
    vi.useRealTimers();
  });

  it('returns months ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-04-01T00:00:00Z'));
    expect(relativeTime('2025-01-01T00:00:00Z')).toBe('3 months ago');
    vi.useRealTimers();
  });

  it('returns "just now" for future dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    expect(relativeTime('2025-01-02T00:00:00Z')).toBe('just now');
    vi.useRealTimers();
  });

  it('returns raw string for invalid input', () => {
    expect(relativeTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDuration', () => {
  it('returns "ongoing" for null', () => {
    expect(formatDuration(null)).toBe('ongoing');
  });

  it('returns "ongoing" for undefined', () => {
    expect(formatDuration(undefined)).toBe('ongoing');
  });

  it('formats seconds', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats minutes', () => {
    expect(formatDuration(5 * 60_000)).toBe('5m');
  });

  it('formats hours with remaining minutes', () => {
    expect(formatDuration(150 * 60_000)).toBe('2h 30m');
  });

  it('formats exact hours without minutes', () => {
    expect(formatDuration(120 * 60_000)).toBe('2h');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('formatTokens', () => {
  it('returns "0" for null/undefined/0', () => {
    expect(formatTokens(null)).toBe('0');
    expect(formatTokens(undefined)).toBe('0');
    expect(formatTokens(0)).toBe('0');
  });

  it('returns raw number below 1000', () => {
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1)).toBe('1');
  });

  it('formats thousands with k suffix', () => {
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(45_000)).toBe('45k');
    expect(formatTokens(999_999)).toBe('1000k');
  });

  it('drops trailing .0 in k format', () => {
    expect(formatTokens(2_000)).toBe('2k');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(10_000_000)).toBe('10M');
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-08T12:00:00Z');
    expect(result).toContain('2026');
    expect(result).toMatch(/Mar|3/);
  });

  it('returns "Invalid Date" for unparseable input', () => {
    expect(formatDate('not-a-date')).toBe('Invalid Date');
  });
});

describe('formatDateTime', () => {
  it('formats ISO date with time', () => {
    const result = formatDateTime('2026-03-08T14:30:00Z');
    expect(result).toMatch(/Mar|3/);
    expect(result.length).toBeGreaterThan(5);
  });

  it('handles unparseable input gracefully', () => {
    const result = formatDateTime('bad');
    expect(result).toContain('Invalid Date');
  });
});
