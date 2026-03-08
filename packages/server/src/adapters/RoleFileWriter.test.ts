import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CopilotRoleFileWriter,
  ClaudeRoleFileWriter,
  GeminiRoleFileWriter,
  CursorRoleFileWriter,
  CodexRoleFileWriter,
  OpenCodeRoleFileWriter,
  createRoleFileWriter,
  listRoleFileWriterProviders,
  FLIGHTDECK_MARKER,
} from './RoleFileWriter.js';
import type { RoleDefinition } from './RoleFileWriter.js';

// ── Fixtures ────────────────────────────────────────────────────────

const sampleRoles: RoleDefinition[] = [
  {
    role: 'developer',
    description: 'Writes and modifies code',
    instructions: 'You are a developer. Write clean code and tests.',
    tools: ['read', 'edit', 'shell'],
  },
  {
    role: 'architect',
    description: 'Designs system architecture',
    instructions: 'You are an architect. Think about scalability and maintainability.',
  },
];

const singleRole: RoleDefinition[] = [
  {
    role: 'reviewer',
    description: 'Reviews code changes',
    instructions: 'You review code for correctness and style.',
    tools: ['read', 'search'],
  },
];

// ── Test Helpers ────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'rolefilewriter-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Copilot Writer ──────────────────────────────────────────────────

describe('CopilotRoleFileWriter', () => {
  const writer = new CopilotRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('copilot-agent-md');
  });

  it('writes .agent.md files to .github/agents/', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain('.github/agents/flightdeck-developer.agent.md');
    expect(files[1]).toContain('.github/agents/flightdeck-architect.agent.md');
  });

  it('produces YAML frontmatter with name, description, and tools', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.github', 'agents', 'flightdeck-developer.agent.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('name: flightdeck-developer');
    expect(content).toContain('description: "Writes and modifies code"');
    expect(content).toContain('tools:');
    expect(content).toContain('  - read');
    expect(content).toContain('  - edit');
    expect(content).toContain('  - shell');
    expect(content).toContain('# Developer — Flightdeck Agent');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('uses default tools when none specified', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.github', 'agents', 'flightdeck-architect.agent.md'),
      'utf-8',
    );

    expect(content).toContain('  - read');
    expect(content).toContain('  - edit');
    expect(content).toContain('  - search');
    expect(content).toContain('  - shell');
  });

  it('cleanRoleFiles removes generated files', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(tempDir, '.github', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles does not remove non-flightdeck files', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    const dir = join(tempDir, '.github', 'agents');
    await writeFile(join(dir, 'custom-agent.agent.md'), '# My custom agent');

    await writer.cleanRoleFiles(tempDir);

    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['custom-agent.agent.md']);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    await expect(writer.cleanRoleFiles(join(tempDir, 'nonexistent'))).resolves.not.toThrow();
  });

  it('handles empty roles array', async () => {
    const files = await writer.writeRoleFiles([], tempDir);
    expect(files).toHaveLength(0);
  });

  it('escapes quotes in description', async () => {
    const roles: RoleDefinition[] = [
      {
        role: 'tester',
        description: 'Tests "everything" thoroughly',
        instructions: 'Test all the things.',
      },
    ];
    await writer.writeRoleFiles(roles, tempDir);
    const content = await readFile(
      join(tempDir, '.github', 'agents', 'flightdeck-tester.agent.md'),
      'utf-8',
    );
    expect(content).toContain('description: "Tests \\"everything\\" thoroughly"');
  });
});

// ── Claude Writer ───────────────────────────────────────────────────

describe('ClaudeRoleFileWriter', () => {
  const writer = new ClaudeRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('claude-agent-md');
  });

  it('writes .md files to .claude/agents/', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain('.claude/agents/flightdeck-developer.md');
    expect(files[1]).toContain('.claude/agents/flightdeck-architect.md');
  });

  it('produces YAML frontmatter with name and description (no tools)', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.claude', 'agents', 'flightdeck-developer.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('name: flightdeck-developer');
    expect(content).toContain('description: "Writes and modifies code"');
    expect(content).not.toContain('tools:');
    expect(content).toContain('# Developer');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('cleanRoleFiles removes generated files', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(tempDir, '.claude', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    await expect(writer.cleanRoleFiles(join(tempDir, 'nonexistent'))).resolves.not.toThrow();
  });
});

// ── Gemini Writer ───────────────────────────────────────────────────

