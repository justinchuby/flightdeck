import type { KnowledgeStore } from './KnowledgeStore.js';
import { sanitizeContent } from './KnowledgeInjector.js';
import type {
  SessionData,
  SessionMessage,
  ExtractedKnowledge,
  ExtractionResult,
  KnowledgeMetadata,
} from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Extracts knowledge from completed agent sessions and stores it
 * in the KnowledgeStore for future injection into agent prompts.
 *
 * Extraction types:
 * - **Decisions** (semantic): Architectural/design choices and their rationale
 * - **Patterns** (procedural): Reusable approaches, workflows, best practices
 * - **Error resolutions** (procedural): Bug fixes, debugging strategies
 * - **Session summary** (episodic): What happened, what was accomplished
 */
export class SessionKnowledgeExtractor {
  constructor(private store: KnowledgeStore) {}

  /**
   * Extract knowledge from a completed session and store it.
   * Returns details of what was extracted and stored.
   */
  extractFromSession(sessionData: SessionData): ExtractionResult {
    const { projectId, messages } = sessionData;

    if (!messages.length) {
      return { entriesStored: 0, decisions: [], patterns: [], errors: [], summary: null };
    }

    const decisions = this.extractDecisions(sessionData);
    const patterns = this.extractPatterns(sessionData);
    const errors = this.extractErrors(sessionData);
    const summary = this.extractSessionSummary(sessionData);

    let entriesStored = 0;
    const allEntries = [...decisions, ...patterns, ...errors];
    if (summary) allEntries.push(summary);

    for (const entry of allEntries) {
      try {
        const safeContent = sanitizeContent(entry.content);
        this.store.put(projectId, entry.category, entry.key, safeContent, entry.metadata);
        entriesStored++;
      } catch (err) {
        logger.warn({
          module: 'project',
          msg: 'Failed to store extracted knowledge',
          key: entry.key,
          err: (err as Error).message,
        });
      }
    }

    if (entriesStored > 0) {
      logger.info({
        module: 'project',
        msg: 'Session knowledge extracted',
        projectId,
        sessionId: sessionData.sessionId,
        entriesStored,
        decisions: decisions.length,
        patterns: patterns.length,
        errors: errors.length,
        hasSummary: !!summary,
      });
    }

    return { entriesStored, decisions, patterns, errors, summary };
  }

  /**
   * Extract architectural and design decisions from session messages.
   * Looks for decision signals: "decided", "chose", "going with", "selected", etc.
   */
  extractDecisions(sessionData: SessionData): ExtractedKnowledge[] {
    const results: ExtractedKnowledge[] = [];
    const seen = new Set<string>();

    for (const msg of sessionData.messages) {
      const sentences = extractSignalSentences(msg.content, DECISION_SIGNALS);
      for (const sentence of sentences) {
        const normalized = sentence.toLowerCase().trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        results.push({
          category: 'semantic',
          key: makeKey(sessionData.sessionId, 'decision', results.length + 1),
          content: sentence,
          metadata: buildMetadata(sessionData, msg, 'decision'),
        });
      }
    }

    return results;
  }

  /**
   * Extract reusable patterns and workflows from session messages.
   * Looks for pattern signals: "pattern", "approach", "workflow", "always", "never", etc.
   */
  extractPatterns(sessionData: SessionData): ExtractedKnowledge[] {
    const results: ExtractedKnowledge[] = [];
    const seen = new Set<string>();

    for (const msg of sessionData.messages) {
      const sentences = extractSignalSentences(msg.content, PATTERN_SIGNALS);
      for (const sentence of sentences) {
        const normalized = sentence.toLowerCase().trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        results.push({
          category: 'procedural',
          key: makeKey(sessionData.sessionId, 'pattern', results.length + 1),
          content: sentence,
          metadata: buildMetadata(sessionData, msg, 'pattern'),
        });
      }
    }

    return results;
  }

