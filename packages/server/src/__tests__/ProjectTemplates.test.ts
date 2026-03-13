import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectTemplateRegistry } from '../coordination/playbooks/ProjectTemplates.js';
import type { ProjectTemplate } from '../coordination/playbooks/ProjectTemplates.js';

describe('ProjectTemplateRegistry', () => {
  let registry: ProjectTemplateRegistry;

  beforeEach(() => {
    registry = new ProjectTemplateRegistry();
  });

  // ── Built-in templates ─────────────────────────────────────────────────────

  it('loads all 5 built-in templates on construction', () => {
    expect(registry.getAll()).toHaveLength(5);
  });

  it('contains the expected built-in template IDs', () => {
    const ids = registry.getAll().map(t => t.id);
    expect(ids).toContain('full-stack');
    expect(ids).toContain('bug-fix');
    expect(ids).toContain('docs-sprint');
    expect(ids).toContain('refactor');
    expect(ids).toContain('security-audit');
  });

  it('built-in full-stack template has correct role count', () => {
    const t = registry.get('full-stack')!;
    expect(t).toBeDefined();
    expect(t.roles).toHaveLength(4);
    const roleName = t.roles.map(r => r.role);
    expect(roleName).toContain('architect');
    expect(roleName).toContain('developer');
    expect(roleName).toContain('qa-tester');
  });

  it('built-in bug-fix template has 4 initial tasks', () => {
    const t = registry.get('bug-fix')!;
    expect(t.initialTasks).toHaveLength(4);
    expect(t.initialTasks[0].dependencies).toHaveLength(0); // first task has no deps
  });

  it('built-in security-audit template has correct tags', () => {
    const t = registry.get('security-audit')!;
    expect(t.tags).toContain('security');
    expect(t.tags).toContain('audit');
  });

  // ── get ────────────────────────────────────────────────────────────────────

  it('get returns the template by ID', () => {
    const t = registry.get('refactor');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Major Refactoring');
  });

  it('get returns undefined for an unknown ID', () => {
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  // ── add ────────────────────────────────────────────────────────────────────

  it('add registers a new custom template', () => {
    const custom: ProjectTemplate = {
      id: 'my-template',
      name: 'My Template',
      description: 'Custom workflow',
      roles: [{ role: 'developer', model: 'claude-sonnet-4-5', count: 1 }],
      initialTasks: [{ description: 'Do work', dependencies: [] }],
      settings: {},
      tags: ['custom'],
    };
    registry.add(custom);
    expect(registry.get('my-template')).toBeDefined();
    expect(registry.getAll()).toHaveLength(6);
  });

  it('add throws when a template with the same ID already exists', () => {
    const dup: ProjectTemplate = {
      id: 'bug-fix',
      name: 'Duplicate',
      description: '',
      roles: [],
      initialTasks: [],
      settings: {},
      tags: [],
    };
    expect(() => registry.add(dup)).toThrow("Template 'bug-fix' already exists");
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  it('remove deletes an existing template and returns true', () => {
    expect(registry.remove('docs-sprint')).toBe(true);
    expect(registry.get('docs-sprint')).toBeUndefined();
    expect(registry.getAll()).toHaveLength(4);
  });

  it('remove returns false for a non-existent ID', () => {
    expect(registry.remove('ghost')).toBe(false);
    expect(registry.getAll()).toHaveLength(5); // unchanged
  });

  // ── findByTag ──────────────────────────────────────────────────────────────

  it('findByTag returns templates that include the tag', () => {
    const results = registry.findByTag('bugfix');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('bug-fix');
  });

  it('findByTag returns multiple matching templates', () => {
    const results = registry.findByTag('feature');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(t => t.id === 'full-stack')).toBe(true);
  });

  it('findByTag returns empty array when no template matches', () => {
    expect(registry.findByTag('nonexistent-tag')).toHaveLength(0);
  });

  // ── findByKeyword ──────────────────────────────────────────────────────────

  it('findByKeyword matches on template name (case-insensitive)', () => {
    const results = registry.findByKeyword('refactor');
    expect(results.some(t => t.id === 'refactor')).toBe(true);
  });

  it('findByKeyword matches on description', () => {
    const results = registry.findByKeyword('security');
    expect(results.some(t => t.id === 'security-audit')).toBe(true);
  });

  it('findByKeyword matches on tags', () => {
    const results = registry.findByKeyword('docs');
    expect(results.some(t => t.id === 'docs-sprint')).toBe(true);
  });

  it('findByKeyword is case-insensitive', () => {
    expect(registry.findByKeyword('FULL-STACK').length).toBeGreaterThanOrEqual(1);
    expect(registry.findByKeyword('full-stack').length).toBeGreaterThanOrEqual(1);
  });

  it('findByKeyword returns empty array when nothing matches', () => {
    expect(registry.findByKeyword('xyznomatch')).toHaveLength(0);
  });
});
