import { randomUUID } from 'node:crypto';
import type { KnowledgeStore } from './KnowledgeStore.js';
import type { KnowledgeEntry, KnowledgeMetadata } from './types.js';
import type {
  Correction,
  CorrectionEntry,
  Feedback,
  FeedbackEntry,
  TrainingRetrievalOptions,
  TrainingSummary,
  TagCount,
  AgentTrainingStats,
} from './types.js';

/**
 * TrainingCapture — captures user corrections and feedback as knowledge entries.
 *
 * Corrections are stored as 'procedural' knowledge (learned patterns from user feedback).
 * Feedback entries are stored as 'episodic' knowledge (observations about agent behavior).
 *
 * Uses KnowledgeStore as the persistence layer, with structured metadata
 * for filtering and retrieval.
 */
export class TrainingCapture {
  constructor(private store: KnowledgeStore) {}

  /**
   * Capture a user correction — records what an agent did wrong
   * and what the user wanted instead.
   */
  captureCorrection(projectId: string, correction: Correction): CorrectionEntry {
    const id = `correction-${randomUUID()}`;
    const content = this.buildCorrectionContent(correction);
    const metadata: KnowledgeMetadata = {
      source: 'user-correction',
      type: 'correction',
      agentId: correction.agentId,
      originalAction: correction.originalAction,
      correctedAction: correction.correctedAction,
      ...(correction.context !== undefined && { context: correction.context }),
      tags: correction.tags ?? [],
      confidence: 1.0,
    };

    const entry = this.store.put(projectId, 'procedural', id, content, metadata);

    return {
      id,
      projectId,
      timestamp: entry.createdAt,
      ...correction,
      tags: correction.tags ?? [],
    };
  }

  /**
   * Capture positive or negative feedback about an agent's action.
   */
  captureFeedback(projectId: string, feedback: Feedback): FeedbackEntry {
    const id = `feedback-${randomUUID()}`;
    const content = this.buildFeedbackContent(feedback);
    const metadata: KnowledgeMetadata = {
      source: 'user-feedback',
      type: 'feedback',
      agentId: feedback.agentId,
      action: feedback.action,
      rating: feedback.rating,
      ...(feedback.comment !== undefined && { comment: feedback.comment }),
      tags: feedback.tags ?? [],
    };

    const entry = this.store.put(projectId, 'episodic', id, content, metadata);

    return {
      id,
      projectId,
      timestamp: entry.createdAt,
      ...feedback,
      tags: feedback.tags ?? [],
    };
  }

  /**
   * Retrieve corrections for a project, optionally filtered by tags or agentId.
   */
  getCorrections(projectId: string, options?: TrainingRetrievalOptions): CorrectionEntry[] {
    const entries = this.store.getByCategory(projectId, 'procedural');
    const corrections = entries
      .filter((entry) => entry.metadata?.type === 'correction')
      .map((entry) => this.entrytoCorrectionEntry(entry));

    return this.applyFilters(corrections, options);
  }

  /**
   * Retrieve feedback for a project, optionally filtered by tags, agentId, or rating.
   */
  getFeedback(projectId: string, options?: TrainingRetrievalOptions): FeedbackEntry[] {
    const entries = this.store.getByCategory(projectId, 'episodic');
    const feedback = entries
      .filter((entry) => entry.metadata?.type === 'feedback')
      .map((entry) => this.entryToFeedbackEntry(entry));

    return this.applyFilters(feedback, options);
  }

  /**
   * Get aggregated training statistics for a project.
   */
  getTrainingSummary(projectId: string): TrainingSummary {
    const corrections = this.getCorrections(projectId);
    const feedback = this.getFeedback(projectId);

    const positiveFeedback = feedback.filter((f) => f.rating === 'positive').length;
    const negativeFeedback = feedback.filter((f) => f.rating === 'negative').length;

    return {
      totalCorrections: corrections.length,
      totalFeedback: feedback.length,
      positiveFeedback,
      negativeFeedback,
      topCorrectionTags: this.countTags(corrections),
      topFeedbackTags: this.countTags(feedback),
      agentStats: this.computeAgentStats(corrections, feedback),
    };
  }

