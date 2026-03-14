import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { projectsRoutes } from './projects.js';
import type { AppContext } from './context.js';

const mockStateDir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  return mkdtempSync(join(tmpdir(), 'fd-test-state-'));
});

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return { ...actual, FLIGHTDECK_STATE_DIR: mockStateDir };
});

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createTestServer(ctx: Partial<AppContext>) {
  const app = express();
  app.use(express.json());
  app.use(projectsRoutes(ctx as AppContext));
  let server: Server;
  return {
    app,
    start: () => new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    stop: () => new Promise<void>((resolve) => { server?.close(() => resolve()); }),
  };
}

describe('POST /projects — title validation', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const mockCreate = vi.fn().mockReturnValue({
    id: 'test-abc123', name: 'Test', description: '', cwd: null,
    status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  const mockRegistry = { create: mockCreate, get: vi.fn() } as any;

  beforeAll(async () => {
    const srv = createTestServer({ projectRegistry: mockRegistry });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('rejects missing name', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('name is required');
  });

  it('rejects empty string name', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('name is required');
  });

  it('rejects whitespace-only name', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('name is required');
  });

  it('rejects name exceeding 100 characters', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'A'.repeat(101) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/100 characters/);
  });

  it('rejects name with only special characters', async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '!!!@@@###' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one letter or number/);
  });

  it('accepts valid name and trims it', async () => {
    mockCreate.mockClear();
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  My Project  ' }),
    });
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('My Project', undefined, undefined);
  });

  it('accepts name at exactly 100 characters', async () => {
    mockCreate.mockClear();
    const name = 'A'.repeat(100);
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
  });

  it('accepts name with unicode that produces valid slug', async () => {
    mockCreate.mockClear();
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Café Project' }),
    });
    expect(res.status).toBe(201);
  });

  it('accepts the literal word "project"', async () => {
    mockCreate.mockClear();
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'project' }),
    });
    expect(res.status).toBe(201);
  });
});

// ── Session Detail + Enhanced Resume ──────────────────────────────

