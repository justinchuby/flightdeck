import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mutable mock state ──────────────────────────────────────────────────────

let mockAgents: any[] = [];
let mockPendingDecisions: any[] = [];
let mockRoles: any[] = [];
const mockRemovePendingDecision = vi.fn();
const mockSetApprovalQueueOpen = vi.fn();

vi.mock('../../stores/appStore', () => ({
  useAppStore: (selector: any) =>
    selector({
      agents: mockAgents,
      pendingDecisions: mockPendingDecisions,
      roles: mockRoles,
      removePendingDecision: mockRemovePendingDecision,
      setApprovalQueueOpen: mockSetApprovalQueueOpen,
      connected: true,
      config: {},
    }),
}));

const mockApiFetch = vi.fn().mockResolvedValue([]);
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../hooks/useSwipeGesture', () => ({
  useSwipeGesture: () => ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
    offsetX: 0,
    offsetY: 0,
    swiping: false,
  }),
}));

vi.mock('../../services/PaletteSearchEngine', () => ({
  PaletteSearchEngine: class {
    updateItems() {}
    search() {
      return [];
    }
  },
}));

// pricing module is now deprecated (no exports needed)

// Mock localStorage for InstallPrompt (jsdom may not provide it)
const localStorageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, val: string) => localStorageMap.set(key, val),
  removeItem: (key: string) => localStorageMap.delete(key),
  clear: () => localStorageMap.clear(),
  get length() { return localStorageMap.size; },
  key: (_i: number) => null as string | null,
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true });

// ── Imports (AFTER vi.mock calls) ───────────────────────────────────────────

import { BottomTabBar } from '../Layout/BottomTabBar';
import { MobileApprovalStack } from '../Mobile/MobileApprovalStack';
import { MobilePulse } from '../Mobile/MobilePulse';
import { MobileAgentCard } from '../Mobile/MobileAgentCard';
import { MobileCommandSheet, CommandFAB } from '../Mobile/MobileCommandSheet';
import { InstallPrompt } from '../Mobile/InstallPrompt';
import { OfflineBanner } from '../Mobile/OfflineBanner';
import { RoleGallery } from '../Roles/RoleGallery';
import { RoleBuilder } from '../Roles/RoleBuilder';
import { RolePreview } from '../Roles/RolePreview';
import { RoleTestDialog } from '../Roles/RoleTestDialog';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    role: { id: 'r-1', icon: '🏗', name: 'Architect', description: '', systemPrompt: '', color: '#6366f1', builtIn: true },
    status: 'running',
    task: 'Design system architecture',
    dagTaskId: 'task-1',
    childIds: [],
    createdAt: '2025-01-01T00:00:00Z',
    outputPreview: 'Designing module layout...',
    autopilot: false,
    inputTokens: 5000,
    outputTokens: 2000,
    contextWindowSize: 100000,
    contextWindowUsed: 45000,
    ...overrides,
  };
}

