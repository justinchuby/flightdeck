import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks (must be before imports that use them) ────────────────────────────

vi.mock('../../hooks/useSpotlight', () => ({
  useSpotlight: () => ({ top: 100, left: 100, width: 200, height: 50 }),
}));

vi.mock('../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) =>
      selector({
        agents: [],
        pendingDecisions: [],
        config: null,
        connected: true,
        systemPaused: false,
        setApprovalQueueOpen: vi.fn(),
      }),
    { getState: () => ({ agents: [], pendingDecisions: [] }) },
  ),
}));

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (selector: any) =>
      selector({
        selectedLeadId: 'test-lead',
        projects: { 'test-lead': { dagStatus: null } },
      }),
    { getState: () => ({ selectedLeadId: 'test-lead' }) },
  ),
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { PaletteSearchEngine, type PaletteItem } from '../../services/PaletteSearchEngine';
import { generateSuggestions, type SuggestionInput } from '../../services/PaletteSuggestionEngine';
import {
  matchNLCommand,
  getNLPaletteItems,
  getAllPatterns,
} from '../../services/NLCommandRegistry';
import { undoStack } from '../../services/UndoStack';
import { useRecentCommands } from '../../hooks/useRecentCommands';
import { useProgressiveRoutes } from '../../hooks/useProgressiveRoutes';
import { SpotlightTour, isTourComplete, resetTour } from '../Onboarding/SpotlightTour';
import { QuickStart } from '../Onboarding/QuickStart';
import type { AgentInfo, Decision, DagTask, Role } from '../../types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes code',
    systemPrompt: '',
    color: '#3B82F6',
    icon: '💻',
    builtIn: true,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    role: makeRole(),
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    autopilot: true,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: `dec-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentRole: 'Developer',
    title: 'Should deploy?',
    rationale: 'Ready for prod',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeDagTask(overrides: Partial<DagTask> = {}): DagTask {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    leadId: 'lead-1',
    role: 'Developer',
    description: 'Implement feature',
    files: [],
    dependsOn: [],
    dagStatus: 'done',
    priority: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePaletteItem(overrides: Partial<PaletteItem> = {}): PaletteItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    type: 'action',
    label: 'Test Action',
    description: 'A test action',
    icon: '⚡',
    keywords: ['test'],
    action: vi.fn(),
    ...overrides,
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

// ── localStorage polyfill (jsdom may not provide a working one) ─────────────

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
  storage.clear();
  undoStack.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. PaletteSearchEngine
// ═══════════════════════════════════════════════════════════════════════════

describe('PaletteSearchEngine', () => {
  it('creates a Fuse instance and starts empty', () => {
    const engine = new PaletteSearchEngine();
    expect(engine.search('')).toEqual([]);
  });

  it('search("") returns all items after updateItems', () => {
    const engine = new PaletteSearchEngine();
    const items = [
      makePaletteItem({ id: 'a', label: 'Deploy' }),
      makePaletteItem({ id: 'b', label: 'Build' }),
    ];
    engine.updateItems(items);
    expect(engine.search('')).toHaveLength(2);
  });

  it('fuzzy search returns matching items', () => {
    const engine = new PaletteSearchEngine();
    engine.updateItems([
      makePaletteItem({ id: 'deploy', label: 'Deploy to production', keywords: ['deploy', 'prod'] }),
      makePaletteItem({ id: 'build', label: 'Build project', keywords: ['build', 'compile'] }),
      makePaletteItem({ id: 'test', label: 'Run tests', keywords: ['test', 'jest'] }),
    ]);
    const results = engine.search('deploy');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('deploy');
  });

  it('groupResults groups by type and caps per group', () => {
    const items = [
      makePaletteItem({ type: 'action', id: 'a1' }),
      makePaletteItem({ type: 'action', id: 'a2' }),
      makePaletteItem({ type: 'action', id: 'a3' }),
      makePaletteItem({ type: 'action', id: 'a4' }),
      makePaletteItem({ type: 'navigation', id: 'n1' }),
    ];
    const groups = PaletteSearchEngine.groupResults(items, 2);
    const actionGroup = groups.find(g => g.type === 'action')!;
    expect(actionGroup.items).toHaveLength(2); // capped at 2
    expect(actionGroup.total).toBe(4);         // but total shows 4
    expect(groups.find(g => g.type === 'navigation')).toBeDefined();
  });

  it('groupAll groups with no per-group cap', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makePaletteItem({ type: 'agent', id: `ag-${i}` }),
    );
    const groups = PaletteSearchEngine.groupAll(items);
    const agentGroup = groups.find(g => g.type === 'agent')!;
    expect(agentGroup.items).toHaveLength(5);
    expect(agentGroup.total).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PaletteSuggestionEngine
// ═══════════════════════════════════════════════════════════════════════════

describe('PaletteSuggestionEngine', () => {
  it('returns review suggestion when pendingDecisions > 0', () => {
    const input: SuggestionInput = {
      agents: [],
      pendingDecisions: [makeDecision()],
    };
    const suggestions = generateSuggestions(input);
    expect(suggestions.some(s => s.id === 'suggest-review-decisions')).toBe(true);
    expect(suggestions[0].label).toContain('1 pending decision');
  });

  it('returns context warning when agent at >85% context', () => {
    const input: SuggestionInput = {
      agents: [
        makeAgent({
          contextWindowSize: 100_000,
          contextWindowUsed: 90_000,
          role: makeRole({ name: 'Architect' }),
        }),
      ],
      pendingDecisions: [],
    };
    const suggestions = generateSuggestions(input);
    const ctxSuggestion = suggestions.find(s => s.id.startsWith('suggest-compact'));
    expect(ctxSuggestion).toBeDefined();
    expect(ctxSuggestion!.label).toContain('90%');
  });

  it('returns idle suggestion when 2+ idle agents', () => {
    const input: SuggestionInput = {
      agents: [
        makeAgent({ status: 'idle' }),
        makeAgent({ status: 'idle' }),
        makeAgent({ status: 'running' }),
      ],
      pendingDecisions: [],
    };
    const suggestions = generateSuggestions(input);
    expect(suggestions.some(s => s.id === 'suggest-idle-agents')).toBe(true);
  });

  it('returns all-done when all tasks are done', () => {
    const input: SuggestionInput = {
      agents: [],
      pendingDecisions: [],
      dagTasks: [makeDagTask({ dagStatus: 'done' }), makeDagTask({ dagStatus: 'done' })],
    };
    const suggestions = generateSuggestions(input);
    expect(suggestions.some(s => s.id === 'suggest-all-done')).toBe(true);
  });

  it('returns max 3 suggestions sorted by score', () => {
    const input: SuggestionInput = {
      agents: [
        makeAgent({ status: 'idle' }),
        makeAgent({ status: 'idle' }),
        makeAgent({ contextWindowSize: 100_000, contextWindowUsed: 95_000 }),
      ],
      pendingDecisions: [makeDecision()],
      dagTasks: [makeDagTask({ dagStatus: 'done' })],
    };
    const suggestions = generateSuggestions(input);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    // Verify sorted by descending score
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].score).toBeGreaterThanOrEqual(suggestions[i].score);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. NLCommandRegistry
// ═══════════════════════════════════════════════════════════════════════════

describe('NLCommandRegistry', () => {
  it('exact match: "wrap it up" → nl-wrap-up', () => {
    const match = matchNLCommand('wrap it up');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('nl-wrap-up');
  });

  it('starts-with match: "pause everything now" → nl-pause-all', () => {
    const match = matchNLCommand('pause everything now');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('nl-pause-all');
  });

  it('keyword overlap match', () => {
    // "tasks remaining progress" has 2/3 words overlapping with nl-tasks-left phrases
    const match = matchNLCommand('tasks remaining progress');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('nl-tasks-left');
  });

  it('returns null for non-matching input', () => {
    expect(matchNLCommand('banana smoothie recipe')).toBeNull();
  });

  it('returns null for very short input', () => {
    expect(matchNLCommand('hi')).toBeNull();
  });

  it('getNLPaletteItems returns 29 items', () => {
    const items = getNLPaletteItems(vi.fn());
    expect(items).toHaveLength(29);
    expect(items[0].type).toBe('nl-command');
  });

  it('getAllPatterns returns 29 patterns', () => {
    const patterns = getAllPatterns();
    expect(patterns).toHaveLength(29);
    expect(patterns[0]).toHaveProperty('id');
    expect(patterns[0]).toHaveProperty('phrases');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. UndoStack
// ═══════════════════════════════════════════════════════════════════════════

describe('UndoStack', () => {
  it('push/peek/pop basic operations', () => {
    undoStack.push('cmd-1', 'Approve all');
    undoStack.push('cmd-2', 'Pause agent');

    expect(undoStack.length).toBe(2);
    expect(undoStack.peek()?.commandId).toBe('cmd-2');

    const popped = undoStack.pop();
    expect(popped?.commandId).toBe('cmd-2');
    expect(undoStack.length).toBe(1);
  });

  it('TTL expiry removes old entries', () => {
    vi.useFakeTimers();
    undoStack.push('old-cmd', 'Old command');

    // Advance past the 5-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(undoStack.peek()).toBeNull();
    expect(undoStack.length).toBe(0);

    vi.useRealTimers();
  });

  it('clear() empties the stack', () => {
    undoStack.push('cmd-1', 'First');
    undoStack.push('cmd-2', 'Second');
    undoStack.clear();
    expect(undoStack.length).toBe(0);
    expect(undoStack.pop()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. useRecentCommands
// ═══════════════════════════════════════════════════════════════════════════

describe('useRecentCommands', () => {
  function TestHarness() {
    const { recent, addRecent, clearRecent } = useRecentCommands();
    return (
      <div>
        <span data-testid="count">{recent.length}</span>
        <ul>
          {recent.map(r => (
            <li key={r.id} data-testid={`item-${r.id}`}>{r.label}</li>
          ))}
        </ul>
        <button onClick={() => addRecent('cmd-a', 'Alpha', '⚡')}>Add A</button>
        <button onClick={() => addRecent('cmd-b', 'Beta', '🔥')}>Add B</button>
        <button onClick={() => addRecent('cmd-a', 'Alpha Updated', '⚡')}>Re-add A</button>
        <button onClick={clearRecent}>Clear</button>
      </div>
    );
  }

  it('addRecent adds to list', () => {
    render(<TestHarness />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    fireEvent.click(screen.getByText('Add A'));
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('deduplicates by id (moves to front)', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Add A'));
    fireEvent.click(screen.getByText('Add B'));
    fireEvent.click(screen.getByText('Re-add A'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    // Alpha Updated should be first (re-added moves to front)
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toBe('Alpha Updated');
  });

  it('clearRecent empties list', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Add A'));
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. SpotlightTour
// ═══════════════════════════════════════════════════════════════════════════

describe('SpotlightTour', () => {
  it('isTourComplete/resetTour use localStorage correctly', () => {
    expect(isTourComplete()).toBe(false);
    localStorage.setItem('onboarding-tour-complete', 'true');
    expect(isTourComplete()).toBe(true);
    resetTour();
    expect(isTourComplete()).toBe(false);
  });

  it('renders first step title', () => {
    render(<SpotlightTour onComplete={vi.fn()} />);
    expect(screen.getByText('The Pulse')).toBeInTheDocument();
  });

  it('has 6 progress dots', () => {
    const { container } = render(<SpotlightTour onComplete={vi.fn()} />);
    // The dots are small divs with rounded-full class inside the flex gap-1 container
    const dotContainer = container.querySelector('.flex.gap-1');
    expect(dotContainer).not.toBeNull();
    expect(dotContainer!.children).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. QuickStart
// ═══════════════════════════════════════════════════════════════════════════

describe('QuickStart', () => {
  const defaultProps = {
    onSelectTemplate: vi.fn(),
    onStartFromScratch: vi.fn(),
    onBrowseProjects: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 5 template cards', () => {
    render(<QuickStart {...defaultProps} />);
    // Each card has a "Start →" button
    const startButtons = screen.getAllByText('Start →');
    expect(startButtons).toHaveLength(5);
  });

  it('shows recommended badge on Quick Fix', () => {
    render(<QuickStart {...defaultProps} />);
    expect(screen.getByText('✨ Recommended')).toBeInTheDocument();
    expect(screen.getByText('Quick Fix')).toBeInTheDocument();
  });

  it('calls onSelectTemplate when Start is clicked', () => {
    render(<QuickStart {...defaultProps} />);
    const startButtons = screen.getAllByText('Start →');
    fireEvent.click(startButtons[0]); // Click the first template's Start
    expect(defaultProps.onSelectTemplate).toHaveBeenCalledWith('code-review');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. useProgressiveRoutes (tier computation)
// ═══════════════════════════════════════════════════════════════════════════

describe('useProgressiveRoutes', () => {
  // We can't easily mock the store per-test with top-level vi.mock,
  // so we test the tier logic by manipulating localStorage which
  // the hook checks via isManuallyExpanded() and getSessionCount().

  it('returns starter tier by default (no agents, no tasks, no overrides)', () => {
    function TestHarness() {
      const { tier, visibleRoutes, hiddenRoutes } = useProgressiveRoutes();
      return (
        <div>
          <span data-testid="tier">{tier}</span>
          <span data-testid="visible">{visibleRoutes.length}</span>
          <span data-testid="hidden">{hiddenRoutes.length}</span>
        </div>
      );
    }

    render(<TestHarness />);
    expect(screen.getByTestId('tier').textContent).toBe('starter');
    // Starter tier: 4 starter routes visible
    expect(screen.getByTestId('visible').textContent).toBe('4');
  });

  it('returns power tier when sidebar-routes-expanded is set', () => {
    localStorage.setItem('sidebar-routes-expanded', 'true');

    function TestHarness() {
      const { tier, visibleRoutes } = useProgressiveRoutes();
      return (
        <div>
          <span data-testid="tier">{tier}</span>
          <span data-testid="visible">{visibleRoutes.length}</span>
        </div>
      );
    }

    render(<TestHarness />);
    expect(screen.getByTestId('tier').textContent).toBe('power');
    // Power tier: all 12 routes visible
    expect(screen.getByTestId('visible').textContent).toBe('12');
  });

  it('returns power tier when session-count >= 3', () => {
    localStorage.setItem('session-count', '5');

    function TestHarness() {
      const { tier } = useProgressiveRoutes();
      return <span data-testid="tier">{tier}</span>;
    }

    render(<TestHarness />);
    expect(screen.getByTestId('tier').textContent).toBe('power');
  });
});
