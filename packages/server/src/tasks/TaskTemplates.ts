/**
 * TaskTemplates — Reusable DAG patterns for common workflows.
 *
 * A template describes a workflow as a set of named task refs with
 * dependency edges. `TaskTemplateRegistry.instantiate()` expands a template
 * into a live TaskDAG via `declareTaskBatch`, returning a ref→taskId map.
 */
import type { TaskDAG, DagTaskInput } from './TaskDAG.js';
import { logger } from '../utils/logger.js';

// ── Template types ──────────────────────────────────────────────────────

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  tasks: TemplateTask[];
}

export interface TemplateTask {
  /** Template-local reference (e.g. "implement", "review", "test") */
  ref: string;
  title: string;
  role: string;
  dependsOn?: string[];  // refs of other template tasks
}

// ── Built-in templates ──────────────────────────────────────────────────

const TEMPLATES: TaskTemplate[] = [
  {
    id: 'feature',
    name: 'New Feature',
    description: 'Standard feature workflow: implement → test → review → merge',
    tasks: [
      { ref: 'implement', title: 'Implement feature', role: 'developer' },
      { ref: 'test',      title: 'Write tests',       role: 'developer',      dependsOn: ['implement'] },
      { ref: 'review',    title: 'Code review',        role: 'code-reviewer',  dependsOn: ['test'] },
      { ref: 'merge',     title: 'Merge and commit',   role: 'developer',      dependsOn: ['review'] },
    ],
  },
  {
    id: 'bugfix',
    name: 'Bug Fix',
    description: 'Bug fix workflow: investigate → fix → test → review',
    tasks: [
      { ref: 'investigate', title: 'Investigate bug',       role: 'developer' },
      { ref: 'fix',         title: 'Implement fix',         role: 'developer',     dependsOn: ['investigate'] },
      { ref: 'test',        title: 'Add regression test',   role: 'developer',     dependsOn: ['fix'] },
      { ref: 'review',      title: 'Review fix',            role: 'code-reviewer', dependsOn: ['test'] },
    ],
  },
  {
    id: 'refactor',
    name: 'Refactoring',
    description: 'Safe refactor: plan → implement → test → review',
    tasks: [
      { ref: 'plan',      title: 'Architecture plan',    role: 'architect' },
      { ref: 'implement', title: 'Implement refactor',   role: 'developer',     dependsOn: ['plan'] },
      { ref: 'test',      title: 'Verify tests pass',    role: 'developer',     dependsOn: ['implement'] },
      { ref: 'review',    title: 'Review refactor',      role: 'code-reviewer', dependsOn: ['test'] },
    ],
  },
  {
    id: 'docs',
    name: 'Documentation',
    description: 'Write and review documentation',
    tasks: [
      { ref: 'write',  title: 'Write documentation',  role: 'tech-writer' },
      { ref: 'review', title: 'Review documentation', role: 'code-reviewer', dependsOn: ['write'] },
    ],
  },
  {
    id: 'parallel-feature',
    name: 'Parallel Feature (3 devs)',
    description: 'Split feature into 3 parallel tracks with joint review',
    tasks: [
      { ref: 'design',    title: 'Design & plan',              role: 'architect' },
      { ref: 'track-a',   title: 'Track A implementation',     role: 'developer',     dependsOn: ['design'] },
      { ref: 'track-b',   title: 'Track B implementation',     role: 'developer',     dependsOn: ['design'] },
      { ref: 'track-c',   title: 'Track C implementation',     role: 'developer',     dependsOn: ['design'] },
      { ref: 'integrate', title: 'Integration',                role: 'developer',     dependsOn: ['track-a', 'track-b', 'track-c'] },
      { ref: 'test',      title: 'Integration tests',          role: 'developer',     dependsOn: ['integrate'] },
      { ref: 'review',    title: 'Final review',               role: 'code-reviewer', dependsOn: ['test'] },
    ],
  },
];

// ── TaskTemplateRegistry ────────────────────────────────────────────────

export class TaskTemplateRegistry {
  private templates: Map<string, TaskTemplate> = new Map();

  constructor() {
    for (const t of TEMPLATES) this.templates.set(t.id, t);
  }

  /** Get all available templates */
  getAll(): TaskTemplate[] { return [...this.templates.values()]; }

  /** Get a template by ID */
  get(id: string): TaskTemplate | undefined { return this.templates.get(id); }

  /** Register a custom template (overwrites if ID exists) */
  register(template: TaskTemplate): void {
    this.templates.set(template.id, template);
    logger.info('task-template', `Registered template "${template.id}"`);
  }

  /**
   * Instantiate a template into the DAG via a single `declareTaskBatch` call.
   *
   * Generates stable task IDs using `${templateId}-${ref}-${timestamp}` so
   * multiple instantiations of the same template won't collide.
   *
   * @param templateId  ID of the template to apply.
   * @param leadId      Lead agent ID that owns the DAG.
   * @param taskDAG     Live TaskDAG instance.
   * @param overrides   Optional per-ref overrides for title and/or role.
   * @returns Map of template ref → generated task ID, or null if template not found.
   */
  instantiate(
    templateId: string,
    leadId: string,
    taskDAG: TaskDAG,
    overrides?: Record<string, Partial<Pick<TemplateTask, 'title' | 'role'>>>,
  ): Record<string, string> | null {
    const template = this.templates.get(templateId);
    if (!template) {
      logger.warn('task-template', `Template "${templateId}" not found`);
      return null;
    }

    // Generate unique task IDs — timestamp in base-36 keeps IDs short and readable
    const stamp = Date.now().toString(36);
    const refToId: Record<string, string> = {};
    for (const task of template.tasks) {
      refToId[task.ref] = `${templateId}-${task.ref}-${stamp}`;
    }

    // Build DagTaskInput[] with all dependencies resolved in one pass
    const inputs: DagTaskInput[] = template.tasks.map(task => {
      const override = overrides?.[task.ref] ?? {};
      return {
        id: refToId[task.ref],
        role: override.role ?? task.role,
        description: override.title ?? task.title,
        depends_on: (task.dependsOn ?? []).map(depRef => refToId[depRef]),
      };
    });

    taskDAG.declareTaskBatch(leadId, inputs);
    logger.info('task-template', `Instantiated "${template.name}" template with ${template.tasks.length} tasks for lead ${leadId.slice(0, 8)}`);
    return refToId;
  }
}
