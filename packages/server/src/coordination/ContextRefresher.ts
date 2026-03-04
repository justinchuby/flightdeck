import type { AgentManager } from '../agents/AgentManager.js';
import type { AgentContextInfo } from '../agents/Agent.js';
import { isTerminalStatus } from '../agents/Agent.js';
import type { FileLockRegistry } from './FileLockRegistry.js';
import type { ActivityLedger } from './ActivityLedger.js';
import { SynthesisEngine } from './SynthesisEngine.js';
import { SmartActivityFilter } from './SmartActivityFilter.js';

/**
 * Periodic update interval when sub-leads are active (ms).
 * Only used when the project has sub-leads who can CREATE_AGENT autonomously.
 */
const SUB_LEAD_UPDATE_INTERVAL_MS = 180_000;

export class ContextRefresher {
  private agentManager: AgentManager;
  private lockRegistry: FileLockRegistry;
  private activityLedger: ActivityLedger;
  private synthesisEngine: SynthesisEngine;
  private activityFilter: SmartActivityFilter;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private periodicHandle: ReturnType<typeof setTimeout> | null = null;
  private boundRefresh: () => void;
  private boundCompacted: (data: { agentId: string }) => void;
  private currentIntervalMs: number = SUB_LEAD_UPDATE_INTERVAL_MS;
  private running: boolean = false;

  constructor(
    agentManager: AgentManager,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
  ) {
    this.agentManager = agentManager;
    this.lockRegistry = lockRegistry;
    this.activityLedger = activityLedger;
    this.synthesisEngine = new SynthesisEngine(activityLedger, agentManager);
    this.activityFilter = new SmartActivityFilter();

    // Store bound references so we can remove them in stop()
    this.boundRefresh = () => this.scheduleRefresh();
    this.boundCompacted = (data) => this.refreshOne(data.agentId);

    // Notify lead when new agents appear (sub-leads can CREATE_AGENT independently)
    this.agentManager.on('agent:spawned', this.boundRefresh);

    // Re-inject crew context immediately after Copilot CLI compacts an agent's context
    this.agentManager.on('agent:context_compacted', this.boundCompacted);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedulePeriodicRefresh();
  }

  stop(): void {
    this.running = false;
    // Remove event listeners to prevent leaks
    this.agentManager.off('agent:spawned', this.boundRefresh);
    this.agentManager.off('agent:context_compacted', this.boundCompacted);

    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    if (this.periodicHandle) {
      clearTimeout(this.periodicHandle);
      this.periodicHandle = null;
    }
  }

  refreshAll(): void {
    const peers = this.buildPeerList();
    const lockSection = this.buildFileLockSection();
    const alerts = this.buildAlerts(peers);

    for (const agent of this.agentManager.getAll()) {
      if (agent.status !== 'running') continue;
      if (!agent.role.receivesStatusUpdates) continue;
      const otherPeers = peers.filter((p) => p.id !== agent.id);
      const healthHeader = this.buildHealthHeader(agent.id, agent.role.id !== 'lead');
      agent.injectContextUpdate(otherPeers, [], `${healthHeader}\n${lockSection}`, alerts);
    }
  }

  refreshOne(agentId: string): void {
    const agent = this.agentManager.get(agentId);
    if (!agent || agent.status !== 'running') return;

    const peers = this.buildPeerList();
    const otherPeers = peers.filter((p) => p.id !== agentId);
    const alerts = this.buildAlerts(peers);
    const healthHeader = agent.role.receivesStatusUpdates
      ? `${this.buildHealthHeader(agent.id, agent.role.id !== 'lead')}\n${this.buildFileLockSection()}`
      : undefined;
    agent.injectContextUpdate(otherPeers, [], healthHeader, alerts);
  }

  /** Refresh only agents whose role has receivesStatusUpdates */
  private refreshStatusReceivers(): void {
    const statusAgents = this.agentManager.getAll().filter(
      (a) => a.status === 'running' && a.role.receivesStatusUpdates,
    );
    if (statusAgents.length === 0) return;

    const peers = this.buildPeerList();
    const lockSection = this.buildFileLockSection();
    const alerts = this.buildAlerts(peers);

    for (const agent of statusAgents) {
      const otherPeers = peers.filter((p) => p.id !== agent.id);
      const healthHeader = `${this.buildHealthHeader(agent.id, agent.role.id !== 'lead')}\n${lockSection}`;
      agent.injectContextUpdate(otherPeers, [], healthHeader, alerts);
    }
  }

