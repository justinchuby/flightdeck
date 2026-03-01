import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertEngine } from '../coordination/AlertEngine.js';
import type { Agent } from '../agents/Agent.js';
import type { AgentManager } from '../agents/AgentManager.js';
import type { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import type { DecisionLog } from '../coordination/DecisionLog.js';
import type { ActivityLedger } from '../coordination/ActivityLedger.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<{
  id: string;
  role: { id: string; name: string };
  status: string;
  parentId: string | undefined;
  createdAt: Date;
  isPrompting: boolean;
  promptingStartedAt: number | null;
  contextWindowSize: number;
  contextWindowUsed: number;
}> = {}): Agent {
  return {
    id: overrides.id ?? 'agent-1',
    role: overrides.role ?? { id: 'developer', name: 'Developer' },
    status: overrides.status ?? 'running',
    parentId: overrides.parentId ?? undefined,
    createdAt: overrides.createdAt ?? new Date(Date.now() - 20 * 60 * 1000), // 20 min ago by default
    isPrompting: overrides.isPrompting ?? false,
    promptingStartedAt: overrides.promptingStartedAt ?? (overrides.isPrompting ? Date.now() : null),
    contextWindowSize: overrides.contextWindowSize ?? 0,
    contextWindowUsed: overrides.contextWindowUsed ?? 0,
  } as unknown as Agent;
}

function createMockDeps() {
  const agents: Agent[] = [];
  const agentManager = {
    getAll: vi.fn(() => agents),
    get: vi.fn((id: string) => agents.find(a => a.id === id)),
  } as unknown as AgentManager;

  const lockRegistry = {
    getAll: vi.fn(() => []),
  } as unknown as FileLockRegistry;

  const decisionLog = {
    getNeedingConfirmation: vi.fn(() => []),
  } as unknown as DecisionLog;

  const activityLedger = {
    on: vi.fn(),
  } as unknown as ActivityLedger;

  const taskDAG = {
    resolveReady: vi.fn(() => []),
  } as unknown as TaskDAG;

  return { agents, agentManager, lockRegistry, decisionLog, activityLedger, taskDAG };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AlertEngine — checkStuckAgents exemptions', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let engine: AlertEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createMockDeps();
    engine = new AlertEngine(
      deps.agentManager,
      deps.lockRegistry,
      deps.decisionLog,
      deps.activityLedger,
      deps.taskDAG,
    );
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('fires stuck_agent alert for a long-running developer with no activity', () => {
    deps.agents.push(makeAgent({
      id: 'stuck-dev-1234',
      status: 'running',
      createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(1);
    expect(stuckAlerts[0].agentId).toBe('stuck-dev-1234');
  });

  it('skips agents with role "lead"', () => {
    deps.agents.push(makeAgent({
      id: 'lead-abc123',
      role: { id: 'lead', name: 'Project Lead' },
      status: 'running',
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(0);
  });

  it('skips recently-created agents (less than 5 minutes old)', () => {
    deps.agents.push(makeAgent({
      id: 'new-dev-5678',
      status: 'running',
      createdAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(0);
  });

  it('skips agents with an active LLM call (isPrompting=true)', () => {
    deps.agents.push(makeAgent({
      id: 'prompting-dev-9012',
      status: 'running',
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      isPrompting: true,
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(0);
  });

  it('still flags old non-lead non-prompting agents', () => {
    // This agent should be flagged: old, not lead, not prompting
    deps.agents.push(makeAgent({
      id: 'old-dev-aaaa',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      isPrompting: false,
    }));

    // This agent should NOT be flagged: lead
    deps.agents.push(makeAgent({
      id: 'lead-bbbb',
      role: { id: 'lead', name: 'Lead' },
      status: 'running',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    }));

    // This agent should NOT be flagged: new
    deps.agents.push(makeAgent({
      id: 'new-dev-cccc',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      createdAt: new Date(Date.now() - 1 * 60 * 1000),
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(1);
    expect(stuckAlerts[0].agentId).toBe('old-dev-aaaa');
  });

  it('does not flag idle agents regardless of age', () => {
    deps.agents.push(makeAgent({
      id: 'idle-dev-1111',
      status: 'idle',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(0);
  });

  it('flags agents prompting for over 30 minutes as stuck', () => {
    deps.agents.push(makeAgent({
      id: 'hung-prompt-dev',
      status: 'running',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      isPrompting: true,
      promptingStartedAt: Date.now() - 35 * 60 * 1000, // 35 min ago
    }));

    engine.start();
    const alerts = engine.getAlerts();
    const stuckAlerts = alerts.filter(a => a.type === 'stuck_agent');
    expect(stuckAlerts.length).toBe(1);
    expect(stuckAlerts[0].agentId).toBe('hung-prompt-dev');
  });
});
