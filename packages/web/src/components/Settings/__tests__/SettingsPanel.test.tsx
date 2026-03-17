// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';

// Mock all child components and hooks
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      config: { maxConcurrentAgents: 5 },
      roles: [
        { id: 'developer', name: 'Developer', icon: '🛠️', color: '#3b82f6', description: 'Writes code', systemPrompt: 'You are a dev', builtIn: true },
        { id: 'custom', name: 'Custom', icon: '🤖', color: '#888', description: 'Custom role', systemPrompt: 'Custom prompt', builtIn: false },
      ],
    }),
}));

const mockToggleSound = vi.fn();
const mockSetOversightLevel = vi.fn();
const mockSetThemeMode = vi.fn();

const mockSettingsState: Record<string, unknown> = {
  soundEnabled: true,
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

const mockApi = { updateConfig: vi.fn(), createRole: vi.fn(), deleteRole: vi.fn() };
vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => mockApi,
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

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
});
afterEach(cleanup);

describe('SettingsPanel', () => {
  it('renders Settings heading', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders theme buttons', () => {
    render(<SettingsPanel />);
    expect(screen.getByLabelText('Set theme to Light')).toBeDefined();
    expect(screen.getByLabelText('Set theme to Dark')).toBeDefined();
    expect(screen.getByLabelText('Set theme to System')).toBeDefined();
  });

  it('renders max agents slider', () => {
    render(<SettingsPanel />);
    expect(screen.getByLabelText('Maximum concurrent agents')).toBeDefined();
  });

  it('renders sound toggle', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Enable sound alerts')).toBeDefined();
  });

  it('renders oversight level options', () => {
    render(<SettingsPanel />);
    expect(screen.getByTestId('oversight-supervised')).toBeDefined();
    expect(screen.getByTestId('oversight-balanced')).toBeDefined();
    expect(screen.getByTestId('oversight-autonomous')).toBeDefined();
  });

  it('renders child sections', () => {
    render(<SettingsPanel />);
    expect(screen.getByTestId('providers-section')).toBeDefined();
    expect(screen.getByTestId('telegram-settings')).toBeDefined();
    expect(screen.getByTestId('data-management')).toBeDefined();
  });

  it('renders agent roles list', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Developer')).toBeDefined();
    expect(screen.getByText('Custom')).toBeDefined();
  });

  it('shows delete button only for custom roles', () => {
    render(<SettingsPanel />);
    // Custom role has a delete button, built-in does not
    const deleteButtons = screen.getAllByLabelText(/Delete role/);
    expect(deleteButtons.length).toBe(1);
    expect(screen.getByLabelText('Delete role Custom')).toBeDefined();
  });

  it('shows Add Custom Role button', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Add Custom Role')).toBeDefined();
  });

  it('toggles role form on button click', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByText('Add Custom Role'));
    expect(screen.getByLabelText('Role ID')).toBeDefined();
    expect(screen.getByLabelText('Role display name')).toBeDefined();
  });

  it('expands role to show system prompt', () => {
    render(<SettingsPanel />);
    fireEvent.click(screen.getByLabelText('Developer role details'));
    expect(screen.getByText('System Prompt')).toBeDefined();
    expect(screen.getByText('You are a dev')).toBeDefined();
  });

  it('renders footer with attribution', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('@justinchuby')).toBeDefined();
  });
});
