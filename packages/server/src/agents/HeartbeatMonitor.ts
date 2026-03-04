import type { Agent } from './Agent.js';
import type { Delegation } from './CommandDispatcher.js';
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
  emit(event: string, ...args: any[]): void;
}

export class HeartbeatMonitor {
  private leadIdleSince: Map<string, number> = new Map();
  private leadNudgeCount: Map<string, number> = new Map();
  private humanInterrupted: Set<string> = new Set();
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

  /** Called when a lead agent becomes active — reset idle tracking */
  trackActive(agentId: string): void {
    this.leadIdleSince.delete(agentId);
    this.leadNudgeCount.set(agentId, 0);
    this.humanInterrupted.delete(agentId);
  }

  /** Called when a lead agent exits or is terminated — clean up all tracking */
  trackRemoved(agentId: string): void {
    this.leadIdleSince.delete(agentId);
    this.leadNudgeCount.delete(agentId);
    this.humanInterrupted.delete(agentId);
  }

  /** Called when a human interrupts a lead — suppress nudges until it resumes */
  trackHumanInterrupt(agentId: string): void {
    this.humanInterrupted.add(agentId);
  }

  /** Periodic heartbeat check: detect stalled teams and nudge the lead */
  private check(): void {
    const leads = this.ctx.getAllAgents().filter((a) => a.role.id === 'lead' && a.status === 'idle');

    for (const lead of leads) {
      const idleSince = this.leadIdleSince.get(lead.id);
      if (!idleSince) continue;

      // Don't nudge if the lead went idle after a human interrupt
      if (this.humanInterrupted.has(lead.id)) continue;

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

      // Only escalate after 5+ consecutive nudges (soft threshold)
      if (nudgeCount >= 5) {
        logger.warn('lead', `Lead ${lead.id.slice(0, 8)} unresponsive after ${nudgeCount} reminders`);
        this.ctx.emit('lead:stalled', { leadId: lead.id, nudgeCount, idleDuration });
      }
    }
  }
}
