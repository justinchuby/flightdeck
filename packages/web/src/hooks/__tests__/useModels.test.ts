import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useModels, _resetModelsCache, deriveModelName } from '../useModels';

const mockApiFetch = vi.fn();
vi.mock('../useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

describe('useModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetModelsCache();
  });

  const MOCK_RESPONSE = {
    models: ['claude-opus-4-6', 'claude-sonnet-4-5', 'gpt-5.1', 'gemini-3-pro-preview'],
    defaults: { lead: ['claude-opus-4-6'] },
    modelsByProvider: {
      claude: ['claude-opus-4-6', 'claude-sonnet-4-5'],
      copilot: ['gpt-5.1'],
      gemini: ['gemini-3-pro-preview'],
    },
    activeProvider: 'claude',
  };

  it('returns filteredModels containing only models from the active provider', async () => {
    mockApiFetch.mockResolvedValue(MOCK_RESPONSE);

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeProvider).toBe('claude');
    expect(result.current.filteredModels).toEqual(['claude-opus-4-6', 'claude-sonnet-4-5']);
    // Full models list is still available
    expect(result.current.models).toEqual(MOCK_RESPONSE.models);
  });

  it('returns all models when activeProvider is missing from response', async () => {
    mockApiFetch.mockResolvedValue({
      models: ['claude-opus-4-6', 'gpt-5.1'],
      defaults: {},
    });

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Falls back to 'copilot' when no activeProvider, but no modelsByProvider means all shown
    expect(result.current.filteredModels).toEqual(['claude-opus-4-6', 'gpt-5.1']);
  });

  it('returns all models as filteredModels when modelsByProvider has no entry for activeProvider', async () => {
    mockApiFetch.mockResolvedValue({
      models: ['claude-opus-4-6', 'gpt-5.1'],
      defaults: {},
      modelsByProvider: { gemini: ['gemini-3-pro-preview'] },
      activeProvider: 'claude',
    });

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // No claude entry in modelsByProvider → falls back to all models
    expect(result.current.filteredModels).toEqual(['claude-opus-4-6', 'gpt-5.1']);
  });

  it('exposes modelsByProvider and activeProvider', async () => {
    mockApiFetch.mockResolvedValue(MOCK_RESPONSE);

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.modelsByProvider).toEqual(MOCK_RESPONSE.modelsByProvider);
    expect(result.current.activeProvider).toBe('claude');
  });
});

describe('deriveModelName', () => {
  it('capitalizes model name parts', () => {
    expect(deriveModelName('claude-opus-4-6')).toBe('Claude Opus 4.6');
    expect(deriveModelName('gpt-5.3-codex')).toBe('GPT 5.3 Codex');
    expect(deriveModelName('gemini-3-pro-preview')).toBe('Gemini 3 Pro Preview');
  });
});
