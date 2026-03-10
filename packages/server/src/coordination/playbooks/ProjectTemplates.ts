/**
 * ProjectTemplates — Reusable templates for bootstrapping new projects.
 *
 * A ProjectTemplate defines the agent roles, initial task graph, and
 * settings needed to spin up a common project type without starting from
 * scratch every time.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  roles: Array<{ role: string; model: string; count: number }>;
  initialTasks: Array<{ description: string; dependencies: string[] }>;
  settings: Record<string, unknown>;
  tags: string[];
}

// ── Built-in templates ────────────────────────────────────────────────────────

const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'full-stack',
    name: 'Full-Stack Feature',
    description: 'Complete feature implementation with architect, 2 developers, code reviewer, and tester',
    roles: [
      { role: 'architect',      model: 'claude-opus-4.6',         count: 1 },
      { role: 'developer',      model: 'claude-sonnet-4.6',       count: 2 },
      { role: 'code-reviewer',  model: 'gemini-3-pro-preview',    count: 1 },
      { role: 'qa-tester',      model: 'claude-sonnet-4.6',       count: 1 },
    ],
    initialTasks: [
      { description: 'Architecture review and design',   dependencies: [] },
      { description: 'Backend implementation',           dependencies: ['Architecture review and design'] },
      { description: 'Frontend implementation',          dependencies: ['Architecture review and design'] },
      { description: 'Code review',                      dependencies: ['Backend implementation', 'Frontend implementation'] },
      { description: 'Integration testing',              dependencies: ['Code review'] },
    ],
    settings: { maxAgents: 6, autoRetry: true },
    tags: ['feature', 'full-stack'],
  },
  {
    id: 'bug-fix',
    name: 'Bug Investigation & Fix',
    description: 'Targeted bug fix with architect exploration and developer fix',
    roles: [
      { role: 'architect',     model: 'claude-sonnet-4.6', count: 1 },
      { role: 'developer',     model: 'claude-sonnet-4.6', count: 1 },
      { role: 'code-reviewer', model: 'claude-haiku-4.5',  count: 1 },
    ],
    initialTasks: [
      { description: 'Investigate root cause',      dependencies: [] },
      { description: 'Implement fix',               dependencies: ['Investigate root cause'] },
      { description: 'Review fix',                  dependencies: ['Implement fix'] },
      { description: 'Verify fix with tests',       dependencies: ['Review fix'] },
    ],
    settings: { maxAgents: 3 },
    tags: ['bugfix', 'quick'],
  },
  {
    id: 'docs-sprint',
    name: 'Documentation Sprint',
    description: 'Parallel documentation with tech writer and reviewer',
    roles: [
      { role: 'tech-writer',   model: 'claude-sonnet-4.6', count: 2 },
      { role: 'code-reviewer', model: 'claude-haiku-4.5',  count: 1 },
    ],
    initialTasks: [
      { description: 'Audit existing documentation',  dependencies: [] },
      { description: 'Write API documentation',        dependencies: ['Audit existing documentation'] },
      { description: 'Write user guides',              dependencies: ['Audit existing documentation'] },
      { description: 'Review all documentation',       dependencies: ['Write API documentation', 'Write user guides'] },
    ],
    settings: { maxAgents: 3 },
    tags: ['docs', 'parallel'],
  },
  {
    id: 'refactor',
    name: 'Major Refactoring',
    description: 'Systematic refactoring with architect-led design and parallel implementation',
    roles: [
      { role: 'architect',         model: 'claude-opus-4.6',      count: 1 },
      { role: 'developer',         model: 'claude-sonnet-4.6',    count: 3 },
      { role: 'code-reviewer',     model: 'gemini-3-pro-preview', count: 1 },
      { role: 'critical-reviewer', model: 'claude-opus-4.6',      count: 1 },
    ],
    initialTasks: [
      { description: 'Design refactoring plan',             dependencies: [] },
      { description: 'Extract module A',                    dependencies: ['Design refactoring plan'] },
      { description: 'Extract module B',                    dependencies: ['Design refactoring plan'] },
      { description: 'Extract module C',                    dependencies: ['Design refactoring plan'] },
      { description: 'Integration + regression tests',      dependencies: ['Extract module A', 'Extract module B', 'Extract module C'] },
      { description: 'Critical review',                     dependencies: ['Integration + regression tests'] },
    ],
    settings: { maxAgents: 6, autoRetry: true },
    tags: ['refactor', 'large'],
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Security-focused review with critical reviewer and developer fixes',
    roles: [
      { role: 'critical-reviewer', model: 'claude-opus-4.6',   count: 1 },
      { role: 'developer',         model: 'claude-sonnet-4.6', count: 1 },
    ],
    initialTasks: [
      { description: 'Scan for vulnerabilities', dependencies: [] },
      { description: 'Fix critical issues',      dependencies: ['Scan for vulnerabilities'] },
      { description: 'Verify fixes',             dependencies: ['Fix critical issues'] },
    ],
    settings: { maxAgents: 2 },
    tags: ['security', 'audit'],
  },
];

// ── Registry ─────────────────────────────────────────────────────────────────

export class ProjectTemplateRegistry {
  private templates: Map<string, ProjectTemplate> = new Map();

  constructor() {
    for (const t of BUILT_IN_TEMPLATES) this.templates.set(t.id, t);
  }

  /** Get a template by ID */
  get(id: string): ProjectTemplate | undefined {
    return this.templates.get(id);
  }

  /** Get all templates */
  getAll(): ProjectTemplate[] {
    return [...this.templates.values()];
  }

  /**
   * Add a new custom template.
   * @throws {Error} if a template with the same ID already exists.
   */
  add(template: ProjectTemplate): void {
    if (this.templates.has(template.id)) {
      throw new Error(`Template '${template.id}' already exists`);
    }
    this.templates.set(template.id, template);
  }

  /** Remove a template by ID. Returns true if it existed and was removed. */
  remove(id: string): boolean {
    return this.templates.delete(id);
  }

  /** Find templates that include the given tag */
  findByTag(tag: string): ProjectTemplate[] {
    return this.getAll().filter(t => t.tags.includes(tag));
  }

  /** Find templates whose name, description, or tags contain the keyword (case-insensitive) */
  findByKeyword(keyword: string): ProjectTemplate[] {
    const kw = keyword.toLowerCase();
    return this.getAll().filter(t =>
      t.name.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw) ||
      t.tags.some(tag => tag.includes(kw)),
    );
  }
}
