import { eq, desc } from 'drizzle-orm';
import type { Database } from '../../db/database.js';
import type { AgentManager } from '../../agents/AgentManager.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import type { DecisionLog } from '../decisions/DecisionLog.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import type { FileLockRegistry } from '../files/FileLockRegistry.js';
import { sessionRetros } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { asAgentId } from '../../types/brandedIds.js';
import { shortAgentId } from '@flightdeck/shared';

// ── Types ─────────────────────────────────────────────────────────

export interface AgentScorecard {
  agentId: string;
  role: string;
  model: string;
  status: string;
  tasksCompleted: number;
  tasksTotal: number;
  tokensUsed: number;
  contextWindowSize: number;
  contextUtilization: number;   // 0-1
  filesTouched: string[];
  activeTimeMs: number;
  idleTimeMs: number;
}

export interface SessionSummary {
  leadId: string;
  timeSpan: { start: string; end: string; durationMs: number };
  totalAgents: number;
  totalTokens: number;
  totalEvents: number;
  totalDecisions: number;
  decisionsConfirmed: number;
  decisionsRejected: number;
  dagTasksTotal: number;
  dagTasksDone: number;
  dagTasksFailed: number;
}

interface BottleneckEntry {
  agentId: string;
  role: string;
  type: 'idle_time' | 'context_pressure' | 'stuck';
  value: number;       // ms for idle_time/stuck, percentage for context_pressure
  description: string;
}

interface SessionRetroData {
  generatedAt: string;
  summary: SessionSummary;
  scorecards: AgentScorecard[];
  bottlenecks: BottleneckEntry[];
}

// ── SessionRetro ──────────────────────────────────────────────────

export class SessionRetro {
  constructor(
    private db: Database,
    private agentManager: AgentManager,
    private activityLedger: ActivityLedger,
    private decisionLog: DecisionLog,
    private taskDAG: TaskDAG,
    private lockRegistry: FileLockRegistry,
  ) {}

  /** Generate and store a retrospective for a lead's session. */
  generateRetro(leadId: string): SessionRetroData {
    const data = this.buildRetroData(leadId);

    this.db.drizzle
      .insert(sessionRetros)
      .values({ leadId, data: JSON.stringify(data) })
      .run();

    logger.info('retro', `Session retro generated for lead ${shortAgentId(leadId)}: ${data.scorecards.length} agents, ${data.summary.totalEvents} events`);
    return data;
  }

  /** Get all retros for a lead, newest first. */
  getRetros(leadId: string): Array<{ id: number; leadId: string; createdAt: string; data: SessionRetroData }> {
    const rows = this.db.drizzle
      .select()
      .from(sessionRetros)
      .where(eq(sessionRetros.leadId, leadId))
      .orderBy(desc(sessionRetros.createdAt))
      .all();

    return rows.map(r => ({
      id: r.id,
      leadId: r.leadId,
      createdAt: r.createdAt ?? new Date().toISOString(),
      data: JSON.parse(r.data) as SessionRetroData,
    }));
  }

  // ── Data collection ─────────────────────────────────────────────

  private buildRetroData(leadId: string): SessionRetroData {
    const crewAgents = this.agentManager.getAll().filter(
      a => a.id === leadId || a.parentId === leadId,
    );

    const allEvents = this.activityLedger.getRecent(100_000);
    const crewAgentIds = new Set(crewAgents.map(a => a.id));
    const crewEvents = allEvents.filter(e => crewAgentIds.has(asAgentId(e.agentId)));

    const scorecards = crewAgents.map(agent => this.buildScorecard(agent, crewEvents));
    const summary = this.buildSummary(leadId, crewAgents, crewEvents);
    const bottlenecks = this.findBottlenecks(scorecards);

    return {
      generatedAt: new Date().toISOString(),
      summary,
      scorecards,
      bottlenecks,
    };
  }

