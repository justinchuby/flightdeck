import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import {
  CopilotRoleFileWriter,
  ClaudeRoleFileWriter,
  GeminiRoleFileWriter,
  CursorRoleFileWriter,
  CodexRoleFileWriter,
  OpenCodeRoleFileWriter,
  GenericMarkdownRoleFileWriter,
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
  let copilotHomeDir: string;
  let writer: CopilotRoleFileWriter;

  beforeEach(async () => {
    copilotHomeDir = await mkdtemp(join(tmpdir(), 'copilot-home-'));
    writer = new CopilotRoleFileWriter(copilotHomeDir);
  });

  afterEach(async () => {
    await rm(copilotHomeDir, { recursive: true, force: true });
  });

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('copilot-agent-md');
  });

  it('writes .agent.md files to ~/.copilot/agents/ (user home, not project dir)', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain(join(copilotHomeDir, '.copilot', 'agents', 'flightdeck-developer.agent.md'));
    expect(files[1]).toContain(join(copilotHomeDir, '.copilot', 'agents', 'flightdeck-architect.agent.md'));
    // Ensure files are NOT in the project directory
    expect(files[0]).not.toContain(tempDir);
    expect(files[1]).not.toContain(tempDir);
  });

  it('produces YAML frontmatter with name, description, and tools', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(copilotHomeDir, '.copilot', 'agents', 'flightdeck-developer.agent.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('name: flightdeck-developer');
    expect(content).toContain('description: "Flightdeck Developer: Writes and modifies code"');
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
      join(copilotHomeDir, '.copilot', 'agents', 'flightdeck-architect.agent.md'),
      'utf-8',
    );

    expect(content).toContain('  - read');
    expect(content).toContain('  - edit');
    expect(content).toContain('  - search');
    expect(content).toContain('  - shell');
  });

  it('cleanRoleFiles removes generated files from home directory', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(copilotHomeDir, '.copilot', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles does not remove non-flightdeck files', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    const dir = join(copilotHomeDir, '.copilot', 'agents');
    await writeFile(join(dir, 'custom-agent.agent.md'), '# My custom agent');

    await writer.cleanRoleFiles(tempDir);

    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['custom-agent.agent.md']);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    const freshWriter = new CopilotRoleFileWriter(join(tempDir, 'nonexistent-home'));
    await expect(freshWriter.cleanRoleFiles(tempDir)).resolves.not.toThrow();
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
      join(copilotHomeDir, '.copilot', 'agents', 'flightdeck-tester.agent.md'),
      'utf-8',
    );
    expect(content).toContain('description: "Flightdeck Tester: Tests \\"everything\\" thoroughly"');
  });

  it('ignores targetDir parameter (uses home dir instead)', async () => {
    const projectDir = join(tempDir, 'some-project');
    await mkdir(projectDir, { recursive: true });
    const files = await writer.writeRoleFiles(singleRole, projectDir);

    expect(files[0]).toContain(copilotHomeDir);
    expect(files[0]).not.toContain(projectDir);
  });
});

// ── Claude Writer ───────────────────────────────────────────────────

describe('ClaudeRoleFileWriter', () => {
  let claudeHomeDir: string;
  let writer: ClaudeRoleFileWriter;

  beforeEach(async () => {
    claudeHomeDir = await mkdtemp(join(tmpdir(), 'claude-home-'));
    writer = new ClaudeRoleFileWriter(claudeHomeDir);
  });

  afterEach(async () => {
    await rm(claudeHomeDir, { recursive: true, force: true });
  });

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('claude-agent-md');
  });

  it('writes .md files to ~/.claude/agents/ (user home, not project dir)', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    expect(files[0]).toContain(join(claudeHomeDir, '.claude', 'agents', 'flightdeck-developer.md'));
    expect(files[1]).toContain(join(claudeHomeDir, '.claude', 'agents', 'flightdeck-architect.md'));
    // Ensure files are NOT in the project directory
    expect(files[0]).not.toContain(tempDir);
    expect(files[1]).not.toContain(tempDir);
  });

  it('produces YAML frontmatter with name and description (no tools)', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(claudeHomeDir, '.claude', 'agents', 'flightdeck-developer.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('name: flightdeck-developer');
    expect(content).toContain('description: "Flightdeck Developer: Writes and modifies code"');
    expect(content).not.toContain('tools:');
    expect(content).toContain('# Developer');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('cleanRoleFiles removes generated files from home directory', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(claudeHomeDir, '.claude', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    const freshWriter = new ClaudeRoleFileWriter(join(tempDir, 'nonexistent-home'));
    await expect(freshWriter.cleanRoleFiles(tempDir)).resolves.not.toThrow();
  });

  it('ignores targetDir parameter (uses home dir instead)', async () => {
    const projectDir = join(tempDir, 'some-project');
    await mkdir(projectDir, { recursive: true });
    const files = await writer.writeRoleFiles(singleRole, projectDir);

    expect(files[0]).toContain(claudeHomeDir);
    expect(files[0]).not.toContain(projectDir);
  });
});

