/**
 * TaskDecomposer — Natural language task description → structured sub-tasks.
 *
 * Uses keyword matching against known template patterns to pick the best
 * template, then customizes the titles with the user's description.
 * Falls back to a generic implement → test → review chain when no template matches.
 */
import type { TaskTemplateRegistry, TaskTemplate } from './TaskTemplates.js';

// ── Public types ────────────────────────────────────────────────────────

export interface DecomposedTask {
  title: string;
  role: string;
  /** Refs into sibling tasks by their position index ("0", "1", …) */
  dependsOn: string[];
}

export interface DecompositionResult {
  /** Template ID used, if any matched */
  template?: string;
  tasks: DecomposedTask[];
  /** Confidence in the match, 0–1 */
  confidence: number;
}

// ── Keyword patterns per template ───────────────────────────────────────

const TEMPLATE_PATTERNS: Record<string, string[]> = {
  'feature':          ['feature', 'implement', 'add', 'create', 'build', 'new'],
  'bugfix':           ['bug', 'fix', 'broken', 'error', 'crash', 'issue', 'defect'],
  'refactor':         ['refactor', 'restructure', 'reorganize', 'decompose', 'split', 'clean up'],
  'docs':             ['document', 'docs', 'readme', 'documentation', 'write docs', 'update docs'],
  'parallel-feature': ['parallel', 'split into', 'multiple tracks', 'concurrent'],
};

// ── TaskDecomposer ──────────────────────────────────────────────────────

export class TaskDecomposer {
  constructor(private templates: TaskTemplateRegistry) {}

  /**
   * Decompose a natural language task description into sub-tasks.
   *
   * Returns the best-matching template's task structure with titles
   * customized to reflect the actual description. Falls back to a
   * simple three-step chain when no template matches well enough.
   */
  decompose(description: string): DecompositionResult {
    const lower = description.toLowerCase();

    const match = this.matchTemplate(lower);
    if (match) {
      const tasks: DecomposedTask[] = match.template.tasks.map(t => ({
        title:     this.customizeTitle(t.title, description),
        role:      t.role,
        dependsOn: t.dependsOn ?? [],
      }));
      return { template: match.template.id, tasks, confidence: match.confidence };
    }

    return this.simpleDecompose(description);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private matchTemplate(text: string): { template: TaskTemplate; confidence: number } | null {
    const scores: Array<{ template: TaskTemplate; confidence: number }> = [];

    for (const template of this.templates.getAll()) {
      const keywords = TEMPLATE_PATTERNS[template.id] ?? [];
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score += 0.2;
      }
      if (score > 0) {
        scores.push({ template, confidence: Math.min(score, 0.95) });
      }
    }

    scores.sort((a, b) => b.confidence - a.confidence);
    return scores[0] ?? null;
  }

  /** Generic three-step decomposition when no template matches */
  private simpleDecompose(description: string): DecompositionResult {
    return {
      tasks: [
        { title: description,             role: 'developer',     dependsOn: [] },
        { title: `Test: ${description}`,  role: 'developer',     dependsOn: ['0'] },
        { title: `Review: ${description}`, role: 'code-reviewer', dependsOn: ['1'] },
      ],
      confidence: 0.3,
    };
  }

  /**
   * Blend the template step title with the user's description subject.
   * Strips common leading verbs ("implement", "add", …) to avoid redundancy.
   */
  private customizeTitle(templateTitle: string, description: string): string {
    const subject = description
      .slice(0, 80)
      .replace(/^(implement|add|create|fix|refactor|build|write)\s+/i, '');
    return `${templateTitle}: ${subject}`;
  }
}
