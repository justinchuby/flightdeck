import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoleGallery } from '../RoleGallery';
import type { Role } from '../../../types';

// ── Mocks ─────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

let mockStoreRoles: Role[] = [];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: (selector: (s: any) => any) => selector({ roles: mockStoreRoles }),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    systemPrompt: 'You are a developer',
    icon: '👨‍💻',
    model: 'gpt-4',
    builtIn: true,
    ...overrides,
  } as Role;
}

const defaultProps = {
  onCreateRole: vi.fn(),
  onEditRole: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiFetch.mockReset();
  mockStoreRoles = [];
  defaultProps.onCreateRole = vi.fn();
  defaultProps.onEditRole = vi.fn();
});

describe('RoleGallery', () => {
  it('renders roles header', () => {
    mockStoreRoles = [makeRole()];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('🎭 Roles')).toBeTruthy();
  });

  it('renders "Create Role" button', () => {
    mockStoreRoles = [makeRole()];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('+ Create Role')).toBeTruthy();
  });

  it('calls onCreateRole when create button is clicked', () => {
    mockStoreRoles = [makeRole()];
    render(<RoleGallery {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Create Role'));
    expect(defaultProps.onCreateRole).toHaveBeenCalled();
  });

  it('renders built-in roles from store', () => {
    mockStoreRoles = [
      makeRole({ id: 'dev', name: 'Developer', builtIn: true }),
      makeRole({ id: 'arch', name: 'Architect', builtIn: true, icon: '🏗' }),
    ];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('Developer')).toBeTruthy();
    expect(screen.getByText('Architect')).toBeTruthy();
    expect(screen.getByText(/Built-in \(2\)/)).toBeTruthy();
  });

  it('renders custom roles section when custom roles exist', () => {
    mockStoreRoles = [
      makeRole({ id: 'dev', name: 'Developer', builtIn: true }),
      makeRole({ id: 'custom1', name: 'My Custom Agent', builtIn: false }),
    ];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('My Custom Agent')).toBeTruthy();
    expect(screen.getByText(/Custom \(1\)/)).toBeTruthy();
  });

  it('hides custom section when no custom roles', () => {
    mockStoreRoles = [makeRole({ id: 'dev', builtIn: true })];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.queryByText(/Custom \(/)).toBeNull();
  });

  it('calls onEditRole when custom role is clicked', () => {
    const customRole = makeRole({ id: 'custom1', name: 'My Agent', builtIn: false });
    mockStoreRoles = [customRole];
    render(<RoleGallery {...defaultProps} />);
    fireEvent.click(screen.getByText('My Agent'));
    expect(defaultProps.onEditRole).toHaveBeenCalledWith(customRole);
  });

  it('does not call onEditRole when built-in role is clicked', () => {
    mockStoreRoles = [makeRole({ id: 'dev', name: 'Developer', builtIn: true })];
    render(<RoleGallery {...defaultProps} />);
    fireEvent.click(screen.getByText('Developer'));
    expect(defaultProps.onEditRole).not.toHaveBeenCalled();
  });

  it('shows role icon and model', () => {
    mockStoreRoles = [makeRole({ icon: '🔥', model: 'claude-3' })];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('🔥')).toBeTruthy();
    expect(screen.getByText('claude-3')).toBeTruthy();
  });

  it('shows default icon when role has no icon', () => {
    mockStoreRoles = [makeRole({ icon: '' })];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('🤖')).toBeTruthy();
  });

  it('shows "default" when role has no model', () => {
    mockStoreRoles = [makeRole({ model: '' })];
    render(<RoleGallery {...defaultProps} />);
    expect(screen.getByText('default')).toBeTruthy();
  });

  it('fetches roles from API when store is empty', async () => {
    mockStoreRoles = [];
    mockApiFetch.mockResolvedValue([
      makeRole({ id: 'fetched', name: 'Fetched Role' }),
    ]);
    render(<RoleGallery {...defaultProps} />);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/roles');
    });

    await waitFor(() => {
      expect(screen.getByText('Fetched Role')).toBeTruthy();
    });
  });
});
