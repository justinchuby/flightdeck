import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigStore } from '../config/ConfigStore.js';

// Suppress logger output in tests
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeTmpDir(): string {
  const dir = join(tmpdir(), `config-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, content: string): string {
  const path = join(dir, 'flightdeck.config.yaml');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('ConfigStore', () => {
  let dir: string;
  let store: ConfigStore | null = null;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    store?.stop();
    store = null;
  });

  it('loads config from file on construction', () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    expect(store.current.server.maxConcurrentAgents).toBe(25);
  });

  it('uses defaults when no file exists', () => {
    const path = join(dir, 'nonexistent.yaml');
    store = new ConfigStore(path);
    expect(store.current.server.maxConcurrentAgents).toBe(50);
    expect(store.current.heartbeat.idleThresholdMs).toBe(60_000);
  });

  it('uses defaults when file has invalid YAML', () => {
    const path = writeConfig(dir, '  - bad: [unclosed');
    store = new ConfigStore(path);
    expect(store.current.server.maxConcurrentAgents).toBe(50);
  });

  it('reloads when file changes and emits events', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    const reloaded = vi.fn();
    const serverChanged = vi.fn();
    store.on('config:reloaded', reloaded);
    store.on('config:server:changed', serverChanged);

    // Wait for initial watcher check
    await new Promise(r => setTimeout(r, 300));

    // Change the file
    writeFileSync(path, 'server:\n  maxConcurrentAgents: 100\n', 'utf-8');
    await new Promise(r => setTimeout(r, 500));

    expect(reloaded).toHaveBeenCalled();
    expect(serverChanged).toHaveBeenCalled();
    expect(store.current.server.maxConcurrentAgents).toBe(100);

    const event = serverChanged.mock.calls[0][0];
    expect(event.config.maxConcurrentAgents).toBe(100);
    expect(event.diffs.length).toBeGreaterThan(0);
  });

  it('keeps last-known-good config when reload fails (bad YAML)', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    await new Promise(r => setTimeout(r, 300));
    expect(store.current.server.maxConcurrentAgents).toBe(25);

    const reloadFailed = vi.fn();
    store.on('config:reload_failed', reloadFailed);

    // Write bad YAML
    writeFileSync(path, '  - bad: [unclosed', 'utf-8');
    await new Promise(r => setTimeout(r, 500));

    expect(reloadFailed).toHaveBeenCalled();
    // Should still have the previous good config
    expect(store.current.server.maxConcurrentAgents).toBe(25);
  });

  it('keeps last-known-good config when reload fails (validation error)', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    await new Promise(r => setTimeout(r, 300));

    const reloadFailed = vi.fn();
    store.on('config:reload_failed', reloadFailed);

    // Write invalid value
    writeFileSync(path, 'server:\n  maxConcurrentAgents: -1\n', 'utf-8');
    await new Promise(r => setTimeout(r, 500));

    expect(reloadFailed).toHaveBeenCalled();
    expect(store.current.server.maxConcurrentAgents).toBe(25);
  });

  it('emits section-specific events only for changed sections', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    await new Promise(r => setTimeout(r, 300));

    const serverChanged = vi.fn();
    const heartbeatChanged = vi.fn();
    store.on('config:server:changed', serverChanged);
    store.on('config:heartbeat:changed', heartbeatChanged);

    // Only change server section
    writeFileSync(path, 'server:\n  maxConcurrentAgents: 30\n', 'utf-8');
    await new Promise(r => setTimeout(r, 500));

    expect(serverChanged).toHaveBeenCalled();
    expect(heartbeatChanged).not.toHaveBeenCalled();
  });

  it('stop() prevents further events', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    await new Promise(r => setTimeout(r, 300));

    const reloaded = vi.fn();
    store.on('config:reloaded', reloaded);

    store.stop();

    writeFileSync(path, 'server:\n  maxConcurrentAgents: 99\n', 'utf-8');
    await new Promise(r => setTimeout(r, 500));

    expect(reloaded).not.toHaveBeenCalled();
  });

  it('writePartial merges into existing file and triggers reload', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);
    store.start();

    await new Promise(r => setTimeout(r, 300));

    const reloaded = vi.fn();
    store.on('config:reloaded', reloaded);

    await store.writePartial({ server: { maxConcurrentAgents: 75 } });
    await new Promise(r => setTimeout(r, 500));

    expect(reloaded).toHaveBeenCalled();
    expect(store.current.server.maxConcurrentAgents).toBe(75);
  });

  it('concurrent writePartial calls are serialized (no lost writes)', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);

    // Fire 3 concurrent writes — without serialization, some would be lost
    const p1 = store.writePartial({ server: { maxConcurrentAgents: 10 } });
    const p2 = store.writePartial({ oversight: { level: 'supervised' } });
    const p3 = store.writePartial({ telegram: { enabled: true } });

    await Promise.all([p1, p2, p3]);

    // Read the file back and verify ALL three writes are present
    const { readFileSync } = await import('fs');
    const content = readFileSync(path, 'utf-8');
    const { parse: parseYaml } = await import('yaml');
    const parsed = parseYaml(content) as Record<string, any>;

    expect(parsed.server.maxConcurrentAgents).toBe(10);
    expect(parsed.oversight.level).toBe('supervised');
    expect(parsed.telegram.enabled).toBe(true);
  });

  it('writePartial propagates validation errors', async () => {
    const path = writeConfig(dir, 'server:\n  maxConcurrentAgents: 25\n');
    store = new ConfigStore(path);

    // maxConcurrentAgents must be a positive integer
    await expect(
      store.writePartial({ server: { maxConcurrentAgents: -1 } }),
    ).rejects.toThrow('Config validation failed');
  });
});
