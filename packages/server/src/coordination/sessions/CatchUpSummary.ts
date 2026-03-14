import type { ActivityLedger } from '../activity/ActivityLedger.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import type { DecisionLog } from '../decisions/DecisionLog.js';

// ── Types ─────────────────────────────────────────────────────────

export interface CatchUpSummary {
  since: string;
  generatedAt: string;
  tasksCompleted: number;
  tasksFailed: number;
  decisionsPending: number;
  decisionsResolved: number;
  commitsLanded: number;
  agentsSpawned: number;
  agentsStopped: number;
  errorsOccurred: number;
  keyEvents: KeyEvent[];
}

export interface KeyEvent {
  timestamp: string;
  type: string;
  summary: string;
  agentId?: string;
  agentRole?: string;
}

// Event types that constitute "key events" worth highlighting
const KEY_EVENT_TYPES = new Set<string>([
  'sub_agent_spawned',
  'agent_terminated',
  'task_completed',
  'decision_made',
  'error',
  'message_sent',
  'delegated',
]);

// ── CatchUpService ────────────────────────────────────────────────

export class CatchUpService {
  constructor(
    private activityLedger: ActivityLedger,
    private taskDAG: TaskDAG | null,
    private decisionLog: DecisionLog,
  ) {}

  /** Generate a catch-up summary of everything that happened since `sinceTimestamp` */
  getSummary(leadId: string, sinceTimestamp: string): CatchUpSummary {
    const activities = this.activityLedger.getSince(sinceTimestamp, leadId);

    let tasksCompleted = 0;
    let decisionsResolved = 0;
    let agentsSpawned = 0;
    let agentsStopped = 0;
    let errorsOccurred = 0;
    const keyEvents: KeyEvent[] = [];

    for (const entry of activities) {
      switch (entry.actionType) {
        case 'task_completed':
          tasksCompleted++;
          break;
        case 'sub_agent_spawned':
          agentsSpawned++;
          break;
        case 'agent_terminated':
          agentsStopped++;
          break;
        case 'error':
          errorsOccurred++;
          break;
        case 'decision_made':
          decisionsResolved++;
          break;
      }

      if (KEY_EVENT_TYPES.has(entry.actionType)) {
        keyEvents.push({
          timestamp: entry.timestamp,
          type: entry.actionType,
          summary: entry.summary,
          agentId: entry.agentId,
          agentRole: entry.agentRole,
        });
      }
    }

    // Count currently pending decisions
    const decisionsPending = this.countPendingDecisions(leadId);

    // Count failed tasks from DAG (not tracked via activity events)
    const tasksFailed = this.countFailedTasks(leadId);

    return {
      since: sinceTimestamp,
      generatedAt: new Date().toISOString(),
      tasksCompleted,
      tasksFailed,
      decisionsPending,
      decisionsResolved,
      commitsLanded: 0, // No commit ActionType — tracked via git, not activity ledger
      agentsSpawned,
      agentsStopped,
      errorsOccurred,
      keyEvents: keyEvents.slice(-50),
    };
  }

  private countPendingDecisions(leadId: string): number {
    try {
      const pending = this.decisionLog.getNeedingConfirmation();
      return pending.filter(d => d.leadId === leadId || !d.leadId).length;
    } catch {
      return 0;
    }
  }

  private countFailedTasks(leadId: string): number {
    try {
      if (!this.taskDAG) return 0;
      const status = this.taskDAG.getStatus(leadId);
      return status.summary.failed;
    } catch {
      return 0;
    }
  }
}