// ── Gemini Writer ───────────────────────────────────────────────────

describe('GeminiRoleFileWriter', () => {
  let geminiHomeDir: string;
  let writer: GeminiRoleFileWriter;

  beforeEach(async () => {
    geminiHomeDir = await mkdtemp(join(tmpdir(), 'gemini-home-'));
    writer = new GeminiRoleFileWriter(geminiHomeDir);
  });

  afterEach(async () => {
    await rm(geminiHomeDir, { recursive: true, force: true });
  });

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('gemini-agent-md');
  });

  it('writes .md files to ~/.gemini/agents/ (user home, not project dir)', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(2);
    // Files should be in the home directory, NOT in tempDir (project dir)
    expect(files[0]).toContain(join(geminiHomeDir, '.gemini', 'agents', 'flightdeck-developer.md'));
    expect(files[1]).toContain(join(geminiHomeDir, '.gemini', 'agents', 'flightdeck-architect.md'));
    // Ensure files are NOT in the project directory
    expect(files[0]).not.toContain(tempDir);
    expect(files[1]).not.toContain(tempDir);
  });

  it('produces pure markdown without YAML frontmatter', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(geminiHomeDir, '.gemini', 'agents', 'flightdeck-developer.md'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).not.toContain('---');
    expect(content).toContain('# Developer');
    expect(content).toContain('> Flightdeck Developer: Writes and modifies code');
    expect(content).toContain('You are a developer. Write clean code and tests.');
  });

  it('cleanRoleFiles removes generated files from home directory', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const dir = join(geminiHomeDir, '.gemini', 'agents');
    const { readdir } = await import('fs/promises');
    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it('cleanRoleFiles is safe when directory does not exist', async () => {
    const freshWriter = new GeminiRoleFileWriter(join(tempDir, 'nonexistent-home'));
    await expect(freshWriter.cleanRoleFiles(tempDir)).resolves.not.toThrow();
  });

  it('ignores targetDir parameter (uses home dir instead)', async () => {
    const projectDir = join(tempDir, 'some-project');
    await mkdir(projectDir, { recursive: true });
    const files = await writer.writeRoleFiles(singleRole, projectDir);

    // Written to home dir, not project dir
    expect(files[0]).toContain(geminiHomeDir);
    expect(files[0]).not.toContain(projectDir);
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
    expect(files[0]).toContain(join('.cursor', 'rules', 'flightdeck-developer.mdc'));
    expect(files[1]).toContain(join('.cursor', 'rules', 'flightdeck-architect.mdc'));
  });

  it('produces YAML frontmatter with description and alwaysApply', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(
      join(tempDir, '.cursor', 'rules', 'flightdeck-developer.mdc'),
      'utf-8',
    );

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('description: "Flightdeck Developer: Writes and modifies code"');
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
  let codexHomeDir: string;
  let writer: CodexRoleFileWriter;

  beforeEach(async () => {
    codexHomeDir = await mkdtemp(join(tmpdir(), 'codex-home-'));
    writer = new CodexRoleFileWriter(codexHomeDir);
  });

  afterEach(async () => {
    await rm(codexHomeDir, { recursive: true, force: true });
  });

  it('returns correct format identifier', () => {
    expect(writer.getFormat()).toBe('codex-agents-md');
  });

  it('writes a single AGENTS.md file to ~/.codex/ (user home, not project dir)', async () => {
    const files = await writer.writeRoleFiles(sampleRoles, tempDir);

    expect(files).toHaveLength(1);
    expect(files[0]).toContain(join(codexHomeDir, '.codex', 'AGENTS.md'));
    // Ensure file is NOT in the project directory
    expect(files[0]).not.toContain(tempDir);
  });

  it('contains all roles as markdown sections', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    const content = await readFile(join(codexHomeDir, '.codex', 'AGENTS.md'), 'utf-8');

    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('# Flightdeck Agents');
    expect(content).toContain('## Developer');
    expect(content).toContain('> Flightdeck Developer: Writes and modifies code');
    expect(content).toContain('You are a developer. Write clean code and tests.');
    expect(content).toContain('## Architect');
    expect(content).toContain('> Flightdeck Architect: Designs system architecture');
    expect(content).toContain('---');
  });

  it('writes single role without separator', async () => {
    await writer.writeRoleFiles(singleRole, tempDir);
    const content = await readFile(join(codexHomeDir, '.codex', 'AGENTS.md'), 'utf-8');

    expect(content).toContain('## Reviewer');
    expect(content).not.toContain('---\n\n##');
  });

  it('cleanRoleFiles removes the AGENTS.md file from home directory', async () => {
    await writer.writeRoleFiles(sampleRoles, tempDir);
    await writer.cleanRoleFiles(tempDir);

    const { access } = await import('fs/promises');
    await expect(access(join(codexHomeDir, '.codex', 'AGENTS.md'))).rejects.toThrow();
  });

  it('cleanRoleFiles does not remove user-authored AGENTS.md', async () => {
    const codexDir = join(codexHomeDir, '.codex');
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, 'AGENTS.md'), '# My hand-written agents file');
    await writer.cleanRoleFiles(tempDir);

    const content = await readFile(join(codexDir, 'AGENTS.md'), 'utf-8');
    expect(content).toBe('# My hand-written agents file');
  });

  it('cleanRoleFiles is safe when file does not exist', async () => {
    await expect(writer.cleanRoleFiles(tempDir)).resolves.not.toThrow();
  });

  it('handles empty roles array', async () => {
    const files = await writer.writeRoleFiles([], tempDir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(codexHomeDir, '.codex', 'AGENTS.md'), 'utf-8');
    expect(content).toContain('# Flightdeck Agents');
  });

  it('ignores targetDir parameter (uses home dir instead)', async () => {
    const projectDir = join(tempDir, 'some-project');
    await mkdir(projectDir, { recursive: true });
    const files = await writer.writeRoleFiles(singleRole, projectDir);

    expect(files[0]).toContain(codexHomeDir);
    expect(files[0]).not.toContain(projectDir);
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
      description: 'Flightdeck Developer: Writes and modifies code',
      prompt: 'You are a developer. Write clean code and tests.',
      tools: { read: 'allow', edit: 'allow', shell: 'allow' },
    });
    expect(config.agents['flightdeck-architect']).toEqual({
      description: 'Flightdeck Architect: Designs system architecture',
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
    const writer = new CopilotRoleFileWriter(tempDir);
    const roles: RoleDefinition[] = [
      {
        role: 'tester',
        description: 'legit\nmalicious_key: injected_value',
        instructions: 'test',
      },
    ];
    await writer.writeRoleFiles(roles, tempDir);
    const content = await readFile(
      join(tempDir, '.copilot', 'agents', 'flightdeck-tester.agent.md'),
      'utf-8',
    );

    // The newline should be escaped, not literal
    expect(content).toContain('legit\\nmalicious_key: injected_value');
    expect(content).not.toContain('malicious_key: injected_value\n');
  });

  it('escapes carriage returns in description', async () => {
    const writer = new ClaudeRoleFileWriter(tempDir);
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
  it('returns all 8 provider IDs', () => {
    const providers = listRoleFileWriterProviders();
    expect(providers).toHaveLength(8);
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

// ── Cross-platform path safety ─────────────────────────────────────

describe('Cross-platform path construction', () => {
  it('user-level writers use path.join for all paths (no hardcoded separators)', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'xplat-'));
    try {
      const writers = [
        { writer: new CopilotRoleFileWriter(fakeHome), label: 'copilot' },
        { writer: new ClaudeRoleFileWriter(fakeHome), label: 'claude' },
        { writer: new GeminiRoleFileWriter(fakeHome), label: 'gemini' },
        { writer: new CodexRoleFileWriter(fakeHome), label: 'codex' },
      ];

      for (const { writer, label } of writers) {
        const files = await writer.writeRoleFiles(singleRole, '/should/be/ignored');
        for (const filePath of files) {
          // Every returned path must start with the injected home dir
          expect(filePath, `${label}: path should start with homeDir`).toMatch(
            new RegExp(`^${fakeHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
          );
          // Path should use the platform separator, never a mix
          const afterHome = filePath.slice(fakeHome.length);
          const wrongSep = sep === '/' ? '\\' : '/';
          expect(afterHome, `${label}: path should not contain wrong separator '${wrongSep}'`).not.toContain(wrongSep);
        }
      }
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it('returned paths contain platform-appropriate separators', async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), 'xplat-sep-'));
    try {
      const writer = new CopilotRoleFileWriter(fakeHome);
      const files = await writer.writeRoleFiles(singleRole, '/ignored');

      // The path should contain the expected directory structure joined by platform sep
      const expectedFragment = ['.copilot', 'agents', 'flightdeck-reviewer.agent.md'].join(sep);
      expect(files[0]).toContain(expectedFragment);
    } finally {
      await rm(fakeHome, { recursive: true, force: true });
    }
  });
});

// ── GenericMarkdownRoleFileWriter ───────────────────────────────────

describe('GenericMarkdownRoleFileWriter', () => {
  let fakeHome: string;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'generic-writer-'));
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('writes AGENTS.md in the specified directory', async () => {
    const writer = new GenericMarkdownRoleFileWriter('.kimi', fakeHome);
    const files = await writer.writeRoleFiles(sampleRoles, '/ignored');
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(join('.kimi', 'AGENTS.md'));
    const content = await readFile(files[0], 'utf-8');
    expect(content).toContain(FLIGHTDECK_MARKER);
    expect(content).toContain('## Developer');
    expect(content).toContain('## Architect');
  });

  it('includes role instructions in output', async () => {
    const writer = new GenericMarkdownRoleFileWriter('.qwen-code', fakeHome);
    const files = await writer.writeRoleFiles(singleRole, '/ignored');
    const content = await readFile(files[0], 'utf-8');
    expect(content).toContain('You review code for correctness and style.');
    expect(content).toContain('Reviewer');
  });

  it('getFormat() returns expected format string', () => {
    const writer = new GenericMarkdownRoleFileWriter('.kimi');
    expect(writer.getFormat()).toBe('kimi-agents-md');

    const writer2 = new GenericMarkdownRoleFileWriter('.qwen-code');
    expect(writer2.getFormat()).toBe('qwen-code-agents-md');
  });

  it('cleanRoleFiles removes the AGENTS.md file', async () => {
    const writer = new GenericMarkdownRoleFileWriter('.kimi', fakeHome);
    await writer.writeRoleFiles(sampleRoles, '/ignored');
    const filePath = join(fakeHome, '.kimi', 'AGENTS.md');
    const before = await readFile(filePath, 'utf-8');
    expect(before).toContain(FLIGHTDECK_MARKER);

    await writer.cleanRoleFiles('/ignored');
    await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
  });

  it('factory creates GenericMarkdownRoleFileWriter for kimi and qwen-code', () => {
    const kimiWriter = createRoleFileWriter('kimi');
    expect(kimiWriter).toBeInstanceOf(GenericMarkdownRoleFileWriter);

    const qwenWriter = createRoleFileWriter('qwen-code');
    expect(qwenWriter).toBeInstanceOf(GenericMarkdownRoleFileWriter);
  });
});