describe('GeminiRoleFileWriter', () => {
  const writer = new GeminiRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('gemini-agent-md');
  });

  it('writes .md files to .gemini/agents/', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain('.gemini/agents/flightdeck-developer.md');
    expect(files[1]).toContain('.gemini/agents/flightdeck-architect.md');
  });

  it('produces pure markdown without YAML frontmatter', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.gemini', 'agents', 'flightdeck-developer.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).not.toContain('---');
    expect(content).toContain('# Developer');
    expect(content).toContain('> Writes and modifies code');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('cleanRoleFiles removes generated files', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(tempDir, '.gemini', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    await expect(writer.cleanRoleFiles(join(tempDir, 'nonexistent'))).resolves.not.toThrow();
  });
});

// ── Cursor Writer ───────────────────────────────────────────────────

describe('CursorRoleFileWriter', () => {
  const writer = new CursorRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('cursor-mdc');
  });

  it('writes .mdc files to .cursor/rules/', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain('.cursor/rules/flightdeck-developer.mdc');
    expect(files[1]).toContain('.cursor/rules/flightdeck-architect.mdc');
  });

  it('produces YAML frontmatter with description and alwaysApply', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.cursor', 'rules', 'flightdeck-developer.mdc'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('description: "Writes and modifies code"');
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('# Developer');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('cleanRoleFiles removes generated files', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(tempDir, '.cursor', 'rules');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles does not remove non-flightdeck .mdc files', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    const dir = join(tempDir, '.cursor', 'rules');
    await writeFile(join(dir, 'my-custom-rule.mdc'), '---\nalwaysApply: true\n---\nCustom rule');

    await writer.cleanRoleFiles(tempDir);

    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['my-custom-rule.mdc']);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    await expect(writer.cleanRoleFiles(join(tempDir, 'nonexistent'))).resolves.not.toThrow();
  });
});

// ── Codex Writer ────────────────────────────────────────────────────

describe('CodexRoleFileWriter', () => {
  const writer = new CodexRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('codex-agents-md');
  });

  it('writes a single AGENTS.md file', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain('AGENTS.md');
  });

  it('contains all roles as markdown sections', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('# Flightdeck Agents');
    expect(content).toContain('## Developer');
    expect(content).toContain('> Writes and modifies code');
    expect(content).toContain('You are a developer. Write clean code and tests.');
    expect(content).toContain('## Architect');
    expect(content).toContain('> Designs system architecture');
    expect(content).toContain('---');
  });

  it('writes single role without separator', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');

    expect(content).toContain('## Reviewer');
    expect(content).not.toContain('---\n\n##');
  });

  it('cleanRoleFiles removes the AGENTS.md file', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const { access } = await import('fs/promises');
    await expect(access(join(tempDir, 'AGENTS.md'))).rejects.toThrow();
  });

  it('cleanRoleFiles does not remove user-authored AGENTS.md', async () => {
    await writeFile(join(tempDir, 'AGENTS.md'), '# My hand-written agents file');
    await writer.cleanRoleFiles(tempDir);

    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toBe('# My hand-written agents file');
  });

  it('cleanRoleFiles is safe when file does not exist', async () => {
    await expect(writer.cleanRoleFiles(tempDir)).resolves.not.toThrow();
  });

  it('handles empty roles array', async () => {
    const files = await writer.writeRoleFiles([], tempDir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Flightdeck Agents');
  });
});

// ── OpenCode Writer ─────────────────────────────────────────────────

