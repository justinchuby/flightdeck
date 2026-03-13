import type { Agent } from './Agent.js';
import { isTerminalStatus } from './Agent.js';
import type { Delegation } from './CommandDispatcher.js';
import { buildCommandReminder } from './commands/CommandHelp.js';
import { logger } from '../utils/logger.js';

export interface DagSummary {
  pending: number; ready: number; running: number; done: number;
  failed: number; blocked: number; paused: number; skipped: number;
}

export interface RemainingTask {
  id: string;
  description: string;
  dagStatus: string;
}

export interface HeartbeatContext {
  getAllAgents(): Agent[];
  getDelegationsMap(): Map<string, Delegation>;
  getDagSummary(leadId: string): DagSummary | null;
  getRemainingTasks(leadId: string): RemainingTask[];
  getTaskByAgent(leadId: string, agentId: string): { id: string; dagStatus: string } | null;
  emit(event: string, ...args: unknown[]): void;
}

/** How often (ms) to send command reminders — default 2 hours */
const COMMAND_REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function buildCommandReminderMessage(role?: string): string {
  return buildCommandReminder(role);
}

export class HeartbeatMonitor {
  private leadIdleSince: Map<string, number> = new Map();
  private leadNudgeCount: Map<string, number> = new Map();
  private humanInterrupted: Set<string> = new Set();
  private lastCommandReminder: Map<string, number> = new Map();
  /** Agents that explicitly halted heartbeat — stays halted until resumeHeartbeat() */
  private haltedAgents: Set<string> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ctx: HeartbeatContext;

  constructor(ctx: HeartbeatContext) {
    this.ctx = ctx;
  }