  /**
   * Extract error resolutions and debugging knowledge from session messages.
   * Looks for error signals: "fixed", "resolved", "root cause", "bug was", "workaround", etc.
   */
  extractErrors(sessionData: SessionData): ExtractedKnowledge[] {
    const results: ExtractedKnowledge[] = [];
    const seen = new Set<string>();

    for (const msg of sessionData.messages) {
      const sentences = extractSignalSentences(msg.content, ERROR_SIGNALS);
      for (const sentence of sentences) {
        const normalized = sentence.toLowerCase().trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        results.push({
          category: 'procedural',
          key: makeKey(sessionData.sessionId, 'error-resolution', results.length + 1),
          content: sentence,
          metadata: buildMetadata(sessionData, msg, 'error-resolution'),
        });
      }
    }

    return results;
  }

  /**
   * Generate an episodic session summary.
   * Uses the agent's completion summary if available, otherwise synthesizes from messages.
   */
  private extractSessionSummary(sessionData: SessionData): ExtractedKnowledge | null {
    const { completionSummary, task, messages, sessionId, role } = sessionData;

    if (completionSummary) {
      return {
        category: 'episodic',
        key: makeKey(sessionId, 'summary', 0),
        content: completionSummary,
        metadata: {
          source: `session:${sessionId}`,
          confidence: 0.9,
          tags: ['session-summary', ...(task ? [slugifyTag(task)] : [])],
          role,
          task,
          sessionId,
        },
      };
    }

    // Synthesize a summary from the last few messages if no explicit summary
    if (messages.length < 2) return null;

    const lastMessages = messages.slice(-3);
    const synthesized = lastMessages
      .map((m) => truncate(m.content, 200))
      .join(' → ');

    return {
      category: 'episodic',
      key: makeKey(sessionId, 'summary', 0),
      content: `Session ${task ? `for "${task}"` : sessionId}: ${synthesized}`,
      metadata: {
        source: `session:${sessionId}`,
        confidence: 0.6,
        tags: ['session-summary', 'auto-synthesized'],
        role,
        task,
        sessionId,
      },
    };
  }
}

// ── Signal word lists for extraction heuristics ─────────────────────

const DECISION_SIGNALS = [
  'decided to',
  'chose to',
  'going with',
  'selected',
  'we will use',
  'agreed on',
  'opted for',
  'the approach is',
  'design decision',
  'architectural decision',
  'trade-off',
  'tradeoff',
];

const PATTERN_SIGNALS = [
  'pattern',
  'best practice',
  'the approach',
  'workflow',
  'always do',
  'always use',
  'never do',
  'never use',
  'convention',
  'standard way',
  'recommended',
  'prefer',
  'rule of thumb',
  'lesson learned',
];

const ERROR_SIGNALS = [
  'fixed by',
  'fixed the',
  'resolved by',
  'root cause',
  'the bug was',
  'the issue was',
  'the fix is',
  'the fix was',
  'workaround',
  'debugging',
  'error was caused',
  'the problem was',
  'solution was',
];

// ── Helper functions ────────────────────────────────────────────────

/**
 * Extract sentences that contain signal phrases.
 * Returns the full sentence containing each signal, with surrounding context.
 */
function extractSignalSentences(content: string, signals: string[]): string[] {
  const results: string[] = [];
  // Split into sentences (rough: split on . ! ? followed by space or end)
  const sentences = content.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (signals.some((signal) => lower.includes(signal))) {
      const trimmed = sentence.trim();
      if (trimmed.length >= 20 && trimmed.length <= 500) {
        results.push(trimmed);
      }
    }
  }

  return results;
}

/**
 * Generate a safe knowledge key from session ID and type.
 * Must match /^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/
 */
function makeKey(sessionId: string, type: string, index: number): string {
  // Take first 12 chars of sessionId, sanitized
  const safeId = sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'session';
  return `s${safeId}-${type}-${index}`;
}

/** Build standard metadata for an extracted knowledge entry. */
function buildMetadata(
  sessionData: SessionData,
  msg: SessionMessage,
  extractionType: string,
): KnowledgeMetadata {
  return {
    source: `session:${sessionData.sessionId}`,
    confidence: 0.7,
    tags: [
      extractionType,
      ...(sessionData.task ? [slugifyTag(sessionData.task)] : []),
      ...(sessionData.role ? [sessionData.role] : []),
    ],
    sessionId: sessionData.sessionId,
    agentId: sessionData.agentId,
    sender: msg.sender,
    task: sessionData.task,
  };
}

/** Convert a freeform string to a safe tag. */
function slugifyTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'unknown';
}

/** Truncate a string to maxLen, adding ellipsis if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