describe('OpenCodeRoleFileWriter', () => {
  const writer = new OpenCodeRoleFileWriter();

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('opencode-json');
  });

  it('writes opencode.json with agent definitions', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain('opencode.json');
  });

  it('produces valid JSON with correct agent entries', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(join(tempDir, 'opencode.json'), 'utf-8');
    const config = JSON.parse(content);

    expect(config._generatedByFlightdeck).toBe(true);
    expect(config.agents['flightdeck-developer']).toEqual({
      description: 'Writes and modifies code',
      prompt: 'You are a developer. Write clean code and tests.',
      tools: { read: 'allow', edit: 'allow', shell: 'allow' },
    });
    expect(config.agents['flightdeck-architect']).toEqual({
      description: 'Designs system architecture',
      prompt: 'You are an architect. Think about scalability and maintainability.',
    });
  });

  it('includes tools only when specified', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(join(tempDir, 'opencode.json'), 'utf-8');
    const config = JSON.parse(content);

    expect(config.agents['flightdeck-developer'].tools).toBeDefined();
    expect(config.agents['flightdeck-architect'].tools).toBeUndefined();
  });

  it('preserves existing non-flightdeck config', async () => {
    // Write existing config
    await writeFile(
      join(tempDir, 'opencode.json'),
      JSON.stringify({ theme: 'dark', agents: { 'my-agent': { prompt: 'hello' } } }, null, 2),
    );

    await writer.writeRoleFiles(singleRole, tempDir);
    const content = await readFile(join(tempDir, 'opencode.json'), 'utf-8');
    const config = JSON.parse(content);

    expect(config.theme).toBe('dark');
    expect(config.agents['my-agent']).toEqual({ prompt: 'hello' });
    expect(config.agents['flightdeck-reviewer']).toBeDefined();
  });

  it('cleanRoleFiles removes flightdeck agents but preserves others', async () => {
    // Write existing + flightdeck config
    await writeFile(
      join(tempDir, 'opencode.json'),
      JSON.stringify(
        {
          theme: 'dark',
          agents: {
            'my-agent': { prompt: 'hello' },
            'flightdeck-developer': { prompt: 'test' },
          },
          _generatedByFlightdeck: true,
        },
        null,
        2,
      ),
    );

    await writer.cleanRoleFiles(tempDir);
    const content = await readFile(join(tempDir, 'opencode.json'), 'utf-8');
    const config = JSON.parse(content);

    expect(config.theme).toBe('dark');
    expect(config.agents['my-agent']).toEqual({ prompt: 'hello' });
    expect(config.agents['flightdeck-developer']).toBeUndefined();
    expect(config._generatedByFlightdeck).toBeUndefined();
  });

  it('cleanRoleFiles deletes file when only flightdeck content remains', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const { access } = await import('fs/promises');
    await expect(access(join(tempDir, 'opencode.json'))).rejects.toThrow();
  });

  it('cleanRoleFiles skips files without flightdeck marker', async () => {
    await writeFile(
      join(tempDir, 'opencode.json'),
      JSON.stringify({ theme: 'dark' }, null, 2),
    );

    await writer.cleanRoleFiles(tempDir);
    const content = await readFile(join(tempDir, 'opencode.json'), 'utf-8');
    const config = JSON.parse(content);
    expect(config.theme).toBe('dark');
  });

  it('cleanRoleFiles is safe when file does not exist', async () => {
    await expect(writer.cleanRoleFiles(tempDir)).resolves.not.toThrow();
  });
});

// ── Security: Path Traversal ────────────────────────────────────────

describe('Path traversal prevention', () => {
  const providers = ['copilot', 'claude', 'gemini', 'cursor', 'codex', 'opencode'];

  const maliciousRoles: RoleDefinition[] = [
    {
      role: '../../.git/hooks/post-commit' as string,
      description: 'Malicious role',
      instructions: 'Payload',
    },
  ];

  for (const provider of providers) {
    it(`${provider}: rejects path traversal in role name`, async () => {
      const writer = createRoleFileWriter(provider);
      await expect(writer.writeRoleFiles(maliciousRoles, tempDir)).rejects.toThrow(
        /Invalid role name/,
      );
    });
  }

  it('rejects role names with dots', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      { role: 'my.role', description: 'test', instructions: 'test' },
    ];
    await expect(writer.writeRoleFiles(roles, tempDir)).rejects.toThrow(/Invalid role name/);
  });

  it('rejects role names with slashes', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      { role: 'a/b', description: 'test', instructions: 'test' },
    ];
    await expect(writer.writeRoleFiles(roles, tempDir)).rejects.toThrow(/Invalid role name/);
  });

  it('rejects role names with spaces', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      { role: 'my role', description: 'test', instructions: 'test' },
    ];
    await expect(writer.writeRoleFiles(roles, tempDir)).rejects.toThrow(/Invalid role name/);
  });

  it('rejects role names starting with hyphen', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      { role: '-admin', description: 'test', instructions: 'test' },
    ];
    await expect(writer.writeRoleFiles(roles, tempDir)).rejects.toThrow(/Invalid role name/);
  });

  it('accepts valid role names', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      { role: 'my-role-123', description: 'test', instructions: 'test' },
    ];
    await expect(writer.writeRoleFiles(roles, tempDir)).resolves.toHaveLength(1);
  });
});

// ── Security: YAML Injection ────────────────────────────────────────

describe('YAML injection prevention', () => {
  it('escapes newlines in description to prevent key injection', async () => {
    const writer = createRoleFileWriter('copilot');
    const roles: RoleDefinition[] = [
      {
        role: 'tester',
        description: 'legit\nmalicious_key: injected_value',
        instructions: 'test',
      },
    ];
    await writer.writeRoleFiles(roles, tempDir);
    const content = await readFile(
      join(tempDir, '.github', 'agents', 'flightdeck-tester.agent.md'),
      'utf-8',
    );

    // The newline should be escaped, not literal
    expect(content).toContain('legit\\nmalicious_key: injected_value');
    expect(content).not.toContain('malicious_key: injected_value\n');
  });

  it('escapes carriage returns in description', async () => {
    const writer = createRoleFileWriter('claude');
    const roles: RoleDefinition[] = [
      {
        role: 'tester',
        description: 'legit\r\ninjected: value',
        instructions: 'test',
      },
    ];
    await writer.writeRoleFiles(roles, tempDir);
    const content = await readFile(
      join(tempDir, '.claude', 'agents', 'flightdeck-tester.md'),
      'utf-8',
    );

    expect(content).toContain('legit\\r\\ninjected: value');
  });

  it('escapes tabs in description', async () => {
    const writer = createRoleFileWriter('cursor');
    const roles: RoleDefinition[] = [
      {
        role: 'tester',
        description: 'legit\tinjected',
        instructions: 'test',
      },
    ];
    await writer.writeRoleFiles(roles, tempDir);
    const content = await readFile(
      join(tempDir, '.cursor', 'rules', 'flightdeck-tester.mdc'),
      'utf-8',
    );

    expect(content).toContain('legit\\tinjected');
  });
});