  buildPeerList(): AgentContextInfo[] {
    const agents = this.agentManager.getAll();
    const allLocks = this.lockRegistry.getAll();

    return agents.map((agent) => ({
      id: agent.id,
      role: agent.role.id,
      roleName: agent.role.name,
      status: agent.status,
      task: agent.task,
      parentId: agent.parentId,
      model: agent.model || agent.role.model,
      isSystemAgent: agent.isSystemAgent || undefined,
      lockedFiles: allLocks
        .filter((lock) => lock.agentId === agent.id)
        .map((lock) => lock.filePath),
      pendingMessages: agent.pendingMessageCount ?? 0,
      createdAt: agent.createdAt?.toISOString?.() ?? new Date().toISOString(),
      contextWindowSize: agent.contextWindowSize ?? 0,
      contextWindowUsed: agent.contextWindowUsed ?? 0,
    }));
  }

  buildRecentActivity(limit: number = 20): string[] {
    // Fetch extra entries so the smart filter has enough high/medium priority events.
    // If the first pass is exhausted by low-value churn, widen the window adaptively.
    const initialFetch = limit * 5;
    let rawEntries = this.activityLedger.getRecent(initialFetch);
    let filtered = this.activityFilter.filter(rawEntries, limit);

    if (filtered.length < limit && rawEntries.length >= initialFetch) {
      rawEntries = this.activityLedger.getRecent(initialFetch * 3);
      filtered = this.activityFilter.filter(rawEntries, limit);
    }

    return filtered.map((entry) => {
      const shortId = entry.agentId.slice(0, 8);
      return `[${entry.timestamp}] Agent ${shortId} (${entry.agentRole}): ${entry.actionType} — ${entry.summary}`;
    });
  }

  /**
   * Compute a 2-3 line health summary for CREW_UPDATE.
   * @param agentId - The agent receiving the header
   * @param projectWide - If true, shows all agents (for secretary); if false, shows only children (for lead)
   */
  private buildHealthHeader(agentId: string, projectWide: boolean = false): string {
    const allAgents = this.agentManager.getAll();
    const myAgents = projectWide
      ? allAgents.filter(a => a.id !== agentId)
      : allAgents.filter(a => a.parentId === agentId);
    const active = myAgents.filter(a => a.status === 'running').length;
    const idle = myAgents.filter(a => a.status === 'idle').length;
    const completed = myAgents.filter(a => isTerminalStatus(a.status)).length;
    const total = myAgents.length;

    // Decisions — lead sees own decisions; project-wide sees all
    const decisionLog = this.agentManager.getDecisionLog();
    const pendingDecisions = projectWide
      ? decisionLog.getAll().filter(d => d.needsConfirmation && d.status === 'recorded')
      : decisionLog.getByLeadId(agentId).filter(d => d.needsConfirmation && d.status === 'recorded');
    const pendingCount = pendingDecisions.length;
    let oldestAge = '';
    if (pendingDecisions.length > 0) {
      const oldestMs = Date.now() - new Date(pendingDecisions[0].timestamp).getTime();
      const mins = Math.floor(oldestMs / 60000);
      oldestAge = isNaN(mins) ? 'pending' : mins < 1 ? '<1 min' : `${mins} min`;
    }

    // DAG tasks — for project-wide, find the lead agent to get DAG scope
    const taskDAG = this.agentManager.getTaskDAG();
    const dagLeadId = projectWide
      ? allAgents.find(a => a.role.id === 'lead' && !a.parentId)?.id ?? agentId
      : agentId;
    const dagStatus = taskDAG.getStatus(dagLeadId);
    const dag = dagStatus.summary;
    const dagTotal = dag.pending + dag.ready + dag.running + dag.done + dag.failed + dag.blocked + dag.paused + dag.skipped;
    const completionPct = dagTotal > 0 ? Math.round(((dag.done + dag.skipped) / dagTotal) * 100) : null;

    // Health indicator
    const hasCritical = dag.blocked > 0 || dag.failed > 0;
    const hasWarning = pendingCount > 0 || idle > Math.max(1, total / 2);
    const icon = total === 0 ? '\u26AA' : hasCritical ? '\uD83D\uDD34' : hasWarning ? '\u26A0\uFE0F' : '\u2705';

    // Line 1: completion + agents + decisions
    const parts: string[] = [];
    if (total === 0) {
      parts.push('No agents yet');
    } else {
      if (completionPct !== null) parts.push(`${completionPct}% complete`);
      parts.push(`${active} active, ${idle} idle${completed > 0 ? `, ${completed} done` : ''}`);
    }
    if (pendingCount > 0) parts.push(`${pendingCount} decision${pendingCount !== 1 ? 's' : ''} pending (${oldestAge})`);

    // Line 2: blocked/failed
    const line2Parts: string[] = [];
    if (dag.blocked > 0) line2Parts.push(`${dag.blocked} blocked task${dag.blocked !== 1 ? 's' : ''}`);
    if (dag.failed > 0) line2Parts.push(`${dag.failed} failed task${dag.failed !== 1 ? 's' : ''}`);
    const line2 = line2Parts.length > 0 ? `\n${line2Parts.join(' · ')}` : dagTotal > 0 ? '\n0 blocked tasks' : '';

    const healthLine = `== PROJECT HEALTH ==\n${icon} ${parts.join(' \u00B7 ')}${line2}`;

    // Append critical events from SynthesisEngine (for leads only)
    if (!projectWide) {
      const criticalSection = this.synthesisEngine.formatCriticalSection(agentId);
      if (criticalSection) return `${healthLine}\n${criticalSection}`;
    }

    return healthLine;
  }