  // ---------------------------------------------------------------------------
  // Content builders — produce human-readable, FTS5-searchable text
  // ---------------------------------------------------------------------------

  private buildCorrectionContent(correction: Correction): string {
    const parts = [
      `Correction for agent ${correction.agentId}:`,
      `Original: ${correction.originalAction}`,
      `Corrected: ${correction.correctedAction}`,
    ];
    if (correction.context) {
      parts.push(`Context: ${correction.context}`);
    }
    if (correction.tags?.length) {
      parts.push(`Tags: ${correction.tags.join(', ')}`);
    }
    return parts.join('\n');
  }

  private buildFeedbackContent(feedback: Feedback): string {
    const parts = [
      `${feedback.rating === 'positive' ? 'Positive' : 'Negative'} feedback for agent ${feedback.agentId}:`,
      `Action: ${feedback.action}`,
    ];
    if (feedback.comment) {
      parts.push(`Comment: ${feedback.comment}`);
    }
    if (feedback.tags?.length) {
      parts.push(`Tags: ${feedback.tags.join(', ')}`);
    }
    return parts.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Entry converters — map KnowledgeEntry to typed domain objects
  // ---------------------------------------------------------------------------

  private entrytoCorrectionEntry(entry: KnowledgeEntry): CorrectionEntry {
    const meta = entry.metadata ?? {};
    return {
      id: entry.key,
      projectId: entry.projectId,
      timestamp: entry.createdAt,
      agentId: (meta.agentId as string) ?? '',
      originalAction: (meta.originalAction as string) ?? '',
      correctedAction: (meta.correctedAction as string) ?? '',
      context: meta.context as string | undefined,
      tags: (meta.tags as string[]) ?? [],
    };
  }

  private entryToFeedbackEntry(entry: KnowledgeEntry): FeedbackEntry {
    const meta = entry.metadata ?? {};
    return {
      id: entry.key,
      projectId: entry.projectId,
      timestamp: entry.createdAt,
      agentId: (meta.agentId as string) ?? '',
      action: (meta.action as string) ?? '',
      rating: (meta.rating as 'positive' | 'negative') ?? 'negative',
      comment: meta.comment as string | undefined,
      tags: (meta.tags as string[]) ?? [],
    };
  }

  // ---------------------------------------------------------------------------
  // Filtering and aggregation helpers
  // ---------------------------------------------------------------------------

  private applyFilters<T extends { tags: string[]; agentId: string }>(
    entries: T[],
    options?: TrainingRetrievalOptions,
  ): T[] {
    let result = entries;

    if (options?.tags?.length) {
      const filterTags = new Set(options.tags);
      result = result.filter((entry) => entry.tags.some((tag) => filterTags.has(tag)));
    }

    if (options?.agentId) {
      result = result.filter((entry) => entry.agentId === options.agentId);
    }

    if (options?.limit !== undefined && options.limit >= 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  private countTags(entries: Array<{ tags: string[] }>): TagCount[] {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  private computeAgentStats(
    corrections: CorrectionEntry[],
    feedback: FeedbackEntry[],
  ): AgentTrainingStats[] {
    const agentMap = new Map<string, { corrections: number; positive: number; negative: number }>();

    const getOrCreate = (agentId: string) => {
      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, { corrections: 0, positive: 0, negative: 0 });
      }
      return agentMap.get(agentId)!;
    };

    for (const correction of corrections) {
      getOrCreate(correction.agentId).corrections++;
    }

    for (const fb of feedback) {
      const stats = getOrCreate(fb.agentId);
      if (fb.rating === 'positive') {
        stats.positive++;
      } else {
        stats.negative++;
      }
    }

    return Array.from(agentMap.entries())
      .map(([agentId, stats]) => ({ agentId, ...stats }))
      .sort((a, b) => {
        const totalA = a.corrections + a.positive + a.negative;
        const totalB = b.corrections + b.positive + b.negative;
        return totalB - totalA;
      });
  }
}
