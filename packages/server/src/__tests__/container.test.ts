import { describe, it, expect, afterEach, vi } from 'vitest';
import { createContainer, createTestContainer, type ServiceContainer, type ContainerConfig } from '../container.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';

// Mock config module so container's updateConfig/getConfig don't affect global state
vi.mock('../config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config.js')>();
  let mockConfig: ServerConfig = {
    port: 3001,
    host: '127.0.0.1',
    cliCommand: 'copilot',
    cliArgs: [],
    provider: 'copilot',
    maxConcurrentAgents: 10,
    dbPath: ':memory:',
  };
  return {
    ...original,
    getConfig: vi.fn(() => ({ ...mockConfig })),
    updateConfig: vi.fn((patch: Partial<ServerConfig>) => {
      mockConfig = { ...mockConfig, ...patch };
      return mockConfig;
    }),
  };
});

function createTestContainerConfig(): ContainerConfig {
  return {
    config: {
      port: 3001,
      host: '127.0.0.1',
      cliCommand: 'copilot',
      cliArgs: [],
      provider: 'copilot',
      maxConcurrentAgents: 10,
      dbPath: ':memory:',
    },
    repoRoot: process.cwd(),
  };
}

describe('createContainer', () => {
  let container: ServiceContainer | null = null;

  afterEach(async () => {
    if (container) {
      await container.shutdown();
      container = null;
    }
  });

  it('builds all services without errors', async () => {
    container = await createContainer(createTestContainerConfig());

    // Tier 0: Config & DB
    expect(container.db).toBeDefined();
    expect(container.config).toBeDefined();
    expect(container.config.dbPath).toBe(':memory:');

    // Tier 1: Core Registries
    expect(container.lockRegistry).toBeDefined();
    expect(container.activityLedger).toBeDefined();
    expect(container.roleRegistry).toBeDefined();
    expect(container.decisionLog).toBeDefined();
    expect(container.projectRegistry).toBeDefined();

    // Tier 2: Stateless Services
    expect(container.retryManager).toBeDefined();
    expect(container.crashForensics).toBeDefined();
    expect(container.notificationManager).toBeDefined();
    expect(container.modelSelector).toBeDefined();
    expect(container.reportGenerator).toBeDefined();
    expect(container.projectTemplateRegistry).toBeDefined();
    expect(container.knowledgeTransfer).toBeDefined();
    expect(container.decisionRecordStore).toBeDefined();
    expect(container.coverageTracker).toBeDefined();
    expect(container.complexityMonitor).toBeDefined();
    expect(container.dependencyScanner).toBeDefined();
    expect(container.webhookManager).toBeDefined();
    expect(container.eventPipeline).toBeDefined();
    expect(container.taskTemplateRegistry).toBeDefined();

    // Tier 3: Composed Services
    expect(container.taskDecomposer).toBeDefined();
    expect(container.fileDependencyGraph).toBeDefined();
    expect(container.eagerScheduler).toBeDefined();
    expect(container.searchEngine).toBeDefined();
    expect(container.escalationManager).toBeDefined();

    // Tier 4: AgentManager
    expect(container.agentManager).toBeDefined();

    // Tier 5: AgentManager-dependent services
    expect(container.alertEngine).toBeDefined();
    expect(container.capabilityRegistry).toBeDefined();
    expect(container.agentMatcher).toBeDefined();
    expect(container.sessionRetro).toBeDefined();
    expect(container.sessionExporter).toBeDefined();
    expect(container.performanceTracker).toBeDefined();

    // costTracker available both publicly and internally
    expect(container.costTracker).toBeDefined();

    // sessionResumeManager available at top level (routes destructure from AppContext)
    expect(container.sessionResumeManager).toBeDefined();

    // Internal services
    expect(container.internal.messageBus).toBeDefined();
    expect(container.internal.agentMemory).toBeDefined();
    expect(container.internal.chatGroupRegistry).toBeDefined();
    expect(container.internal.taskDAG).toBeDefined();
    expect(container.internal.contextRefresher).toBeDefined();
    expect(container.internal.scheduler).toBeDefined();
    expect(container.internal.worktreeManager).toBeDefined();
    expect(container.internal.timerRegistry).toBeDefined();
  });

  it('shutdown calls stop on all lifecycle services', async () => {
    container = await createContainer(createTestContainerConfig());

    const spies = [
      vi.spyOn(container.eagerScheduler!, 'stop'),
      vi.spyOn(container.internal.timerRegistry, 'stop'),
      vi.spyOn(container.internal.scheduler, 'stop'),
      vi.spyOn(container.retryManager!, 'stop'),
      vi.spyOn(container.alertEngine!, 'stop'),
      vi.spyOn(container.escalationManager!, 'stop'),
    ];

    await container.shutdown();
    container = null; // prevent double shutdown in afterEach

    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });

  it('shutdown handles errors in individual services gracefully', async () => {
    container = await createContainer(createTestContainerConfig());

    vi.spyOn(container.eagerScheduler!, 'stop').mockImplementation(() => {
      throw new Error('stop failed');
    });

    // Should not throw — just warns
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(container.shutdown()).resolves.toBeUndefined();
    warnSpy.mockRestore();

    container = null; // prevent double shutdown
  });

  it('shutdown awaits async handlers (no fire-and-forget)', async () => {
    container = await createContainer(createTestContainerConfig());

    // Replace a stop method with an async function that rejects after a delay.
    // If shutdown properly awaits, the rejection is caught and warned.
    const asyncError = new Error('async stop failed');
    vi.spyOn(container.eagerScheduler!, 'stop').mockImplementation(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(asyncError), 10)) as any,
    );

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(container.shutdown()).resolves.toBeUndefined();

    // The async rejection should have been caught and warned
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'container',
        msg: expect.stringContaining('shutdown failed'),
      }),
    );
    warnSpy.mockRestore();
    container = null;
  });

  it('shutdown is idempotent', async () => {
    container = await createContainer(createTestContainerConfig());

    await container.shutdown();
    // Second shutdown should not throw
    await expect(container.shutdown()).resolves.toBeUndefined();
    container = null;
  });

  it('does not expose legacy daemon services', async () => {
    container = await createContainer(createTestContainerConfig());

    // Daemon services were replaced by agent server architecture
    expect((container as any).daemonProcess).toBeUndefined();
    expect((container as any).daemonClient).toBeUndefined();
    expect((container as any).reconnectProtocol).toBeUndefined();
  });

  it('container extends AppContext (usable by routes)', async () => {
    container = await createContainer(createTestContainerConfig());

    // The container should be assignable to AppContext
    // Verify key AppContext fields exist (these are what routes use)
    const ctx = container;
    expect(ctx.agentManager).toBeDefined();
    expect(ctx.roleRegistry).toBeDefined();
    expect(ctx.lockRegistry).toBeDefined();
    expect(ctx.activityLedger).toBeDefined();
    expect(ctx.decisionLog).toBeDefined();
  });

  it('exposes sessionResumeManager at top level for route destructuring', async () => {
    container = await createContainer(createTestContainerConfig());

    // sessionResumeManager must be on the top-level container (AppContext)
    // so routes can destructure it — not only in container.internal
    expect(container.sessionResumeManager).toBeDefined();
    expect(container.sessionResumeManager).toBe(container.internal.sessionResumeManager);
  });

  it('provides shutdown lifecycle method', async () => {
    container = await createContainer(createTestContainerConfig());
    expect(typeof container.shutdown).toBe('function');
  });

  it('provides httpServer field (initially null)', async () => {
    container = await createContainer(createTestContainerConfig());
    // httpServer is set by caller after Express app creation
    expect(container.httpServer).toBeDefined();
  });

  it('provides internal services namespace', async () => {
    container = await createContainer(createTestContainerConfig());
    expect(container.internal).toBeDefined();
    expect(typeof container.internal).toBe('object');
  });

  it('exposes costTracker in internal namespace', async () => {
    container = await createContainer(createTestContainerConfig());
    expect(container.internal.costTracker).toBeDefined();
  });

  it('shutdown is safe when called twice (no stopList mutation)', async () => {
    container = await createContainer(createTestContainerConfig());

    const schedulerSpy = vi.spyOn(container.internal.scheduler, 'stop');

    // Simulate SIGTERM+SIGINT race: call shutdown twice rapidly
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await Promise.all([container.shutdown(), container.shutdown()]);
    warnSpy.mockRestore();

    // scheduler.stop should be called exactly twice (once per shutdown call)
    // because [...stopList].reverse() creates a copy each time
    expect(schedulerSpy).toHaveBeenCalledTimes(2);
    container = null;
  });
});

describe('createTestContainer', () => {
  let container: ServiceContainer | null = null;

  afterEach(async () => {
    if (container) {
      await container.shutdown();
      container = null;
    }
  });

  it('creates a container with in-memory database', async () => {
    container = await createTestContainer();
    expect(container.db).toBeDefined();
    expect(container.agentManager).toBeDefined();
    expect(container.config.dbPath).toBe(':memory:');
  });

  it('accepts repoRoot override', async () => {
    container = await createTestContainer({
      repoRoot: '/tmp/custom-repo',
    });
    expect(container.internal.worktreeManager).toBeDefined();
  });
});
