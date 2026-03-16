// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';

/* ── Mocks ─────────────────────────────────────────────────── */

vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      config: { maxConcurrentAgents: 5 },
      roles: [
        { id: 'developer', name: 'Developer', icon: '🛠️', color: '#3b82f6', description: 'Writes code', systemPrompt: 'You are a dev', builtIn: true },
        { id: 'custom-role', name: 'Custom', icon: '🤖', color: '#888', description: 'Custom role', systemPrompt: 'Custom prompt', builtIn: false, model: 'gpt-4' },
      ],
    }),
}));

const mockToggleSound = vi.fn();
const mockSetOversightLevel = vi.fn();
const mockSetThemeMode = vi.fn();

const mockSettingsState: Record<string, unknown> = {
  soundEnabled: false,
  toggleSound: mockToggleSound,
  oversightLevel: 'balanced',
  setOversightLevel: mockSetOversightLevel,
  themeMode: 'dark',
  setThemeMode: mockSetThemeMode,
};

vi.mock('../../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) =>
      selector ? selector(mockSettingsState) : mockSettingsState,
    { getState: () => mockSettingsState, setState: vi.fn(), subscribe: vi.fn() },
  ),
}));

const mockApi = {
  updateConfig: vi.fn().mockResolvedValue({}),
  createRole: vi.fn().mockResolvedValue({}),
  deleteRole: vi.fn().mockResolvedValue({}),
};
vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => mockApi,
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

// Import after mock declaration so the hoisted mock is in place
import { apiFetch as mockApiFetchRaw } from '../../../hooks/useApi';
const mockApiFetch = mockApiFetchRaw as unknown as ReturnType<typeof vi.fn>;

