// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';

import { useProgressiveRoutes } from '../useProgressiveRoutes';

describe('useProgressiveRoutes — localStorage error paths', () => {
  beforeEach(() => {
    useAppStore.setState({ agents: [] });
    useLeadStore.setState({ selectedLeadId: null, projects: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getSessionCount returns 0 when localStorage.getItem throws (line 43)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied');
    });

    const { result } = renderHook(() => useProgressiveRoutes());
    // With 0 agents and getSessionCount returning 0, tier should be 'starter'
    expect(result.current.tier).toBe('starter');
  });

  it('isManuallyExpanded returns false when localStorage.getItem throws (line 48)', () => {
    // getItem throws, so isManuallyExpanded returns false, getSessionCount returns 0
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied');
    });

    // With 3+ agents, tier should be 'collaboration' (not 'power' since isManuallyExpanded is false)
    useAppStore.setState({ agents: [{ id: '1' }, { id: '2' }, { id: '3' }] as any });
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('collaboration');
  });

  it('expandAll catches when localStorage.setItem throws (line 75)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => useProgressiveRoutes());
    // Should not throw
    expect(() => result.current.expandAll()).not.toThrow();
  });
});
