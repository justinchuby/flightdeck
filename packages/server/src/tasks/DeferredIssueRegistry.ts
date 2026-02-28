import { EventEmitter } from 'events';
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { deferredIssues } from '../db/schema.js';

export interface DeferredIssue {
  id: number;
  leadId: string;
  reviewerAgentId: string;
  reviewerRole: string;
  severity: string;
  description: string;
  sourceFile: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt?: string;
}

export class DeferredIssueRegistry extends EventEmitter {
  constructor(private db: Database) {
    super();
  }

  /** Add a new deferred issue. Returns the created issue. */
  add(leadId: string, reviewerAgentId: string, reviewerRole: string, description: string, severity = 'P1', sourceFile = ''): DeferredIssue {
    const result = this.db.drizzle
      .insert(deferredIssues)
      .values({ leadId, reviewerAgentId, reviewerRole, description, severity, sourceFile })
      .returning()
      .get();

    const issue = this.rowToIssue(result);
    this.emit('deferred_issue', issue);
    return issue;
  }

  /** Get all deferred issues for a lead, optionally filtered by status. */
  list(leadId: string, status?: 'open' | 'resolved' | 'dismissed'): DeferredIssue[] {
    if (status) {
      return this.db.drizzle
        .select()
        .from(deferredIssues)
        .where(and(eq(deferredIssues.leadId, leadId), eq(deferredIssues.status, status)))
        .orderBy(desc(deferredIssues.id))
        .all()
        .map(this.rowToIssue);
    }
    return this.db.drizzle
      .select()
      .from(deferredIssues)
      .where(eq(deferredIssues.leadId, leadId))
      .orderBy(desc(deferredIssues.id))
      .all()
      .map(this.rowToIssue);
  }

  /** Resolve a deferred issue by ID. Returns true if found and updated. */
  resolve(leadId: string, issueId: number): boolean {
    const result = this.db.drizzle
      .update(deferredIssues)
      .set({ status: 'resolved', resolvedAt: new Date().toISOString() })
      .where(and(eq(deferredIssues.id, issueId), eq(deferredIssues.leadId, leadId)))
      .run();
    return result.changes > 0;
  }

  /** Dismiss a deferred issue by ID. Returns true if found and updated. */
  dismiss(leadId: string, issueId: number): boolean {
    const result = this.db.drizzle
      .update(deferredIssues)
      .set({ status: 'dismissed', resolvedAt: new Date().toISOString() })
      .where(and(eq(deferredIssues.id, issueId), eq(deferredIssues.leadId, leadId)))
      .run();
    return result.changes > 0;
  }

  /** Clear all deferred issues for a lead. */
  clear(leadId: string): number {
    const result = this.db.drizzle
      .delete(deferredIssues)
      .where(eq(deferredIssues.leadId, leadId))
      .run();
    return result.changes;
  }

  private rowToIssue(row: any): DeferredIssue {
    return {
      id: row.id,
      leadId: row.leadId,
      reviewerAgentId: row.reviewerAgentId,
      reviewerRole: row.reviewerRole,
      severity: row.severity ?? 'P1',
      description: row.description,
      sourceFile: row.sourceFile ?? '',
      status: row.status ?? 'open',
      createdAt: row.createdAt ?? '',
      resolvedAt: row.resolvedAt ?? undefined,
    };
  }
}
