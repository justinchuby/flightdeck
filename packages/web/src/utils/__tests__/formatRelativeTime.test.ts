import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRelativeTime } from '../formatRelativeTime';

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for timestamps less than 1 minute ago', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T12:00:30Z') });
    expect(formatRelativeTime('2026-03-08T12:00:00Z')).toBe('just now');
  });

  it('returns minutes for timestamps less than 1 hour ago', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T12:15:00Z') });
    const result = formatRelativeTime('2026-03-08T12:00:00Z');
    expect(result).toMatch(/15/);
    expect(result).not.toBe('just now');
  });

  it('returns hours for timestamps less than 1 day ago', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T15:00:00Z') });
    const result = formatRelativeTime('2026-03-08T12:00:00Z');
    expect(result).toMatch(/3/);
  });

  it('returns days for timestamps older than 1 day', () => {
    vi.useFakeTimers({ now: new Date('2026-03-10T12:00:00Z') });
    const result = formatRelativeTime('2026-03-08T12:00:00Z');
    expect(result).toMatch(/2/);
  });

  it('handles space-separated timestamps (non-ISO)', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T12:30:00Z') });
    const result = formatRelativeTime('2026-03-08 12:00:00');
    expect(result).toMatch(/30/);
  });

  it('handles timestamps without Z suffix', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T14:00:00Z') });
    const result = formatRelativeTime('2026-03-08T12:00:00');
    expect(result).toMatch(/2/);
  });

  it('handles timestamps already ending with Z', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T13:00:00Z') });
    const result = formatRelativeTime('2026-03-08T12:00:00Z');
    expect(result).toMatch(/1/);
  });

  it('returns "just now" for future timestamps', () => {
    vi.useFakeTimers({ now: new Date('2026-03-08T12:00:00Z') });
    expect(formatRelativeTime('2026-03-08T13:00:00Z')).toBe('just now');
  });

  it('returns original string for invalid timestamps', () => {
    expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
    expect(formatRelativeTime('')).toBe('');
  });
});
