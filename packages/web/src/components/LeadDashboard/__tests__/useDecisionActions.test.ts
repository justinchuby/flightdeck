// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockUpdateDecision = vi.fn();
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: { getState: () => ({ updateDecision: mockUpdateDecision }) },
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useDecisionActions } from '../useDecisionActions';

describe('useDecisionActions', () => {
  beforeEach(() => {
    mockUpdateDecision.mockClear();
    mockApiFetch.mockReset();
  });

  it('returns three action handlers', () => {
    const { result } = renderHook(() => useDecisionActions('lead-1'));
    expect(result.current.handleConfirmDecision).toBeTypeOf('function');
    expect(result.current.handleRejectDecision).toBeTypeOf('function');
    expect(result.current.handleDismissDecision).toBeTypeOf('function');
  });

  it('handleConfirmDecision sends POST and updates store', async () => {
    mockApiFetch.mockResolvedValue({ status: 'confirmed', confirmedAt: '2024-01-01T00:00:00Z' });
    const { result } = renderHook(() => useDecisionActions('lead-1'));
    await act(async () => {
      await result.current.handleConfirmDecision('d1', 'approved');
    });
    // Optimistic update
    expect(mockUpdateDecision).toHaveBeenCalledWith('lead-1', 'd1', expect.objectContaining({ status: 'confirmed' }));
    // API call
    expect(mockApiFetch).toHaveBeenCalledWith('/decisions/d1/confirm', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'approved' }),
    }));
    // Final update from server
    expect(mockUpdateDecision).toHaveBeenCalledWith('lead-1', 'd1', { status: 'confirmed', confirmedAt: '2024-01-01T00:00:00Z' });
  });

  it('handleRejectDecision sends POST and updates store', async () => {
    mockApiFetch.mockResolvedValue({ status: 'rejected', confirmedAt: '2024-01-01T00:00:00Z' });
    const { result } = renderHook(() => useDecisionActions('lead-1'));
    await act(async () => {
      await result.current.handleRejectDecision('d1', 'bad idea');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/decisions/d1/reject', expect.objectContaining({
      method: 'POST',
    }));
    expect(mockUpdateDecision).toHaveBeenCalledWith('lead-1', 'd1', expect.objectContaining({ status: 'rejected' }));
  });

  it('handleDismissDecision sends POST', async () => {
    mockApiFetch.mockResolvedValue({ status: 'dismissed', confirmedAt: '2024-01-01T00:00:00Z' });
    const { result } = renderHook(() => useDecisionActions('lead-1'));
    await act(async () => {
      await result.current.handleDismissDecision('d1');
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/decisions/d1/dismiss', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('no-ops when selectedLeadId is null', async () => {
    const { result } = renderHook(() => useDecisionActions(null));
    await act(async () => {
      await result.current.handleConfirmDecision('d1');
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockUpdateDecision).not.toHaveBeenCalled();
  });
});
