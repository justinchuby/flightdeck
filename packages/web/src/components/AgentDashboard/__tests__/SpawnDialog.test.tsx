// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockSpawnAgent = vi.fn().mockResolvedValue({});

vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => ({ spawnAgent: mockSpawnAgent }),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ filteredModels: ['gpt-4', 'claude-3'] }),
  deriveModelName: (m: string) => m.toUpperCase(),
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([
    { id: 'openai', name: 'OpenAI', installed: true, authenticated: true, enabled: true },
    { id: 'anthropic', name: 'Anthropic', installed: true, authenticated: false, enabled: true },
  ]),
}));

import { useAppStore } from '../../../stores/appStore';
import { SpawnDialog } from '../SpawnDialog';

describe('SpawnDialog', () => {
  beforeEach(() => {
    useAppStore.getState().setRoles([
      { id: 'developer', name: 'Developer', icon: '\ud83d\udcbb', description: 'Writes code' },
      { id: 'tester', name: 'Tester', icon: '\ud83e\uddea', description: 'Tests code' },
    ]);
    mockSpawnAgent.mockClear();
  });

  it('renders with role options', async () => {
    await act(async () => { render(<SpawnDialog onClose={vi.fn()} />); });
    expect(screen.getByText('Spawn Agent')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Tester')).toBeInTheDocument();
  });

  it('selects a role', async () => {
    await act(async () => { render(<SpawnDialog onClose={vi.fn()} />); });
    fireEvent.click(screen.getByText('Tester'));
    // Tester should be visually selected (radio button)
    const radios = document.querySelectorAll('input[type="radio"]');
    const testerRadio = Array.from(radios).find((r: any) => r.value === 'tester') as HTMLInputElement;
    expect(testerRadio?.checked).toBe(true);
  });

  it('shows advanced options when toggled', async () => {
    await act(async () => { render(<SpawnDialog onClose={vi.fn()} />); });
    fireEvent.click(screen.getByText('Advanced options'));
    await waitFor(() => {
      expect(screen.getByText('Provider')).toBeInTheDocument();
    });
    // Provider options
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText(/Anthropic.*not authenticated/)).toBeInTheDocument();
  });

  it('spawns agent on click', async () => {
    const onClose = vi.fn();
    await act(async () => { render(<SpawnDialog onClose={onClose} />); });
    fireEvent.click(screen.getByText('Spawn'));
    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith('developer', undefined, undefined);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error on spawn failure', async () => {
    mockSpawnAgent.mockRejectedValueOnce(new Error('Network error'));
    await act(async () => { render(<SpawnDialog onClose={vi.fn()} />); });
    fireEvent.click(screen.getByText('Spawn'));
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows loading state during spawn', async () => {
    let resolve: () => void;
    mockSpawnAgent.mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    await act(async () => { render(<SpawnDialog onClose={vi.fn()} />); });
    fireEvent.click(screen.getByText('Spawn'));
    await waitFor(() => {
      expect(screen.getByText('Spawning...')).toBeInTheDocument();
    });
    await act(async () => resolve!());
  });

  it('closes on cancel click', async () => {
    const onClose = vi.fn();
    await act(async () => { render(<SpawnDialog onClose={onClose} />); });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes provider and model in advanced options', async () => {
    const onClose = vi.fn();
    await act(async () => { render(<SpawnDialog onClose={onClose} />); });
    fireEvent.click(screen.getByText('Advanced options'));
    await waitFor(() => screen.getByText('Provider'));
    // Select provider
    const providerSelect = screen.getByText('Provider').closest('div')?.querySelector('select');
    if (providerSelect) fireEvent.change(providerSelect, { target: { value: 'openai' } });
    // Select model
    const modelSelect = screen.getByText('Model').closest('div')?.querySelector('select');
    if (modelSelect) fireEvent.change(modelSelect, { target: { value: 'gpt-4' } });
    fireEvent.click(screen.getByText('Spawn'));
    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith('developer', undefined, { provider: 'openai', model: 'gpt-4' });
    });
  });
});
