import type { AgentManager } from '../agents/AgentManager.js';
import type { AgentContextInfo } from '../agents/Agent.js';
import type { FileLockRegistry } from './FileLockRegistry.js';
import type { ActivityLedger } from './ActivityLedger.js';

export class ContextRefresher {
  private agentManager: AgentManager;
  private lockRegistry: FileLockRegistry;
  private activityLedger: ActivityLedger;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    agentManager: AgentManager,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
  ) {
    this.agentManager = agentManager;
    this.lockRegistry = lockRegistry;
    this.activityLedger = activityLedger;

    // Listen to significant events with debounce
    const debouncedRefresh = () => this.scheduleRefresh();
    this.agentManager.on('agent:spawned', debouncedRefresh);
    this.agentManager.on('agent:terminated', debouncedRefresh);
    this.agentManager.on('agent:exit', debouncedRefresh);
    this.lockRegistry.on('lock:acquired', debouncedRefresh);
    this.lockRegistry.on('lock:released', debouncedRefresh);

    // Re-inject crew context immediately after Copilot CLI compacts an agent's context
    this.agentManager.on('agent:context_compacted', (data: { agentId: string }) => {
      this.refreshOne(data.agentId);
    });
  }

  start(): void {
    // Event-driven refresh only — no periodic timer.
    // Context updates are pushed on significant events (spawn, terminate, lock changes)
    // to avoid wasting tokens on idle heartbeats.
  }

  stop(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }

  refreshAll(): void {
    const peers = this.buildPeerList();
    const recentActivity = this.buildRecentActivity();

    for (const agent of this.agentManager.getAll()) {
      if (agent.status !== 'running') continue;
      const otherPeers = peers.filter((p) => p.id !== agent.id);
      agent.injectContextUpdate(otherPeers, recentActivity);
    }
  }

  refreshOne(agentId: string): void {
    const agent = this.agentManager.get(agentId);
    if (!agent || agent.status !== 'running') return;

    const peers = this.buildPeerList().filter((p) => p.id !== agentId);
    const recentActivity = this.buildRecentActivity();
    agent.injectContextUpdate(peers, recentActivity);
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
      lockedFiles: allLocks
        .filter((lock) => lock.agentId === agent.id)
        .map((lock) => lock.filePath),
    }));
  }

  buildRecentActivity(limit: number = 20): string[] {
    const entries = this.activityLedger.getRecent(limit);
    return entries.map((entry) => {
      const shortId = entry.agentId.slice(0, 8);
      return `[${entry.timestamp}] Agent ${shortId} (${entry.agentRole}): ${entry.actionType} — ${entry.summary}`;
    });
  }

  private scheduleRefresh(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.refreshAll();
    }, 2000);
  }
}
