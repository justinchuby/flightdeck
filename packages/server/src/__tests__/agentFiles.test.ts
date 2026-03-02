import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sep } from 'path';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available inside the hoisted vi.mock factories
// ---------------------------------------------------------------------------

const { mockMkdirSync, mockWriteFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { agentFlagForRole, writeAgentFiles } from '../agents/agentFiles.js';
import type { Role } from '../agents/RoleRegistry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes production code',
    systemPrompt: 'You are a skilled Developer.',
    ...overrides,
  } as Role;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentFlagForRole', () => {
  it('returns correct prefix for a role id', () => {
    expect(agentFlagForRole('developer')).toBe('flightdeck-developer');
  });

  it('works for various role IDs', () => {
    expect(agentFlagForRole('lead')).toBe('flightdeck-lead');
    expect(agentFlagForRole('code-reviewer')).toBe('flightdeck-code-reviewer');
    expect(agentFlagForRole('architect')).toBe('flightdeck-architect');
  });
});

describe('writeAgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    writeAgentFiles([makeRole()]);

    expect(mockMkdirSync).toHaveBeenCalledOnce();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(['.copilot', 'agents'].join(sep)),
      { recursive: true },
    );
  });

  it('skips mkdir if directory already exists', () => {
    mockExistsSync.mockReturnValue(true);

    writeAgentFiles([makeRole()]);

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('writes correct content for each role', () => {
    mockExistsSync.mockReturnValue(true);
    const role = makeRole();

    writeAgentFiles([role]);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();

    const [filePath, content, encoding] = mockWriteFileSync.mock.calls[0];
    expect(filePath).toContain('flightdeck-developer.agent.md');
    expect(encoding).toBe('utf-8');

    // Frontmatter
    expect(content).toContain('name: flightdeck-developer');
    expect(content).toContain('description: "Flightdeck Developer: Writes production code"');

    // Tools
    expect(content).toContain('  - read');
    expect(content).toContain('  - edit');
    expect(content).toContain('  - search');
    expect(content).toContain('  - shell');

    // Body
    expect(content).toContain('# Developer — Flightdeck Agent');
    expect(content).toContain('You are a skilled Developer.');
  });

  it('handles multiple roles', () => {
    mockExistsSync.mockReturnValue(true);

    const roles = [
      makeRole({ id: 'lead', name: 'Lead', description: 'Leads the team', systemPrompt: 'Lead prompt' }),
      makeRole({ id: 'developer', name: 'Developer', description: 'Writes code', systemPrompt: 'Dev prompt' }),
      makeRole({ id: 'reviewer', name: 'Reviewer', description: 'Reviews code', systemPrompt: 'Review prompt' }),
    ];

    writeAgentFiles(roles);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(3);

    const writtenPaths = mockWriteFileSync.mock.calls.map((c: any[]) => c[0]);
    expect(writtenPaths[0]).toContain('flightdeck-lead.agent.md');
    expect(writtenPaths[1]).toContain('flightdeck-developer.agent.md');
    expect(writtenPaths[2]).toContain('flightdeck-reviewer.agent.md');
  });

  it('catches errors gracefully without propagating', () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    // Should not throw
    expect(() => writeAgentFiles([makeRole()])).not.toThrow();
  });
});
