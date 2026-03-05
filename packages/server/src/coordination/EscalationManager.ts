import { EventEmitter } from 'events';
import type { DecisionLog } from './DecisionLog.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';
import { logger } from '../utils/logger.js';

export type EscalationCondition = 'stale_decision' | 'blocked_task' | 'agent_stuck' | 'build_failure';
export type EscalationTarget = 'lead' | 'user' | 'architect';

export interface EscalationRule {
  id: string;
  name: string;
  condition: EscalationCondition;
  thresholdMs: number;
  escalateTo: EscalationTarget;
}

export interface Escalation {
  id: string;
  ruleId: string;
  subject: string;
  detail: string;
  escalatedAt: number;
  resolved: boolean;
  resolvedAt?: number;
}

const DEFAULT_RULES: EscalationRule[] = [
  {
    id: 'stale-decision',
    name: 'Stale Decision',
    condition: 'stale_decision',
    thresholdMs: 10 * 60_000,
    escalateTo: 'user',
  },
  {
    id: 'blocked-task-15m',
    name: 'Blocked Task >15min',
    condition: 'blocked_task',
    thresholdMs: 15 * 60_000,
    escalateTo: 'lead',
  },
  {
    id: 'build-failure',
    name: 'Build Failure',
    condition: 'build_failure',
    thresholdMs: 0,
    escalateTo: 'lead',
  },
];

export class EscalationManager extends EventEmitter {
  private rules: EscalationRule[] = [...DEFAULT_RULES];
  private escalations: Escalation[] = [];
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private decisionLog: DecisionLog,
    private taskDAG: TaskDAG,
  ) {
    super();
  }

  start(intervalMs: number = 60_000): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.evaluate(), intervalMs);
    logger.info('escalation', `EscalationManager started (interval: ${intervalMs}ms)`);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      logger.info('escalation', 'EscalationManager stopped');
    }
  }

  /** Run all escalation rules and return any newly created escalations. */
  evaluate(): Escalation[] {
    const newEscalations: Escalation[] = [];
    const now = Date.now();

    for (const rule of this.rules) {
      if (rule.condition === 'stale_decision') {
        // Find decisions that need confirmation and are older than the threshold
        const pending = this.decisionLog.getNeedingConfirmation();
        for (const decision of pending) {
          const age = now - new Date(decision.timestamp).getTime();
          if (age >= rule.thresholdMs) {
            const existing = this.escalations.find(e => e.subject === decision.id && e.ruleId === rule.id && !e.resolved);
            if (!existing) {
              const esc = this.createEscalation(rule, decision.id, `Decision "${decision.title}" awaiting confirmation for ${Math.round(age / 60_000)}min`);
              newEscalations.push(esc);
            }
          }
        }
      }

      if (rule.condition === 'blocked_task') {
        const allTasks = this.taskDAG.getAll();
        for (const task of allTasks) {
          if (task.dagStatus === 'blocked') {
            const age = now - new Date(task.createdAt).getTime();
            if (age >= rule.thresholdMs) {
              const existing = this.escalations.find(e => e.subject === task.id && e.ruleId === rule.id && !e.resolved);
              if (!existing) {
                const label = task.description || task.id;
                const esc = this.createEscalation(rule, task.id, `Task "${label}" blocked for ${Math.round(age / 60_000)}min`);
                newEscalations.push(esc);
              }
            }
          }
        }
      }
    }

    if (newEscalations.length > 0) {
      logger.warn('escalation', `${newEscalations.length} new escalation(s) raised`);
    }

    return newEscalations;
  }

  /** Trigger a build-failure escalation immediately (called by CI runner or external events). */
  triggerBuildFailure(subject: string, detail: string): Escalation | null {
    const rule = this.rules.find(r => r.condition === 'build_failure');
    if (!rule) return null;
    const existing = this.escalations.find(e => e.subject === subject && e.ruleId === rule.id && !e.resolved);
    if (existing) return null;
    const esc = this.createEscalation(rule, subject, detail);
    logger.warn('escalation', `Build failure escalation: ${detail}`);
    return esc;
  }

  resolve(escalationId: string): boolean {
    const esc = this.escalations.find(e => e.id === escalationId);
    if (!esc) return false;
    esc.resolved = true;
    esc.resolvedAt = Date.now();
    logger.info('escalation', `Escalation ${escalationId} resolved`);
    this.emit('escalation:resolved', esc);
    return true;
  }

  getActive(): Escalation[] {
    return this.escalations.filter(e => !e.resolved);
  }

  getAll(): Escalation[] {
    return [...this.escalations];
  }

  getRules(): EscalationRule[] {
    return [...this.rules];
  }

  addRule(rule: EscalationRule): void {
    this.rules.push(rule);
  }

  private createEscalation(rule: EscalationRule, subject: string, detail: string): Escalation {
    const esc: Escalation = {
      id: `esc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      ruleId: rule.id,
      subject,
      detail,
      escalatedAt: Date.now(),
      resolved: false,
    };
    this.escalations.push(esc);
    this.emit('escalation', esc);
    return esc;
  }
}
