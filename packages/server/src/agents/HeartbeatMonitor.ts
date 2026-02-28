import type { Agent } from './Agent.js';
import type { Delegation } from './CommandDispatcher.js';
import { logger } from '../utils/logger.js';

export interface HeartbeatContext {
  getAllAgents(): Agent[];
  getDelegationsMap(): Map<string, Delegation>;
  emit(event: string, ...args: any[]): void;
}

export class HeartbeatMonitor {
  private leadIdleSince: Map<string, number> = new Map();
  private leadNudgeCount: Map<string, number> = new Map();
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
  }

  /** Periodic heartbeat check: detect stalled teams and nudge the lead */
  private check(): void {
    const leads = this.ctx.getAllAgents().filter((a) => a.role.id === 'lead' && a.status === 'idle');

    for (const lead of leads) {
      const idleSince = this.leadIdleSince.get(lead.id);
      if (!idleSince) continue;

      // Don't nudge if lead went idle less than 60s ago
      const idleDuration = Date.now() - idleSince;
      if (idleDuration < 60_000) continue;

      // Find children of this lead
      const children = this.ctx.getAllAgents().filter((a) => a.parentId === lead.id);
      if (children.length === 0) continue; // no team → legitimately idle

      // If any child is still running, work is in progress — wait
      const anyRunning = children.some((a) => a.status === 'running');
      if (anyRunning) continue;

      // Check if there are active (incomplete) delegations — if none, work is done
      const activeDelegations = Array.from(this.ctx.getDelegationsMap().values()).filter(
        (d) => d.fromAgentId === lead.id && d.status === 'active'
      );
      if (activeDelegations.length === 0) continue; // all delegations completed → legitimately idle

      // All children are idle/completed but there are uncompleted delegations — team is stalled
      const idleChildren = children.filter((a) => a.status === 'idle');
      const completedChildren = children.filter((a) => a.status === 'completed' || a.status === 'failed');

      const nudgeCount = (this.leadNudgeCount.get(lead.id) ?? 0) + 1;
      this.leadNudgeCount.set(lead.id, nudgeCount);

      const roster = children.map((c) => `  - ${c.role.name} (${c.id.slice(0, 8)}): ${c.status}`).join('\n');
      const nudge = `[System Heartbeat] Your team appears stalled — you've been idle for ${Math.floor(idleDuration / 1000)}s. ` +
        `${idleChildren.length} agents idle, ${completedChildren.length} completed/failed, ${activeDelegations.length} active delegations.\n` +
        `Team status:\n${roster}\n` +
        `Please review agent reports and continue: delegate reviews, assign next tasks, or report final results to the user.`;

      logger.warn('lead', `Heartbeat nudge #${nudgeCount} → ${lead.role.name} (${lead.id.slice(0, 8)}): idle ${Math.floor(idleDuration / 1000)}s, ${children.length} children`);
      lead.sendMessage(nudge);

      this.ctx.emit('agent:message_sent', {
        from: 'system',
        fromRole: 'System',
        to: lead.id,
        toRole: lead.role.name,
        content: nudge,
      });

      // Escalate after 2 consecutive nudges
      if (nudgeCount >= 2) {
        logger.error('lead', `Lead ${lead.id.slice(0, 8)} stalled after ${nudgeCount} nudges`);
        this.ctx.emit('lead:stalled', { leadId: lead.id, nudgeCount, idleDuration });
      }
    }
  }
}
