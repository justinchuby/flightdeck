/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// Mock Toast store
vi.mock('../../Toast', () => ({
  useToastStore: vi.fn((selector: any) => selector({ add: vi.fn() })),
}));

import { KnowledgePanel } from '../KnowledgePanel';

const sampleEntries = [
  {
    id: 1,
    projectId: 'proj-1',
    category: 'core' as const,
    key: 'agent-identity',
    content: 'This project uses TypeScript and React.',
    metadata: { source: 'user', tags: ['setup'] },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-07T14:00:00Z',
  },
  {
    id: 2,
    projectId: 'proj-1',
    category: 'procedural' as const,
    key: 'git-workflow',
    content: 'Always use feature branches. Squash merge to main.',
    metadata: { source: 'agent', tags: ['git'] },
    createdAt: '2026-02-01T08:00:00Z',
    updatedAt: '2026-02-15T12:00:00Z',
  },
  {
    id: 3,
    projectId: 'proj-1',
    category: 'semantic' as const,
    key: 'api-conventions',
    content: 'REST endpoints use kebab-case. JSON responses.',
    metadata: { source: 'auto' },
    createdAt: '2026-03-01T08:00:00Z',
    updatedAt: '2026-03-05T12:00:00Z',
  },
];

const sampleStats = [
  { category: 'core', count: 1, limit: 20, readOnly: true },
  { category: 'episodic', count: 0, limit: 100, readOnly: false },
  { category: 'procedural', count: 1, limit: 200, readOnly: false },
  { category: 'semantic', count: 1, limit: 500, readOnly: false },
];

const sampleTraining = {
  totalCorrections: 5,
  totalFeedback: 12,
  positiveFeedback: 8,
  negativeFeedback: 4,
  topCorrectionTags: [{ tag: 'style', count: 3 }],
  topFeedbackTags: [{ tag: 'helpful', count: 5 }],
  agentStats: [{ agentId: 'abc12345', corrections: 2, positive: 3, negative: 1 }],
};

function setupMocks() {
  mockApiFetch.mockImplementation((path: string, opts?: any) => {
    if (path === '/projects') return Promise.resolve([{ id: 'proj-1', name: 'Test Project', status: 'active' }]);
    if (path.endsWith('/knowledge') && !opts) return Promise.resolve(sampleEntries);
    if (path.includes('/knowledge/stats')) return Promise.resolve(sampleStats);
    if (path.includes('/knowledge/training')) return Promise.resolve(sampleTraining);
    if (path.includes('/knowledge/search')) return Promise.resolve([
      { entry: sampleEntries[2], fusedScore: 0.85, estimatedTokens: 20 },
    ]);
    return Promise.resolve([]);
  });
}

