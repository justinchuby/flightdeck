import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigWatcher } from './ConfigWatcher.js';
import * as fsPromises from 'fs/promises';
import type { Stats } from 'fs';

vi.mock('fs/promises');
vi.mock('fs', () => ({
  existsSync: () => false,
  watch: vi.fn(),
}));

const mockStat = vi.mocked(fsPromises.stat);
const mockReadFile = vi.mocked(fsPromises.readFile);

describe('ConfigWatcher', () => {
  let watcher: ConfigWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    watcher = new ConfigWatcher('/fake/config.yaml', 500);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should emit warning only once when config file is missing', async () => {
    const warnings: string[] = [];
    watcher.on('warning', (msg: string) => warnings.push(msg));

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockStat.mockRejectedValue(enoent);

    watcher.start();
    // Initial check fires immediately
    await vi.advanceTimersByTimeAsync(10);
    expect(warnings).toHaveLength(1);

    // Subsequent polls should NOT emit again
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings).toHaveLength(1);
  });

  it('should warn again if file disappears after being found', async () => {
    const warnings: string[] = [];
    watcher.on('warning', (msg: string) => warnings.push(msg));

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const fakeStat = { mtimeMs: 1000, size: 42 } as Stats;

    // Phase 1: file missing
    mockStat.mockRejectedValue(enoent);
    watcher.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(warnings).toHaveLength(1);

    // Phase 2: file appears
    mockStat.mockResolvedValue(fakeStat);
    mockReadFile.mockResolvedValue('key: value');
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings).toHaveLength(1); // no new warning

    // Phase 3: file disappears again — should warn once more
    mockStat.mockRejectedValue(enoent);
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings).toHaveLength(2);

    // Phase 4: still missing — no duplicate
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings).toHaveLength(2);
  });
});
