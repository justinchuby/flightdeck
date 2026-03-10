import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../db/database.js';
import { KnowledgeStore } from '../KnowledgeStore.js';
import { TrainingCapture } from '../TrainingCapture.js';
import type { Correction, Feedback } from '../types.js';

describe('TrainingCapture', () => {
  let db: Database;
  let store: KnowledgeStore;
  let capture: TrainingCapture;
  const projectId = 'test-project-training';

  beforeEach(() => {
    db = new Database(':memory:');
    store = new KnowledgeStore(db);
    capture = new TrainingCapture(store);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // captureCorrection
  // ---------------------------------------------------------------------------
  describe('captureCorrection', () => {
    const baseCorrection: Correction = {
      agentId: 'agent-dev-001',
      originalAction: 'Used any type in interface',
      correctedAction: 'Use unknown type and narrow',
    };

    it('stores a correction and returns an entry with id and timestamp', () => {
      const entry = capture.captureCorrection(projectId, baseCorrection);

      expect(entry.id).toMatch(/^correction-/);
      expect(entry.projectId).toBe(projectId);
      expect(entry.agentId).toBe('agent-dev-001');
      expect(entry.originalAction).toBe('Used any type in interface');
      expect(entry.correctedAction).toBe('Use unknown type and narrow');
      expect(entry.timestamp).toBeDefined();
      expect(entry.tags).toEqual([]);
    });

    it('stores correction with context and tags', () => {
      const correction: Correction = {
        ...baseCorrection,
        context: 'Reviewing PR #42 interface definitions',
        tags: ['code-style', 'typescript'],
      };

      const entry = capture.captureCorrection(projectId, correction);

      expect(entry.context).toBe('Reviewing PR #42 interface definitions');
      expect(entry.tags).toEqual(['code-style', 'typescript']);
    });

    it('persists correction to KnowledgeStore as procedural knowledge', () => {
      capture.captureCorrection(projectId, baseCorrection);

      const stored = store.getByCategory(projectId, 'procedural');
      expect(stored).toHaveLength(1);
      expect(stored[0].metadata?.type).toBe('correction');
      expect(stored[0].metadata?.source).toBe('user-correction');
      expect(stored[0].metadata?.agentId).toBe('agent-dev-001');
      expect(stored[0].metadata?.confidence).toBe(1.0);
    });

    it('builds searchable content from correction details', () => {
      capture.captureCorrection(projectId, {
        ...baseCorrection,
        context: 'During code review',
        tags: ['typescript'],
      });

      const stored = store.getByCategory(projectId, 'procedural');
      expect(stored).toHaveLength(1);
      expect(stored[0].content).toContain('agent-dev-001');
      expect(stored[0].content).toContain('Used any type in interface');
      expect(stored[0].content).toContain('Use unknown type and narrow');
      expect(stored[0].content).toContain('During code review');
      expect(stored[0].content).toContain('typescript');
    });

    it('stores multiple corrections with unique keys', () => {
      capture.captureCorrection(projectId, baseCorrection);
      capture.captureCorrection(projectId, {
        ...baseCorrection,
        originalAction: 'Used console.log',
        correctedAction: 'Use logger.debug',
      });

      const stored = store.getByCategory(projectId, 'procedural');
      expect(stored).toHaveLength(2);
      expect(stored[0].key).not.toBe(stored[1].key);
    });
  });

  // ---------------------------------------------------------------------------
  // captureFeedback
  // ---------------------------------------------------------------------------
  describe('captureFeedback', () => {
    const baseFeedback: Feedback = {
      agentId: 'agent-dev-002',
      action: 'Wrote comprehensive test suite',
      rating: 'positive',
    };

    it('stores positive feedback and returns an entry', () => {
      const entry = capture.captureFeedback(projectId, baseFeedback);

      expect(entry.id).toMatch(/^feedback-/);
      expect(entry.projectId).toBe(projectId);
      expect(entry.agentId).toBe('agent-dev-002');
      expect(entry.action).toBe('Wrote comprehensive test suite');
      expect(entry.rating).toBe('positive');
      expect(entry.timestamp).toBeDefined();
      expect(entry.tags).toEqual([]);
    });

    it('stores negative feedback with comment and tags', () => {
      const feedback: Feedback = {
        agentId: 'agent-dev-003',
        action: 'Committed without running tests',
        rating: 'negative',
        comment: 'Always run tests before committing',
        tags: ['workflow', 'testing'],
      };

      const entry = capture.captureFeedback(projectId, feedback);

      expect(entry.rating).toBe('negative');
      expect(entry.comment).toBe('Always run tests before committing');
      expect(entry.tags).toEqual(['workflow', 'testing']);
    });

    it('persists feedback to KnowledgeStore as episodic knowledge', () => {
      capture.captureFeedback(projectId, baseFeedback);

      const stored = store.getByCategory(projectId, 'episodic');
      expect(stored).toHaveLength(1);
      expect(stored[0].metadata?.type).toBe('feedback');
      expect(stored[0].metadata?.source).toBe('user-feedback');
      expect(stored[0].metadata?.rating).toBe('positive');
    });

    it('builds searchable content from feedback details', () => {
      capture.captureFeedback(projectId, {
        ...baseFeedback,
        comment: 'Great work on the vitest setup',
        tags: ['testing'],
      });

      const stored = store.getByCategory(projectId, 'episodic');
      expect(stored).toHaveLength(1);
      expect(stored[0].content).toContain('Positive feedback');
      expect(stored[0].content).toContain('agent-dev-002');
      expect(stored[0].content).toContain('Great work on the vitest setup');
    });
  });

  // ---------------------------------------------------------------------------
  // getCorrections
  // ---------------------------------------------------------------------------
  describe('getCorrections', () => {
    beforeEach(() => {
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'Used var',
        correctedAction: 'Use const',
        tags: ['code-style', 'javascript'],
      });
      capture.captureCorrection(projectId, {
        agentId: 'agent-b',
        originalAction: 'Skipped error handling',
        correctedAction: 'Always wrap in try-catch',
        tags: ['error-handling'],
      });
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'Used git add -A',
        correctedAction: 'Use git add with specific files',
        tags: ['git', 'workflow'],
      });
    });

    it('returns all corrections for a project', () => {
      const corrections = capture.getCorrections(projectId);
      expect(corrections).toHaveLength(3);
    });

    it('filters by tags', () => {
      const corrections = capture.getCorrections(projectId, { tags: ['code-style'] });
      expect(corrections).toHaveLength(1);
      expect(corrections[0].correctedAction).toBe('Use const');
    });

    it('filters by multiple tags (OR logic)', () => {
      const corrections = capture.getCorrections(projectId, {
        tags: ['code-style', 'git'],
      });
      expect(corrections).toHaveLength(2);
    });

    it('filters by agentId', () => {
      const corrections = capture.getCorrections(projectId, { agentId: 'agent-a' });
      expect(corrections).toHaveLength(2);
    });

    it('combines tag and agentId filters', () => {
      const corrections = capture.getCorrections(projectId, {
        tags: ['git'],
        agentId: 'agent-a',
      });
      expect(corrections).toHaveLength(1);
      expect(corrections[0].correctedAction).toBe('Use git add with specific files');
    });

    it('respects limit option', () => {
      const corrections = capture.getCorrections(projectId, { limit: 2 });
      expect(corrections).toHaveLength(2);
    });

    it('returns empty array when no corrections exist', () => {
      const corrections = capture.getCorrections('empty-project');
      expect(corrections).toHaveLength(0);
    });

    it('does not return corrections from other projects', () => {
      capture.captureCorrection('other-project', {
        agentId: 'agent-x',
        originalAction: 'Bad thing',
        correctedAction: 'Good thing',
      });

      const corrections = capture.getCorrections(projectId);
      expect(corrections).toHaveLength(3);
      expect(corrections.every((c) => c.projectId === projectId)).toBe(true);
    });

    it('ignores non-correction procedural entries', () => {
      // Manually insert a non-correction procedural entry
      store.put(projectId, 'procedural', 'manual-pattern', 'Some pattern', {
        type: 'pattern',
        source: 'auto',
      });

      const corrections = capture.getCorrections(projectId);
      expect(corrections).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getFeedback
  // ---------------------------------------------------------------------------
  describe('getFeedback', () => {
    beforeEach(() => {
      capture.captureFeedback(projectId, {
        agentId: 'agent-a',
        action: 'Wrote clean code',
        rating: 'positive',
        tags: ['code-quality'],
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-b',
        action: 'Broke the build',
        rating: 'negative',
        tags: ['ci', 'workflow'],
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-a',
        action: 'Good test coverage',
        rating: 'positive',
        tags: ['testing'],
      });
    });

    it('returns all feedback for a project', () => {
      const feedback = capture.getFeedback(projectId);
      expect(feedback).toHaveLength(3);
    });

    it('filters by tags', () => {
      const feedback = capture.getFeedback(projectId, { tags: ['ci'] });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].rating).toBe('negative');
    });

    it('filters by agentId', () => {
      const feedback = capture.getFeedback(projectId, { agentId: 'agent-a' });
      expect(feedback).toHaveLength(2);
      expect(feedback.every((f) => f.agentId === 'agent-a')).toBe(true);
    });

    it('respects limit option', () => {
      const feedback = capture.getFeedback(projectId, { limit: 1 });
      expect(feedback).toHaveLength(1);
    });

    it('returns empty array when no feedback exists', () => {
      const feedback = capture.getFeedback('empty-project');
      expect(feedback).toHaveLength(0);
    });

    it('ignores non-feedback episodic entries', () => {
      store.put(projectId, 'episodic', 'session-summary', 'Session 1 complete', {
        type: 'session',
        source: 'auto',
      });

      const feedback = capture.getFeedback(projectId);
      expect(feedback).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getTrainingSummary
  // ---------------------------------------------------------------------------
  describe('getTrainingSummary', () => {
    it('returns empty summary for a project with no data', () => {
      const summary = capture.getTrainingSummary('empty-project');

      expect(summary.totalCorrections).toBe(0);
      expect(summary.totalFeedback).toBe(0);
      expect(summary.positiveFeedback).toBe(0);
      expect(summary.negativeFeedback).toBe(0);
      expect(summary.topCorrectionTags).toEqual([]);
      expect(summary.topFeedbackTags).toEqual([]);
      expect(summary.agentStats).toEqual([]);
    });

    it('computes correct totals', () => {
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X',
        correctedAction: 'Y',
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-a',
        action: 'Good',
        rating: 'positive',
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-a',
        action: 'Bad',
        rating: 'negative',
      });

      const summary = capture.getTrainingSummary(projectId);

      expect(summary.totalCorrections).toBe(1);
      expect(summary.totalFeedback).toBe(2);
      expect(summary.positiveFeedback).toBe(1);
      expect(summary.negativeFeedback).toBe(1);
    });

    it('ranks tags by frequency', () => {
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X1',
        correctedAction: 'Y1',
        tags: ['git', 'workflow'],
      });
      capture.captureCorrection(projectId, {
        agentId: 'agent-b',
        originalAction: 'X2',
        correctedAction: 'Y2',
        tags: ['git', 'code-style'],
      });
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X3',
        correctedAction: 'Y3',
        tags: ['testing'],
      });

      const summary = capture.getTrainingSummary(projectId);

      expect(summary.topCorrectionTags[0]).toEqual({ tag: 'git', count: 2 });
      expect(summary.topCorrectionTags).toHaveLength(4);
    });

    it('computes per-agent statistics', () => {
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X',
        correctedAction: 'Y',
      });
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X2',
        correctedAction: 'Y2',
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-a',
        action: 'Good work',
        rating: 'positive',
      });
      capture.captureFeedback(projectId, {
        agentId: 'agent-b',
        action: 'Broke stuff',
        rating: 'negative',
      });

      const summary = capture.getTrainingSummary(projectId);

      // agent-a has the most interactions → first
      expect(summary.agentStats[0]).toEqual({
        agentId: 'agent-a',
        corrections: 2,
        positive: 1,
        negative: 0,
      });
      expect(summary.agentStats[1]).toEqual({
        agentId: 'agent-b',
        corrections: 0,
        positive: 0,
        negative: 1,
      });
    });

    it('handles feedback tags separately from correction tags', () => {
      capture.captureCorrection(projectId, {
        agentId: 'a',
        originalAction: 'X',
        correctedAction: 'Y',
        tags: ['code-style'],
      });
      capture.captureFeedback(projectId, {
        agentId: 'a',
        action: 'Good',
        rating: 'positive',
        tags: ['workflow'],
      });

      const summary = capture.getTrainingSummary(projectId);

      expect(summary.topCorrectionTags).toEqual([{ tag: 'code-style', count: 1 }]);
      expect(summary.topFeedbackTags).toEqual([{ tag: 'workflow', count: 1 }]);
    });
  });

  // ---------------------------------------------------------------------------
  // Project isolation
  // ---------------------------------------------------------------------------
  describe('project isolation', () => {
    it('keeps corrections separate between projects', () => {
      capture.captureCorrection('project-alpha', {
        agentId: 'agent-1',
        originalAction: 'Alpha mistake',
        correctedAction: 'Alpha fix',
      });
      capture.captureCorrection('project-beta', {
        agentId: 'agent-1',
        originalAction: 'Beta mistake',
        correctedAction: 'Beta fix',
      });

      expect(capture.getCorrections('project-alpha')).toHaveLength(1);
      expect(capture.getCorrections('project-beta')).toHaveLength(1);
      expect(capture.getCorrections('project-alpha')[0].originalAction).toBe('Alpha mistake');
    });

    it('keeps feedback separate between projects', () => {
      capture.captureFeedback('project-alpha', {
        agentId: 'agent-1',
        action: 'Alpha action',
        rating: 'positive',
      });
      capture.captureFeedback('project-beta', {
        agentId: 'agent-1',
        action: 'Beta action',
        rating: 'negative',
      });

      expect(capture.getFeedback('project-alpha')).toHaveLength(1);
      expect(capture.getFeedback('project-beta')).toHaveLength(1);
    });

    it('keeps training summaries separate between projects', () => {
      capture.captureCorrection('project-alpha', {
        agentId: 'a',
        originalAction: 'X',
        correctedAction: 'Y',
      });
      capture.captureFeedback('project-beta', {
        agentId: 'b',
        action: 'Z',
        rating: 'positive',
      });

      const alphaSummary = capture.getTrainingSummary('project-alpha');
      const betaSummary = capture.getTrainingSummary('project-beta');

      expect(alphaSummary.totalCorrections).toBe(1);
      expect(alphaSummary.totalFeedback).toBe(0);
      expect(betaSummary.totalCorrections).toBe(0);
      expect(betaSummary.totalFeedback).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('handles corrections with empty tags array', () => {
      const entry = capture.captureCorrection(projectId, {
        agentId: 'agent-1',
        originalAction: 'Bad',
        correctedAction: 'Good',
        tags: [],
      });

      expect(entry.tags).toEqual([]);
    });

    it('handles feedback without optional fields', () => {
      const entry = capture.captureFeedback(projectId, {
        agentId: 'agent-1',
        action: 'Something',
        rating: 'positive',
      });

      expect(entry.comment).toBeUndefined();
      expect(entry.tags).toEqual([]);
    });

    it('handles limit of 0', () => {
      capture.captureCorrection(projectId, {
        agentId: 'a',
        originalAction: 'X',
        correctedAction: 'Y',
      });

      const corrections = capture.getCorrections(projectId, { limit: 0 });
      expect(corrections).toHaveLength(0);
    });

    it('handles filtering with no matching tags', () => {
      capture.captureCorrection(projectId, {
        agentId: 'a',
        originalAction: 'X',
        correctedAction: 'Y',
        tags: ['git'],
      });

      const corrections = capture.getCorrections(projectId, { tags: ['nonexistent'] });
      expect(corrections).toHaveLength(0);
    });

    it('handles filtering with no matching agentId', () => {
      capture.captureCorrection(projectId, {
        agentId: 'agent-a',
        originalAction: 'X',
        correctedAction: 'Y',
      });

      const corrections = capture.getCorrections(projectId, { agentId: 'agent-z' });
      expect(corrections).toHaveLength(0);
    });
  });
});