  start(intervalMs = 120_000): void {
    this.stop();
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Called when a lead agent goes idle — start tracking idle time */
  trackIdle(agentId: string): void {
    this.leadIdleSince.set(agentId, Date.now());
  }

  /** Called when a lead agent becomes active — reset idle tracking and UI interrupt */
  trackActive(agentId: string): void {
    this.leadIdleSince.delete(agentId);
    this.leadNudgeCount.set(agentId, 0);
    this.humanInterrupted.delete(agentId);
    // NOTE: haltedAgents is NOT cleared here — HALT_HEARTBEAT is an explicit
    // opt-out that persists until resumeHeartbeat().
  }

  /** Called when a lead agent exits or is terminated — clean up all tracking */
  trackRemoved(agentId: string): void {
    this.leadIdleSince.delete(agentId);
    this.leadNudgeCount.delete(agentId);
    this.humanInterrupted.delete(agentId);
    this.lastCommandReminder.delete(agentId);
    this.haltedAgents.delete(agentId);
  }

  /**
   * Called when a human sends a message via the UI — temporarily suppress lead nudges.
   * Cleared automatically by trackActive() when the lead starts working again.
   * Does NOT affect command reminders or haltedAgents.
   */
  trackHumanInterrupt(agentId: string): void {
    this.humanInterrupted.add(agentId);
  }

  /**
   * Called when HALT_HEARTBEAT command is issued — persistently suppress
   * lead idle nudges until resumeHeartbeat(). Command reminders are unaffected.
   * Returns true if newly halted, false if already halted (idempotent).
   */
  haltHeartbeat(agentId: string): boolean {
    if (this.haltedAgents.has(agentId)) return false;
    this.haltedAgents.add(agentId);
    return true;
  }

  /**
   * Explicitly resume heartbeat for an agent that previously issued HALT_HEARTBEAT.
   * Returns true if actually resumed, false if wasn't halted.
   */
  resumeHeartbeat(agentId: string): boolean {
    return this.haltedAgents.delete(agentId);
  }

  /** Check if an agent has halted heartbeat */
  isHalted(agentId: string): boolean {
    return this.haltedAgents.has(agentId);
  }

  /**
   * Send a command reference reminder to a specific agent on-demand
   * (e.g., when they issue an unknown/invalid command).
   * Bypasses the 2-hour interval. Not affected by HALT_HEARTBEAT (which only controls nudges).
   */
  sendCommandReminderTo(agent: Agent): void {
    if (isTerminalStatus(agent.status)) return;

    const message = buildCommandReminderMessage(agent.role.id);
    agent.queueMessage(message);
    this.lastCommandReminder.set(agent.id, Date.now());

    logger.info('heartbeat', `Command reminder (on-demand) → ${agent.role.name} (${agent.id.slice(0, 8)})`);

    this.ctx.emit('agent:message_sent', {
      from: 'system',
      fromRole: 'System',
      to: agent.id,
      toRole: agent.role.name,
      content: message,
    });
  }

  /**
   * Backoff: nudges 1-3 fire every cycle, 4-6 every 2nd cycle, 7+ every 3rd cycle.
   * Returns true if this cycle should be skipped (no nudge sent).
   */
  shouldSkipNudge(nudgeCount: number): boolean {
    if (nudgeCount <= 3) return false;
    if (nudgeCount <= 6) return nudgeCount % 2 !== 0;
    return nudgeCount % 3 !== 0;
  }

  /** Periodic heartbeat check: detect stalled teams and nudge the lead */
  private check(): void {
    const leads = this.ctx.getAllAgents().filter((a) => a.role.id === 'lead' && a.status === 'idle');

    for (const lead of leads) {
      const idleSince = this.leadIdleSince.get(lead.id);
      if (!idleSince) continue;

      // Don't nudge if the lead went idle after a human interrupt or has halted heartbeat
      if (this.humanInterrupted.has(lead.id) || this.haltedAgents.has(lead.id)) continue;

      // Don't nudge if lead went idle less than 60s ago
      const idleDuration = Date.now() - idleSince;
      if (idleDuration < 60_000) continue;

      // Find children of this lead
      const children = this.ctx.getAllAgents().filter((a) => a.parentId === lead.id);
      if (children.length === 0) continue; // no team → legitimately idle

      // If any child is still actively working (running or being created), wait
      const anyActive = children.some((a) => a.status === 'running' || a.status === 'creating');
      if (anyActive) continue;

      // Check if there are active (incomplete) delegations
      const activeDelegations = Array.from(this.ctx.getDelegationsMap().values()).filter(
        (d) => d.fromAgentId === lead.id && d.status === 'active'
      );

      // Check DAG summary for running tasks and remaining work
      const dagSummary = this.ctx.getDagSummary(lead.id);

      // If DAG tasks are actively running, work is in progress — wait
      if (dagSummary && dagSummary.running > 0) continue;

      const remainingDagTasks = dagSummary
        ? dagSummary.pending + dagSummary.ready + dagSummary.blocked + dagSummary.paused
        : 0;

      // If no active delegations AND no remaining DAG tasks, work is truly done
      if (activeDelegations.length === 0 && remainingDagTasks === 0) continue;

      // All children are idle/completed but there is remaining work — nudge the lead
      const nudgeCount = (this.leadNudgeCount.get(lead.id) ?? 0) + 1;
      this.leadNudgeCount.set(lead.id, nudgeCount);

      // Escalate after 5+ consecutive check cycles (fires regardless of backoff)
      if (nudgeCount >= 5) {
        logger.warn('lead', `Lead ${lead.id.slice(0, 8)} unresponsive after ${nudgeCount} reminders`);
        this.ctx.emit('lead:stalled', { leadId: lead.id, nudgeCount, idleDuration });
      }

      // Backoff: skip nudge message based on count to reduce noise
      if (this.shouldSkipNudge(nudgeCount)) continue;

      // Build actionable nudge message
      const parts: string[] = [];
      const totalRemaining = remainingDagTasks + activeDelegations.length;
      const dagDetails: string[] = [];
      if (dagSummary) {
        if (dagSummary.ready > 0) dagDetails.push(`${dagSummary.ready} ready`);
        if (dagSummary.pending > 0) dagDetails.push(`${dagSummary.pending} pending`);
        if (dagSummary.blocked > 0) dagDetails.push(`${dagSummary.blocked} blocked`);
        if (dagSummary.paused > 0) dagDetails.push(`${dagSummary.paused} paused`);
      }
      const statusSuffix = dagDetails.length > 0 ? ` (${dagDetails.join(', ')})` : '';
      parts.push(`[System] Reminder: ${totalRemaining} tasks remaining${statusSuffix}.`);

      if (activeDelegations.length > 0) {
        parts.push(`${activeDelegations.length} active delegations still pending.`);
        if (remainingDagTasks > 0) {
          const untrackedCount = activeDelegations.filter(
            d => !this.ctx.getTaskByAgent(lead.id, d.toAgentId)
          ).length;
          if (untrackedCount > 0) {
            parts.push(`⚠️ ${untrackedCount} active delegation(s) are not tracked in your task DAG. Use ADD_TASK to track them.`);
          }
        }
      }

      // List remaining tasks (up to 8)
      const remaining = this.ctx.getRemainingTasks(lead.id);
      if (remaining.length > 0) {
        const shown = remaining.slice(0, 8);
        const taskLines = shown.map(t => `  - ${t.id}: ${t.description.slice(0, 60)}${t.description.length > 60 ? '…' : ''} (${t.dagStatus})`);
        parts.push('\n' + taskLines.join('\n'));
        if (remaining.length > 8) {
          parts.push(`  ... and ${remaining.length - 8} more`);
        }
      }

      parts.push('\nUse DELEGATE to assign ready tasks, QUERY_CREW to check agents, or HALT_HEARTBEAT to pause reminders.');
      const nudge = parts.join('\n');

      logger.info('lead', `Heartbeat reminder #${nudgeCount} → ${lead.role.name} (${lead.id.slice(0, 8)}): idle ${Math.floor(idleDuration / 1000)}s`);
      lead.sendMessage(nudge);

      this.ctx.emit('agent:message_sent', {
        from: 'system',
        fromRole: 'System',
        to: lead.id,
        toRole: lead.role.name,
        content: nudge,
      });
    }

    // ── Second pass: periodic command reminders for ALL agents ────────
    this.sendCommandReminders();
  }

  /** Send periodic command reference reminders to agents that have been running >2 hours */
  private sendCommandReminders(): void {
    const now = Date.now();
    const allAgents = this.ctx.getAllAgents();

    for (const agent of allAgents) {
      // Only send periodic reminders to agents actively processing (running state).
      // Idle/waiting agents don't need nudges — they'll get one when they resume work.
      if (agent.status !== 'running') continue;

      const lastReminder = this.lastCommandReminder.get(agent.id);
      const agentCreatedAt = agent.createdAt.getTime();

      // Use last reminder time, or agent creation time if never reminded
      const sinceTimestamp = lastReminder ?? agentCreatedAt;
      const elapsed = now - sinceTimestamp;

      if (elapsed < COMMAND_REMINDER_INTERVAL_MS) continue;

      // Send the reminder via queueMessage (waits for idle, non-interrupting)
      const message = buildCommandReminderMessage(agent.role.id);
      agent.queueMessage(message);
      this.lastCommandReminder.set(agent.id, now);

      logger.info('heartbeat', `Command reminder → ${agent.role.name} (${agent.id.slice(0, 8)})`);

      this.ctx.emit('agent:message_sent', {
        from: 'system',
        fromRole: 'System',
        to: agent.id,
        toRole: agent.role.name,
        content: message,
      });
    }
  }
}
