import { describe, it, expect, beforeEach } from 'vitest';
import { TaskTemplateRegistry } from '../tasks/TaskTemplates.js';
import { TaskDecomposer } from '../tasks/TaskDecomposer.js';

describe('TaskDecomposer', () => {
  let registry: TaskTemplateRegistry;
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    registry = new TaskTemplateRegistry();
    decomposer = new TaskDecomposer(registry);
  });

  // ── Template matching ───────────────────────────────────────────────

  it('matches feature template for "implement" keyword', () => {
    const result = decomposer.decompose('implement user profile page');
    expect(result.template).toBe('feature');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('matches feature template for "add" keyword', () => {
    const result = decomposer.decompose('add dark mode support');
    expect(result.template).toBe('feature');
  });

  it('matches bugfix template for "fix bug" description', () => {
    const result = decomposer.decompose('fix bug in authentication flow');
    expect(result.template).toBe('bugfix');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('matches bugfix template for "crash" keyword', () => {
    const result = decomposer.decompose('crash when uploading large files');
    expect(result.template).toBe('bugfix');
  });

  it('matches docs template for documentation tasks', () => {
    const result = decomposer.decompose('write documentation for the REST API');
    expect(result.template).toBe('docs');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('matches docs template for "readme" keyword', () => {
    const result = decomposer.decompose('update readme with setup instructions');
    expect(result.template).toBe('docs');
  });

  it('matches refactor template', () => {
    const result = decomposer.decompose('refactor the database layer');
    expect(result.template).toBe('refactor');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('matches parallel-feature template for "parallel" keyword', () => {
    const result = decomposer.decompose('parallel development of three modules');
    expect(result.template).toBe('parallel-feature');
  });

  // ── Fallback ────────────────────────────────────────────────────────

  it('falls back to simple decomposition for unknown patterns', () => {
    const result = decomposer.decompose('configure the CI pipeline timeouts');
    expect(result.template).toBeUndefined();
    expect(result.tasks).toHaveLength(3);
    expect(result.confidence).toBe(0.3);
  });

  it('fallback tasks have implement → test → review structure', () => {
    const result = decomposer.decompose('configure the CI pipeline timeouts');
    expect(result.tasks[0].role).toBe('developer');
    expect(result.tasks[1].role).toBe('developer');
    expect(result.tasks[2].role).toBe('code-reviewer');
    expect(result.tasks[1].dependsOn).toContain('0');
    expect(result.tasks[2].dependsOn).toContain('1');
  });

  // ── Task structure ──────────────────────────────────────────────────

  it('returns tasks with title, role, and dependsOn fields', () => {
    const result = decomposer.decompose('implement payment gateway integration');
    for (const task of result.tasks) {
      expect(task.title).toBeDefined();
      expect(typeof task.title).toBe('string');
      expect(task.role).toBeDefined();
      expect(Array.isArray(task.dependsOn)).toBe(true);
    }
  });

  it('customizes task titles with the description subject', () => {
    const result = decomposer.decompose('implement payment gateway integration');
    // titles should reference the subject, not just the bare template step name
    expect(result.tasks.some(t => t.title.includes('payment gateway'))).toBe(true);
  });

  it('strips common leading verbs from subject in title', () => {
    const result = decomposer.decompose('implement user authentication with JWT');
    // "implement" should be stripped leaving "user authentication with JWT"
    expect(result.tasks.some(t => t.title.includes('user authentication'))).toBe(true);
  });

  // ── Confidence ──────────────────────────────────────────────────────

  it('returns confidence score between 0 and 1', () => {
    const r1 = decomposer.decompose('fix critical crash bug');
    expect(r1.confidence).toBeGreaterThanOrEqual(0);
    expect(r1.confidence).toBeLessThanOrEqual(1);

    const r2 = decomposer.decompose('configure the CI pipeline timeouts');
    expect(r2.confidence).toBeGreaterThanOrEqual(0);
    expect(r2.confidence).toBeLessThanOrEqual(1);
  });

  it('confidence is higher for strong keyword matches than fallback', () => {
    const strong = decomposer.decompose('fix bug crash error broken issue');
    const fallback = decomposer.decompose('configure the CI pipeline timeouts');
    expect(strong.confidence).toBeGreaterThan(fallback.confidence);
  });

  it('confidence is capped at 0.95', () => {
    // Many matching keywords should not push confidence above 0.95
    const result = decomposer.decompose('bug fix broken error crash issue defect');
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });
});
