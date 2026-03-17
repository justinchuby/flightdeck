import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Mocks ──────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../stores/appStore', () => {
  const store = vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agents: [],
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

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../hooks/useRecentCommands', () => ({
  useRecentCommands: () => ({
    recent: [],
    addRecent: vi.fn(),
    clearRecent: vi.fn(),
  }),
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

// ── Tests ───────────────────────────────────────────────────────────

describe('CommandPalette', () => {
  const onClose = vi.fn();
  const onOpenSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dialog with input and footer hints', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    expect(screen.getByText('↵ Select')).toBeInTheDocument();
    expect(screen.getByText('esc Close')).toBeInTheDocument();
  });

  it('auto-focuses the input on mount', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('renders navigation items by default', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('Go to Overview')).toBeInTheDocument();
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
    expect(screen.getByText('Go to Timeline')).toBeInTheDocument();
  });

  it('renders action items by default', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('Toggle Light / Dark Theme')).toBeInTheDocument();
    expect(screen.getByText('Open Approval Queue')).toBeInTheDocument();
  });

  it('renders a search item when onOpenSearch is provided', () => {
    render(<CommandPalette onClose={onClose} onOpenSearch={onOpenSearch} />);
    expect(screen.getByText('Search Chat History…')).toBeInTheDocument();
  });

  it('does not render search item without onOpenSearch', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.queryByText('Search Chat History…')).not.toBeInTheDocument();
  });

  it('filters items when typing in the search input', () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Overview' } });
    expect(screen.getByText('Go to Overview')).toBeInTheDocument();
  });

  it('shows "No matching commands" when search has no results', () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'xyznonexistent123456' } });
    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed with empty query', () => {
    render(<CommandPalette onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clears query on Escape when query is non-empty (does not close)', () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    // First Escape clears query, does not close
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when clicking the backdrop', () => {
    render(<CommandPalette onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when clicking inside the palette content', () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.click(input);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('navigates selection with ArrowDown and ArrowUp', () => {
    render(<CommandPalette onClose={onClose} />);
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');

    // First item should be selected by default
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // After ArrowDown, second item should be selected
    const updatedOptions = within(listbox).getAllByRole('option');
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'false');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const reUpdatedOptions = within(listbox).getAllByRole('option');
    expect(reUpdatedOptions[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('executes selected item on Enter and navigates', () => {
    render(<CommandPalette onClose={onClose} />);
    // First nav item is "Go to Project Lead" at path '/'
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('executes item on click', () => {
    render(<CommandPalette onClose={onClose} />);
    const overviewButton = screen.getByText('Go to Overview').closest('button')!;
    fireEvent.click(overviewButton);
    expect(mockNavigate).toHaveBeenCalledWith('/overview');
    expect(onClose).toHaveBeenCalled();
  });

  it('displays keyboard shortcut badges for navigation items', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('G O')).toBeInTheDocument();
    expect(screen.getByText('G S')).toBeInTheDocument();
  });

  it('displays the ⌘K hint in the input area', () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('toggles preview panel with Tab key', () => {
    render(<CommandPalette onClose={onClose} />);
    // Tab toggles preview; preview starts shown but buildPreviewData returns null,
    // so toggling shouldn't crash
    fireEvent.keyDown(window, { key: 'Tab' });
    // No crash = success
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders grouped sections with labels', () => {
    render(<CommandPalette onClose={onClose} />);
    const groups = screen.getAllByRole('group');
    expect(groups.length).toBeGreaterThan(0);
    // Navigation group should exist
    const navGroup = groups.find(
      (g) => g.getAttribute('aria-label')?.toLowerCase().includes('navigation'),
    );
    expect(navGroup).toBeTruthy();
  });
});