  /** Build a summary of currently held file locks */
  private buildFileLockSection(): string {
    const locks = this.lockRegistry.getAll();
    if (locks.length === 0) return '== ACTIVE FILE LOCKS ==\nNone';

    const lines = locks.map(lock => {
      const agent = this.agentManager.get(lock.agentId);
      const roleName = agent?.role.name ?? 'Unknown';
      return `- ${lock.filePath} \u2192 ${lock.agentId.slice(0, 8)} (${roleName})`;
    });
    return `== ACTIVE FILE LOCKS ==\n${lines.join('\n')}`;
  }

  /** Build actionable alerts: stuck agents, high context usage */
  private buildAlerts(peers: import('../agents/Agent.js').AgentContextInfo[]): string[] {
    const alerts: string[] = [];
    const now = Date.now();

    for (const p of peers) {
      // Context usage warning at 80%
      if (p.contextWindowSize && p.contextWindowSize > 0 && p.contextWindowUsed) {
        const pct = Math.round((p.contextWindowUsed / p.contextWindowSize) * 100);
        if (pct >= 80) {
          alerts.push(`${p.id.slice(0, 8)} near context limit (${pct}%)`);
        }
      }

      // Stuck agent: running for >10 minutes
      if (p.status === 'running' && p.createdAt) {
        const elapsedMs = now - new Date(p.createdAt).getTime();
        if (elapsedMs > 10 * 60 * 1000) {
          const mins = Math.floor(elapsedMs / 60000);
          alerts.push(`${p.id.slice(0, 8)} running >${mins}m — may be stuck`);
        }
      }
    }

    return alerts;
  }

  /**
   * Check if running sub-leads exist (agents with role 'lead' that have a parentId).
   * Only when sub-leads are active does the lead need periodic updates,
   * since sub-leads can CREATE_AGENT autonomously.
   */
  private hasActiveSubLeads(): boolean {
    return this.agentManager.getAll().some(
      a => a.role.id === 'lead' && !!a.parentId && a.status === 'running',
    );
  }

  /** Schedule the next periodic refresh — only runs when sub-leads are active */
  private schedulePeriodicRefresh(): void {
    if (!this.running) return;
    if (this.periodicHandle) {
      clearTimeout(this.periodicHandle);
      this.periodicHandle = null;
    }

    // No periodic updates if no sub-leads — the lead gets direct Agent Reports
    if (!this.hasActiveSubLeads()) return;

    this.currentIntervalMs = SUB_LEAD_UPDATE_INTERVAL_MS;
    this.periodicHandle = setTimeout(() => {
      this.periodicHandle = null;
      if (!this.running) return;
      if (this.hasActiveSubLeads()) {
        this.refreshStatusReceivers();
      }
      this.schedulePeriodicRefresh();
    }, this.currentIntervalMs);
  }

  private scheduleRefresh(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.refreshAll();
      // Re-evaluate periodic timer (a new sub-lead may have spawned)
      if (!this.periodicHandle) this.schedulePeriodicRefresh();
    }, 2000);
  }
}
