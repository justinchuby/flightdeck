import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatAgentId, relativeTime } from '../format';

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
