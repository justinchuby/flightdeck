import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRecentCommands } from '../useRecentCommands';

const STORAGE_KEY = 'command-palette-recent';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => { store.clear(); }),
    get length() { return store.size; },
    key: vi.fn(() => null),
  };
}

describe('useRecentCommands', () => {
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    vi.stubGlobal('localStorage', mockStorage);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts with empty recent list', () => {
    const { result } = renderHook(() => useRecentCommands());
    expect(result.current.recent).toEqual([]);
  });

  it('loads initial state from localStorage', () => {
    const stored = [{ id: 'cmd-1', label: 'Test', icon: '🔧', timestamp: 500 }];
    (mockStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(stored));

    const { result } = renderHook(() => useRecentCommands());
    expect(result.current.recent).toEqual(stored);
  });

  it('handles corrupt localStorage gracefully', () => {
    (mockStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('not-valid-json{{{');
    const { result } = renderHook(() => useRecentCommands());
    expect(result.current.recent).toEqual([]);
  });

  it('adds a command via addRecent', () => {
    const { result } = renderHook(() => useRecentCommands());

    act(() => {
      result.current.addRecent('cmd-1', 'Build', '🔨');
    });

    expect(result.current.recent).toHaveLength(1);
    expect(result.current.recent[0]).toEqual({
      id: 'cmd-1',
      label: 'Build',
      icon: '🔨',
      timestamp: 1000,
    });
  });

  it('persists to localStorage on addRecent', () => {
    const { result } = renderHook(() => useRecentCommands());

    act(() => {
      result.current.addRecent('cmd-1', 'Build', '🔨');
    });

    expect(mockStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.stringContaining('"cmd-1"'),
    );
  });

  it('deduplicates by id, keeping newest first', () => {
    const { result } = renderHook(() => useRecentCommands());

    act(() => {
      result.current.addRecent('cmd-1', 'Build', '🔨');
    });
    act(() => {
      result.current.addRecent('cmd-2', 'Test', '🧪');
    });
    act(() => {
      result.current.addRecent('cmd-1', 'Build Updated', '🔨');
    });

    expect(result.current.recent).toHaveLength(2);
    expect(result.current.recent[0].id).toBe('cmd-1');
    expect(result.current.recent[0].label).toBe('Build Updated');
    expect(result.current.recent[1].id).toBe('cmd-2');
  });

  it('limits to 10 items', () => {
    const { result } = renderHook(() => useRecentCommands());

    act(() => {
      for (let i = 0; i < 12; i++) {
        result.current.addRecent(`cmd-${i}`, `Command ${i}`, '📋');
      }
    });

    expect(result.current.recent).toHaveLength(10);
    // Most recent should be first
    expect(result.current.recent[0].id).toBe('cmd-11');
  });

  it('clears all recent commands', () => {
    const { result } = renderHook(() => useRecentCommands());

    act(() => {
      result.current.addRecent('cmd-1', 'Build', '🔨');
      result.current.addRecent('cmd-2', 'Test', '🧪');
    });

    act(() => {
      result.current.clearRecent();
    });

    expect(result.current.recent).toEqual([]);
    expect(mockStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});
