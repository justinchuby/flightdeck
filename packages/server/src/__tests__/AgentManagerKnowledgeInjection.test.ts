import { describe, it, expect, vi } from 'vitest';
import type { InjectionContext, InjectionResult } from '../knowledge/KnowledgeInjector.js';
import type { KnowledgeCategory } from '../knowledge/types.js';

/**
 * Tests for the knowledge injection logic in AgentManager.spawn().
 *
 * AgentManager is too complex to instantiate with full deps, so we
 * extract and mirror the injection logic for focused unit testing.
 */

// ── Mock types mirroring AgentManager internals ─────────────────────

interface MockRole {
  id: string;
  name: string;
  systemPrompt: string;
}

interface MockKnowledgeInjector {
  injectKnowledge(projectId: string, context?: InjectionContext): InjectionResult;
}

const EMPTY_BREAKDOWN: Record<KnowledgeCategory, number> = {
  core: 0,
  procedural: 0,
  semantic: 0,
  episodic: 0,
};

/**
 * Mirror of the knowledge injection block in AgentManager.spawn().
 * Applies knowledge to effectiveRole.systemPrompt when injector + projectId are present.
 */
function applyKnowledgeInjection(
  role: MockRole,
  knowledgeInjector: MockKnowledgeInjector | undefined,
  effectiveProjectId: string | undefined,
  task?: string,
): { effectiveRole: MockRole; injection: InjectionResult | null } {
  let effectiveRole = { ...role };
  let injection: InjectionResult | null = null;

  if (knowledgeInjector && effectiveProjectId) {
    const injectionCtx: InjectionContext = {
      task: task || undefined,
      role: role.id,
    };
    const result = knowledgeInjector.injectKnowledge(effectiveProjectId, injectionCtx);
    if (result.text) {
      effectiveRole = {
        ...effectiveRole,
        systemPrompt: `${effectiveRole.systemPrompt}\n\n${result.text}`,
      };
      injection = result;
    }
  }

  return { effectiveRole, injection };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AgentManager knowledge injection', () => {
  const baseRole: MockRole = {
    id: 'developer',
    name: 'Developer',
    systemPrompt: 'You are a skilled developer.',
  };

  it('injects knowledge into system prompt when injector and projectId are present', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '<project-context>\n== Project Context ==\n[Project Rules]\n- Use TypeScript strict mode\n</project-context>',
        totalTokens: 42,
        entriesIncluded: 1,
        breakdown: { ...EMPTY_BREAKDOWN, core: 42 },
      }),
    };

    const { effectiveRole, injection } = applyKnowledgeInjection(
      baseRole, injector, 'proj-123', 'Build the feature',
    );

    expect(effectiveRole.systemPrompt).toContain('You are a skilled developer.');
    expect(effectiveRole.systemPrompt).toContain('<project-context>');
    expect(effectiveRole.systemPrompt).toContain('Use TypeScript strict mode');
    expect(injection).not.toBeNull();
    expect(injection!.entriesIncluded).toBe(1);
    expect(injection!.totalTokens).toBe(42);

    expect(injector.injectKnowledge).toHaveBeenCalledWith('proj-123', {
      task: 'Build the feature',
      role: 'developer',
    });
  });

  it('passes task and role to injection context', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '<project-context>knowledge</project-context>',
        totalTokens: 10,
        entriesIncluded: 1,
        breakdown: { ...EMPTY_BREAKDOWN, core: 10 },
      }),
    };

    applyKnowledgeInjection(baseRole, injector, 'proj-456', 'Fix the bug');

    expect(injector.injectKnowledge).toHaveBeenCalledWith('proj-456', {
      task: 'Fix the bug',
      role: 'developer',
    });
  });

  it('skips injection when no projectId is available', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn(),
    };

    const { effectiveRole, injection } = applyKnowledgeInjection(
      baseRole, injector, undefined, 'Some task',
    );

    expect(effectiveRole.systemPrompt).toBe('You are a skilled developer.');
    expect(injection).toBeNull();
    expect(injector.injectKnowledge).not.toHaveBeenCalled();
  });

  it('skips injection when no knowledgeInjector is configured', () => {
    const { effectiveRole, injection } = applyKnowledgeInjection(
      baseRole, undefined, 'proj-789', 'Some task',
    );

    expect(effectiveRole.systemPrompt).toBe('You are a skilled developer.');
    expect(injection).toBeNull();
  });

  it('skips injection when injector returns empty text', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '',
        totalTokens: 0,
        entriesIncluded: 0,
        breakdown: EMPTY_BREAKDOWN,
      }),
    };

    const { effectiveRole, injection } = applyKnowledgeInjection(
      baseRole, injector, 'proj-empty',
    );

    expect(effectiveRole.systemPrompt).toBe('You are a skilled developer.');
    expect(injection).toBeNull();
  });

  it('appends knowledge after existing system prompt content', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '<project-context>\nKnowledge block\n</project-context>',
        totalTokens: 20,
        entriesIncluded: 2,
        breakdown: { ...EMPTY_BREAKDOWN, core: 10, procedural: 10 },
      }),
    };

    const { effectiveRole } = applyKnowledgeInjection(
      baseRole, injector, 'proj-append',
    );

    // Knowledge should be appended, not prepended
    const promptParts = effectiveRole.systemPrompt.split('\n\n');
    expect(promptParts[0]).toBe('You are a skilled developer.');
    expect(promptParts[1]).toContain('<project-context>');
  });

  it('converts empty task string to undefined in context', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '<project-context>data</project-context>',
        totalTokens: 5,
        entriesIncluded: 1,
        breakdown: { ...EMPTY_BREAKDOWN, core: 5 },
      }),
    };

    // Empty string task should become undefined
    applyKnowledgeInjection(baseRole, injector, 'proj-notask', '');

    expect(injector.injectKnowledge).toHaveBeenCalledWith('proj-notask', {
      task: undefined,
      role: 'developer',
    });
  });

  it('preserves original role object (no mutation)', () => {
    const injector: MockKnowledgeInjector = {
      injectKnowledge: vi.fn().mockReturnValue({
        text: '<project-context>injected</project-context>',
        totalTokens: 10,
        entriesIncluded: 1,
        breakdown: { ...EMPTY_BREAKDOWN, core: 10 },
      }),
    };

    const originalPrompt = baseRole.systemPrompt;
    applyKnowledgeInjection(baseRole, injector, 'proj-immutable');

    expect(baseRole.systemPrompt).toBe(originalPrompt);
  });
});

