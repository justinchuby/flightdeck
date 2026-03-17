// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { ModelConfigPanel } from '../ModelConfigPanel';

/* ── Mocks ─────────────────────────────────────────────────── */

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../hooks/useModels', () => ({
  deriveModelName: (id: string) => id.replace('claude-', '').replace('gpt-', 'GPT-'),
}));

vi.mock('../../../utils/providerColors', () => ({
  getProviderColors: () => ({ bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' }),
}));

vi.mock('@flightdeck/shared', () => ({
  getProvider: (id: string) => {
    if (id === 'anthropic') return { name: 'Anthropic', id: 'anthropic' };
    if (id === 'openai') return { name: 'OpenAI', id: 'openai' };
    return { name: id, id };
  },
}));

/* ── Fixtures ──────────────────────────────────────────────── */

const mockModelsResponse = {
  models: ['claude-sonnet-4', 'claude-haiku-4', 'gpt-4o'],
  defaults: {
    developer: ['claude-sonnet-4', 'gpt-4o'],
    architect: ['claude-sonnet-4'],
    'code-reviewer': ['claude-sonnet-4'],
    secretary: ['claude-haiku-4'],
  },
  modelsByProvider: {
    anthropic: ['claude-sonnet-4', 'claude-haiku-4'],
    openai: ['gpt-4o'],
  },
};

const mockConfigResponse = {
  config: { developer: ['claude-sonnet-4', 'gpt-4o'], architect: ['claude-sonnet-4'] },
  defaults: { developer: ['claude-sonnet-4', 'gpt-4o'], architect: ['claude-sonnet-4'] },
};

/* ── Helpers ───────────────────────────────────────────────── */

interface MockOverrides {
  modelsResponse?: unknown;
  modelsError?: Error;
  configResponse?: unknown;
  configError?: Error;
  putResult?: unknown;
  putError?: Error;
}

function setupMocks(overrides?: MockOverrides) {
  mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    if (opts?.method === 'PUT') {
      if (overrides?.putError) return Promise.reject(overrides.putError);
      return Promise.resolve(overrides?.putResult ?? {});
    }
    if (url === '/models') {
      if (overrides?.modelsError) return Promise.reject(overrides.modelsError);
      return Promise.resolve(overrides?.modelsResponse ?? mockModelsResponse);
    }
    if (url.includes('/model-config')) {
      if (overrides?.configError) return Promise.reject(overrides.configError);
      return Promise.resolve(overrides?.configResponse ?? mockConfigResponse);
    }
    return Promise.resolve({});
  });
}

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.queryByText('Loading models...')).toBeNull();
  });
}

/** Get the container div for a given role display name. */
function getRoleSection(roleName: string): HTMLElement {
  return screen.getByText(roleName).parentElement!;
}

/** Check whether a model toggle button is in selected (highlighted) state. */
function isSelected(button: HTMLElement): boolean {
  return button.className.includes('bg-yellow-600/20');
}

/* ── Setup / Teardown ──────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

afterEach(cleanup);

/* ── Tests ─────────────────────────────────────────────────── */

