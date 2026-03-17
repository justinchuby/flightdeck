import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock useWebSocket before importing the context
vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({
    connected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  })),
}));

import { WebSocketProvider, useWebSocketContext } from '../WebSocketContext';

describe('WebSocketContext', () => {
  it('throws when useWebSocketContext is used outside WebSocketProvider', () => {
    expect(() => {
      renderHook(() => useWebSocketContext());
    }).toThrow('useWebSocketContext must be used within a WebSocketProvider');
  });

  it('provides ws value inside WebSocketProvider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WebSocketProvider>{children}</WebSocketProvider>
    );

    const { result } = renderHook(() => useWebSocketContext(), { wrapper });
    expect(result.current).toBeDefined();
    expect(typeof result.current).toBe('object');
  });
});
