import type { DecisionLog, Decision } from './DecisionLog.js';
import { logger } from '../../utils/logger.js';

export interface DecisionRecord {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded' | 'deprecated';
  context: string;
  options: DecisionOption[];
  chosen: string;
  rationale: string;
  consequences: string[];
  proposedBy: string;
  proposedByRole: string;
  decidedAt: string;
  relatedDecisions?: string[];
  tags: string[];
}

interface DecisionOption {
  name: string;
  pros: string[];
  cons: string[];
}

export class DecisionRecordStore {
  private records: Map<string, DecisionRecord> = new Map();
  private counter = 0;

  private generateId(): string {
    return `adr-${Date.now().toString(36)}-${(this.counter++).toString(36)}`;
  }

  /** Create a decision record from a raw DECISION command */
  createFromDecision(decision: Decision, context?: string): DecisionRecord {
    const record: DecisionRecord = {
      id: this.generateId(),
      title: decision.title,
      status: decision.status === 'confirmed' ? 'accepted' :
              decision.status === 'rejected' ? 'rejected' : 'proposed',
      context: context || 'No context provided',
      options: [],
      chosen: decision.title,
      rationale: decision.rationale,
      consequences: [],
      proposedBy: decision.agentId,
      proposedByRole: decision.agentRole ?? 'unknown',
      decidedAt: decision.timestamp,
      tags: this.extractTags(decision.title + ' ' + decision.rationale),
    };

    this.records.set(record.id, record);
    logger.info('adr', `Created decision record ${record.id}: ${record.title}`);
    return record;
  }

  /** Create a detailed decision record manually */
  create(record: Omit<DecisionRecord, 'id' | 'tags'>): DecisionRecord {
    const full: DecisionRecord = {
      ...record,
      id: this.generateId(),
      tags: this.extractTags(record.title + ' ' + record.rationale + ' ' + record.context),
    };
    this.records.set(full.id, full);
    return full;
  }

  /** Get all records, optionally filtered */
  getAll(filter?: { status?: string; tag?: string; since?: string }): DecisionRecord[] {
    let results = [...this.records.values()];
    if (filter?.status) results = results.filter(r => r.status === filter.status);
    if (filter?.tag) results = results.filter(r => r.tags.includes(filter.tag!));
    if (filter?.since) results = results.filter(r => r.decidedAt >= filter.since!);
    return results.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }

  /** Get a single record */
  get(id: string): DecisionRecord | undefined { return this.records.get(id); }

  /** Update record status */
  updateStatus(id: string, status: DecisionRecord['status']): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    record.status = status;
    return true;
  }

  /** Add consequence to a record (learned later) */
  addConsequence(id: string, consequence: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    record.consequences.push(consequence);
    return true;
  }

  /** Search records by text */
  search(query: string): DecisionRecord[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (terms.length === 0) return [];

    return this.getAll().filter(record => {
      const text = `${record.title} ${record.context} ${record.rationale} ${record.tags.join(' ')}`.toLowerCase();
      return terms.every(term => text.includes(term));
    });
  }

  /** Get unique tags across all records */
  getTags(): string[] {
    const tags = new Set<string>();
    for (const record of this.records.values()) {
      for (const tag of record.tags) tags.add(tag);
    }
    return [...tags].sort();
  }

  /** Sync from existing DecisionLog entries */
  syncFromDecisionLog(decisionLog: DecisionLog, leadId: string): number {
    const decisions = decisionLog.getByLeadId(leadId);
    let synced = 0;
    for (const dec of decisions) {
      // Check if already synced (simple dedup by title+timestamp)
      const existing = [...this.records.values()].find(
        r => r.title === dec.title && r.decidedAt === dec.timestamp
      );
      if (!existing) {
        this.createFromDecision(dec);
        synced++;
      }
    }
    return synced;
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const lower = text.toLowerCase();

    // Architecture tags
    const techKeywords = ['api', 'database', 'schema', 'ui', 'frontend', 'backend', 'auth', 'security',
      'performance', 'testing', 'deployment', 'migration', 'refactor', 'pattern', 'architecture'];
    for (const kw of techKeywords) {
      if (lower.includes(kw)) tags.push(kw);
    }

    return [...new Set(tags)];
  }

  get count(): number { return this.records.size; }
}
