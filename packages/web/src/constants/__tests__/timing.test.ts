import { describe, it, expect } from 'vitest';
import { POLL_INTERVAL_MS, STATE_FETCH_DEBOUNCE_MS, PLAYBACK_TICK_MS, MIN_SESSION_DURATION_MS } from '../timing';

describe('timing constants', () => {
  it('POLL_INTERVAL_MS is a positive number', () => {
    expect(POLL_INTERVAL_MS).toBe(10_000);
  });

  it('STATE_FETCH_DEBOUNCE_MS is a positive number', () => {
    expect(STATE_FETCH_DEBOUNCE_MS).toBe(300);
  });

  it('PLAYBACK_TICK_MS is a positive number', () => {
    expect(PLAYBACK_TICK_MS).toBe(100);
  });

  it('MIN_SESSION_DURATION_MS is a positive number', () => {
    expect(MIN_SESSION_DURATION_MS).toBe(1_000);
  });

  it('poll interval is larger than debounce', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThan(STATE_FETCH_DEBOUNCE_MS);
  });
});
