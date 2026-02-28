import type { ActivityLedger, ActivityEntry } from './ActivityLedger.js';
import type { DecisionLog, Decision } from './DecisionLog.js';

export interface SearchResult {
  type: 'activity' | 'decision' | 'message';
  score: number;
  agentId?: string;
  agentRole?: string;
  content: string;
  timestamp: string;
  context?: string;   // surrounding context
  highlights: string[]; // matched fragments
}

export interface SearchQuery {
  query: string;
  types?: ('activity' | 'decision' | 'message')[];
  agentId?: string;
  leadId?: string;
  since?: string;  // ISO date
  limit?: number;
}

export class SearchEngine {
  private activityLedger: ActivityLedger;
  private decisionLog: DecisionLog;

  constructor(activityLedger: ActivityLedger, decisionLog: DecisionLog) {
    this.activityLedger = activityLedger;
    this.decisionLog = decisionLog;
  }

  /**
   * Search across all indexed content.
   * Uses simple text matching with relevance scoring.
   */
  search(query: SearchQuery): SearchResult[] {
    const results: SearchResult[] = [];
    const terms = this.tokenize(query.query);
    if (terms.length === 0) return [];

    const limit = query.limit ?? 50;
    const types = query.types ?? ['activity', 'decision'];

    // Search activities
    if (types.includes('activity')) {
      const entries = this.activityLedger.getRecent(10_000);
      for (const entry of entries) {
        if (query.agentId && entry.agentId !== query.agentId) continue;
        if (query.since && entry.timestamp < query.since) continue;

        const text = `${entry.summary} ${entry.details ? JSON.stringify(entry.details) : ''}`;
        const score = this.scoreMatch(terms, text);
        if (score > 0) {
          results.push({
            type: 'activity',
            score,
            agentId: entry.agentId,
            agentRole: entry.agentRole,
            content: entry.summary,
            timestamp: entry.timestamp,
            highlights: this.extractHighlights(terms, text),
          });
        }
      }
    }

    // Search decisions
    if (types.includes('decision')) {
      const leadId = query.leadId;
      if (leadId) {
        const decisions = this.decisionLog.getByLeadId(leadId);
        for (const dec of decisions) {
          const text = `${dec.title} ${dec.rationale}`;
          const score = this.scoreMatch(terms, text);
          if (score > 0) {
            results.push({
              type: 'decision',
              score,
              agentId: dec.agentId,
              content: `${dec.title}: ${dec.rationale}`,
              timestamp: dec.timestamp,
              highlights: this.extractHighlights(terms, text),
            });
          }
        }
      } else {
        // No leadId filter — search all decisions
        const allDecisions = this.decisionLog.getAll();
        if (query.agentId) {
          for (const dec of allDecisions) {
            if (dec.agentId !== query.agentId) continue;
            const text = `${dec.title} ${dec.rationale}`;
            const score = this.scoreMatch(terms, text);
            if (score > 0) {
              results.push({
                type: 'decision',
                score,
                agentId: dec.agentId,
                content: `${dec.title}: ${dec.rationale}`,
                timestamp: dec.timestamp,
                highlights: this.extractHighlights(terms, text),
              });
            }
          }
        } else {
          for (const dec of allDecisions) {
            const text = `${dec.title} ${dec.rationale}`;
            const score = this.scoreMatch(terms, text);
            if (score > 0) {
              results.push({
                type: 'decision',
                score,
                agentId: dec.agentId,
                content: `${dec.title}: ${dec.rationale}`,
                timestamp: dec.timestamp,
                highlights: this.extractHighlights(terms, text),
              });
            }
          }
        }
      }
    }

    // Sort by score descending, limit results
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Tokenize query into search terms */
  private tokenize(query: string): string[] {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1) // Skip single chars
      .map((t) => t.replace(/[^\w-]/g, ''))
      .filter((t) => t.length > 0);
  }

  /** Score how well text matches the search terms */
  private scoreMatch(terms: string[], text: string): number {
    const lower = text.toLowerCase();
    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
      if (lower.includes(term)) {
        matchedTerms++;
        // Exact word match scores higher
        const wordBoundary = new RegExp(
          `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'i',
        );
        score += wordBoundary.test(text) ? 2 : 1;

        // Title/summary position bonus
        const idx = lower.indexOf(term);
        if (idx < 50) score += 0.5; // Early match bonus
      }
    }

    // All terms must match for non-zero score
    if (matchedTerms < terms.length) return 0;

    // Normalize by number of terms
    return score / terms.length;
  }

  /** Extract text fragments containing matches */
  private extractHighlights(terms: string[], text: string): string[] {
    const highlights: string[] = [];
    const lower = text.toLowerCase();

    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(text.length, idx + term.length + 30);
        let fragment = text.slice(start, end);
        if (start > 0) fragment = '...' + fragment;
        if (end < text.length) fragment = fragment + '...';
        highlights.push(fragment);
      }
    }

    return highlights.slice(0, 3); // Max 3 highlights
  }
}
