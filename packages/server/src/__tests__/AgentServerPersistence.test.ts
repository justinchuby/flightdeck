/**
 * AgentServerPersistence tests.
 *
 * Tests the write-on-mutation persistence layer using in-memory SQLite
 * to verify that agent lifecycle events are correctly persisted to the
 * agentRoster and activeDelegations tables.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import * as schema from '../db/schema.js';
import { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';
import { AgentServerPersistence } from '../agent-server-persistence.js';
import type { ManagedAgent } from '../agent-server.js';

// ── Test Helpers ────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, '../../drizzle');

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, drizzle: db } as any;
}

function makeManagedAgent(overrides: Partial<ManagedAgent> = {}): ManagedAgent {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? 'developer',
    model: overrides.model ?? 'claude-sonnet',
    adapter: {} as any,
    status: overrides.status ?? 'starting',
    pid: overrides.pid ?? 1234,
    task: overrides.task ?? 'implement feature',
    sessionId: overrides.sessionId,
    projectId: overrides.projectId ?? 'test-project',
    teamId: overrides.teamId ?? 'test-team',
    startedAt: overrides.startedAt ?? Date.now(),
    cleanups: [],
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('AgentServerPersistence', () => {
  let db: any;
  let rosterRepo: AgentRosterRepository;
  let delegationRepo: ActiveDelegationRepository;
  let persistence: AgentServerPersistence;

  beforeEach(() => {
    db = createTestDb();
    rosterRepo = new AgentRosterRepository(db);
    delegationRepo = new ActiveDelegationRepository(db);
    persistence = new AgentServerPersistence({
      rosterRepo,
      delegationRepo,
      projectId: 'test-project',
    });
  });

  describe('onAgentSpawned', () => {
    it('persists agent to roster on spawn', () => {
      const agent = makeManagedAgent({ id: 'agent-spawn-1', role: 'developer', model: 'claude-sonnet' });
      persistence.onAgentSpawned(agent);

      const record = rosterRepo.getAgent('agent-spawn-1');
      expect(record).toBeDefined();
      expect(record!.agentId).toBe('agent-spawn-1');
      expect(record!.role).toBe('developer');
      expect(record!.model).toBe('claude-sonnet');
      expect(record!.status).toBe('idle');
      expect(record!.projectId).toBe('test-project');
    });

    it('includes task and pid in metadata', () => {
      const agent = makeManagedAgent({ id: 'agent-meta-1', task: 'fix bug', pid: 5678 });
      persistence.onAgentSpawned(agent);

      const record = rosterRepo.getAgent('agent-meta-1');
      expect(record!.metadata).toBeDefined();
      expect(record!.metadata!.task).toBe('fix bug');
      expect(record!.metadata!.pid).toBe(5678);
    });

    it('upserts on duplicate agent ID', () => {
      const agent1 = makeManagedAgent({ id: 'agent-dup', role: 'developer' });
      const agent2 = makeManagedAgent({ id: 'agent-dup', role: 'architect' });

      persistence.onAgentSpawned(agent1);
      persistence.onAgentSpawned(agent2);

      const record = rosterRepo.getAgent('agent-dup');
      expect(record!.role).toBe('architect');
    });
  });

  describe('onSessionReady', () => {
    it('updates session ID for existing agent', () => {
      const agent = makeManagedAgent({ id: 'agent-sess-1' });
      persistence.onAgentSpawned(agent);

      persistence.onSessionReady('agent-sess-1', 'session-abc-123');

      const record = rosterRepo.getAgent('agent-sess-1');
      expect(record!.sessionId).toBe('session-abc-123');
    });

    it('handles non-existent agent gracefully', () => {
      // Should not throw
      persistence.onSessionReady('nonexistent', 'session-xyz');
    });
  });

  describe('onStatusChanged', () => {
    it('maps running status to busy', () => {
      const agent = makeManagedAgent({ id: 'agent-status-1' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-1', 'running');

      const record = rosterRepo.getAgent('agent-status-1');
      expect(record!.status).toBe('busy');
    });

    it('maps idle status to idle', () => {
      const agent = makeManagedAgent({ id: 'agent-status-2' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-2', 'idle');

      const record = rosterRepo.getAgent('agent-status-2');
      expect(record!.status).toBe('idle');
    });

    it('maps starting to idle', () => {
      const agent = makeManagedAgent({ id: 'agent-status-3' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-3', 'starting');

      const record = rosterRepo.getAgent('agent-status-3');
      expect(record!.status).toBe('idle');
    });

    it('maps crashed to terminated', () => {
      const agent = makeManagedAgent({ id: 'agent-status-4' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-4', 'crashed');

      const record = rosterRepo.getAgent('agent-status-4');
      expect(record!.status).toBe('terminated');
    });

    it('maps exited to terminated', () => {
      const agent = makeManagedAgent({ id: 'agent-status-5' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-5', 'exited');

      const record = rosterRepo.getAgent('agent-status-5');
      expect(record!.status).toBe('terminated');
    });

    it('ignores unknown status values', () => {
      const agent = makeManagedAgent({ id: 'agent-status-6' });
      persistence.onAgentSpawned(agent);

      persistence.onStatusChanged('agent-status-6', 'unknown_status');

      const record = rosterRepo.getAgent('agent-status-6');
      expect(record!.status).toBe('idle'); // unchanged from initial
    });
  });

  describe('onAgentExited', () => {
    it('marks agent as terminated on clean exit', () => {
      const agent = makeManagedAgent({ id: 'agent-exit-1' });
      persistence.onAgentSpawned(agent);

      persistence.onAgentExited('agent-exit-1', 0);

      const record = rosterRepo.getAgent('agent-exit-1');
      expect(record!.status).toBe('terminated');
    });

    it('marks agent as terminated on crash exit', () => {
      const agent = makeManagedAgent({ id: 'agent-exit-2' });
      persistence.onAgentSpawned(agent);

      persistence.onAgentExited('agent-exit-2', 1);

      const record = rosterRepo.getAgent('agent-exit-2');
      expect(record!.status).toBe('terminated');
    });
  });

  describe('onAgentTerminated', () => {
    it('marks agent as terminated', () => {
      const agent = makeManagedAgent({ id: 'agent-term-1' });
      persistence.onAgentSpawned(agent);

      persistence.onAgentTerminated('agent-term-1');

      const record = rosterRepo.getAgent('agent-term-1');
      expect(record!.status).toBe('terminated');
    });

    it('cancels active delegations for terminated agent', () => {
      const agent = makeManagedAgent({ id: 'agent-term-2' });
      persistence.onAgentSpawned(agent);

      // Create an active delegation
      delegationRepo.create('del-1', 'agent-term-2', 'subtask', undefined, 'task-1');

      persistence.onAgentTerminated('agent-term-2');

      const delegations = delegationRepo.getActive('agent-term-2');
      expect(delegations.length).toBe(0);
    });
  });

  describe('onServerStop', () => {
    it('marks all active agents as terminated', () => {
      const agent1 = makeManagedAgent({ id: 'agent-stop-1', status: 'running' });
      const agent2 = makeManagedAgent({ id: 'agent-stop-2', status: 'idle' });
      persistence.onAgentSpawned(agent1);
      persistence.onAgentSpawned(agent2);

      persistence.onServerStop([agent1, agent2]);

      const record1 = rosterRepo.getAgent('agent-stop-1');
      const record2 = rosterRepo.getAgent('agent-stop-2');
      expect(record1!.status).toBe('terminated');
      expect(record2!.status).toBe('terminated');
    });

    it('skips agents already in terminal state', () => {
      const agent = makeManagedAgent({ id: 'agent-stop-3', status: 'exited' });
      persistence.onAgentSpawned(agent);

      // Mark as terminated via exit
      persistence.onAgentExited('agent-stop-3', 0);

      // onServerStop should not double-process
      persistence.onServerStop([agent]);

      const record = rosterRepo.getAgent('agent-stop-3');
      expect(record!.status).toBe('terminated');
    });

    it('handles empty agent list', () => {
      persistence.onServerStop([]);
      // No error
    });
  });

  describe('getActiveAgents', () => {
    it('returns only non-terminated agents', () => {
      const agent1 = makeManagedAgent({ id: 'active-1' });
      const agent2 = makeManagedAgent({ id: 'active-2' });
      const agent3 = makeManagedAgent({ id: 'active-3' });
      persistence.onAgentSpawned(agent1);
      persistence.onAgentSpawned(agent2);
      persistence.onAgentSpawned(agent3);

      persistence.onAgentTerminated('active-2');

      const active = persistence.getActiveAgents();
      expect(active.length).toBe(2);
      expect(active.map(a => a.agentId).sort()).toEqual(['active-1', 'active-3']);
    });
  });

  describe('full lifecycle', () => {
    it('tracks agent through spawn → running → idle → exit', () => {
      const agent = makeManagedAgent({ id: 'lifecycle-1' });

      persistence.onAgentSpawned(agent);
      let record = rosterRepo.getAgent('lifecycle-1');
      expect(record!.status).toBe('idle');

      persistence.onSessionReady('lifecycle-1', 'session-42');
      record = rosterRepo.getAgent('lifecycle-1');
      expect(record!.sessionId).toBe('session-42');

      persistence.onStatusChanged('lifecycle-1', 'running');
      record = rosterRepo.getAgent('lifecycle-1');
      expect(record!.status).toBe('busy');

      persistence.onStatusChanged('lifecycle-1', 'idle');
      record = rosterRepo.getAgent('lifecycle-1');
      expect(record!.status).toBe('idle');

      persistence.onAgentExited('lifecycle-1', 0);
      record = rosterRepo.getAgent('lifecycle-1');
      expect(record!.status).toBe('terminated');
    });
  });

  describe('error resilience', () => {
    it('does not throw when db operations fail', () => {
      // Close the database to force errors
      db.sqlite.close();

      const agent = makeManagedAgent({ id: 'err-1' });

      // All operations should log errors but not throw
      expect(() => persistence.onAgentSpawned(agent)).not.toThrow();
      expect(() => persistence.onSessionReady('err-1', 'session')).not.toThrow();
      expect(() => persistence.onStatusChanged('err-1', 'running')).not.toThrow();
      expect(() => persistence.onAgentExited('err-1', 0)).not.toThrow();
      expect(() => persistence.onAgentTerminated('err-1')).not.toThrow();
      expect(() => persistence.onServerStop([agent])).not.toThrow();
    });
  });
});
