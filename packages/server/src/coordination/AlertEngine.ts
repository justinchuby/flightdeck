import { EventEmitter } from 'events';
import type { AgentManager } from '../agents/AgentManager.js';
import type { FileLockRegistry } from './FileLockRegistry.js';
import type { DecisionLog } from './DecisionLog.js';
import type { ActivityLedger } from './ActivityLedger.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Alert {
  id: number;
  type: string;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  agentId?: string;
}

// ── Constants ─────────────────────────────────────────────────────

const MAX_ALERTS = 100;
const STUCK_AGENT_MS = 10 * 60 * 1000;       // 10 minutes
const CONTEXT_PRESSURE_THRESHOLD = 0.85;       // 85%
const STALE_DECISION_MS = 10 * 60 * 1000;     // 10 minutes
const CHECK_INTERVAL_MS = 60 * 1000;           // 1 minute

// ── AlertEngine ───────────────────────────────────────────────────

export class AlertEngine extends EventEmitter {
  private alerts: Alert[] = [];
  private nextId = 1;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  // Track recent activity per agent to detect "stuck" state
  private lastActivityByAgent = new Map<string, number>();

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
    this.activityLedger.on('activity', (entry: { agentId: string }) => {
      this.lastActivityByAgent.set(entry.agentId, Date.now());
    });

    this.checkTimer = setInterval(() => this.runChecks(), CHECK_INTERVAL_MS);
    // Run immediately on start
    this.runChecks();
    logger.info('alerts', 'AlertEngine started');
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  getAlerts(): Alert[] {
    return [...this.alerts];
  }

  // ── Core check loop ─────────────────────────────────────────────

  private runChecks(): void {
    this.checkStuckAgents();
    this.checkContextPressure();
    this.checkDuplicateFileEdits();
    this.checkIdleAgentsWithReadyTasks();
    this.checkStaleDecisions();
  }

  // ── Individual checks ───────────────────────────────────────────

  /** 1. Agent in 'running' status with no activity for 10+ minutes */
  private checkStuckAgents(): void {
    const now = Date.now();
    for (const agent of this.agentManager.getAll()) {
      if (agent.status !== 'running') continue;
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

  /** 2. Agent's context window usage > 85% */
  private checkContextPressure(): void {
    for (const agent of this.agentManager.getAll()) {
      if (agent.status !== 'running' && agent.status !== 'idle') continue;
      if (agent.contextWindowSize === 0) continue;
      const usage = agent.contextWindowUsed / agent.contextWindowSize;
      if (usage > CONTEXT_PRESSURE_THRESHOLD) {
        const pct = Math.round(usage * 100);
        this.addAlert({
          type: 'context_pressure',
          severity: pct > 95 ? 'critical' : 'warning',
          message: `Agent ${agent.role.name} (${agent.id.slice(0, 8)}) context window at ${pct}% — quality may degrade`,
          agentId: agent.id,
        });
      }
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

    const alert: Alert = {
      ...partial,
      id: this.nextId++,
      timestamp: new Date().toISOString(),
    };

    this.alerts.push(alert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(-MAX_ALERTS);
    }

    this.emit('alert:new', alert);
    logger.info('alerts', `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
  }
}
