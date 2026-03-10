/**
 * End-to-end integration test for the knowledge pipeline.
 *
 * Tests the FULL lifecycle at two levels:
 *
 * A) Component-level (real DB, real knowledge components):
 *   1. Pre-populate project knowledge (core rules)
 *   2. KnowledgeInjector queries project knowledge → injects into prompt
 *   3. SessionKnowledgeExtractor extracts learnings from agent sessions
 *   4. Re-inject into next agent → verify learnings appear
 *
 * B) AgentManager-level (real AgentManager + real knowledge, mock non-knowledge deps):
 *   1. Spawn agent via AgentManager.spawn() → verify systemPrompt has knowledge
 *   2. SkillsLoader injects .github/skills/ content
 *   3. Token budget is respected
 *   4. Knowledge + skills compose correctly in the prompt
 *   5. SessionKnowledgeExtractor wired to onExit
 *
 * Uses real Database (:memory:), KnowledgeStore, MemoryCategoryManager,
 * KnowledgeInjector, SessionKnowledgeExtractor, and SkillsLoader.
 * Mocks only AgentManager deps unrelated to knowledge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { MemoryCategoryManager } from '../MemoryCategoryManager.js';
import { KnowledgeInjector } from '../KnowledgeInjector.js';
import { SessionKnowledgeExtractor } from '../SessionKnowledgeExtractor.js';
import { SkillsLoader } from '../SkillsLoader.js';
import { AgentManager } from '../../agents/AgentManager.js';
import type { SessionData, SessionMessage } from '../types.js';
import type { Role } from '@flightdeck/shared';

// Mock writeAgentFiles to avoid filesystem writes during AgentManager tests
vi.mock('../../agents/agentFiles.js', () => ({
  writeAgentFiles: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function msg(sender: string, content: string): SessionMessage {
  return { sender, content, timestamp: new Date().toISOString() };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    sessionId: 'session-001',
    projectId: 'proj-e2e',
    task: 'Build the authentication module',
    role: 'developer',
    agentId: 'agent-001',
    messages: [],
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'A developer',
    systemPrompt: 'You are a skilled developer.',
    color: '#0088ff',
    icon: '💻',
    builtIn: true,
    ...overrides,
  };
}

/** Creates a stub where any property access returns a no-op vi.fn(). */
function stubDep(): any {
  const cache: Record<string | symbol, any> = {};
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
      if (!cache[prop]) {
        cache[prop] = vi.fn().mockReturnValue([]);
      }
      return cache[prop];
    },
  });
}

function stubRegistry() {
  return {
    getRole: vi.fn((id: string) => makeRole({ id })),
    getAll: vi.fn(() => [makeRole()]),
    getAllRoles: vi.fn(() => [makeRole()]),
    generateRoleList: vi.fn(() => '- developer: Developer'),
    addRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    registerRole: vi.fn(),
    listRoles: vi.fn(() => []),
  } as any;
}

function makeConfig() {
  return {
    port: 3000,
    host: 'localhost',
    cliCommand: 'copilot',
    cliArgs: [],
    provider: 'mock',
    maxConcurrentAgents: 10,
    dbPath: ':memory:',
  };
}

