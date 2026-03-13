import { EventEmitter } from 'events';
import type { AgentManager } from '../../agents/AgentManager.js';
import type { FileLockRegistry } from '../files/FileLockRegistry.js';
import type { DecisionLog } from '../decisions/DecisionLog.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

import type { Alert, AlertSeverity, AlertAction } from '@flightdeck/shared';
export type { Alert, AlertSeverity, AlertAction } from '@flightdeck/shared';

// ── Constants ─────────────────────────────────────────────────────

const MAX_ALERTS = 100;
const STUCK_AGENT_MS = 10 * 60 * 1000;       // 10 minutes
const NEW_AGENT_GRACE_MS = 5 * 60 * 1000;   // 5 minutes grace for newly created agents
const MAX_PROMPTING_MS = 30 * 60 * 1000;     // 30 minutes max before prompting is considered stuck
const STALE_DECISION_MS = 10 * 60 * 1000;     // 10 minutes
const CHECK_INTERVAL_MS = 60 * 1000;           // 1 minute

// ── AlertEngine ───────────────────────────────────────────────────

export class AlertEngine extends EventEmitter {
  private alerts: Alert[] = [];
  private nextId = 1;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private boundActivityHandler: ((entry: { agentId: string }) => void) | null = null;

  // Track recent activity per agent to detect "stuck" state
  private lastActivityByAgent = new Map<string, number>();
  private static readonly MAX_TRACKED_AGENTS = 500;

  constructor(
    private agentManager: AgentManager,
    private lockRegistry: FileLockRegistry,
    private decisionLog: DecisionLog,
    private activityLedger: ActivityLedger,
    private taskDAG: TaskDAG,
  ) {
    super();
  }

