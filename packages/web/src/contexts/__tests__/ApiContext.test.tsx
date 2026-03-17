import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock useApi before importing the context
vi.mock('../../hooks/useApi', () => ({
  useApi: vi.fn(() => ({
    fetchAgents: vi.fn(),
    fetchRoles: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  })),
  apiFetch: vi.fn(),
}));

import { ApiProvider, useApiContext } from '../ApiContext';

describe('ApiContext', () => {
  it('throws when useApiContext is used outside ApiProvider', () => {
    expect(() => {
      renderHook(() => useApiContext());
    }).toThrow('useApiContext must be used within an ApiProvider');
  });

  it('provides api value inside ApiProvider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider>{children}</ApiProvider>
    );

    const { result } = renderHook(() => useApiContext(), { wrapper });
    expect(result.current).toBeDefined();
    expect(typeof result.current).toBe('object');
  });
});