/** Create a temp skills directory with the given skills. */
function createSkillsDir(skills: Array<{ name: string; description: string; content: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-e2e-'));
  for (const skill of skills) {
    const skillDir = join(dir, skill.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content}`
    );
  }
  return dir;
}

/** Create an AgentManager wired with real knowledge components. */
function createAgentManager(opts: {
  knowledgeInjector?: KnowledgeInjector;
  skillsLoader?: SkillsLoader;
  sessionKnowledgeExtractor?: SessionKnowledgeExtractor;
} = {}): AgentManager {
  const mgr = new AgentManager(
    makeConfig(),
    stubRegistry(),
    stubDep() as any,  // lockRegistry
    stubDep() as any,  // activityLedger
    stubDep() as any,  // messageBus
    stubDep() as any,  // decisionLog
    stubDep() as any,  // agentMemory
    stubDep() as any,  // chatGroupRegistry
    stubDep() as any,  // taskDAG
    {
      knowledgeInjector: opts.knowledgeInjector,
    },
  );
  if (opts.skillsLoader) {
    mgr.setSkillsLoader(opts.skillsLoader);
  }
  if (opts.sessionKnowledgeExtractor) {
    mgr.setSessionKnowledgeExtractor(opts.sessionKnowledgeExtractor);
  }
  return mgr;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Knowledge Pipeline E2E', () => {
  let db: Database;
  let store: KnowledgeStore;
  let categoryManager: MemoryCategoryManager;
  let injector: KnowledgeInjector;
  let extractor: SessionKnowledgeExtractor;

  const PROJECT_ID = 'proj-e2e';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    categoryManager = new MemoryCategoryManager(store);
    injector = new KnowledgeInjector(categoryManager);
    extractor = new SessionKnowledgeExtractor(store);
  });

  afterEach(() => {
    db.close();
  });

  // ── Phase 1: Knowledge Injection ──────────────────────────────

  describe('Phase 1: Knowledge Injection', () => {
    it('injects core knowledge into agent prompt', () => {
      // Pre-populate core knowledge
      categoryManager.putMemory(PROJECT_ID, 'core', 'project-rules', 'Always use TypeScript strict mode. Never commit secrets.');

      const result = injector.injectKnowledge(PROJECT_ID, {
        task: 'Build feature',
        role: 'developer',
      });

      expect(result.text).toContain('TypeScript strict mode');
      expect(result.text).toContain('Never commit secrets');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.entriesIncluded).toBeGreaterThanOrEqual(1);
      expect(result.breakdown.core).toBeGreaterThan(0);
    });

    it('injects multiple categories when available', () => {
      categoryManager.putMemory(PROJECT_ID, 'core', 'tech-stack', 'React + TypeScript frontend, Node.js backend');
      categoryManager.putMemory(PROJECT_ID, 'procedural', 'testing-pattern', 'Use vitest with describe/it blocks. Tests live next to source.');
      categoryManager.putMemory(PROJECT_ID, 'semantic', 'auth-decision', 'We decided to use JWT tokens for stateless authentication.');

      const result = injector.injectKnowledge(PROJECT_ID, {
        task: 'Add user authentication',
        role: 'developer',
      });

      expect(result.entriesIncluded).toBeGreaterThanOrEqual(2);
      expect(result.text).toContain('React');
      expect(result.text).toContain('vitest');
    });

    it('respects token budget', () => {
      // Add a lot of knowledge
      for (let i = 0; i < 20; i++) {
        categoryManager.putMemory(PROJECT_ID, 'procedural', `rule-${i}`,
          `This is procedural rule number ${i} with some detailed content about coding standards and best practices that should consume tokens.`);
      }

      const small = injector.injectKnowledge(PROJECT_ID, { tokenBudget: 50 });
      const large = injector.injectKnowledge(PROJECT_ID, { tokenBudget: 5000 });

      expect(small.totalTokens).toBeLessThanOrEqual(60); // some overhead tolerance
      expect(large.entriesIncluded).toBeGreaterThan(small.entriesIncluded);
    });

    it('returns empty for project with no knowledge', () => {
      const result = injector.injectKnowledge('empty-project');

      expect(result.text).toBe('');
      expect(result.totalTokens).toBe(0);
      expect(result.entriesIncluded).toBe(0);
    });
  });

  // ── Phase 2: Knowledge Extraction ─────────────────────────────

  describe('Phase 2: Knowledge Extraction', () => {
    it('extracts decisions from session messages', () => {
      const session = makeSession({
        messages: [
          msg('user', 'Should we use REST or GraphQL?'),
          msg('agent', 'We decided to use REST because the API is simple CRUD and GraphQL adds unnecessary complexity.'),
          msg('agent', 'The REST endpoints follow resource naming conventions.'),
        ],
      });

      const result = extractor.extractFromSession(session);

      expect(result.decisions.length).toBeGreaterThanOrEqual(1);
      expect(result.decisions[0].content).toContain('REST');
    });

    it('extracts patterns from session messages', () => {
      const session = makeSession({
        messages: [
          msg('agent', 'I noticed a pattern: all database queries should go through the repository layer, never raw SQL in route handlers.'),
          msg('agent', 'Following the repository pattern consistently.'),
          msg('agent', 'Done implementing the feature.'),
        ],
      });

      const result = extractor.extractFromSession(session);

      expect(result.patterns.length).toBeGreaterThanOrEqual(1);
      expect(result.patterns[0].content).toContain('repository');
    });

    it('extracts error resolutions from session messages', () => {
      const session = makeSession({
        messages: [
          msg('agent', 'Encountered an error: TypeError in the parser module.'),
          msg('agent', 'The bug was caused by a missing null check on line 42. Fixed by adding early return for undefined inputs.'),
          msg('agent', 'All tests pass now.'),
        ],
      });

      const result = extractor.extractFromSession(session);

      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0].content).toContain('null check');
    });

    it('generates summary from completionSummary', () => {
      const session = makeSession({
        messages: [
          msg('agent', 'Starting work on the auth module.'),
          msg('agent', 'Implementing JWT validation middleware.'),
          msg('agent', 'All tests passing.'),
        ],
        completionSummary: 'Built JWT authentication with login, logout, and token refresh endpoints.',
      });

      const result = extractor.extractFromSession(session);

      expect(result.summary).not.toBeNull();
      expect(result.summary!.content).toContain('JWT');
    });

    it('persists extracted knowledge to store', () => {
      const session = makeSession({
        messages: [
          msg('agent', 'We decided to use bcrypt for password hashing with cost factor 12.'),
          msg('agent', 'The pattern is: hash on write, compare on read, never store plaintext.'),
          msg('agent', 'Done with security implementation.'),
        ],
        completionSummary: 'Implemented secure password storage with bcrypt.',
      });

      extractor.extractFromSession(session);

      const allEntries = store.getAll(PROJECT_ID);
      expect(allEntries.length).toBeGreaterThanOrEqual(2);

      const categories = allEntries.map(e => e.category);
      expect(categories).toContain('semantic'); // decisions
      expect(categories).toContain('episodic'); // summary
    });

    it('skips extraction for sessions with fewer than 3 messages', () => {
      const session = makeSession({
        messages: [
          msg('agent', 'Starting...'),
          msg('agent', 'Aborted.'),
        ],
      });

      const result = extractor.extractFromSession(session);

      // With < 3 messages, extraction should produce minimal or no results
      // The extractor may still attempt but signals are unlikely in 2 short messages
      expect(result.entriesStored).toBeLessThanOrEqual(1);
    });
  });

  // ── Phase 3: Full Lifecycle ───────────────────────────────────

  describe('Phase 3: Full Lifecycle (inject → extract → re-inject)', () => {
    it('knowledge flows from one agent session to the next', () => {
      // STEP 1: Pre-populate some core knowledge
      categoryManager.putMemory(PROJECT_ID, 'core', 'stack', 'TypeScript + React + SQLite');

      // STEP 2: First agent gets injected knowledge
      const injection1 = injector.injectKnowledge(PROJECT_ID, {
        task: 'Build auth module',
        role: 'developer',
      });
      expect(injection1.text).toContain('TypeScript');
      expect(injection1.entriesIncluded).toBe(1);

      // STEP 3: First agent session produces learnings
      const session1 = makeSession({
        sessionId: 'session-agent-1',
        agentId: 'agent-1',
        task: 'Build auth module',
        messages: [
          msg('agent', 'Starting auth module implementation.'),
          msg('agent', 'We decided to use JWT with RS256 signing for token security.'),
          msg('agent', 'The pattern for middleware: validate token → extract user → attach to req.context.'),
          msg('agent', 'Implementation complete.'),
        ],
        completionSummary: 'Built JWT auth with RS256 signing and validation middleware.',
      });
      const extraction1 = extractor.extractFromSession(session1);
      expect(extraction1.entriesStored).toBeGreaterThanOrEqual(2);

      // STEP 4: Verify knowledge was stored
      const storedEntries = store.getAll(PROJECT_ID);
      expect(storedEntries.length).toBeGreaterThanOrEqual(3); // core + decisions + patterns + summary

      // STEP 5: Second agent spawns and gets BOTH original + learned knowledge
      const injection2 = injector.injectKnowledge(PROJECT_ID, {
        task: 'Build user profile endpoint',
        role: 'developer',
      });
      expect(injection2.entriesIncluded).toBeGreaterThan(injection1.entriesIncluded);
      expect(injection2.text).toContain('TypeScript'); // core still there
      // Learned knowledge should appear
      const hasJwt = injection2.text.toLowerCase().includes('jwt');
      const hasAuth = injection2.text.toLowerCase().includes('auth');
      expect(hasJwt || hasAuth).toBe(true);
    });

    it('multiple sessions accumulate knowledge', () => {
      // Session 1: Architecture decision
      extractor.extractFromSession(makeSession({
        sessionId: 'session-1',
        agentId: 'agent-1',
        messages: [
          msg('agent', 'Analyzing the codebase structure.'),
          msg('agent', 'We decided to use a modular monolith architecture with clear domain boundaries.'),
          msg('agent', 'Each module has its own types, store, and routes.'),
        ],
        completionSummary: 'Established modular monolith architecture.',
      }));

      // Session 2: Error fix
      extractor.extractFromSession(makeSession({
        sessionId: 'session-2',
        agentId: 'agent-2',
        messages: [
          msg('agent', 'Debugging the connection pool issue.'),
          msg('agent', 'The root cause was a connection leak in the middleware. Fixed by adding proper cleanup in finally block.'),
          msg('agent', 'All integration tests pass now.'),
        ],
        completionSummary: 'Fixed connection pool leak.',
      }));

      // Session 3: Pattern discovery
      extractor.extractFromSession(makeSession({
        sessionId: 'session-3',
        agentId: 'agent-3',
        messages: [
          msg('agent', 'Reviewing error handling across the codebase.'),
          msg('agent', 'Best practice: always wrap async route handlers in try-catch and pass errors to next().'),
          msg('agent', 'Documented the error handling pattern.'),
        ],
        completionSummary: 'Standardized error handling patterns.',
      }));

      // Verify accumulated knowledge
      const allEntries = store.getAll(PROJECT_ID);
      expect(allEntries.length).toBeGreaterThanOrEqual(5);

      // Categories should be diverse
      const categories = new Set(allEntries.map(e => e.category));
      expect(categories.size).toBeGreaterThanOrEqual(2);

      // New agent should get rich context
      const injection = injector.injectKnowledge(PROJECT_ID, {
        task: 'Add error monitoring',
        role: 'developer',
      });
      expect(injection.entriesIncluded).toBeGreaterThanOrEqual(3);
    });

    it('metadata tracks provenance (sessionId, agentId, source)', () => {
      extractor.extractFromSession(makeSession({
        sessionId: 'session-provenance',
        agentId: 'agent-provenance',
        messages: [
          msg('agent', 'Starting analysis.'),
          msg('agent', 'We decided to use event sourcing for the audit trail.'),
          msg('agent', 'Implementation complete.'),
        ],
        completionSummary: 'Implemented event sourcing for audit.',
      }));

      const entries = store.getAll(PROJECT_ID);
      const withMetadata = entries.filter(e => e.metadata);

      expect(withMetadata.length).toBeGreaterThanOrEqual(1);
      const meta = withMetadata[0].metadata!;
      expect(meta.source).toBeDefined();
    });
  });

  // ── Phase 4: Category Management ──────────────────────────────

  describe('Phase 4: Category management and limits', () => {
    it('core entries are read-only after creation', () => {
      categoryManager.putMemory(PROJECT_ID, 'core', 'immutable-rule', 'Original content');

      // Attempting to update should fail or be rejected
      expect(() => {
        categoryManager.putMemory(PROJECT_ID, 'core', 'immutable-rule', 'Modified content');
      }).toThrow();

      // Original content preserved
      const entries = store.getByCategory(PROJECT_ID, 'core');
      expect(entries[0].content).toContain('Original content');
    });

    it('episodic entries are auto-evicted when exceeding category limit', () => {
      // Default episodic limit is 100 entries
      // putMemory auto-evicts when exceeding maxEntries
      for (let i = 0; i < 105; i++) {
        categoryManager.putMemory(PROJECT_ID, 'episodic', `episode-${i}`,
          `Session summary ${i}`);
      }

      const remaining = store.getByCategory(PROJECT_ID, 'episodic');
      expect(remaining.length).toBeLessThanOrEqual(100);

      // Verify pruneEpisodic works with a tighter limit
      const pruneResult = categoryManager.pruneEpisodic(PROJECT_ID, undefined, 50);
      expect(pruneResult.removedByCount).toBeGreaterThanOrEqual(50);

      const afterPrune = store.getByCategory(PROJECT_ID, 'episodic');
      expect(afterPrune.length).toBeLessThanOrEqual(50);
    });

    it('knowledge from different projects is isolated', () => {
      const PROJECT_A = 'proj-alpha';
      const PROJECT_B = 'proj-beta';

      categoryManager.putMemory(PROJECT_A, 'core', 'stack', 'Python + Django');
      categoryManager.putMemory(PROJECT_B, 'core', 'stack', 'TypeScript + Express');

      const injectionA = injector.injectKnowledge(PROJECT_A);
      const injectionB = injector.injectKnowledge(PROJECT_B);

      expect(injectionA.text).toContain('Python');
      expect(injectionA.text).not.toContain('TypeScript');
      expect(injectionB.text).toContain('TypeScript');
      expect(injectionB.text).not.toContain('Python');
    });
  });

  // ── Phase 5: AgentManager Integration ─────────────────────────

  describe('Phase 5: AgentManager spawns with real knowledge injection', () => {
    it('spawned agent system prompt includes injected project knowledge', () => {
      categoryManager.putMemory(PROJECT_ID, 'core', 'stack', 'TypeScript + React + SQLite');
      categoryManager.putMemory(PROJECT_ID, 'procedural', 'testing', 'Use vitest with describe/it blocks.');

      const mgr = createAgentManager({ knowledgeInjector: injector });
      const agent = mgr.spawn(
        makeRole(), 'Build auth module',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      expect(agent.role.systemPrompt).toContain('You are a skilled developer.');
      expect(agent.role.systemPrompt).toContain('TypeScript');
      expect(agent.role.systemPrompt).toContain('vitest');
      mgr.terminate(agent.id);
    });

    it('empty project yields unmodified system prompt', () => {
      const mgr = createAgentManager({ knowledgeInjector: injector });
      const agent = mgr.spawn(
        makeRole(), 'Build feature',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: 'empty-project' },
      );

      expect(agent.role.systemPrompt).toBe('You are a skilled developer.');
      mgr.terminate(agent.id);
    });

    it('multiple agents in same project share knowledge', () => {
      categoryManager.putMemory(PROJECT_ID, 'core', 'rules', 'Always review PRs before merge.');

      const mgr = createAgentManager({ knowledgeInjector: injector });

      const agent1 = mgr.spawn(
        makeRole({ id: 'developer' }), 'Task A',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );
      const agent2 = mgr.spawn(
        makeRole({ id: 'architect' }), 'Task B',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      expect(agent1.role.systemPrompt).toContain('review PRs');
      expect(agent2.role.systemPrompt).toContain('review PRs');
      mgr.terminate(agent1.id);
      mgr.terminate(agent2.id);
    });

    it('full lifecycle: extract from session → spawn new agent → gets learned knowledge', () => {
      // Step 1: Pre-populate core knowledge
      categoryManager.putMemory(PROJECT_ID, 'core', 'stack', 'TypeScript + SQLite');

      // Step 2: First agent spawns and gets core knowledge
      const mgr = createAgentManager({
        knowledgeInjector: injector,
        sessionKnowledgeExtractor: extractor,
      });
      const agent1 = mgr.spawn(
        makeRole(), 'Build auth',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );
      expect(agent1.role.systemPrompt).toContain('TypeScript');
      expect(agent1.role.systemPrompt).not.toContain('JWT');
      mgr.terminate(agent1.id);

      // Step 3: Simulate first agent's session producing learnings
      // (Direct call — AgentManager.onExit calls this internally but requires
      // message history which needs a real adapter. Component-level is correct here.)
      extractor.extractFromSession(makeSession({
        sessionId: 'session-agent-1',
        agentId: agent1.id,
        messages: [
          msg('agent', 'Starting auth module implementation.'),
          msg('agent', 'We decided to use JWT with RS256 signing for token security.'),
          msg('agent', 'The pattern for middleware: validate token, extract user, attach to context.'),
          msg('agent', 'Implementation complete.'),
        ],
        completionSummary: 'Built JWT auth with RS256 signing and validation middleware.',
      }));

      // Step 4: Verify learnings were stored
      const stored = store.getAll(PROJECT_ID);
      expect(stored.length).toBeGreaterThanOrEqual(3); // core + extracted

      // Step 5: Second agent spawns via AgentManager → gets BOTH core + learned knowledge
      const agent2 = mgr.spawn(
        makeRole(), 'Build user profile',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      const prompt2 = agent2.role.systemPrompt;
      expect(prompt2).toContain('TypeScript');  // core still there
      const hasLearnedKnowledge =
        prompt2.toLowerCase().includes('jwt') ||
        prompt2.toLowerCase().includes('auth') ||
        prompt2.toLowerCase().includes('rs256');
      expect(hasLearnedKnowledge).toBe(true);
      mgr.terminate(agent2.id);
    });

    it('session extractor is wired and does not crash on terminate', () => {
      // Verifies the extractor is set up — terminate() triggers onExit which
      // calls extractSessionKnowledge. With no message history, extraction
      // gracefully skips (< 3 messages).
      const mgr = createAgentManager({
        knowledgeInjector: injector,
        sessionKnowledgeExtractor: extractor,
      });
      const agent = mgr.spawn(
        makeRole(), 'Quick task',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      // Should not throw — extraction gracefully handles empty history
      expect(() => mgr.terminate(agent.id)).not.toThrow();
    });
  });

  // ── Phase 6: SkillsLoader Integration ─────────────────────────

  describe('Phase 6: SkillsLoader integration via AgentManager', () => {
    let skillsDir: string;

    afterEach(() => {
      if (skillsDir) {
        rmSync(skillsDir, { recursive: true, force: true });
      }
    });

    it('skills from .github/skills/ appear in agent system prompt', () => {
      skillsDir = createSkillsDir([
        { name: 'testing-conventions', description: 'Testing standards', content: 'Always use vitest. Test files live next to source.' },
        { name: 'error-handling', description: 'Error patterns', content: 'Wrap async handlers in try-catch. Use custom error classes.' },
      ]);

      const loader = new SkillsLoader(skillsDir);
      loader.loadAll();

      const mgr = createAgentManager({ skillsLoader: loader });
      const agent = mgr.spawn(makeRole(), 'Build feature');

      expect(agent.role.systemPrompt).toContain('Project Skills');
      expect(agent.role.systemPrompt).toContain('vitest');
      expect(agent.role.systemPrompt).toContain('try-catch');
      mgr.terminate(agent.id);
    });

    it('knowledge + skills compose correctly in prompt order', () => {
      categoryManager.putMemory(PROJECT_ID, 'core', 'stack', 'TypeScript + React');

      skillsDir = createSkillsDir([
        { name: 'code-style', description: 'Style guide', content: 'Use Prettier and ESLint.' },
      ]);
      const loader = new SkillsLoader(skillsDir);
      loader.loadAll();

      const mgr = createAgentManager({
        knowledgeInjector: injector,
        skillsLoader: loader,
      });
      const agent = mgr.spawn(
        makeRole(), 'Build feature',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      const prompt = agent.role.systemPrompt;
      // Order: base prompt → knowledge → skills
      const baseIdx = prompt.indexOf('You are a skilled developer.');
      const knowledgeIdx = prompt.indexOf('TypeScript');
      const skillsIdx = prompt.indexOf('Project Skills');

      expect(baseIdx).toBeLessThan(knowledgeIdx);
      expect(knowledgeIdx).toBeLessThan(skillsIdx);
      mgr.terminate(agent.id);
    });

    it('skills token budget limits injection size', () => {
      // Create a skill with a lot of content
      const longContent = 'This is a detailed coding standard. '.repeat(200);
      skillsDir = createSkillsDir([
        { name: 'verbose-skill', description: 'Very detailed skill', content: longContent },
      ]);

      const loader = new SkillsLoader(skillsDir);
      loader.loadAll();

      // Small budget should truncate
      const small = loader.formatForInjection(50);
      const large = loader.formatForInjection(5000);

      // Small budget should still produce something (at least truncated header)
      if (small) {
        expect(small.length).toBeLessThan(large.length);
      }
      expect(large).toContain('coding standard');
    });

    it('empty skills directory yields unmodified prompt', () => {
      skillsDir = mkdtempSync(join(tmpdir(), 'skills-empty-'));

      const loader = new SkillsLoader(skillsDir);
      loader.loadAll();

      const mgr = createAgentManager({ skillsLoader: loader });
      const agent = mgr.spawn(makeRole(), 'Task');

      expect(agent.role.systemPrompt).toBe('You are a skilled developer.');
      mgr.terminate(agent.id);
    });

    it('nonexistent skills directory is handled gracefully', () => {
      const loader = new SkillsLoader('/tmp/nonexistent-skills-dir-xyz');
      loader.loadAll();

      const mgr = createAgentManager({ skillsLoader: loader });
      const agent = mgr.spawn(makeRole(), 'Task');

      expect(agent.role.systemPrompt).toBe('You are a skilled developer.');
      mgr.terminate(agent.id);
    });

    it('full pipeline: knowledge + skills + extraction lifecycle', () => {
      // This is the ultimate integration test:
      // Pre-populate knowledge + skills → spawn agent → verify prompt → extract → re-spawn

      // 1. Pre-populate project knowledge
      categoryManager.putMemory(PROJECT_ID, 'core', 'architecture', 'Modular monolith with DI container');

      // 2. Set up skills
      skillsDir = createSkillsDir([
        { name: 'commit-conventions', description: 'Git commit rules', content: 'Use conventional commits. Always sign off.' },
      ]);
      const loader = new SkillsLoader(skillsDir);
      loader.loadAll();

      // 3. Create fully-wired AgentManager
      const mgr = createAgentManager({
        knowledgeInjector: injector,
        skillsLoader: loader,
        sessionKnowledgeExtractor: extractor,
      });

      // 4. First agent: has knowledge + skills
      const agent1 = mgr.spawn(
        makeRole(), 'Initial setup',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );
      expect(agent1.role.systemPrompt).toContain('Modular monolith');
      expect(agent1.role.systemPrompt).toContain('conventional commits');
      mgr.terminate(agent1.id);

      // 5. Simulate first agent's session extraction
      extractor.extractFromSession(makeSession({
        sessionId: 'session-full-pipeline',
        agentId: agent1.id,
        messages: [
          msg('agent', 'Setting up the project structure.'),
          msg('agent', 'We decided to use barrel exports for clean module boundaries.'),
          msg('agent', 'Best practice: each module exports types, service, and routes from index.ts.'),
          msg('agent', 'Setup complete.'),
        ],
        completionSummary: 'Established module boundary conventions with barrel exports.',
      }));

      // 6. Second agent gets everything: core + learned + skills
      const agent2 = mgr.spawn(
        makeRole({ id: 'architect' }), 'Design new module',
        undefined, false, undefined, undefined, undefined, undefined,
        { projectId: PROJECT_ID },
      );

      const prompt2 = agent2.role.systemPrompt;
      expect(prompt2).toContain('Modular monolith');       // core knowledge
      expect(prompt2).toContain('conventional commits');    // skills
      const hasLearned =
        prompt2.toLowerCase().includes('barrel') ||
        prompt2.toLowerCase().includes('module boundar');
      expect(hasLearned).toBe(true);                       // extracted learning
      mgr.terminate(agent2.id);
    });
  });
});
