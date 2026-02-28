import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import { TaskTemplateRegistry } from '../tasks/TaskTemplates.js';
import type { TaskTemplate } from '../tasks/TaskTemplates.js';

describe('TaskTemplateRegistry', () => {
  let db: Database;
  let dag: TaskDAG;
  let registry: TaskTemplateRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    dag = new TaskDAG(db);
    registry = new TaskTemplateRegistry();
  });

  afterEach(() => {
    db.close();
  });

  // ── getAll ──────────────────────────────────────────────────────────

  it('getAll returns all built-in templates', () => {
    const templates = registry.getAll();
    expect(templates.length).toBeGreaterThanOrEqual(5);
    const ids = templates.map(t => t.id);
    expect(ids).toContain('feature');
    expect(ids).toContain('bugfix');
    expect(ids).toContain('refactor');
    expect(ids).toContain('docs');
    expect(ids).toContain('parallel-feature');
  });

  // ── get ─────────────────────────────────────────────────────────────

  it('get returns template by id', () => {
    const t = registry.get('feature');
    expect(t).toBeDefined();
    expect(t!.id).toBe('feature');
    expect(t!.name).toBe('New Feature');
    expect(t!.tasks.length).toBe(4);
  });

  it('get returns undefined for unknown id', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  // ── register ────────────────────────────────────────────────────────

  it('register adds a custom template', () => {
    const custom: TaskTemplate = {
      id: 'custom',
      name: 'Custom',
      description: 'A custom template',
      tasks: [
        { ref: 'step1', title: 'Step one', role: 'developer' },
        { ref: 'step2', title: 'Step two', role: 'developer', dependsOn: ['step1'] },
      ],
    };
    registry.register(custom);
    expect(registry.get('custom')).toBeDefined();
    expect(registry.getAll().map(t => t.id)).toContain('custom');
  });

  it('register overwrites an existing template', () => {
    const updated: TaskTemplate = {
      id: 'docs',
      name: 'Docs v2',
      description: 'Updated docs template',
      tasks: [{ ref: 'write', title: 'Write', role: 'tech-writer' }],
    };
    registry.register(updated);
    expect(registry.get('docs')!.name).toBe('Docs v2');
  });

  // ── instantiate ─────────────────────────────────────────────────────

  it('instantiate creates DAG tasks with correct count', () => {
    const leadId = 'lead-1';
    const refToId = registry.instantiate('feature', leadId, dag);
    expect(refToId).not.toBeNull();
    const tasks = dag.getTasks(leadId);
    expect(tasks).toHaveLength(4);
  });

  it('instantiate returns a ref-to-id mapping', () => {
    const leadId = 'lead-2';
    const refToId = registry.instantiate('feature', leadId, dag);
    expect(refToId).not.toBeNull();
    expect(refToId!['implement']).toBeDefined();
    expect(refToId!['test']).toBeDefined();
    expect(refToId!['review']).toBeDefined();
    expect(refToId!['merge']).toBeDefined();
  });

  it('instantiate sets correct dependency chain', () => {
    const leadId = 'lead-3';
    const refToId = registry.instantiate('feature', leadId, dag);
    expect(refToId).not.toBeNull();

    // 'implement' has no deps → ready
    const impl = dag.getTask(leadId, refToId!['implement'])!;
    expect(impl.dagStatus).toBe('ready');
    expect(impl.dependsOn).toHaveLength(0);

    // 'test' depends on 'implement' → pending
    const test = dag.getTask(leadId, refToId!['test'])!;
    expect(test.dagStatus).toBe('pending');
    expect(test.dependsOn).toContain(refToId!['implement']);
  });

  it('instantiate applies title overrides', () => {
    const leadId = 'lead-4';
    const refToId = registry.instantiate('feature', leadId, dag, {
      implement: { title: 'Build login API' },
    });
    expect(refToId).not.toBeNull();
    const implTask = dag.getTask(leadId, refToId!['implement'])!;
    expect(implTask.description).toBe('Build login API');
  });

  it('instantiate applies role overrides', () => {
    const leadId = 'lead-5';
    const refToId = registry.instantiate('bugfix', leadId, dag, {
      review: { role: 'senior-reviewer' },
    });
    expect(refToId).not.toBeNull();
    const reviewTask = dag.getTask(leadId, refToId!['review'])!;
    expect(reviewTask.role).toBe('senior-reviewer');
  });

  it('instantiate returns null for unknown template id', () => {
    const result = registry.instantiate('no-such-template', 'lead-6', dag);
    expect(result).toBeNull();
  });

  it('instantiate supports parallel-feature template with fan-out deps', () => {
    const leadId = 'lead-7';
    const refToId = registry.instantiate('parallel-feature', leadId, dag);
    expect(refToId).not.toBeNull();
    const tasks = dag.getTasks(leadId);
    expect(tasks).toHaveLength(7);

    // design has no deps → ready
    const design = dag.getTask(leadId, refToId!['design'])!;
    expect(design.dagStatus).toBe('ready');

    // integrate depends on all three tracks
    const integrate = dag.getTask(leadId, refToId!['integrate'])!;
    expect(integrate.dependsOn).toContain(refToId!['track-a']);
    expect(integrate.dependsOn).toContain(refToId!['track-b']);
    expect(integrate.dependsOn).toContain(refToId!['track-c']);
  });
});