// ── Skills Injection Tests ──────────────────────────────────────────

interface MockSkillsLoader {
  formatForInjection(): string;
  count: number;
}

/**
 * Mirror of the skills injection block in AgentManager.spawn().
 * Appends skills content to effectiveRole.systemPrompt when loader is present.
 */
function applySkillsInjection(
  role: MockRole,
  skillsLoader: MockSkillsLoader | undefined,
): MockRole {
  let effectiveRole = { ...role };

  if (skillsLoader) {
    const skillsBlock = skillsLoader.formatForInjection();
    if (skillsBlock) {
      effectiveRole = {
        ...effectiveRole,
        systemPrompt: `${effectiveRole.systemPrompt}\n\n${skillsBlock}`,
      };
    }
  }

  return effectiveRole;
}

describe('AgentManager skills injection', () => {
  const baseRole: MockRole = {
    id: 'developer',
    name: 'Developer',
    systemPrompt: 'You are a skilled developer.',
  };

  it('injects skills into system prompt when loader has skills', () => {
    const loader: MockSkillsLoader = {
      formatForInjection: vi.fn().mockReturnValue('## Project Skills\n\n### testing-conventions\nAlways use vitest.\n\nRun tests with `npm test`.'),
      count: 1,
    };

    const result = applySkillsInjection(baseRole, loader);

    expect(result.systemPrompt).toContain('You are a skilled developer.');
    expect(result.systemPrompt).toContain('## Project Skills');
    expect(result.systemPrompt).toContain('testing-conventions');
    expect(loader.formatForInjection).toHaveBeenCalled();
  });

  it('skips injection when no skills loader is configured', () => {
    const result = applySkillsInjection(baseRole, undefined);
    expect(result.systemPrompt).toBe('You are a skilled developer.');
  });

  it('skips injection when loader returns empty string', () => {
    const loader: MockSkillsLoader = {
      formatForInjection: vi.fn().mockReturnValue(''),
      count: 0,
    };

    const result = applySkillsInjection(baseRole, loader);
    expect(result.systemPrompt).toBe('You are a skilled developer.');
  });

  it('appends skills after existing prompt content (including knowledge)', () => {
    const promptWithKnowledge = 'You are a skilled developer.\n\n<project-context>knowledge</project-context>';
    const roleWithKnowledge: MockRole = { ...baseRole, systemPrompt: promptWithKnowledge };

    const loader: MockSkillsLoader = {
      formatForInjection: vi.fn().mockReturnValue('## Project Skills\n\n### my-skill\nSkill content'),
      count: 1,
    };

    const result = applySkillsInjection(roleWithKnowledge, loader);

    const parts = result.systemPrompt.split('\n\n');
    expect(parts[0]).toBe('You are a skilled developer.');
    expect(parts[1]).toContain('<project-context>');
    expect(parts[2]).toContain('## Project Skills');
  });

  it('preserves original role object (no mutation)', () => {
    const loader: MockSkillsLoader = {
      formatForInjection: vi.fn().mockReturnValue('## Project Skills\n\nContent'),
      count: 1,
    };

    const originalPrompt = baseRole.systemPrompt;
    applySkillsInjection(baseRole, loader);
    expect(baseRole.systemPrompt).toBe(originalPrompt);
  });
});