describe('GET /projects/:id/sessions/detail', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  const mockGetSessions = vi.fn();
  const mockGetTasks = vi.fn().mockReturnValue([]);
  const mockGetRetros = vi.fn().mockReturnValue([]);
  const mockGetAllAgents = vi.fn().mockReturnValue([]);

  beforeAll(async () => {
    const srv = createTestServer({
      projectRegistry: {
        get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test', cwd: null }),
        getSessions: mockGetSessions,
      } as any,
      agentManager: {
        getTaskDAG: vi.fn().mockReturnValue({ getTasks: mockGetTasks }),
      } as any,
      agentRoster: {
        getAllAgents: mockGetAllAgents,
        getByProject: mockGetAllAgents,
      } as any,
      sessionRetro: {
        getRetros: mockGetRetros,
      } as any,
    });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('returns 404 for missing project', async () => {
    const srv2 = createTestServer({
      projectRegistry: { get: vi.fn().mockReturnValue(null) } as any,
      agentManager: { getTaskDAG: vi.fn().mockReturnValue({ getTasks: vi.fn() }) } as any,
    });
    const url = await srv2.start();
    const res = await fetch(`${url}/projects/nonexistent/sessions/detail`);
    expect(res.status).toBe(404);
    await srv2.stop();
  });

  it('returns enriched session list with agents and task summary', async () => {
    mockGetSessions.mockReturnValue([
      {
        id: 1, leadId: 'lead-1', projectId: 'proj-1', status: 'completed',
        task: 'Build feature', startedAt: '2026-01-01T10:00:00Z', endedAt: '2026-01-01T12:00:00Z',
      },
    ]);
    mockGetAllAgents.mockReturnValue([
      { agentId: 'lead-1', role: 'lead', model: 'claude', projectId: 'proj-1', sessionId: 'ses-1', metadata: {} },
      { agentId: 'dev-1', role: 'developer', model: 'claude', projectId: 'proj-1', sessionId: 'ses-2', metadata: { parentId: 'lead-1' } },
      { agentId: 'dev-2', role: 'developer', model: 'gpt-4', projectId: 'other-proj', sessionId: null, metadata: { parentId: 'other-lead' } },
    ]);
    mockGetTasks.mockReturnValue([
      { dagStatus: 'done' }, { dagStatus: 'done' }, { dagStatus: 'failed' }, { dagStatus: 'pending' },
    ]);
    mockGetRetros.mockReturnValue([{ id: 1 }]);

    const res = await fetch(`${baseUrl}/projects/proj-1/sessions/detail`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);

    const session = data[0];
    expect(session.id).toBe(1);
    expect(session.leadId).toBe('lead-1');
    expect(session.status).toBe('completed');
    expect(session.durationMs).toBe(2 * 60 * 60 * 1000); // 2 hours
    expect(session.agents).toHaveLength(2); // lead-1 + dev-1 (dev-2 is other project)
    expect(session.agents.map((a: any) => a.agentId).sort()).toEqual(['dev-1', 'lead-1']);
    expect(session.taskSummary).toEqual({ total: 4, done: 2, failed: 1 });
    expect(session.hasRetro).toBe(true);
  });

  it('returns null durationMs for active sessions', async () => {
    mockGetSessions.mockReturnValue([
      {
        id: 2, leadId: 'lead-2', projectId: 'proj-1', status: 'active',
        task: null, startedAt: '2026-01-02T10:00:00Z', endedAt: null,
      },
    ]);
    mockGetAllAgents.mockReturnValue([]);
    mockGetTasks.mockReturnValue([]);
    mockGetRetros.mockReturnValue([]);

    const res = await fetch(`${baseUrl}/projects/proj-1/sessions/detail`);
    const data = await res.json();
    expect(data[0].durationMs).toBeNull();
    expect(data[0].hasRetro).toBe(false);
    expect(data[0].agents).toHaveLength(0);
  });
});

describe('POST /projects/:id/resume — enhanced with team respawn', () => {
  const mockSpawn = vi.fn();
  const mockGet = vi.fn();
  const mockStartSession = vi.fn();
  const mockGetLastLeadId = vi.fn().mockReturnValue(null);
  const mockBuildBriefing = vi.fn().mockReturnValue(null);
  const mockAutoSpawnSecretary = vi.fn();
  const mockGetActiveLeadId = vi.fn().mockReturnValue(null);
  const mockGetSessions = vi.fn().mockReturnValue([]);
  const mockGetAllAgents = vi.fn().mockReturnValue([]);
  const mockGetMessageHistory = vi.fn().mockReturnValue([]);

  // Mock spawn returns an agent with the requested ID (8th arg) to honor the invariant
  const makeFakeAgent = (id: string) => ({
    id, status: 'running', sendMessage: vi.fn(),
    toJSON: () => ({ id, status: 'running', role: { id: 'lead' } }),
  });

  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    mockSpawn.mockImplementation(
      (_role: any, _task: any, _parentId: any, _model: any, _cwd: any, _resumeSession: any, id?: string) =>
        makeFakeAgent(id ?? 'new-lead-1'),
    );
    mockGet.mockReturnValue({ id: 'proj-1', name: 'Test', cwd: '/tmp/test' });

    const srv = createTestServer({
      projectRegistry: {
        get: mockGet,
        getActiveLeadId: mockGetActiveLeadId,
        getLastLeadId: mockGetLastLeadId,
        buildBriefing: mockBuildBriefing,
        formatBriefing: vi.fn(),
        startSession: mockStartSession,
        reactivateSession: vi.fn(),
        claimSessionForResume: vi.fn().mockReturnValue(true),
        getSessions: mockGetSessions,
      } as any,
      agentManager: {
        spawn: mockSpawn,
        get: vi.fn().mockReturnValue(null),
        autoSpawnSecretary: mockAutoSpawnSecretary,
        getMessageHistory: mockGetMessageHistory,
      } as any,
      roleRegistry: {
        get: vi.fn().mockImplementation((id: string) => ({ id, name: id, instructions: '' })),
      } as any,
      agentRoster: {
        getAllAgents: mockGetAllAgents,
        getByProject: mockGetAllAgents,
      } as any,
    });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('spawns lead with freshStart (no team respawn)', async () => {
    mockSpawn.mockClear();
    const res = await fetch(`${baseUrl}/projects/proj-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'do stuff', freshStart: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.respawning).toBe(0);
    // Only 1 spawn call (the lead)
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('spawns lead + schedules team respawn with resumeAll', async () => {
    vi.useFakeTimers();
    mockSpawn.mockClear();
    mockGetSessions.mockReturnValue([
      { id: 1, leadId: 'old-lead', sessionId: 'copilot-ses-1', status: 'completed', startedAt: '2026-01-01T10:00:00Z' },
    ]);
    mockGetAllAgents.mockReturnValue([
      { agentId: 'dev-1', role: 'developer', model: 'claude', projectId: 'proj-1', sessionId: 'ses-dev1', lastTaskSummary: 'build UI', metadata: { parentId: 'old-lead' } },
      { agentId: 'rev-1', role: 'code-reviewer', model: 'gpt-4', projectId: 'proj-1', sessionId: null, lastTaskSummary: null, metadata: { parentId: 'old-lead' } },
      { agentId: 'sec-1', role: 'secretary', model: 'claude', projectId: 'proj-1', sessionId: 'ses-sec1', metadata: { parentId: 'old-lead' } },
    ]);

    const res = await fetch(`${baseUrl}/projects/proj-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeAll: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Secretary now included in resume list
    expect(body.respawning).toBe(3);

    // Lead spawned immediately
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Advance timers to trigger batch respawns (2s initial delay, then concurrent batch)
    await vi.advanceTimersByTimeAsync(2500);
    // All 3 agents spawned in first batch (batch size 3)
    expect(mockSpawn).toHaveBeenCalledTimes(4);

    // Verify respawned agents got correct params
    const secondCall = mockSpawn.mock.calls[1];
    expect(secondCall[0].id).toBe('developer'); // role
    expect(secondCall[2]).toBe('old-lead');    // parentId = resumed lead (same ID as original)
    expect(secondCall[5]).toBe('ses-dev1');       // resumeSessionId

    // Verify secretary resumed with session ID
    const secretaryCall = mockSpawn.mock.calls[3];
    expect(secretaryCall[0].id).toBe('secretary');
    expect(secretaryCall[5]).toBe('ses-sec1');    // resumeSessionId

    vi.useRealTimers();
  });

  it('respawns only selected agents when agents array provided', async () => {
    vi.useFakeTimers();
    mockSpawn.mockClear();
    mockGetSessions.mockReturnValue([
      { id: 1, leadId: 'old-lead', sessionId: 'copilot-ses-1', status: 'completed', startedAt: '2026-01-01T10:00:00Z' },
    ]);
    mockGetAllAgents.mockReturnValue([
      { agentId: 'dev-1', role: 'developer', model: 'claude', projectId: 'proj-1', sessionId: 'ses-d1', metadata: { parentId: 'old-lead' } },
      { agentId: 'rev-1', role: 'code-reviewer', model: 'gpt-4', projectId: 'proj-1', sessionId: 'ses-r1', metadata: { parentId: 'old-lead' } },
    ]);

    const res = await fetch(`${baseUrl}/projects/proj-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['dev-1'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.respawning).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    // 1 lead + 1 selected agent
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('does not send system messages to lead during selective resume', async () => {
    vi.useFakeTimers();
    mockSpawn.mockClear();
    const fakeAgent = makeFakeAgent('old-lead');
    mockSpawn.mockReturnValue(fakeAgent);
    mockGetSessions.mockReturnValue([
      { id: 1, leadId: 'old-lead', sessionId: 'copilot-ses-1', status: 'completed', startedAt: '2026-01-01T10:00:00Z' },
    ]);
    mockGetAllAgents.mockReturnValue([
      { agentId: 'dev-1', role: 'developer', model: 'claude', projectId: 'proj-1', sessionId: 'ses-d1', metadata: { parentId: 'old-lead' } },
      { agentId: 'rev-1', role: 'code-reviewer', model: 'gpt-4', projectId: 'proj-1', sessionId: 'ses-r1', metadata: { parentId: 'old-lead' } },
      { agentId: 'arch-1', role: 'architect', model: 'opus-4', projectId: 'proj-1', sessionId: 'ses-a1', metadata: { parentId: 'old-lead' } },
    ]);

    const res = await fetch(`${baseUrl}/projects/proj-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: ['dev-1'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.respawning).toBe(1);

    // Advance past any potential message delays
    await vi.advanceTimersByTimeAsync(3000);

    // During resume, NO system messages should be sent — agents pick up context from ACP session
    const sendMessageCalls = fakeAgent.sendMessage.mock.calls;
    const exclusionMsg = sendMessageCalls.find(
      (call: string[]) => call[0].includes('Resume Agent Selection')
    );
    expect(exclusionMsg).toBeUndefined();

    vi.useRealTimers();
  });
});

// ── Symlink path validation ────────────────────────────────────────

describe('GET /projects/:id/files — rejects symlinks resolving outside project', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  let tmpBase: string;
  let projectDir: string;

  beforeAll(async () => {
    // External dir (simulates ~/.flightdeck/artifacts/...)
    tmpBase = mkdtempSync(join(tmpdir(), 'fd-test-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'fd-test-project-'));

    const externalDir = join(tmpBase, 'artifacts', 'developer-abc123');
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(externalDir, 'report.md'), '# Test Report\nHello');

    // Project shared dir: one symlink pointing outside, one real dir
    const sharedDir = join(projectDir, '.flightdeck', 'shared');
    mkdirSync(sharedDir, { recursive: true });
    symlinkSync(externalDir, join(sharedDir, 'developer-abc123'));

    const realAgentDir = join(sharedDir, 'architect-def456');
    mkdirSync(realAgentDir, { recursive: true });
    writeFileSync(join(realAgentDir, 'design.md'), '# Design Doc');

    const mockRegistry = {
      get: vi.fn().mockReturnValue({
        id: 'test-proj',
        name: 'Test Project',
        cwd: projectDir,
        status: 'active',
      }),
    } as any;

    const srv = createTestServer({ projectRegistry: mockRegistry });
    baseUrl = await srv.start();
    stop = srv.stop;
  });

  afterAll(async () => {
    await stop?.();
    rmSync(tmpBase, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('rejects listing a symlinked directory that resolves outside the project', async () => {
    const res = await fetch(`${baseUrl}/projects/test-proj/files?path=.flightdeck/shared/developer-abc123`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Path outside project directory');
  });

  it('rejects reading a file through a symlink that resolves outside the project', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/file-contents?path=.flightdeck/shared/developer-abc123/report.md`,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Path outside project directory');
  });

  it('serves files from real (non-symlinked) directories within the project', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/file-contents?path=.flightdeck/shared/architect-def456/design.md`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('# Design Doc');
  });

  it('rejects paths that escape the project via traversal', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/file-contents?path=../../etc/passwd`,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Path outside project directory');
  });
});

// ── Artifact contents endpoint ─────────────────────────────────────

describe('GET /projects/:id/artifact-contents', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    // Create artifact file structure under mockStateDir
    const sessionsDir = join(mockStateDir, 'artifacts', 'test-proj', 'sessions');
    const agentDir = join(sessionsDir, 'lead-abc123', 'architect-def456');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'report.md'), '# Artifact Report\nTest content');

    const mockRegistry = {
      get: vi.fn().mockReturnValue({
        id: 'test-proj',
        name: 'Test Project',
        cwd: '/tmp/fake',
        status: 'active',
      }),
    } as any;

    const srv = createTestServer({ projectRegistry: mockRegistry });
    baseUrl = await srv.start();
    stop = srv.stop;
  });

  afterAll(async () => {
    await stop?.();
  });

  it('serves artifact file content', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/artifact-contents?path=lead-abc123/architect-def456/report.md`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('# Artifact Report');
    expect(body.ext).toBe('md');
    expect(body.size).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent artifact', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/artifact-contents?path=lead-abc123/architect-def456/missing.md`,
    );
    expect(res.status).toBe(404);
  });

  it('rejects path traversal attempts', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/artifact-contents?path=../../../etc/passwd`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid path');
  });

  it('rejects missing path parameter', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/artifact-contents`,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const mockRegistry = { get: vi.fn().mockReturnValue(undefined) } as any;
    const srv = createTestServer({ projectRegistry: mockRegistry });
    const url = await srv.start();
    const res = await fetch(`${url}/projects/unknown/artifact-contents?path=foo/bar.md`);
    expect(res.status).toBe(404);
    await srv.stop();
  });
});

// ── Session artifact endpoint ──────────────────────────────────────

describe('GET /projects/:id/session-artifact', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  let copilotSessionDir: string;

  beforeAll(async () => {
    // Create a fake Copilot session dir structure
    const sessionId = 'test-session-uuid-1234';
    copilotSessionDir = join(homedir(), '.copilot', 'session-state', sessionId);
    mkdirSync(copilotSessionDir, { recursive: true });
    writeFileSync(join(copilotSessionDir, 'plan.md'), '# My Plan\nStep 1: do things');
    mkdirSync(join(copilotSessionDir, 'checkpoints'), { recursive: true });
    writeFileSync(join(copilotSessionDir, 'checkpoints', '001-setup.md'), '# Setup Complete');
    // Sensitive file that should NOT be served
    writeFileSync(join(copilotSessionDir, 'events.jsonl'), '{"type":"message"}');
    writeFileSync(join(copilotSessionDir, 'workspace.yaml'), 'id: test');

    const mockRegistry = {
      get: vi.fn().mockReturnValue({ id: 'test-proj', name: 'Test', cwd: '/tmp/fake', status: 'active' }),
    } as any;

    const mockRoster = {
      getAgent: vi.fn().mockImplementation((id: string) => {
        if (id === 'agent-abc12345') {
          return { agentId: 'agent-abc12345', sessionId, projectId: 'test-proj', role: 'architect' };
        }
        if (id === 'agent-other-proj') {
          return { agentId: 'agent-other-proj', sessionId, projectId: 'other-proj', role: 'developer' };
        }
        return undefined;
      }),
      getByProject: vi.fn().mockReturnValue([]),
    } as any;

    const srv = createTestServer({ projectRegistry: mockRegistry, agentRoster: mockRoster });
    baseUrl = await srv.start();
    stop = srv.stop;
  });

  afterAll(async () => {
    await stop?.();
    rmSync(copilotSessionDir, { recursive: true, force: true });
  });

  it('serves plan.md from Copilot session', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-abc12345&path=plan.md`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('# My Plan');
    expect(body.ext).toBe('md');
  });

  it('serves checkpoint files', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-abc12345&path=checkpoints/001-setup.md`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain('# Setup Complete');
  });

  it('blocks access to events.jsonl (not in allowlist)', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-abc12345&path=events.jsonl`,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('File not accessible');
  });

  it('blocks access to workspace.yaml (not in allowlist)', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-abc12345&path=workspace.yaml`,
    );
    expect(res.status).toBe(403);
  });

  it('blocks cross-project access', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-other-proj&path=plan.md`,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Agent not in this project');
  });

  it('rejects path traversal', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=agent-abc12345&path=../../../etc/passwd`,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing parameters', async () => {
    const res = await fetch(`${baseUrl}/projects/test-proj/session-artifact`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown agent', async () => {
    const res = await fetch(
      `${baseUrl}/projects/test-proj/session-artifact?agentId=nonexistent&path=plan.md`,
    );
    expect(res.status).toBe(404);
  });
});
