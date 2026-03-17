// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

Element.prototype.scrollIntoView = vi.fn();

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

vi.mock('../../../stores/appStore', () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agents: [
        { id: 'agent-1', role: { id: 'coder', name: 'Coder' }, status: 'running', task: 'Fix bug', parentId: null },
        { id: 'agent-2', role: { id: 'tester', name: 'Tester' }, status: 'idle', task: null, parentId: null },
      ],
      pendingDecisions: [],
      setApprovalQueueOpen: vi.fn(),
    }),
  );
  store.getState = () => ({
    agents: [],
    pendingDecisions: [],
    setApprovalQueueOpen: vi.fn(),
  });
  return { useAppStore: store };
});

vi.mock('../../../stores/leadStore', () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ projects: {}, selectedLeadId: null }),
  );
  store.getState = () => ({ projects: {}, selectedLeadId: null });
  return { useLeadStore: store };
});

vi.mock('../../../stores/settingsStore', () => {
  const store = vi.fn(() => ({}));
  store.getState = () => ({ resolvedTheme: 'dark', setThemeMode: vi.fn() });
  return { useSettingsStore: store };
});

vi.mock('../../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../hooks/useRecentCommands', () => ({
  useRecentCommands: () => ({ recent: [], addRecent: vi.fn(), clearRecent: vi.fn() }),
}));
vi.mock('../../../services/PaletteSuggestionEngine', () => ({
  generateSuggestions: () => [],
}));
vi.mock('../../../services/NLCommandRegistry', () => ({
  getNLPaletteItems: () => [],
}));
vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));
vi.mock('../PreviewPanel', () => ({
  PreviewPanel: ({ data }: { data: unknown }) =>
    data ? <div data-testid="preview-panel">Preview</div> : null,
  buildPreviewData: () => null,
}));

import { CommandPalette } from '../CommandPalette';

describe('CommandPalette — extra coverage', () => {
  const onClose = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders agent items from store', () => {
    render(<CommandPalette onClose={onClose} />);
    // Agent items should include the Coder and Tester agents
    expect(screen.getByText(/Coder/)).toBeInTheDocument();
    expect(screen.getByText(/Tester/)).toBeInTheDocument();
  });

  it('shows running badge for running agents', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('● running')).toBeInTheDocument();
  });

  it('filters agent results by name', () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Coder' } });
    expect(screen.getByText(/Coder/)).toBeInTheDocument();
  });

  it('mouseEnter on item updates selection', () => {
    render(<CommandPalette onClose={onClose} />);
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // Hover over second item
    fireEvent.mouseEnter(options[1]);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUp does not go below 0', () => {
    render(<CommandPalette onClose={onClose} />);
    // Pressing ArrowUp at index 0 should stay at 0
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowDown does not exceed list length', () => {
    render(<CommandPalette onClose={onClose} />);
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // Press ArrowDown many times
    for (let i = 0; i < options.length + 5; i++) {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    }
    const updatedOptions = within(listbox).getAllByRole('option');
    const lastOption = updatedOptions[updatedOptions.length - 1];
    expect(lastOption).toHaveAttribute('aria-selected', 'true');
  });

  it('renders footer hints', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('↑↓ Navigate')).toBeInTheDocument();
    expect(screen.getByText('↵ Select')).toBeInTheDocument();
    expect(screen.getByText('⇥ Preview')).toBeInTheDocument();
    expect(screen.getByText('esc Close')).toBeInTheDocument();
  });

  it('renders setting items', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
    expect(screen.getByText('Model Configuration')).toBeInTheDocument();
  });

  it('clicking an option executes its action', () => {
    render(<CommandPalette onClose={onClose} />);
    const settingsButton = screen.getByText('Go to Settings').closest('button')!;
    fireEvent.click(settingsButton);
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(onClose).toHaveBeenCalled();
  });
});