describe('KnowledgePanel', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders heading and loading state', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    expect(screen.getByText('Knowledge')).toBeTruthy();
  });

  it('renders entries after loading', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('agent-identity')).toBeTruthy();
      expect(screen.getByText('git-workflow')).toBeTruthy();
      expect(screen.getByText('api-conventions')).toBeTruthy();
    });
  });

  it('shows category stat cards', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      // Category names appear in both stat cards and tabs
      expect(screen.getAllByText('Core').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Episodic').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Procedural').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Semantic').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('filters by category when tab is clicked', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('agent-identity')).toBeTruthy();
    });

    // Click Procedural category stat card
    const buttons = screen.getAllByRole('button');
    const proceduralCard = buttons.find((b) => b.textContent?.includes('Procedural') && b.textContent?.includes('1'));
    expect(proceduralCard).toBeTruthy();
    fireEvent.click(proceduralCard!);

    // Should show only procedural entries
    await waitFor(() => {
      expect(screen.getByText('git-workflow')).toBeTruthy();
      expect(screen.queryByText('agent-identity')).toBeNull();
      expect(screen.queryByText('api-conventions')).toBeNull();
    });
  });

  it('expands entry to show details on click', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('agent-identity')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('agent-identity'));
    await waitFor(() => {
      // Content appears in both preview and expanded view
      const contentMatches = screen.getAllByText('This project uses TypeScript and React.');
      expect(contentMatches.length).toBeGreaterThanOrEqual(1);
      // Core entries show read-only badge
      expect(screen.getByText('read-only')).toBeTruthy();
    });
  });

  it('shows training overview tab', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Training')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Training'));
    await waitFor(() => {
      expect(screen.getByText('5')).toBeTruthy(); // totalCorrections
      expect(screen.getByText('12')).toBeTruthy(); // totalFeedback
      expect(screen.getByText('8')).toBeTruthy(); // positive
      expect(screen.getByText('4')).toBeTruthy(); // negative
    });
  });

  it('performs search and shows results', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('agent-identity')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search knowledge...');
    fireEvent.change(searchInput, { target: { value: 'api' } });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/knowledge/search?q=api'),
      );
    });
  });

  it('shows new entry form when Add Entry is clicked', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Add Entry')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Add Entry'));
    await waitFor(() => {
      expect(screen.getByText('New Knowledge Entry')).toBeTruthy();
      expect(screen.getByPlaceholderText('Knowledge content...')).toBeTruthy();
    });
  });

  it('creates a new entry via the form', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Add Entry')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Add Entry'));

    const keyInput = screen.getByPlaceholderText(/Key/);
    const contentInput = screen.getByPlaceholderText('Knowledge content...');
    fireEvent.change(keyInput, { target: { value: 'new-fact' } });
    fireEvent.change(contentInput, { target: { value: 'A new piece of knowledge' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/projects/proj-1/knowledge',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('new-fact'),
        }),
      );
    });
  });

  it('shows delete confirmation for non-core entries', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('git-workflow')).toBeTruthy();
    });

    // Expand procedural entry
    fireEvent.click(screen.getByText('git-workflow'));
    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    // Click Delete — should show confirmation
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => {
      expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
    });
  });

  it('does not show delete button for core entries', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('agent-identity')).toBeTruthy();
    });

    // Expand core entry
    fireEvent.click(screen.getByText('agent-identity'));
    await waitFor(() => {
      expect(screen.getByText('read-only')).toBeTruthy();
    });

    // Should NOT show Delete button for core (read-only) entries
    const deleteButtons = screen.queryAllByText('Delete');
    expect(deleteButtons.length).toBe(0);
  });

  it('loads projects when no projectId is provided', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel /></MemoryRouter>);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/projects');
    });
  });

  it('shows empty state when no entries', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/projects') return Promise.resolve([{ id: 'proj-1', name: 'Test', status: 'active' }]);
      if (path.endsWith('/knowledge')) return Promise.resolve([]);
      if (path.includes('/knowledge/stats')) return Promise.resolve([]);
      if (path.includes('/knowledge/training')) return Promise.resolve({ totalCorrections: 0, totalFeedback: 0, positiveFeedback: 0, negativeFeedback: 0, topCorrectionTags: [], topFeedbackTags: [], agentStats: [] });
      return Promise.resolve([]);
    });
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/No knowledge entries yet/)).toBeTruthy();
    });
  });

  // ── Page tab navigation ──────────────────────────────

  it('renders page tabs: Browse, Training, Memory', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-page-tabs')).toBeInTheDocument();
    });
    expect(screen.getByTestId('page-tab-browse')).toBeInTheDocument();
    expect(screen.getByTestId('page-tab-training')).toBeInTheDocument();
    expect(screen.getByTestId('page-tab-memory')).toBeInTheDocument();
  });

  it('switches to Training tab', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId('page-tab-training')).toBeInTheDocument();
    });
    // Category filter tabs are visible on Browse tab
    expect(screen.getByText('All')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('page-tab-training'));
    // After switching, category filter tabs should be gone (Browse hidden)
    await waitFor(() => {
      expect(screen.queryByText('All')).not.toBeInTheDocument();
    });
  });

  it('switches to Memory tab', async () => {
    setupMocks();
    render(<MemoryRouter><KnowledgePanel projectId="proj-1" /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByTestId('page-tab-memory')).toBeInTheDocument();
    });
    expect(screen.getByText('All')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('page-tab-memory'));
    // Browse content gone, category filter tabs hidden
    await waitFor(() => {
      expect(screen.queryByText('All')).not.toBeInTheDocument();
    });
  });
});
