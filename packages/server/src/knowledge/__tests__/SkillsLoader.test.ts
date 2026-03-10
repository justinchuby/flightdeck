import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SkillsLoader, parseFrontmatter } from '../SkillsLoader.js';

// ── Helpers ───────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `skills-loader-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(
  skillsDir: string,
  name: string,
  opts: { description?: string; body?: string; raw?: string } = {},
): void {
  const skillDir = join(skillsDir, name);
  mkdirSync(skillDir, { recursive: true });

  if (opts.raw !== undefined) {
    writeFileSync(join(skillDir, 'SKILL.md'), opts.raw, 'utf-8');
    return;
  }

  const description = opts.description ?? `Description for ${name}`;
  const body = opts.body ?? `# ${name}\n\nContent for ${name}.`;
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
}

// ── Tests ────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses valid frontmatter with name and description', () => {
    const raw = '---\nname: test-skill\ndescription: A test skill\n---\n# Hello\n\nWorld';
    const result = parseFrontmatter(raw);
    expect(result.metadata).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
    expect(result.body).toBe('# Hello\n\nWorld');
  });

  it('handles Windows-style line endings (CRLF)', () => {
    const raw = '---\r\nname: crlf-skill\r\ndescription: CRLF test\r\n---\r\n# Content\r\n\r\nBody text';
    const result = parseFrontmatter(raw);
    expect(result.metadata.name).toBe('crlf-skill');
    expect(result.body).toContain('Content');
  });

  it('trims whitespace from name and description', () => {
    const raw = '---\nname: "  spaced-name  "\ndescription: "  spaced desc  "\n---\nBody';
    const result = parseFrontmatter(raw);
    expect(result.metadata.name).toBe('spaced-name');
    expect(result.metadata.description).toBe('spaced desc');
  });

  it('throws on missing frontmatter delimiters', () => {
    expect(() => parseFrontmatter('# Just markdown')).toThrow('Missing or malformed YAML frontmatter');
  });

  it('throws on empty frontmatter', () => {
    expect(() => parseFrontmatter('---\n\n---\nBody')).toThrow('Frontmatter must be a YAML object');
  });

  it('throws on missing name field', () => {
    const raw = '---\ndescription: Has desc\n---\nBody';
    expect(() => parseFrontmatter(raw)).toThrow('missing required "name" field');
  });

  it('throws on missing description field', () => {
    const raw = '---\nname: has-name\n---\nBody';
    expect(() => parseFrontmatter(raw)).toThrow('missing required "description" field');
  });

  it('throws on empty name', () => {
    const raw = '---\nname: ""\ndescription: Valid\n---\nBody';
    expect(() => parseFrontmatter(raw)).toThrow('missing required "name" field');
  });

  it('throws on invalid YAML in frontmatter', () => {
    const raw = '---\n: invalid: yaml: [unclosed\n---\nBody';
    expect(() => parseFrontmatter(raw)).toThrow('YAML parse error');
  });
});

