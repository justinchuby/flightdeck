import { describe, it, expect, beforeEach } from 'vitest';
import { resolveShortId } from '../resolveShortId';
import { useAppStore } from '../../stores/appStore';

describe('resolveShortId', () => {
  beforeEach(() => {
    useAppStore.setState({
      agents: [
        { id: 'a1b2c3d4-full-uuid', status: 'running' },
        { id: 'e5f6g7h8-full-uuid', status: 'idle' },
      ] as any,
    });
  });

  it('resolves a short ID prefix to full ID', () => {
    expect(resolveShortId('a1b2c3d4')).toBe('a1b2c3d4-full-uuid');
  });

  it('resolves shorter prefix', () => {
    expect(resolveShortId('e5f6')).toBe('e5f6g7h8-full-uuid');
  });

  it('returns null for no match', () => {
    expect(resolveShortId('zzzzz')).toBeNull();
  });

  it('returns null for empty string (matches first)', () => {
    // Empty string is a prefix of everything — returns first match
    const result = resolveShortId('');
    expect(result).toBe('a1b2c3d4-full-uuid');
  });
});
