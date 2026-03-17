import type { Agent } from '../Agent.js';
import { HeartbeatMonitor, type HeartbeatContext } from '../HeartbeatMonitor.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import { isTerminalStatus } from '../Agent.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages agent health monitoring, idle nudging, and budget tracking.
 *
 * Responsibilities:
 * - Wraps HeartbeatMonitor for lead stall detection
 * - Manages idle nudge timers for child agents with uncompleted DAG tasks
 * - Keeps lead budget info in sync with running agent count
 */
export class AgentMonitorService {
  private heartbeat: HeartbeatMonitor;
  private idleNudgeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(heartbeatCtx: HeartbeatContext) {
    this.heartbeat = new HeartbeatMonitor(heartbeatCtx);
    this.heartbeat.start();
  }

  /** Track a lead entering idle state */
  trackIdle(agentId: string): void {
    this.heartbeat.trackIdle(agentId);
  }

  /** Track a lead becoming active */
  trackActive(agentId: string): void {
    this.heartbeat.trackActive(agentId);
  }

  /** Track an agent being removed */
  trackRemoved(agentId: string): void {
    this.heartbeat.trackRemoved(agentId);
  }

  /** Mark a lead as human-interrupted so heartbeat won't nudge it */
  trackHumanInterrupt(agentId: string): void {
    this.heartbeat.trackHumanInterrupt(agentId);
  }

  /** Halt heartbeat reminders for an agent */
  haltHeartbeat(agentId: string): boolean {
    return this.heartbeat.haltHeartbeat(agentId);
  }

  /** Resume heartbeat reminders for an agent */
  resumeHeartbeat(agentId: string): boolean {
    return this.heartbeat.resumeHeartbeat(agentId);
  }

  /** Send command reference reminder to an agent */
  sendCommandReminderTo(agent: Agent): void {
    this.heartbeat.sendCommandReminderTo(agent);
  }

  /**
   * Start an idle nudge timer for a child agent. If the agent stays idle
   * for 30s with uncompleted DAG tasks, sends a reminder.
   */
  startIdleNudge(agent: Agent, taskDAG: TaskDAG, agents: Map<string, Agent>): void {
    if (this.idleNudgeTimers.has(agent.id)) return;

    const timer = setTimeout(() => {
      this.idleNudgeTimers.delete(agent.id);
      if (agent.status !== 'idle' || isTerminalStatus(agent.status)) return;
      if (!agents.has(agent.id)) return;
      const leadId = agent.parentId;
      if (!leadId) return;
      const dagTask = taskDAG.getTaskByAgent(leadId, agent.id);
      if (dagTask && dagTask.dagStatus === 'running') {
        agent.sendMessage(
          `[System] You have an uncompleted task: "${dagTask.title || dagTask.id}". ` +
          `Please mark it done with COMPLETE_TASK, report PROGRESS, or explain what is blocking you.`
        );
      }
    }, 30_000);
    this.idleNudgeTimers.set(agent.id, timer);
  }

  /** Clear a pending idle nudge timer for an agent */
  clearIdleNudgeTimer(agentId: string): void {
    const timer = this.idleNudgeTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.idleNudgeTimers.delete(agentId);
    }
  }

  /** Clear all idle nudge timers (e.g. during shutdown) */
  clearAllTimers(): void {
    for (const [, timer] of this.idleNudgeTimers) {
      clearTimeout(timer);
    }
    this.idleNudgeTimers.clear();
  }

  /** Stop the heartbeat monitor */
  stop(): void {
    this.heartbeat.stop();
  }

  /** Update all agents' budget info to reflect current state */
  updateLeadBudgets(agents: Agent[], maxConcurrent: number, runningCount: number): void {
    const budget = { maxConcurrent, runningCount };
    for (const agent of agents) {
      agent.budget = { ...budget };
    }
  }
}
