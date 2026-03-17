import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mockSetRoles, mockSetConfig, mockUpdateAgent } = vi.hoisted(() => ({
  mockSetRoles: vi.fn(),
  mockSetConfig: vi.fn(),
  mockUpdateAgent: vi.fn(),
}));

vi.mock('../../stores/appStore', () => {
  const storeState = {
    setRoles: mockSetRoles,
    setConfig: mockSetConfig,
    updateAgent: mockUpdateAgent,
  };
  const useAppStore = vi.fn((selector: (s: typeof storeState) => unknown) => selector(storeState));
  (useAppStore as Record<string, unknown>).getState = () => storeState;
  return { useAppStore };
});

import { useApi } from '../useApi';

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation(async (url: string) => {
    const path = url.replace('/api', '');
    const body = responses[path] ?? {};
    return { ok: true, json: () => Promise.resolve(body) };
  });
}

describe('useApi hook', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    globalThis.fetch = mockFetch({ '/roles': [], '/config': {} });
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls loadRoles and loadConfig on mount', async () => {
    renderHook(() => useApi());
    await act(async () => {});
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(fetchCalls).toContain('/api/roles');
    expect(fetchCalls).toContain('/api/config');
    expect(mockSetRoles).toHaveBeenCalledWith([]);
    expect(mockSetConfig).toHaveBeenCalledWith({});
  });

  it('spawnAgent calls POST /agents with correct body', async () => {
    globalThis.fetch = mockFetch({ '/roles': [], '/config': {}, '/agents': { id: 'a1' } });
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => {
      await result.current.spawnAgent('developer', 'write code', { model: 'gpt-4' });
    });
    const spawnCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/agents' && (c[1] as RequestInit)?.method === 'POST',
    );
    expect(spawnCall).toBeDefined();
    expect(JSON.parse((spawnCall![1] as RequestInit).body as string)).toEqual({
      roleId: 'developer', task: 'write code', model: 'gpt-4',
    });
  });

  it('terminateAgent calls DELETE /agents/:id', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.terminateAgent('agent-1'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/agents/agent-1' && (c[1] as RequestInit)?.method === 'DELETE',
    );
    expect(call).toBeDefined();
  });

  it('interruptAgent calls POST /agents/:id/interrupt', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.interruptAgent('agent-2'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/agents/agent-2/interrupt',
    );
    expect(call).toBeDefined();
  });

  it('restartAgent calls POST /agents/:id/restart', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.restartAgent('agent-3'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/agents/agent-3/restart',
    );
    expect(call).toBeDefined();
  });

  it('updateConfig calls PATCH /config and updates store', async () => {
    const configResult = { maxAgents: 5 };
    globalThis.fetch = mockFetch({ '/roles': [], '/config': configResult });
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => {
      const res = await result.current.updateConfig({ maxAgents: 5 });
      expect(res).toEqual(configResult);
    });
    expect(mockSetConfig).toHaveBeenCalledWith(configResult);
  });

  it('createRole calls POST /roles then reloads', async () => {
    const role = { id: 'qa', name: 'QA', description: '', systemPrompt: '', color: '#000', icon: 'x' };
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    await act(async () => { await result.current.createRole(role); });
    const postCall = fetchMock.mock.calls.find(
      (c: unknown[]) => c[0] === '/api/roles' && (c[1] as RequestInit)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
  });

  it('deleteRole calls DELETE /roles/:id then reloads', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();
    await act(async () => { await result.current.deleteRole('old-role'); });
    const deleteCall = fetchMock.mock.calls.find(
      (c: unknown[]) => c[0] === '/api/roles/old-role',
    );
    expect(deleteCall).toBeDefined();
  });

  it('updateAgent optimistically updates store', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.updateAgent('a1', { model: 'claude-3' }); });
    expect(mockUpdateAgent).toHaveBeenCalledWith('a1', { model: 'claude-3' });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/agents/a1' && (c[1] as RequestInit)?.method === 'PATCH',
    );
    expect(call).toBeDefined();
  });

  it('fetchGroups calls correct endpoint', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.fetchGroups('lead-1'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/lead/lead-1/groups',
    );
    expect(call).toBeDefined();
  });

  it('fetchGroupMessages encodes group name', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.fetchGroupMessages('lead-1', 'my group'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('/groups/my%20group/messages'),
    );
    expect(call).toBeDefined();
  });

  it('fetchDagStatus calls correct endpoint', async () => {
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    await act(async () => { await result.current.fetchDagStatus('lead-1'); });
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => c[0] === '/api/lead/lead-1/dag',
    );
    expect(call).toBeDefined();
  });

  it('initial load errors do not crash', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useApi());
    await act(async () => {});
    expect(result.current.spawnAgent).toBeDefined();
  });
});