vi.mock('../ProvidersSection', () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));
vi.mock('../TelegramSettings', () => ({
  TelegramSettings: () => <div data-testid="telegram-settings" />,
}));
vi.mock('../DataManagement', () => ({
  DataManagement: () => <div data-testid="data-management" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiFetch.mockResolvedValue({});
});
afterEach(cleanup);

/* ── Tests ─────────────────────────────────────────────────── */

describe('SettingsPanel — coverage', () => {
  /* Custom instructions load from /config/yaml */
  it('loads custom instructions from server on mount', async () => {
    mockApiFetch.mockResolvedValueOnce({
      oversight: { customInstructions: 'Be careful with DB' },
    });
    render(<SettingsPanel />);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/config/yaml');
    });
  });

  /* Custom instructions save on blur */
  it('saves custom instructions on textarea blur', async () => {
    mockApiFetch.mockResolvedValue({});
    render(<SettingsPanel />);
    const textarea = screen.getByPlaceholderText(/Optional: Add custom instructions/);
    fireEvent.change(textarea, { target: { value: 'New instructions' } });
    fireEvent.blur(textarea);
    await waitFor(() => {
      const patchCalls = mockApiFetch.mock.calls.filter(
        (c: unknown[]) => c[0] === '/config' && typeof c[1] === 'object',
      );
      expect(patchCalls.length).toBeGreaterThan(0);
    });
  });

  /* Character counter */
  it('shows character counter for custom instructions', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('0/500')).toBeDefined();
  });

  /* Instructions saved indicator */
  it('shows "Saved ✓" after saving custom instructions', async () => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue({});
    render(<SettingsPanel />);
    const textarea = screen.getByPlaceholderText(/Optional: Add custom instructions/);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.blur(textarea);
    await act(async () => {
      // Flush the PATCH promise
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Saved ✓')).toBeDefined();
    vi.useRealTimers();
  });

  /* Theme mode toggle */
  it('calls setThemeMode when clicking Light theme button', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Set theme to Light'));
    expect(mockSetThemeMode).toHaveBeenCalledWith('light');
  });

  it('calls setThemeMode when clicking System theme button', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Set theme to System'));
    expect(mockSetThemeMode).toHaveBeenCalledWith('system');
  });

  /* Max agents slider */
  it('calls updateConfig when changing max agents slider', () => {
    render(<SettingsPanel />);
    const slider = screen.getByLabelText('Maximum concurrent agents');
    fireEvent.change(slider, { target: { value: '20' } });
    expect(mockApi.updateConfig).toHaveBeenCalledWith({ maxConcurrentAgents: 20 });
  });

  /* Sound toggle */
  it('calls toggleSound when clicking sound toggle button', () => {
    render(<SettingsPanel />);
    const btn = screen.getByLabelText(/sound alerts/i);
    fireEvent.click(btn);
    expect(mockToggleSound).toHaveBeenCalled();
  });

  /* Oversight level change */
  it('calls setOversightLevel when selecting autonomous', () => {
    render(<SettingsPanel />);
    const autonomousRadio = screen.getByTestId('oversight-autonomous').querySelector('input[type="radio"]');
    fireEvent.click(autonomousRadio!);
    expect(mockSetOversightLevel).toHaveBeenCalledWith('autonomous');
  });

  it('calls setOversightLevel when selecting supervised', () => {
    render(<SettingsPanel />);
    const radio = screen.getByTestId('oversight-supervised').querySelector('input[type="radio"]');
    fireEvent.click(radio!);
    expect(mockSetOversightLevel).toHaveBeenCalledWith('supervised');
  });

  /* Custom instructions textarea onChange truncates at 500 */
  it('truncates custom instructions to 500 characters', () => {
    render(<SettingsPanel />);
    const textarea = screen.getByPlaceholderText(/Optional: Add custom instructions/) as HTMLTextAreaElement;
    const longText = 'x'.repeat(600);
    fireEvent.change(textarea, { target: { value: longText } });
    // The component slices to 500, but since the textarea is controlled by React state,
    // the DOM value reflects the state. We verify via the counter.
    expect(screen.getByText('500/500')).toBeDefined();
  });

  /* Role expansion shows system prompt */
  it('expands role to show system prompt', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Developer role details'));
    expect(screen.getByText('System Prompt')).toBeDefined();
    expect(screen.getByText('You are a dev')).toBeDefined();
  });

  it('collapses role when clicked again', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Developer role details'));
    expect(screen.getByText('System Prompt')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Developer role details'));
    expect(screen.queryByText('System Prompt')).toBeNull();
  });

  /* Role model display */
  it('displays role model badge for roles with model', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('gpt-4')).toBeDefined();
  });

  /* Delete custom role */
  it('calls deleteRole when clicking delete on a custom role', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Delete role Custom'));
    expect(mockApi.deleteRole).toHaveBeenCalledWith('custom-role');
  });

  /* Create role form */
  it('opens create role form and submits new role', async () => {
    render(<SettingsPanel />);
    // Open the form
    fireEvent.click(screen.getByText('Add Custom Role'));
    expect(screen.getByLabelText('Role ID')).toBeDefined();

    // Fill form fields
    fireEvent.change(screen.getByLabelText('Role ID'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByLabelText('Role display name'), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByLabelText('Role description'), { target: { value: 'Tests code' } });
    fireEvent.change(screen.getByLabelText('Role system prompt'), { target: { value: 'You test code' } });
    fireEvent.change(screen.getByLabelText('Role icon emoji'), { target: { value: '🧪' } });
    fireEvent.change(screen.getByLabelText('Role color'), { target: { value: '#ff0000' } });

    // Submit
    fireEvent.click(screen.getByText('Create Role'));
    await waitFor(() => {
      expect(mockApi.createRole).toHaveBeenCalledWith({
        id: 'tester',
        name: 'Tester',
        description: 'Tests code',
        systemPrompt: 'You test code',
        color: '#ff0000',
        icon: '🧪',
      });
    });
  });

  it('disables Create Role button when required fields are empty', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('Add Custom Role'));
    const createBtn = screen.getByText('Create Role');
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides role form when Cancel is clicked', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('Add Custom Role'));
    expect(screen.getByLabelText('Role ID')).toBeDefined();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByLabelText('Role ID')).toBeNull();
  });
});
