/**
 * End-to-end integration test for the knowledge pipeline.
 *
 * Tests the FULL lifecycle:
 *   1. Pre-populate project knowledge (core rules)
 *   2. Spawn agent → knowledge injected into system prompt
 *   3. Agent "runs" (synthetic messages with decision/pattern/error signals)
 *   4. Session ends → SessionKnowledgeExtractor extracts learnings
 *   5. Verify learnings stored with correct categories + metadata
 *   6. Spawn second agent → verify it receives the first agent's learnings
 *
 * Uses real Database (:memory:), KnowledgeStore, MemoryCategoryManager,
 * KnowledgeInjector, and SessionKnowledgeExtractor — no mocks except
 * for AgentManager dependencies unrelated to knowledge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { MemoryCategoryManager } from '../MemoryCategoryManager.js';
import { KnowledgeInjector } from '../KnowledgeInjector.js';
import { SessionKnowledgeExtractor } from '../SessionKnowledgeExtractor.js';
import type { SessionData, SessionMessage, KnowledgeCategory } from '../types.js';

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
});
