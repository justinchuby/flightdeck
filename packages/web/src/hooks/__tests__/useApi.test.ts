import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, getAuthToken } from '../useApi';

function mockFetchOk(body: unknown = { ok: true }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status: number, body?: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: body !== undefined
      ? () => Promise.resolve(body)
      : () => Promise.reject(new Error('no json')),
  });
}

function neverResolvingFetch() {
  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  });
}

describe('getAuthToken', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null) });
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns null when no token is available', () => {
    expect(getAuthToken()).toBeNull();
  });

  it('reads token from localStorage', () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('stored-token');
    expect(getAuthToken()).toBe('stored-token');
  });

  it('prefers URL token param over localStorage', () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?token=url-token' },
      writable: true,
    });
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('stored-token');
    expect(getAuthToken()).toBe('url-token');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '' },
      writable: true,
    });
  });

  it('falls back to URL token if localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation(() => { throw new Error('blocked'); }),
    });
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?token=fallback-token' },
      writable: true,
    });
    expect(getAuthToken()).toBe('fallback-token');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '' },
      writable: true,
    });
  });
});

describe('apiFetch', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves normally within timeout', async () => {
    mockFetchOk({ data: 'ok' });
    const result = await apiFetch('/test');
    expect(result).toEqual({ data: 'ok' });
  });

  it('prepends /api base path', async () => {
    mockFetchOk();
    await apiFetch('/widgets');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/widgets', expect.any(Object));
  });

  it('sends Content-Type and auth headers', async () => {
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('my-token');
    mockFetchOk();
    await apiFetch('/test');
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('merges custom headers', async () => {
    mockFetchOk();
    await apiFetch('/test', { headers: { 'X-Custom': 'yes' } });
    const headers = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
    expect(headers['X-Custom']).toBe('yes');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('passes method and body through', async () => {
    mockFetchOk();
    await apiFetch('/items', { method: 'POST', body: JSON.stringify({ x: 1 }) });
    const opts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe('{"x":1}');
  });

  it('rejects with timeout message when request exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    neverResolvingFetch();
    const promise = apiFetch('/slow', { timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow('Request to /slow timed out after 100ms');
    vi.useRealTimers();
  });

  it('respects per-call timeout override', async () => {
    vi.useFakeTimers();
    neverResolvingFetch();
    const promise = apiFetch('/fast', { timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(promise).rejects.toThrow('timed out after 50ms');
    vi.useRealTimers();
  });

  it('skips timeout when timeoutMs is 0', async () => {
    mockFetchOk({ ok: true });
    const result = await apiFetch('/no-timeout', { timeoutMs: 0 });
    expect(result).toEqual({ ok: true });
  });

  it('throws HTTP error for non-ok responses', async () => {
    mockFetchError(404, { error: 'not found' });
    await expect(apiFetch('/missing')).rejects.toThrow('not found');
  });

  it('falls back to HTTP status when body has no error field', async () => {
    mockFetchError(500, {});
    await expect(apiFetch('/broken')).rejects.toThrow('HTTP 500');
  });

  it('falls back to statusText when body JSON parsing fails', async () => {
    mockFetchError(502);
    await expect(apiFetch('/bad-gw')).rejects.toThrow('Error 502');
  });

  it('rethrows non-abort errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network failure'));
    await expect(apiFetch('/net')).rejects.toThrow('Network failure');
  });

  it('aborts immediately when caller signal is already aborted', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      }
      return new Promise(() => {});
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      apiFetch('/aborted', { signal: controller.signal, timeoutMs: 0 }),
    ).rejects.toThrow();
  });

  it('rethrows AbortError when caller aborts during request', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const promise = apiFetch('/cancel', { signal: controller.signal, timeoutMs: 0 });
    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});
