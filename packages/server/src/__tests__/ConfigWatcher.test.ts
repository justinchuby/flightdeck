import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigWatcher } from '../config/ConfigWatcher.js';

function tmpFile(dir: string, content: string): string {
  const path = join(dir, 'test-config.yaml');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('ConfigWatcher', () => {
  let dir: string;
  let watcher: ConfigWatcher | null = null;

  beforeEach(() => {
    dir = join(tmpdir(), `config-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    watcher?.stop();
    watcher = null;
  });

  it('emits "changed" on initial start with file content', async () => {
    const path = tmpFile(dir, 'server:\n  maxConcurrentAgents: 10\n');
    watcher = new ConfigWatcher(path, 50);

    const changed = vi.fn();
    watcher.on('changed', changed);
    watcher.start();

    // Wait for async initial check
    await new Promise(r => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0]).toContain('maxConcurrentAgents');
  });

  it('emits "changed" when file content changes', async () => {
    const path = tmpFile(dir, 'server:\n  maxConcurrentAgents: 10\n');
    watcher = new ConfigWatcher(path, 50);

    const changed = vi.fn();
    watcher.on('changed', changed);
    watcher.start();

    await new Promise(r => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);

    // Modify file
    writeFileSync(path, 'server:\n  maxConcurrentAgents: 20\n', 'utf-8');
    await new Promise(r => setTimeout(r, 300));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[1][0]).toContain('20');
  });

  it('does NOT emit "changed" when file is touched but content unchanged', async () => {
    const content = 'server:\n  maxConcurrentAgents: 10\n';
    const path = tmpFile(dir, content);
    watcher = new ConfigWatcher(path, 50);

    const changed = vi.fn();
    watcher.on('changed', changed);
    watcher.start();

    await new Promise(r => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);

    // Touch file (same content)
    writeFileSync(path, content, 'utf-8');
    await new Promise(r => setTimeout(r, 300));
    // Should still be 1 — no new emission for same content
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('emits "warning" when file is deleted', async () => {
    const path = tmpFile(dir, 'server:\n  maxConcurrentAgents: 10\n');
    watcher = new ConfigWatcher(path, 50);

    const warning = vi.fn();
    watcher.on('warning', warning);
    watcher.start();

    await new Promise(r => setTimeout(r, 200));

    // Delete file
    unlinkSync(path);
    // Force a check since fs.watch might not fire on delete
    await watcher.check();

    expect(warning).toHaveBeenCalled();
    expect(warning.mock.calls[0][0]).toContain('not found');
  });

  it('stop() cleans up watcher and interval', async () => {
    const path = tmpFile(dir, 'server:\n  maxConcurrentAgents: 10\n');
    watcher = new ConfigWatcher(path, 50);

    const changed = vi.fn();
    watcher.on('changed', changed);
    watcher.start();

    await new Promise(r => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);

    watcher.stop();

    // Modify file after stop
    writeFileSync(path, 'server:\n  maxConcurrentAgents: 99\n', 'utf-8');
    await new Promise(r => setTimeout(r, 300));

    // Should not emit after stop
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('emits warning when file does not exist at start', async () => {
    const path = join(dir, 'nonexistent.yaml');
    watcher = new ConfigWatcher(path, 50);

    const warning = vi.fn();
    const changed = vi.fn();
    watcher.on('warning', warning);
    watcher.on('changed', changed);
    watcher.start();

    await new Promise(r => setTimeout(r, 200));
    expect(changed).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });
});
