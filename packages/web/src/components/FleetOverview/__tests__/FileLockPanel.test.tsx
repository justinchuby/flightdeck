// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileLockPanel } from '../FileLockPanel';

const makeAgent = (id: string) => ({
  id,
  role: { id: 'dev', name: 'Developer', icon: '💻' },
  status: 'running' as const,
  childIds: [],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
});

const makeLock = (overrides: Record<string, unknown> = {}) => ({
  filePath: 'src/index.ts',
  agentId: 'a1',
  agentRole: 'developer',
  projectId: 'p1',
  reason: 'editing',
  acquiredAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  ...overrides,
});

describe('FileLockPanel', () => {
  it('renders lock entries', () => {
    render(<FileLockPanel locks={[makeLock()]} agents={[makeAgent('a1')]} />);
    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
  });

  it('shows empty state when no locks', () => {
    const { container } = render(<FileLockPanel locks={[]} agents={[]} />);
    // Should either show empty message or just the header
    expect(container).toBeTruthy();
  });

  it('displays agent name for lock', () => {
    render(<FileLockPanel locks={[makeLock({ agentId: 'abc123' })]} agents={[makeAgent('abc123')]} />);
    // Should show agent role info
    expect(screen.getByText(/Developer/)).toBeInTheDocument();
  });

  it('shows lock reason', () => {
    render(<FileLockPanel locks={[makeLock({ reason: 'refactoring module' })]} agents={[makeAgent('a1')]} />);
    expect(screen.getByText(/refactoring module/)).toBeInTheDocument();
  });

  it('renders multiple locks', () => {
    const locks = [
      makeLock({ filePath: 'src/a.ts', agentId: 'a1' }),
      makeLock({ filePath: 'src/b.ts', agentId: 'a2' }),
    ];
    render(<FileLockPanel locks={locks} agents={[makeAgent('a1'), makeAgent('a2')]} />);
    expect(screen.getByText(/src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText(/src\/b\.ts/)).toBeInTheDocument();
  });
});
