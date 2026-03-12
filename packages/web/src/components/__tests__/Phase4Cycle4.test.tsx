import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

vi.mock('../../services/PaletteSearchEngine', () => ({
  PaletteSearchEngine: class {
    updateItems() {}
    search() {
      return [];
    }
  },
}));

// pricing module is now deprecated (no exports needed)

// ── Imports (AFTER vi.mock calls) ───────────────────────────────────────────

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
});

// ═══════════════════════════════════════════════════════════════════════════
//  1. RoleGallery
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
//  2. RoleBuilder
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
//  3. RolePreview
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
//  4. RoleTestDialog
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
