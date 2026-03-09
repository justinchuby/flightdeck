import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '../useApi';

describe('apiFetch timeout', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Mock localStorage for auth headers
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves normally within timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'ok' }),
    });
    const result = await apiFetch('/test');
    expect(result).toEqual({ data: 'ok' });
  });

  it('rejects with timeout message when request exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    // Fetch that never resolves
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = apiFetch('/slow', { timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow('Request to /slow timed out after 100ms');
    vi.useRealTimers();
  });

  it('respects per-call timeout override', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = apiFetch('/fast', { timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(promise).rejects.toThrow('timed out after 50ms');
    vi.useRealTimers();
  });

  it('skips timeout when timeoutMs is 0', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    const result = await apiFetch('/no-timeout', { timeoutMs: 0 });
    expect(result).toEqual({ ok: true });
    // Verify no abort signal was created with a timeout
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].signal).toBeDefined(); // AbortController still created
  });

  it('throws HTTP error for non-ok responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'not found' }),
    });
    await expect(apiFetch('/missing')).rejects.toThrow('not found');
  });
});
