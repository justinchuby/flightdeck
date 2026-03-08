/**
 * Agent Server Entry Point — forked by ForkTransport.
 *
 * This script runs in a detached child process, separate from the
 * orchestrator. It bootstraps a ForkListener + AgentServer and
 * optionally wires persistence and recovery.
 *
 * Lifecycle:
 *  1. Create ForkListener (IPC + TCP localhost)
 *  2. Open SQLite DB for persistence (shared file, WAL mode)
 *  3. Create AgentServer with persistence hooks
 *  4. Run self-recovery (resume agents from previous state)
 *  5. Start listener → accept orchestrator connections
 *  6. Signal 'ready' to parent via IPC
 *
 * Shutdown:
 *  - SIGINT (Ctrl+C propagated from parent) → immediate graceful shutdown
 *  - SIGTERM → immediate graceful shutdown
 *  - Zombie prevention: on tsx hot-reload the new orchestrator's
 *    ForkTransport.connect() kills stale processes via PID file
 *    before forking a fresh agent server.
 *
 * Design: docs/design/agent-server-architecture.md
 */
import { ForkListener } from './transport/ForkListener.js';
import { AgentServer } from './agent-server.js';
import type { AgentServerPersistence, ManagedAgent } from './agent-server.js';
import { AgentServerPersistence as PersistenceLayer } from './agent-server-persistence.js';
import { AgentServerRecovery } from './agents/AgentServerRecovery.js';
import { Database } from './db/database.js';
import { AgentRosterRepository } from './db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from './db/ActiveDelegationRepository.js';
import { logger } from './utils/logger.js';

// ── Configuration from environment ──────────────────────────────────

const stateDir = process.env.FLIGHTDECK_STATE_DIR ?? process.cwd();
const dbPath = process.env.FLIGHTDECK_DB_PATH ?? 'flightdeck.db';

// ── Persistence bridge ──────────────────────────────────────────────
// AgentServer's interface uses simple (agentId, role, model) params,
// while PersistenceLayer expects ManagedAgent objects. This adapter
// bridges the two for lifecycle callbacks.

function createPersistenceBridge(
  rosterRepo: AgentRosterRepository,
  layer: PersistenceLayer,
): AgentServerPersistence {
  return {
    onAgentSpawned(agentId: string, role: string, model: string): void {
      try {
        rosterRepo.upsertAgent(agentId, role, model, 'idle');
      } catch (err) {
        logger.error({ module: 'persistence-bridge', msg: 'Failed to persist spawn', agentId, err: String(err) });
      }
    },
    onAgentTerminated(agentId: string): void {
      layer.onAgentTerminated(agentId);
    },
    onAgentExited(agentId: string, exitCode: number): void {
      layer.onAgentExited(agentId, exitCode);
    },
    onStatusChanged(agentId: string, status: string): void {
      layer.onStatusChanged(agentId, status);
    },
    onServerStop(agents: ManagedAgent[]): void {
      layer.onServerStop(agents);
    },
  };
}

// ── Bootstrap ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info({ module: 'agent-server-entry', msg: 'Starting agent server process', pid: process.pid, ppid: process.ppid });

  // 1. Create ForkListener — IPC from parent + TCP for reconnection
  const listener = new ForkListener({
    portFileDir: stateDir,
  });

  // 2. Open database for persistence
  let db: Database | undefined;
  let persistenceLayer: PersistenceLayer | undefined;
  let persistence: AgentServerPersistence | undefined;
  try {
    db = new Database(dbPath);
    const rosterRepo = new AgentRosterRepository(db);
    const delegationRepo = new ActiveDelegationRepository(db);
    persistenceLayer = new PersistenceLayer({ rosterRepo, delegationRepo });
    persistence = createPersistenceBridge(rosterRepo, persistenceLayer);
    logger.info({ module: 'agent-server-entry', msg: 'Database opened for persistence', dbPath });
  } catch (err) {
    logger.warn({ module: 'agent-server-entry', msg: 'Persistence unavailable — running without DB', err: String(err) });
  }

  // 3. Create AgentServer
  const server = new AgentServer({
    listener,
    runtimeDir: stateDir,
    persistence,
  });

  // 4. Self-recovery — resume agents from previous state
  if (persistenceLayer) {
    try {
      const recovery = new AgentServerRecovery(persistenceLayer);
      const report = await recovery.recover();
      if (report.total > 0) {
        logger.info({
          module: 'agent-server-entry',
          msg: 'Recovery complete',
          total: report.total,
          resumed: report.resumed.length,
          stale: report.stale.length,
          failed: report.failed.length,
        });
      }
    } catch (err) {
      logger.warn({ module: 'agent-server-entry', msg: 'Recovery failed — starting fresh', err: String(err) });
    }
  }

  // 5. Start server — begin accepting connections
  server.start();

  // 6. Signal ready to parent (ForkTransport waits for this)
  if (process.send) {
    process.send({ type: 'ready', pid: process.pid });
  }

  logger.info({ module: 'agent-server-entry', msg: 'Agent server ready', pid: process.pid });

  // ── Graceful shutdown ───────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ module: 'agent-server-entry', msg: `Shutting down: ${reason}`, pid: process.pid });

    try {
      await server.stop({ reason, timeoutMs: 10_000 });
    } catch (err) {
      logger.warn({ module: 'agent-server-entry', msg: 'Error during server stop', err: String(err) });
    }

    try {
      listener.close();
    } catch (err) {
      logger.warn({ module: 'agent-server-entry', msg: 'Error closing listener', err: String(err) });
    }

    if (db) {
      try {
        db.close();
      } catch (err) {
        logger.warn({ module: 'agent-server-entry', msg: 'Error closing database', err: String(err) });
      }
    }

    logger.info({ module: 'agent-server-entry', msg: 'Agent server stopped', pid: process.pid });
    process.exit(0);
  }

  // ── Signal handling ─────────────────────────────────────────────

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Explicit shutdown command from orchestrator (sent during Ctrl+C).
  // The agent server is detached and won't receive terminal SIGINT,
  // so the orchestrator sends this message before killing us.
  process.on('message', (msg: unknown) => {
    if (msg && typeof msg === 'object' && 'type' in msg && (msg as Record<string, unknown>).type === 'shutdown') {
      shutdown('shutdown-command');
    }
  });

  // Parent IPC disconnect — log it but don't shut down.
  // On tsx hot-reload the new orchestrator kills us via PID file
  // and forks a fresh agent server.
  process.on('disconnect', () => {
    logger.info({ module: 'agent-server-entry', msg: 'Parent IPC disconnected', pid: process.pid });
  });
}

main().catch((err) => {
  logger.error({ module: 'agent-server-entry', msg: 'Fatal startup error', err: String(err) });
  process.exit(1);
});
