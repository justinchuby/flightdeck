import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProgressiveRoutes } from '../useProgressiveRoutes';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';

const store = new Map<string, string>();
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (_i: number) => null,
};

describe('useProgressiveRoutes', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', mockStorage);
    useAppStore.setState({ agents: [] });
    useLeadStore.setState({ selectedLeadId: null, projects: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns starter tier with no agents', () => {
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('starter');
    expect(result.current.visibleRoutes.every(r => r.tier === 'starter')).toBe(true);
  });

  it('returns active tier with 2 agents', () => {
    useAppStore.setState({ agents: [{ id: '1' }, { id: '2' }] as any });
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('active');
    const tiers = new Set(result.current.visibleRoutes.map(r => r.tier));
    expect(tiers.has('starter')).toBe(true);
    expect(tiers.has('active')).toBe(true);
    expect(tiers.has('collaboration')).toBe(false);
  });

  it('returns collaboration tier with 3+ agents', () => {
    useAppStore.setState({ agents: [{ id: '1' }, { id: '2' }, { id: '3' }] as any });
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('collaboration');
  });

  it('returns power tier when sidebar-routes-expanded is set', () => {
    store.set('sidebar-routes-expanded', 'true');
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('power');
    expect(result.current.hiddenRoutes).toHaveLength(0);
  });

  it('returns power tier when session-count >= 3', () => {
    store.set('session-count', '5');
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('power');
  });

  it('allRoutes contains all defined routes', () => {
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.allRoutes.length).toBeGreaterThanOrEqual(11);
  });

  it('visible + hidden = all', () => {
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.visibleRoutes.length + result.current.hiddenRoutes.length)
      .toBe(result.current.allRoutes.length);
  });

  it('returns active tier when tasks exist', () => {
    useLeadStore.setState({
      selectedLeadId: 'lead-1',
      projects: { 'lead-1': { dagStatus: { tasks: [{ id: 't1' }] } } } as any,
    });
    const { result } = renderHook(() => useProgressiveRoutes());
    expect(result.current.tier).toBe('active');
  });
});
