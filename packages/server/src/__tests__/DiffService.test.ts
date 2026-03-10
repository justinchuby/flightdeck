import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffService, parseDiffOutput } from '../coordination/files/DiffService.js';
import type { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';

// ── Mock execFileAsync ────────────────────────────────────────────

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────

function makeLockRegistry(locks: Array<{ filePath: string; agentId: string }>): FileLockRegistry {
  return {
    getByAgent: (agentId: string) =>
      locks.filter(l => l.agentId === agentId).map(l => ({
        filePath: l.filePath,
        agentId: l.agentId,
        agentRole: 'developer',
        projectId: 'proj-1',
        reason: 'test',
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })),
  } as unknown as FileLockRegistry;
}

// ── parseDiffOutput ───────────────────────────────────────────────

describe('parseDiffOutput', () => {
  it('parses a single modified file diff', () => {
    const raw = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
 
 export function main() {
`;
    const files = parseDiffOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/index.ts');
    expect(files[0].status).toBe('modified');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(0);
  });

  it('parses a new file diff', () => {
    const raw = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const x = 1;
+export const y = 2;
+export const z = 3;
`;
    const files = parseDiffOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/new.ts');
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(3);
    expect(files[0].deletions).toBe(0);
  });

  it('parses a deleted file diff', () => {
    const raw = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const a = 1;
-export const b = 2;
`;
    const files = parseDiffOutput(raw);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/old.ts');
    expect(files[0].status).toBe('deleted');
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(2);
  });

  it('parses multiple files in one diff', () => {
    const raw = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/b.ts b/b.ts
index 333..444 100644
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,2 @@
 line1
-removed
 line2
`;
    const files = parseDiffOutput(raw);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('a.ts');
    expect(files[0].additions).toBe(1);
    expect(files[1].path).toBe('b.ts');
    expect(files[1].deletions).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseDiffOutput('')).toEqual([]);
  });
});

// ── DiffService ───────────────────────────────────────────────────

describe('DiffService', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('returns empty result for agent with no locked files', async () => {
    const registry = makeLockRegistry([]);
    const service = new DiffService(registry, '/tmp/test');

    const result = await service.getDiff('agent-1');
    expect(result.agentId).toBe('agent-1');
    expect(result.files).toEqual([]);
    expect(result.summary).toEqual({ filesChanged: 0, additions: 0, deletions: 0 });
  });

  it('caches results and returns cached on second call', async () => {
    const registry = makeLockRegistry([]);
    const service = new DiffService(registry, '/tmp/test');

    const r1 = await service.getDiff('agent-1');
    const r2 = await service.getDiff('agent-1');
    expect(r1.cachedAt).toBe(r2.cachedAt);
  });

  it('skips cache when useCache is false', async () => {
    const registry = makeLockRegistry([]);
    const service = new DiffService(registry, '/tmp/test');

    const r1 = await service.getDiff('agent-1');
    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 5));
    const r2 = await service.getDiff('agent-1', false);
    expect(r2.cachedAt).not.toBe(r1.cachedAt);
  });

  it('invalidate clears the cache', async () => {
    const registry = makeLockRegistry([]);
    const service = new DiffService(registry, '/tmp/test');

    const r1 = await service.getDiff('agent-1');
    service.invalidate('agent-1');
    await new Promise(r => setTimeout(r, 5));
    const r2 = await service.getDiff('agent-1');
    expect(r2.cachedAt).not.toBe(r1.cachedAt);
  });

  it('getSummary returns summary without diff content', async () => {
    const registry = makeLockRegistry([]);
    const service = new DiffService(registry, '/tmp/test');

    const summary = await service.getSummary('agent-1');
    expect(summary.agentId).toBe('agent-1');
    expect(summary.filesChanged).toBe(0);
    expect(summary.additions).toBe(0);
    expect(summary.deletions).toBe(0);
  });

  it('parses git diff output for agent with locked files', async () => {
    const registry = makeLockRegistry([
      { filePath: 'src/index.ts', agentId: 'agent-1' },
    ]);
    const service = new DiffService(registry, '/tmp/test');

    const diffOutput = `diff --git a/src/index.ts b/src/index.ts
index abc..def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
 import { foo } from './foo';
+import { bar } from './bar';
+import { baz } from './baz';
 
 export function main() {
`;
    // Mock git diff call
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args[0] === 'diff') {
        cb(null, { stdout: diffOutput, stderr: '' });
      } else if (args[0] === 'ls-files') {
        cb(null, { stdout: '', stderr: '' });
      } else {
        cb(new Error('unexpected command'));
      }
    });

    const result = await service.getDiff('agent-1');
    expect(result.agentId).toBe('agent-1');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('src/index.ts');
    expect(result.files[0].status).toBe('modified');
    expect(result.files[0].additions).toBe(2);
    expect(result.files[0].deletions).toBe(0);
    expect(result.summary).toEqual({ filesChanged: 1, additions: 2, deletions: 0 });
  });
});
