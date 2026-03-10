// packages/server/src/knowledge/SkillsLoader.ts
// Loads .github/skills/**/SKILL.md files and makes them available to the knowledge system.

import { readdirSync, readFileSync, existsSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ── Types ───────────────────────────────────────────────────────────

/** YAML frontmatter metadata from a SKILL.md file. */
export interface SkillMetadata {
  name: string;
  description: string;
}

/** A fully loaded skill with parsed metadata and markdown body. */
export interface LoadedSkill {
  /** Unique skill name from frontmatter (kebab-case). */
  name: string;
  /** One-line description from frontmatter. */
  description: string;
  /** The markdown body content (everything after the frontmatter). */
  content: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
}

/** Result of loading skills from a directory. */
export interface SkillsLoadResult {
  /** Successfully loaded skills. */
  skills: LoadedSkill[];
  /** Errors encountered while loading (skill dir name → error message). */
  errors: Array<{ directory: string; error: string }>;
}

// ── Frontmatter Parser ──────────────────────────────────────────────

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse YAML frontmatter from a markdown file.
 * Expects the file to start with `---`, followed by YAML, then `---`, then the body.
 */
export function parseFrontmatter(raw: string): { metadata: SkillMetadata; body: string } {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new Error('Missing or malformed YAML frontmatter (expected --- delimiters)');
  }

  const yamlBlock = match[1];
  const body = match[2].trim();

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBlock);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML parse error in frontmatter: ${message}`);
  }

  if (parsed == null || typeof parsed !== 'object') {
    throw new Error('Frontmatter must be a YAML object with name and description fields');
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new Error('Frontmatter missing required "name" field (must be a non-empty string)');
  }
  if (typeof obj.description !== 'string' || !obj.description.trim()) {
    throw new Error('Frontmatter missing required "description" field (must be a non-empty string)');
  }

  return {
    metadata: { name: obj.name.trim(), description: obj.description.trim() },
    body,
  };
}

// ── SkillsLoader ────────────────────────────────────────────────────

/**
 * SkillsLoader — reads .github/skills/ directories, parses SKILL.md files,
 * and makes them available to the knowledge system.
 *
 * Each skill lives in its own directory under the skills root:
 *   .github/skills/<skill-name>/SKILL.md
 *
 * The SKILL.md file has YAML frontmatter with `name` and `description`,
 * followed by a markdown body with the skill content.
 */
export class SkillsLoader {
  private static readonly RELOAD_DEBOUNCE_MS = 500;

  private skills: LoadedSkill[] = [];
  private loaded = false;
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private onReload?: (result: SkillsLoadResult) => void;

  constructor(private readonly skillsDir: string) {}

  /**
   * Load all skills from the configured directory.
   * Safe to call multiple times — reloads each time (supports hot-reload).
   * Returns the load result with successfully loaded skills and any errors.
   */
  loadAll(): SkillsLoadResult {
    const errors: SkillsLoadResult['errors'] = [];

    if (!existsSync(this.skillsDir)) {
      this.skills = [];
      this.loaded = true;
      return { skills: [], errors: [] };
    }

    const dirStat = statSync(this.skillsDir);
    if (!dirStat.isDirectory()) {
      this.skills = [];
      this.loaded = true;
      return { skills: [], errors: [{ directory: this.skillsDir, error: 'Skills path is not a directory' }] };
    }

    const entries = readdirSync(this.skillsDir, { withFileTypes: true });
    const loadedSkills: LoadedSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFilePath = join(this.skillsDir, entry.name, 'SKILL.md');

      if (!existsSync(skillFilePath)) {
        // Directory without SKILL.md — skip silently (might be a non-skill dir)
        continue;
      }

      try {
        const raw = readFileSync(skillFilePath, 'utf-8');
        const { metadata, body } = parseFrontmatter(raw);

        loadedSkills.push({
          name: metadata.name,
          description: metadata.description,
          content: body,
          path: resolve(skillFilePath),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ directory: entry.name, error: message });
      }
    }

    this.skills = loadedSkills;
    this.loaded = true;
    return { skills: [...loadedSkills], errors };
  }

  /** Get all loaded skills. Calls loadAll() if not yet loaded. */
  getSkills(): LoadedSkill[] {
    if (!this.loaded) {
      this.loadAll();
    }
    return [...this.skills];
  }

  /** Find a skill by name. Case-insensitive match. */
  getSkillByName(name: string): LoadedSkill | undefined {
    if (!this.loaded) {
      this.loadAll();
    }
    const lower = name.toLowerCase();
    return this.skills.find(s => s.name.toLowerCase() === lower);
  }

  /**
   * Format skills for injection into agent prompts.
   * Returns a formatted text block listing all skills with their descriptions
   * and full content, suitable for the KnowledgeInjector.
   *
   * @param tokenBudget Max approximate tokens (chars/4). Default 800. Skills
   *   that exceed the remaining budget are truncated or excluded.
   */
  formatForInjection(tokenBudget = 800): string {
    if (!this.loaded) {
      this.loadAll();
    }
    if (this.skills.length === 0) return '';

    const header = '## Project Skills\n\n';
    const separator = '\n\n---\n\n';
    let remaining = tokenBudget * 4; // Convert tokens to approximate chars
    remaining -= header.length;
    if (remaining <= 0) return '';

    const sections: string[] = [];

    for (const skill of this.skills) {
      const full = `### ${skill.name}\n${skill.description}\n\n${skill.content}`;

      if (full.length <= remaining) {
        // Full skill fits within budget
        sections.push(full);
        remaining -= full.length + separator.length;
      } else {
        // Try truncated version: name + description only
        const truncated = `### ${skill.name}\n${skill.description}\n\n[truncated — full content exceeds token budget]`;
        if (truncated.length <= remaining) {
          sections.push(truncated);
          remaining -= truncated.length + separator.length;
        }
        // Else: skip entirely — even truncated version doesn't fit
        break; // Budget exhausted, no point checking remaining skills
      }
    }

    if (sections.length === 0) return '';
    return `${header}${sections.join(separator)}`;
  }

  /** Number of successfully loaded skills. */
  get count(): number {
    return this.skills.length;
  }

  /**
   * Watch the skills directory for changes and auto-reload.
   * Uses fs.watch with a debounce to avoid rapid reloads from editors
   * that write multiple times (save + rename + chmod).
   *
   * @param callback Optional callback invoked after each reload with the result.
   */
  startWatching(callback?: (result: SkillsLoadResult) => void): void {
    if (this.watcher) return; // already watching
    if (!existsSync(this.skillsDir)) return;

    this.onReload = callback;

    try {
      this.watcher = watch(this.skillsDir, { recursive: true }, (_event, _filename) => {
        // Debounce: coalesce rapid changes within 500ms
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.reloadTimer = null;
          const result = this.loadAll();
          this.onReload?.(result);
        }, SkillsLoader.RELOAD_DEBOUNCE_MS);
      });
    } catch {
      // fs.watch can throw on unsupported platforms (e.g. some NFS mounts, Docker volumes)
      this.watcher = null;
    }
  }

  /** Stop watching for changes and clean up resources. */
  stopWatching(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.onReload = undefined;
  }
}