  /** Start periodic checks. Call once during server initialization. */
  start(): void {
    if (this.checkTimer) return;

    // Subscribe to activity events to track last-activity timestamps
    this.boundActivityHandler = (entry: { agentId: string }) => {
      this.lastActivityByAgent.set(entry.agentId, Date.now());
      // Evict oldest entries if map grows unbounded
      if (this.lastActivityByAgent.size > AlertEngine.MAX_TRACKED_AGENTS) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [key, time] of this.lastActivityByAgent) {
          if (time < oldestTime) { oldestTime = time; oldestKey = key; }
        }
        if (oldestKey) this.lastActivityByAgent.delete(oldestKey);
      }
    };
    this.activityLedger.on('activity', this.boundActivityHandler);

    this.checkTimer = setInterval(() => {
      try { this.runChecks(); } catch { /* individual checks are best-effort */ }
    }, CHECK_INTERVAL_MS);
    // Run immediately on start
    this.runChecks();
    logger.info({ module: 'coordination', msg: 'AlertEngine started' });
  }

  stop(): void {
    if (this.boundActivityHandler) {
      this.activityLedger.off('activity', this.boundActivityHandler);
      this.boundActivityHandler = null;
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.lastActivityByAgent.clear();
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  // ── Core check loop ─────────────────────────────────────────────

  private runChecks(): void {
    this.checkStuckAgents();
    this.checkLongRunningPrompts();
    this.checkDuplicateFileEdits();
    this.checkIdleAgentsWithReadyTasks();
    this.checkStaleDecisions();
  }

  // ── Individual checks ───────────────────────────────────────────

  /** 1. Agent in 'running' status with no activity for 10+ minutes */
  private checkStuckAgents(): void {
    return; // Disabled: too noisy for long-running sessions
    const now = Date.now();
    for (const agent of this.agentManager.getAll()) {
      if (agent.status !== 'running') continue;
      // Skip leads — they're coordinators, not workers
      if (agent.role.id === 'lead') continue;
      // Skip recently-created agents — give them time to start
      if (now - agent.createdAt.getTime() < NEW_AGENT_GRACE_MS) continue;
      // Skip agents with an active LLM call — but only if it started recently (< 30 min)
      if (agent.isPrompting) {
        const promptStart = agent.promptingStartedAt;
        if (promptStart != null && (now - promptStart!) < MAX_PROMPTING_MS) continue;
      }
      const lastActivity = this.lastActivityByAgent.get(agent.id) ?? agent.createdAt.getTime();
      if (now - lastActivity > STUCK_AGENT_MS) {
        this.addAlert({
          type: 'stuck_agent',
          severity: 'warning',
          message: `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) has been running with no activity for ${Math.round((now - lastActivity) / 60_000)}min`,
          agentId: agent.id,
        });
      }
    }
  }

  /** 1b. Any agent (including leads) with a prompt running longer than MAX_PROMPTING_MS */
  private checkLongRunningPrompts(): void {
    const now = Date.now();
    for (const agent of this.agentManager.getAll()) {
      if (!agent.isPrompting) continue;
      const promptStart = agent.promptingStartedAt;
      if (promptStart == null) continue;
      const elapsed = now - promptStart;
      if (elapsed < MAX_PROMPTING_MS) continue;

      this.addAlert({
        type: 'long_running_prompt',
        severity: 'warning',
        message: `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) has been prompting for ${Math.round(elapsed / 60_000)}min — may be stalled`,
        agentId: agent.id,
      });
    }
  }

  /** 3. Multiple agents editing the same file (lock contention indicator) */
  private checkDuplicateFileEdits(): void {
    const locks = this.lockRegistry.getAll();
    const fileAgents = new Map<string, string[]>();
    for (const lock of locks) {
      if (!fileAgents.has(lock.filePath)) fileAgents.set(lock.filePath, []);
      fileAgents.get(lock.filePath)!.push(lock.agentId);
    }
    for (const [filePath, agentIds] of fileAgents) {
      if (agentIds.length > 1) {
        const names = agentIds.map(id => {
          const a = this.agentManager.get(id);
          return a ? `${a.role.name} (${id.slice(0, 8)})` : id.slice(0, 8);
        }).join(', ');
        this.addAlert({
          type: 'duplicate_file_edit',
          severity: 'warning',
          message: `File "${filePath}" locked by ${agentIds.length} agents: ${names}`,
          agentId: agentIds[0],
        });
      }
    }
  }

  /** 4. Idle agents with DAG tasks in 'ready' state */
  private checkIdleAgentsWithReadyTasks(): void {
    const idleAgents = this.agentManager.getAll().filter(a => a.status === 'idle');
    if (idleAgents.length === 0) return;

    // Check each lead's DAG for ready tasks
    const leads = this.agentManager.getAll().filter(a => a.role.id === 'lead');
    for (const lead of leads) {
      const readyTasks = this.taskDAG.resolveReady(lead.id);
      if (readyTasks.length === 0) continue;

      // Find idle agents in this lead's team
      const teamIdle = idleAgents.filter(a => a.parentId === lead.id);
      if (teamIdle.length === 0) continue;

      const taskNames = readyTasks.slice(0, 3).map(t => t.id).join(', ');
      const agentNames = teamIdle.slice(0, 3).map(a => `${a.role.name} (${a.id.slice(0, 8)})`).join(', ');
      this.addAlert({
        type: 'idle_agents_ready_tasks',
        severity: 'info',
        message: `${teamIdle.length} idle agent(s) (${agentNames}) but ${readyTasks.length} DAG task(s) ready (${taskNames})`,
      });
    }
  }

  /** 5. Decisions pending confirmation for 10+ minutes */
  private checkStaleDecisions(): void {
    const pending = this.decisionLog.getNeedingConfirmation();
    const now = Date.now();
    for (const decision of pending) {
      const age = now - new Date(decision.timestamp).getTime();
      if (age > STALE_DECISION_MS) {
        this.addAlert({
          type: 'stale_decision',
          severity: 'warning',
          message: `Decision "${decision.title}" pending for ${Math.round(age / 60_000)}min — needs user response`,
          agentId: decision.agentId,
        });
      }
    }
  }

  // ── Alert management ────────────────────────────────────────────

  private addAlert(partial: Omit<Alert, 'id' | 'timestamp'>): void {
    // Dedup: skip if an identical type+agentId alert exists within the last check cycle
    const recent = this.alerts.find(a =>
      a.type === partial.type &&
      a.agentId === partial.agentId &&
      Date.now() - new Date(a.timestamp).getTime() < CHECK_INTERVAL_MS,
    );
    if (recent) return;

    // Resolve projectId from agentId if not explicitly provided
    const projectId = partial.projectId ??
      (partial.agentId ? this.agentManager.getProjectIdForAgent(partial.agentId) : undefined);

    const alert: Alert = {
      ...partial,
      projectId,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
    };

    this.alerts.push(alert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(-MAX_ALERTS);
    }

    this.emit('alert:new', alert);
    logger.info({ module: 'coordination', msg: 'Alert triggered', severity: alert.severity, alertType: alert.type, alertMessage: alert.message });
  }
}