// ── Factory ─────────────────────────────────────────────────────────

describe('createRoleFileWriter', () => {
  it('returns CopilotRoleFileWriter for "copilot"', () => {
    const writer = createRoleFileWriter('copilot');
    expect(writer).toBeInstanceOf(CopilotRoleFileWriter);
    expect(writer.getFormat()).toBe('copilot-agent-md');
  });

  it('returns ClaudeRoleFileWriter for "claude"', () => {
    const writer = createRoleFileWriter('claude');
    expect(writer).toBeInstanceOf(ClaudeRoleFileWriter);
    expect(writer.getFormat()).toBe('claude-agent-md');
  });

  it('returns GeminiRoleFileWriter for "gemini"', () => {
    const writer = createRoleFileWriter('gemini');
    expect(writer).toBeInstanceOf(GeminiRoleFileWriter);
    expect(writer.getFormat()).toBe('gemini-agent-md');
  });

  it('returns CursorRoleFileWriter for "cursor"', () => {
    const writer = createRoleFileWriter('cursor');
    expect(writer).toBeInstanceOf(CursorRoleFileWriter);
    expect(writer.getFormat()).toBe('cursor-mdc');
  });

  it('returns CodexRoleFileWriter for "codex"', () => {
    const writer = createRoleFileWriter('codex');
    expect(writer).toBeInstanceOf(CodexRoleFileWriter);
    expect(writer.getFormat()).toBe('codex-agents-md');
  });

  it('returns OpenCodeRoleFileWriter for "opencode"', () => {
    const writer = createRoleFileWriter('opencode');
    expect(writer).toBeInstanceOf(OpenCodeRoleFileWriter);
    expect(writer.getFormat()).toBe('opencode-json');
  });

  it('throws for unknown provider', () => {
    expect(() => createRoleFileWriter('unknown')).toThrow(
      'No RoleFileWriter for provider "unknown"',
    );
  });

  it('error message lists valid providers', () => {
    try {
      createRoleFileWriter('invalid');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('copilot');
      expect(msg).toContain('claude');
      expect(msg).toContain('gemini');
      expect(msg).toContain('cursor');
      expect(msg).toContain('codex');
      expect(msg).toContain('opencode');
    }
  });
});

// ── listRoleFileWriterProviders ─────────────────────────────────────

describe('listRoleFileWriterProviders', () => {
  it('returns all 6 provider IDs', () => {
    const providers = listRoleFileWriterProviders();
    expect(providers).toHaveLength(6);
    expect(providers).toContain('copilot');
    expect(providers).toContain('claude');
    expect(providers).toContain('gemini');
    expect(providers).toContain('cursor');
    expect(providers).toContain('codex');
    expect(providers).toContain('opencode');
  });
});

// ── Cross-writer consistency ────────────────────────────────────────

describe('Cross-writer consistency', () => {
  const providers = ['copilot', 'claude', 'gemini', 'cursor', 'codex', 'opencode'];

  it('all writers produce at least one file for non-empty roles', async () => {
    for (const provider of providers) {
      const writer = createRoleFileWriter(provider);
      const dir = await mkdtemp(join(tmpdir(), `rfw-${provider}-`));
      try {
        const files = await writer.writeRoleFiles(singleRole, dir);
        expect(files.length).toBeGreaterThanOrEqual(1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('all writers survive a write-then-clean cycle', async () => {
    for (const provider of providers) {
      const writer = createRoleFileWriter(provider);
      const dir = await mkdtemp(join(tmpdir(), `rfw-${provider}-`));
      try {
        await writer.writeRoleFiles(sampleRoles, dir);
        await expect(writer.cleanRoleFiles(dir)).resolves.not.toThrow();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('all writers return a non-empty format string', () => {
    for (const provider of providers) {
      const writer = createRoleFileWriter(provider);
      expect(writer.getFormat()).toBeTruthy();
      expect(typeof writer.getFormat()).toBe('string');
    }
  });
});