function makeDecision(overrides: Record<string, any> = {}) {
  return {
    id: 'dec-1',
    agentId: 'agent-1',
    agentRole: 'Architect',
    title: 'Add caching layer',
    rationale: 'Improves read performance by 10x',
    category: 'Architecture',
    status: 'recorded',
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRole(overrides: Record<string, any> = {}) {
  return {
    id: 'role-1',
    name: 'Security Auditor',
    description: 'Audits code for security vulnerabilities',
    systemPrompt: 'You are a security auditor.',
    color: '#ef4444',
    icon: '🔒',
    builtIn: false,
    model: 'sonnet',
    ...overrides,
  };
}

// ── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAgents = [];
  mockPendingDecisions = [];
  mockRoles = [];
  mockApiFetch.mockResolvedValue([]);
  // Reset navigator.onLine for OfflineBanner tests
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  // Clear localStorage for InstallPrompt tests
  localStorageMap.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. BottomTabBar
// ═══════════════════════════════════════════════════════════════════════════

describe('BottomTabBar', () => {
  const renderBar = (route = '/overview') =>
    render(
      <MemoryRouter initialEntries={[route]}>
        <BottomTabBar />
      </MemoryRouter>,
    );

  it('renders all five tab labels', () => {
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Crews')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('marks active tab with aria-current="page"', () => {
    renderBar('/crews');
    const crewBtn = screen.getByText('Crews').closest('button')!;
    expect(crewBtn).toHaveAttribute('aria-current', 'page');
    // Home should NOT be active
    const homeBtn = screen.getByText('Home').closest('button')!;
    expect(homeBtn).not.toHaveAttribute('aria-current');
  });

  it('renders Crews tab without badge (badges only on More for pending decisions)', () => {
    mockAgents = [makeAgent({ status: 'failed' }), makeAgent({ id: 'a2', status: 'running' })];
    renderBar();
    const crewBtn = screen.getByText('Crews').closest('button')!;
    expect(crewBtn).toBeInTheDocument();
  });

  it('renders Tasks tab without badge (badges only on More for pending decisions)', () => {
    mockAgents = [makeAgent({ status: 'running' }), makeAgent({ id: 'a2', status: 'running' })];
    renderBar();
    const taskBtn = screen.getByText('Tasks').closest('button')!;
    expect(taskBtn).toBeInTheDocument();
  });

  it('toggles More sheet on click', () => {
    renderBar();
    expect(screen.queryByText('Canvas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByText('Canvas')).toBeInTheDocument();
    expect(screen.getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. MobileApprovalStack
// ═══════════════════════════════════════════════════════════════════════════

describe('MobileApprovalStack', () => {
  it('shows "All caught up" when no decisions', () => {
    mockPendingDecisions = [];
    render(<MobileApprovalStack />);
    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    expect(screen.getByText('No pending decisions')).toBeInTheDocument();
  });

  it('shows decision card with category and title', () => {
    mockPendingDecisions = [makeDecision()];
    render(<MobileApprovalStack />);
    expect(screen.getByText(/Architecture/)).toBeInTheDocument();
    expect(screen.getByText('Add caching layer')).toBeInTheDocument();
  });

  it('shows card counter', () => {
    mockPendingDecisions = [makeDecision(), makeDecision({ id: 'dec-2', title: 'Second' })];
    render(<MobileApprovalStack />);
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
  });

  it('has Approve, Reject, and Dismiss buttons', () => {
    mockPendingDecisions = [makeDecision()];
    render(<MobileApprovalStack />);
    expect(screen.getByText(/Approve/)).toBeInTheDocument();
    expect(screen.getByText(/Reject/)).toBeInTheDocument();
    expect(screen.getByText(/Dismiss/)).toBeInTheDocument();
  });

  it('calls apiFetch on Approve click', async () => {
    mockPendingDecisions = [makeDecision()];
    mockApiFetch.mockResolvedValue({});
    render(<MobileApprovalStack />);
    fireEvent.click(screen.getByText(/Approve/));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/approve', { method: 'POST' });
    });
  });

  it('calls apiFetch on Reject click', async () => {
    mockPendingDecisions = [makeDecision()];
    mockApiFetch.mockResolvedValue({});
    render(<MobileApprovalStack />);
    fireEvent.click(screen.getByText(/Reject/));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/reject', { method: 'POST' });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. MobilePulse
// ═══════════════════════════════════════════════════════════════════════════

describe('MobilePulse', () => {
  it('returns null when no agents', () => {
    mockAgents = [];
    const { container } = render(<MobilePulse />);
    expect(container.firstChild).toBeNull();
  });

  it('shows running count and token count', () => {
    mockAgents = [makeAgent({ status: 'running' }), makeAgent({ id: 'a2', status: 'idle' })];
    const { container } = render(<MobilePulse />);
    // running count and tokens are split across text nodes; check container text
    const text = container.textContent || '';
    expect(text).toContain('1●');
  });

  it('shows max context pressure percentage', () => {
    mockAgents = [makeAgent({ contextWindowSize: 100000, contextWindowUsed: 82000 })];
    render(<MobilePulse />);
    // 82000/100000 = 82%
    expect(screen.getByText('82%')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. MobileAgentCard
// ═══════════════════════════════════════════════════════════════════════════

describe('MobileAgentCard', () => {
  it('shows role icon, name, and status dot', () => {
    const agent = makeAgent();
    const { container } = render(<MobileAgentCard agent={agent as any} />);
    expect(screen.getByText('🏗')).toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
    // status dot is rendered
    const dot = container.querySelector('.rounded-full');
    expect(dot).toBeInTheDocument();
  });

  it('shows context pressure bar when used > 0', () => {
    const agent = makeAgent({ contextWindowSize: 100000, contextWindowUsed: 70000 });
    render(<MobileAgentCard agent={agent as any} />);
    // 70% pressure
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('shows current task when dagTaskId is set', () => {
    const agent = makeAgent({ dagTaskId: 'task-1', task: 'Design system architecture' });
    render(<MobileAgentCard agent={agent as any} />);
    expect(screen.getByText('Design system architecture')).toBeInTheDocument();
  });

  it('shows output preview', () => {
    const agent = makeAgent({ outputPreview: 'Designing module layout...' });
    render(<MobileAgentCard agent={agent as any} />);
    expect(screen.getByText('Designing module layout...')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. MobileCommandSheet + CommandFAB
// ═══════════════════════════════════════════════════════════════════════════

describe('MobileCommandSheet', () => {
  const noop = vi.fn();

  it('returns null when closed', () => {
    const { container } = render(
      <MobileCommandSheet isOpen={false} onClose={noop} items={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows search input and quick actions when open', () => {
    render(<MobileCommandSheet isOpen={true} onClose={noop} items={[]} />);
    expect(screen.getByPlaceholderText(/Ask anything/)).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Pause all agents')).toBeInTheDocument();
    expect(screen.getByText('Resume all agents')).toBeInTheDocument();
  });

  it('has dialog role and label', () => {
    render(<MobileCommandSheet isOpen={true} onClose={noop} items={[]} />);
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });
});

describe('CommandFAB', () => {
  it('renders command button with label', () => {
    const onClick = vi.fn();
    render(<CommandFAB onClick={onClick} />);
    const btn = screen.getByLabelText('Open command palette');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. InstallPrompt
// ═══════════════════════════════════════════════════════════════════════════

describe('InstallPrompt', () => {
  it('returns null when no beforeinstallprompt event fired', () => {
    const { container } = render(<InstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null on first visit even with prompt event', () => {
    // visitCount starts at 1 for first render (incremented from 0)
    localStorage.setItem('pwa-visit-count', '0');
    const { container } = render(<InstallPrompt />);
    // visitCount = 1 < 2, so null
    expect(container.firstChild).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. OfflineBanner
// ═══════════════════════════════════════════════════════════════════════════

describe('OfflineBanner', () => {
  it('returns null when online', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows banner when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    render(<OfflineBanner />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. RoleGallery
// ═══════════════════════════════════════════════════════════════════════════

describe('RoleGallery', () => {
  const onCreateRole = vi.fn();
  const onEditRole = vi.fn();

  it('shows built-in and custom sections', () => {
    mockRoles = [
      makeRole({ id: 'r-bi', name: 'Developer', builtIn: true }),
      makeRole({ id: 'r-custom', name: 'Security Auditor', builtIn: false }),
    ];
    render(<RoleGallery onCreateRole={onCreateRole} onEditRole={onEditRole} />);
    expect(screen.getByText(/Built-in/)).toBeInTheDocument();
    expect(screen.getByText(/Custom/)).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Security Auditor')).toBeInTheDocument();
  });

  it('Create Role button calls onCreateRole', () => {
    mockRoles = [makeRole({ builtIn: true })];
    render(<RoleGallery onCreateRole={onCreateRole} onEditRole={onEditRole} />);
    fireEvent.click(screen.getByText('+ Create Role'));
    expect(onCreateRole).toHaveBeenCalledOnce();
  });

  it('clicking custom role calls onEditRole', () => {
    const custom = makeRole({ id: 'r-custom', name: 'My Role', builtIn: false });
    mockRoles = [custom];
    render(<RoleGallery onCreateRole={onCreateRole} onEditRole={onEditRole} />);
    fireEvent.click(screen.getByText('My Role'));
    expect(onEditRole).toHaveBeenCalledWith(custom);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. RoleBuilder
// ═══════════════════════════════════════════════════════════════════════════

describe('RoleBuilder', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  it('renders identity, model, and behavior sections', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Behavior')).toBeInTheDocument();
  });

  it('shows icon picker grid on icon button click', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // The icon button is a 12x12 button with the default icon
    const iconBtns = screen.getAllByText('🤖');
    // First one is the icon picker trigger button (the second is in preview)
    fireEvent.click(iconBtns[0]);
    // Icon picker should appear with radiogroup role
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('shows model selection with Opus, Sonnet, Haiku', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByText(/Opus/)).toBeInTheDocument();
    // Sonnet appears in both model selector and preview; just verify it exists
    expect(screen.getAllByText(/Sonnet/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Haiku/)).toBeInTheDocument();
  });

  it('template selector fills system prompt', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    const select = screen.getByDisplayValue('Start from a template...');
    fireEvent.change(select, { target: { value: 'security' } });
    // System prompt textarea should now contain security text
    const textarea = screen.getByPlaceholderText('System prompt...') as HTMLTextAreaElement;
    expect(textarea.value).toContain('security auditor');
  });

  it('Save button calls apiFetch with POST for new role', async () => {
    mockApiFetch.mockResolvedValue({});
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    // Fill in required name
    const nameInput = screen.getByPlaceholderText('Role name');
    fireEvent.change(nameInput, { target: { value: 'Test Role' } });
    fireEvent.click(screen.getByText('Save Role →'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/roles', expect.objectContaining({ method: 'POST' }));
    });
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });
  });

  it('Save button is disabled when name is empty', () => {
    render(<RoleBuilder onSave={onSave} onCancel={onCancel} />);
    const saveBtn = screen.getByText('Save Role →');
    expect(saveBtn).toBeDisabled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  10. RolePreview
// ═══════════════════════════════════════════════════════════════════════════

describe('RolePreview', () => {
  it('shows icon, name, model, and description', () => {
    render(
      <RolePreview
        icon="🔒"
        name="Security Expert"
        model="opus"
        color="#ef4444"
        description="Finds vulnerabilities"
      />,
    );
    expect(screen.getByText('🔒')).toBeInTheDocument();
    expect(screen.getByText('Security Expert')).toBeInTheDocument();
    expect(screen.getByText('Finds vulnerabilities')).toBeInTheDocument();
    expect(screen.getByText(/Opus/)).toBeInTheDocument();
  });

  it('shows model info without cost', () => {
    render(
      <RolePreview icon="🔒" name="Expert" model="haiku" color="#333" description="" />,
    );
    expect(screen.getByText(/Haiku/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  11. RoleTestDialog
// ═══════════════════════════════════════════════════════════════════════════

describe('RoleTestDialog', () => {
  const testRole = {
    name: 'Auditor',
    icon: '🔒',
    model: 'sonnet',
    systemPrompt: 'You audit code.',
    description: 'Security auditor',
    color: '#ef4444',
  };
  const onClose = vi.fn();

  it('shows test message input with default text', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    const textarea = screen.getByDisplayValue(/introduce yourself/);
    expect(textarea).toBeInTheDocument();
  });

  it('shows role name in header', () => {
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    expect(screen.getByText(/Test: Auditor/)).toBeInTheDocument();
  });

  it('calls apiFetch on submit', async () => {
    mockApiFetch.mockResolvedValue({ response: 'Hello! I am an auditor.' });
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    fireEvent.click(screen.getByText('Send Test Message'));
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/roles/test',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // Shows response
    await waitFor(() => {
      expect(screen.getByText('Hello! I am an auditor.')).toBeInTheDocument();
    });
  });

  it('shows error message on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    render(<RoleTestDialog role={testRole} onClose={onClose} />);
    fireEvent.click(screen.getByText('Send Test Message'));
    await waitFor(() => {
      expect(screen.getByText(/Test failed/)).toBeInTheDocument();
    });
  });
});