describe('ModelConfigPanel – Extended', () => {
  // ─── Model toggle ──────────────────────────────────────────

  describe('Model toggle', () => {
    it('removes a selected model when more than one is selected', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      const sonnetBtn = within(section).getByTitle('sonnet-4');
      expect(isSelected(sonnetBtn)).toBe(true);

      fireEvent.click(sonnetBtn);
      expect(isSelected(sonnetBtn)).toBe(false);
    });

    it('adds an unselected model when clicked', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      const haikuBtn = within(section).getByTitle('haiku-4');
      expect(isSelected(haikuBtn)).toBe(false);

      fireEvent.click(haikuBtn);
      expect(isSelected(haikuBtn)).toBe(true);
    });

    it('cannot remove the last selected model for a role', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Architect');
      const sonnetBtn = within(section).getByTitle('sonnet-4');
      expect(isSelected(sonnetBtn)).toBe(true);

      fireEvent.click(sonnetBtn);
      expect(isSelected(sonnetBtn)).toBe(true);
      // Config unchanged → no dirty state
      expect(screen.queryByTestId('save-config')).toBeNull();
    });
  });

  // ─── Provider tabs ─────────────────────────────────────────

  describe('Provider tabs', () => {
    it('clicking Anthropic tab shows only Anthropic models', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));

      const section = getRoleSection('Developer');
      expect(within(section).queryByTitle('sonnet-4')).not.toBeNull();
      expect(within(section).queryByTitle('haiku-4')).not.toBeNull();
      expect(within(section).queryByTitle('GPT-4o')).toBeNull();
    });

    it('switching to OpenAI tab hides Anthropic models', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));

      const section = getRoleSection('Developer');
      expect(within(section).queryByTitle('GPT-4o')).not.toBeNull();
      expect(within(section).queryByTitle('sonnet-4')).toBeNull();
      expect(within(section).queryByTitle('haiku-4')).toBeNull();
    });
  });

  // ─── Save / Cancel / Reset ─────────────────────────────────

  describe('Save / Cancel / Reset flow', () => {
    it('toggling a model makes config dirty and shows Save & Cancel', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      expect(screen.queryByTestId('save-config')).toBeNull();
      expect(screen.queryByTestId('discard-changes')).toBeNull();

      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));

      expect(screen.getByTestId('save-config')).toBeDefined();
      expect(screen.getByTestId('discard-changes')).toBeDefined();
    });

    it('save button calls PUT with the current config', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));
      fireEvent.click(screen.getByTestId('save-config'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/projects/p1/model-config',
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('claude-haiku-4'),
          }),
        );
      });
    });

    it('shows "Saved" text briefly after successful save', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));
      fireEvent.click(screen.getByTestId('save-config'));

      await waitFor(() => {
        const saveBtn = screen.getByTestId('save-config');
        expect(saveBtn.textContent).toContain('Saved');
      });
    });

    it('cancel/discard reverts config to last saved state', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      const haikuBtn = within(section).getByTitle('haiku-4');
      expect(isSelected(haikuBtn)).toBe(false);

      fireEvent.click(haikuBtn);
      expect(isSelected(haikuBtn)).toBe(true);

      fireEvent.click(screen.getByTestId('discard-changes'));
      expect(isSelected(haikuBtn)).toBe(false);
    });

    it('reset to defaults applies default config', async () => {
      setupMocks({
        configResponse: {
          config: { developer: ['claude-sonnet-4'], architect: ['claude-sonnet-4'] },
          defaults: { developer: ['claude-sonnet-4', 'gpt-4o'], architect: ['claude-sonnet-4'] },
        },
      });
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      const gptBtn = within(section).getByTitle('GPT-4o');
      expect(isSelected(gptBtn)).toBe(false);

      fireEvent.click(screen.getByTitle('Reset to defaults'));

      expect(isSelected(gptBtn)).toBe(true);
    });
  });

  // ─── Error states ──────────────────────────────────────────

  describe('Error states', () => {
    it('shows error when models fetch fails', async () => {
      setupMocks({ modelsError: new Error('Network error') });
      render(<ModelConfigPanel />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load models')).toBeDefined();
      });
    });

    it('shows inline error when project config fetch fails', async () => {
      setupMocks({ configError: new Error('Config error') });
      render(<ModelConfigPanel projectId="p1" />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load project model config')).toBeDefined();
      });
      // Component still renders roles since models loaded
      expect(screen.getByText('Developer')).toBeDefined();
    });

    it('shows error message when save fails', async () => {
      setupMocks({ putError: new Error('Save failed') });
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));
      fireEvent.click(screen.getByTestId('save-config'));

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeDefined();
      });
    });
  });

  // ─── Inline mode (value + onChange, no projectId) ──────────

  describe('Inline mode', () => {
    it('uses value prop as initial config', async () => {
      render(
        <ModelConfigPanel
          value={{ developer: ['claude-sonnet-4'], architect: ['gpt-4o'] }}
          onChange={vi.fn()}
        />,
      );
      await waitForLoaded();

      const devSection = getRoleSection('Developer');
      expect(isSelected(within(devSection).getByTitle('sonnet-4'))).toBe(true);
      expect(isSelected(within(devSection).getByTitle('GPT-4o'))).toBe(false);
    });

    it('calls onChange when a model is toggled', async () => {
      const onChange = vi.fn();
      render(
        <ModelConfigPanel
          value={{ developer: ['claude-sonnet-4', 'gpt-4o'] }}
          onChange={onChange}
        />,
      );
      await waitForLoaded();

      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          developer: expect.arrayContaining(['claude-sonnet-4', 'gpt-4o', 'claude-haiku-4']),
        }),
      );
    });

    it('does not render Save/Cancel buttons without projectId', async () => {
      render(
        <ModelConfigPanel
          value={{ developer: ['claude-sonnet-4'] }}
          onChange={vi.fn()}
        />,
      );
      await waitForLoaded();

      // Toggle a model to ensure even dirty state doesn't show save/cancel
      const section = getRoleSection('Developer');
      fireEvent.click(within(section).getByTitle('haiku-4'));

      expect(screen.queryByTestId('save-config')).toBeNull();
      expect(screen.queryByTestId('discard-changes')).toBeNull();
      expect(screen.queryByText('Model Allowlist')).toBeNull();
    });
  });

  // ─── Compact mode ──────────────────────────────────────────

  describe('Compact mode', () => {
    it('renders shortened model names in compact mode', async () => {
      render(<ModelConfigPanel projectId="p1" compact />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      // Compact: 'gpt-4o'.replace('gpt-', 'g') → 'g4o'
      const gptButton = within(section).getByTitle('GPT-4o');
      expect(gptButton.textContent).toBe('g4o');

      // Compact: 'claude-sonnet-4'.replace('claude-', '') → 'sonnet-4'
      const sonnetButton = within(section).getByTitle('sonnet-4');
      expect(sonnetButton.textContent).toBe('sonnet-4');
    });
  });

  // ─── configsEqual (via dirty detection) ────────────────────

  describe('configsEqual via dirty detection', () => {
    it('toggle-then-untoggle returns to clean state', async () => {
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      const section = getRoleSection('Developer');
      const haikuBtn = within(section).getByTitle('haiku-4');

      // Toggle ON → dirty
      fireEvent.click(haikuBtn);
      expect(screen.getByTestId('save-config')).toBeDefined();

      // Toggle OFF → back to saved config → clean
      fireEvent.click(haikuBtn);
      expect(screen.queryByTestId('save-config')).toBeNull();
    });

    it('detects configs with different keys as not equal', async () => {
      // savedConfig has 1 key (developer), defaults has 3 keys
      setupMocks({
        configResponse: {
          config: { developer: ['claude-sonnet-4'] },
          defaults: {
            developer: ['claude-sonnet-4'],
            architect: ['claude-sonnet-4'],
            secretary: ['claude-haiku-4'],
          },
        },
      });
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      expect(screen.queryByTestId('save-config')).toBeNull();

      // Reset to defaults adds new keys → configsEqual returns false → dirty
      fireEvent.click(screen.getByTitle('Reset to defaults'));
      expect(screen.getByTestId('save-config')).toBeDefined();
    });
  });

  // ─── Provider tab filtering ────────────────────────────────

  describe('Provider tab filtering', () => {
    it('hides provider tabs whose models are absent from allModels', async () => {
      setupMocks({
        modelsResponse: {
          models: ['claude-sonnet-4'],
          defaults: { developer: ['claude-sonnet-4'] },
          modelsByProvider: {
            anthropic: ['claude-sonnet-4'],
            openai: ['gpt-4o'], // gpt-4o is NOT in models[]
          },
        },
      });
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      expect(screen.getByRole('button', { name: /Anthropic/ })).toBeDefined();
      expect(screen.queryByRole('button', { name: /OpenAI/ })).toBeNull();
    });
  });

  // ─── Fallback "All" tab ────────────────────────────────────

  describe('Fallback "All" tab', () => {
    it('shows All tab when modelsByProvider is absent', async () => {
      setupMocks({
        modelsResponse: {
          models: ['model-a', 'model-b'],
          defaults: { developer: ['model-a'] },
          // no modelsByProvider
        },
      });
      render(<ModelConfigPanel projectId="p1" />);
      await waitForLoaded();

      expect(screen.getByText(/^All/)).toBeDefined();
    });
  });
});