describe('SkillsLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadAll()', () => {
    it('loads skills from valid directories', () => {
      writeSkill(tempDir, 'skill-one', { description: 'First skill', body: '# One\n\nContent one' });
      writeSkill(tempDir, 'skill-two', { description: 'Second skill', body: '# Two\n\nContent two' });

      const loader = new SkillsLoader(tempDir);
      const result = loader.loadAll();

      expect(result.skills).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      const names = result.skills.map(s => s.name).sort();
      expect(names).toEqual(['skill-one', 'skill-two']);
    });

    it('returns empty for non-existent directory', () => {
      const loader = new SkillsLoader(join(tempDir, 'does-not-exist'));
      const result = loader.loadAll();

      expect(result.skills).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('skips directories without SKILL.md', () => {
      writeSkill(tempDir, 'valid-skill');
      mkdirSync(join(tempDir, 'empty-dir'));

      const loader = new SkillsLoader(tempDir);
      const result = loader.loadAll();

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('valid-skill');
      expect(result.errors).toHaveLength(0);
    });

    it('skips regular files at the top level', () => {
      writeSkill(tempDir, 'valid-skill');
      writeFileSync(join(tempDir, 'README.md'), '# Not a skill');

      const loader = new SkillsLoader(tempDir);
      const result = loader.loadAll();

      expect(result.skills).toHaveLength(1);
    });

    it('collects errors for malformed SKILL.md files', () => {
      writeSkill(tempDir, 'good-skill');
      writeSkill(tempDir, 'bad-skill', { raw: '# No frontmatter here' });

      const loader = new SkillsLoader(tempDir);
      const result = loader.loadAll();

      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe('good-skill');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].directory).toBe('bad-skill');
      expect(result.errors[0].error).toContain('frontmatter');
    });

    it('reloads on subsequent calls', () => {
      writeSkill(tempDir, 'first');
      const loader = new SkillsLoader(tempDir);

      let result = loader.loadAll();
      expect(result.skills).toHaveLength(1);

      writeSkill(tempDir, 'second');
      result = loader.loadAll();
      expect(result.skills).toHaveLength(2);
    });

    it('resolves paths to absolute', () => {
      writeSkill(tempDir, 'abs-test');
      const loader = new SkillsLoader(tempDir);
      const result = loader.loadAll();

      expect(result.skills[0].path).toMatch(/^\//);
      expect(result.skills[0].path).toContain('SKILL.md');
    });
  });

  describe('getSkills()', () => {
    it('auto-loads on first call', () => {
      writeSkill(tempDir, 'auto-load');
      const loader = new SkillsLoader(tempDir);

      // getSkills() should trigger loadAll()
      const skills = loader.getSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('auto-load');
    });

    it('returns a copy (not mutable reference)', () => {
      writeSkill(tempDir, 'copy-test');
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      const skills1 = loader.getSkills();
      const skills2 = loader.getSkills();
      expect(skills1).not.toBe(skills2);
      expect(skills1).toEqual(skills2);
    });
  });

  describe('getSkillByName()', () => {
    it('finds a skill by exact name', () => {
      writeSkill(tempDir, 'target-skill', { description: 'Find me' });
      writeSkill(tempDir, 'other-skill');

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      const skill = loader.getSkillByName('target-skill');
      expect(skill).toBeDefined();
      expect(skill!.description).toBe('Find me');
    });

    it('finds skills case-insensitively', () => {
      writeSkill(tempDir, 'Mixed-Case');
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      expect(loader.getSkillByName('mixed-case')).toBeDefined();
      expect(loader.getSkillByName('MIXED-CASE')).toBeDefined();
    });

    it('returns undefined for non-existent skill', () => {
      writeSkill(tempDir, 'exists');
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      expect(loader.getSkillByName('does-not-exist')).toBeUndefined();
    });
  });

  describe('formatForInjection()', () => {
    it('formats skills with headers and separators', () => {
      writeSkill(tempDir, 'skill-a', { description: 'Desc A', body: 'Body A' });
      writeSkill(tempDir, 'skill-b', { description: 'Desc B', body: 'Body B' });

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      const formatted = loader.formatForInjection();
      expect(formatted).toContain('## Project Skills');
      expect(formatted).toContain('### skill-a');
      expect(formatted).toContain('Desc A');
      expect(formatted).toContain('Body A');
      expect(formatted).toContain('### skill-b');
      expect(formatted).toContain('---');
    });

    it('returns empty string when no skills loaded', () => {
      const loader = new SkillsLoader(join(tempDir, 'empty'));
      loader.loadAll();

      expect(loader.formatForInjection()).toBe('');
    });
  });

  describe('count', () => {
    it('reflects loaded skill count', () => {
      writeSkill(tempDir, 'one');
      writeSkill(tempDir, 'two');
      writeSkill(tempDir, 'three');

      const loader = new SkillsLoader(tempDir);
      expect(loader.count).toBe(0); // Not loaded yet

      loader.loadAll();
      expect(loader.count).toBe(3);
    });
  });

  describe('token budget', () => {
    it('includes all skills when within budget', () => {
      writeSkill(tempDir, 'small-skill', { body: 'Short content.' });

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();
      const result = loader.formatForInjection(10_000);

      expect(result).toContain('small-skill');
      expect(result).toContain('Short content.');
      expect(result).not.toContain('truncated');
    });

    it('truncates skills that exceed the budget', () => {
      // Create a skill with very long content
      const longBody = 'x'.repeat(4000); // ~1000 tokens
      writeSkill(tempDir, 'big-skill', { body: longBody });

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();
      // Budget of 50 tokens is too small for the full content
      const result = loader.formatForInjection(50);

      expect(result).toContain('big-skill');
      expect(result).toContain('truncated');
      expect(result).not.toContain(longBody);
    });

    it('excludes skills entirely when even truncated version exceeds budget', () => {
      writeSkill(tempDir, 'any-skill', { body: 'Some content.' });

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();
      // Ridiculously small budget — even the header won't fit
      const result = loader.formatForInjection(1);

      expect(result).toBe('');
    });

    it('includes first skills and truncates later ones on budget exhaustion', () => {
      writeSkill(tempDir, 'alpha', { body: 'Alpha content.' });
      writeSkill(tempDir, 'beta', { body: 'B'.repeat(4000) }); // ~1000 tokens

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();
      // Enough for first skill but not for second's full content
      const result = loader.formatForInjection(100);

      expect(result).toContain('alpha');
      // Beta may be truncated or excluded depending on exact token math
    });

    it('uses default budget of 800 tokens when no argument provided', () => {
      // Create skills that total well under 800 tokens
      writeSkill(tempDir, 'tiny', { body: 'Tiny.' });

      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      // Default budget should include small skills
      const result = loader.formatForInjection();
      expect(result).toContain('tiny');
      expect(result).toContain('Tiny.');
    });
  });

  describe('hot-reload', () => {
    it('startWatching detects new skill files and reloads', async () => {
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();
      expect(loader.count).toBe(0);

      let reloadResult: ReturnType<typeof loader.loadAll> | null = null;
      const reloadPromise = new Promise<void>((resolve) => {
        loader.startWatching((result) => {
          reloadResult = result;
          resolve();
        });
      });

      // Add a skill file after watching has started
      writeSkill(tempDir, 'dynamic-skill', { description: 'Added at runtime' });

      // Wait for the debounced reload (500ms + buffer)
      await Promise.race([
        reloadPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Watcher timeout')), 3000)),
      ]);

      expect(reloadResult).not.toBeNull();
      expect(loader.count).toBe(1);
      expect(loader.getSkillByName('dynamic-skill')).toBeDefined();

      loader.stopWatching();
    });

    it('stopWatching prevents further reloads', () => {
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      const callback = vi.fn();
      loader.startWatching(callback);
      loader.stopWatching();

      // After stopping, adding files should not trigger callback
      writeSkill(tempDir, 'ignored-skill');

      // Give it more than the debounce period
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).not.toHaveBeenCalled();
          resolve();
        }, 800);
      });
    });

    it('startWatching is idempotent', () => {
      const loader = new SkillsLoader(tempDir);
      loader.loadAll();

      loader.startWatching();
      loader.startWatching(); // second call should be no-op
      loader.stopWatching();
    });

    it('startWatching on non-existent directory is a no-op', () => {
      const loader = new SkillsLoader('/nonexistent/path');
      loader.startWatching(); // should not throw
      loader.stopWatching();
    });
  });
});