  private buildScorecard(agent: any, crewEvents: any[]): AgentScorecard {
    const agentEvents = crewEvents.filter(e => e.agentId === agent.id);

    // Count task-related events
    const tasksCompleted = agentEvents.filter(e => e.actionType === 'task_completed').length;
    const tasksTotal = agentEvents.filter(e =>
      e.actionType === 'task_started' || e.actionType === 'task_completed',
    ).length || Math.max(tasksCompleted, 1);

    // Files touched from lock events
    const filesTouched = new Set<string>();
    for (const e of agentEvents) {
      if (e.actionType === 'lock_acquired' && e.details?.filePath) {
        filesTouched.add(e.details.filePath);
      }
    }

    // Time analysis from status_change events
    const statusChanges = agentEvents
      .filter(e => e.actionType === 'status_change')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let activeTimeMs = 0;
    let idleTimeMs = 0;
    for (let i = 0; i < statusChanges.length - 1; i++) {
      const current = statusChanges[i];
      const next = statusChanges[i + 1];
      const duration = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
      const status = current.details?.status || current.details?.newStatus;
      if (status === 'running') {
        activeTimeMs += duration;
      } else if (status === 'idle') {
        idleTimeMs += duration;
      }
    }

    // If no status changes, estimate from agent creation time
    if (statusChanges.length === 0) {
      const totalMs = Date.now() - agent.createdAt.getTime();
      if (agent.status === 'running') activeTimeMs = totalMs;
      else if (agent.status === 'idle') idleTimeMs = totalMs;
    }

    const contextUtilization = agent.contextWindowSize > 0
      ? agent.contextWindowUsed / agent.contextWindowSize
      : 0;

    return {
      agentId: agent.id,
      role: agent.role?.name ?? 'unknown',
      model: agent.model ?? 'unknown',
      status: agent.status,
      tasksCompleted,
      tasksTotal,
      tokensUsed: agent.contextWindowUsed ?? 0,
      contextWindowSize: agent.contextWindowSize ?? 0,
      contextUtilization,
      filesTouched: [...filesTouched],
      activeTimeMs,
      idleTimeMs,
    };
  }

  private buildSummary(leadId: string, crewAgents: any[], crewEvents: any[]): SessionSummary {
    // Time span
    const timestamps = crewEvents.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t));
    const start = timestamps.length > 0 ? timestamps.reduce((a, b) => Math.min(a, b), Infinity) : Date.now();
    const end = timestamps.length > 0 ? timestamps.reduce((a, b) => Math.max(a, b), -Infinity) : Date.now();

    // Token totals
    const totalTokens = crewAgents.reduce((sum, a) => sum + (a.contextWindowUsed ?? 0), 0);

    // Decisions
    const decisions = this.decisionLog.getByLeadId(leadId);
    const decisionsConfirmed = decisions.filter(d => d.status === 'confirmed').length;
    const decisionsRejected = decisions.filter(d => d.status === 'rejected').length;

    // DAG tasks
    const dagTasks = this.taskDAG.getTasks(leadId);
    const dagTasksDone = dagTasks.filter(t => t.dagStatus === 'done').length;
    const dagTasksFailed = dagTasks.filter(t => t.dagStatus === 'failed').length;

    return {
      leadId,
      timeSpan: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        durationMs: end - start,
      },
      totalAgents: crewAgents.length,
      totalTokens,
      totalEvents: crewEvents.length,
      totalDecisions: decisions.length,
      decisionsConfirmed,
      decisionsRejected,
      dagTasksTotal: dagTasks.length,
      dagTasksDone,
      dagTasksFailed,
    };
  }

  private findBottlenecks(scorecards: AgentScorecard[]): BottleneckEntry[] {
    const bottlenecks: BottleneckEntry[] = [];

    // Sort by idle time descending — top 3 idlers
    const byIdle = [...scorecards]
      .filter(s => s.idleTimeMs > 60_000) // at least 1 min idle
      .sort((a, b) => b.idleTimeMs - a.idleTimeMs)
      .slice(0, 3);

    for (const s of byIdle) {
      const idleMin = Math.round(s.idleTimeMs / 60_000);
      bottlenecks.push({
        agentId: s.agentId,
        role: s.role,
        type: 'idle_time',
        value: s.idleTimeMs,
        description: `${s.role} (${shortAgentId(s.agentId)}) was idle for ${idleMin}min`,
      });
    }

    // Context pressure — agents over 80%
    const pressured = scorecards
      .filter(s => s.contextUtilization > 0.8)
      .sort((a, b) => b.contextUtilization - a.contextUtilization);

    for (const s of pressured) {
      const pct = Math.round(s.contextUtilization * 100);
      bottlenecks.push({
        agentId: s.agentId,
        role: s.role,
        type: 'context_pressure',
        value: s.contextUtilization,
        description: `${s.role} (${shortAgentId(s.agentId)}) used ${pct}% of context window`,
      });
    }

    // Stuck agents — running with very low event count relative to active time
    for (const s of scorecards) {
      if (s.status === 'running' && s.activeTimeMs > 600_000 && s.tasksCompleted === 0) {
        bottlenecks.push({
          agentId: s.agentId,
          role: s.role,
          type: 'stuck',
          value: s.activeTimeMs,
          description: `${s.role} (${shortAgentId(s.agentId)}) ran for ${Math.round(s.activeTimeMs / 60_000)}min with no completed tasks`,
        });
      }
    }

    return bottlenecks;
  }
}
