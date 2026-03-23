import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { FileLockRegistry } from './FileLockRegistry.js';
import { logger } from '../../utils/logger.js';
import { shortAgentId } from '@flightdeck/shared';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────

interface FileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted';
  additions: number;
  deletions: number;
  diff: string;
}

interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface DiffResult {
  agentId: string;
  files: FileDiff[];
  summary: DiffSummary;
  cachedAt: string;
}

// ── Cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  result: DiffResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const GIT_TIMEOUT_MS = 10_000;

// ── DiffService ───────────────────────────────────────────────────

export class DiffService {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private lockRegistry: FileLockRegistry,
    private cwd: string,
  ) {
    // Evict expired cache entries every 60s to prevent unbounded growth
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
  }

  /** Stop the cache cleanup timer */
  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.cache.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  /** Get full diff for an agent's locked files */
  async getDiff(agentId: string, useCache = true): Promise<DiffResult> {
    if (useCache) {
      const cached = this.cache.get(agentId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }

    const locks = this.lockRegistry.getByAgent(agentId);
    const filePaths = locks.map(l => l.filePath);

    if (filePaths.length === 0) {
      const result: DiffResult = {
        agentId,
        files: [],
        summary: { filesChanged: 0, additions: 0, deletions: 0 },
        cachedAt: new Date().toISOString(),
      };
      this.cacheResult(agentId, result);
      return result;
    }

    const files: FileDiff[] = [];

    try {
      // Get diffs for tracked files
      const { stdout: diffOutput } = await execFileAsync(
        'git', ['diff', 'HEAD', '--unified=3', '--', ...filePaths],
        { cwd: this.cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      );
      if (diffOutput.trim()) {
        files.push(...parseDiffOutput(diffOutput));
      }

      // Get untracked (new) files that are in the agent's locked set
      const { stdout: untrackedOutput } = await execFileAsync(
        'git', ['ls-files', '--others', '--exclude-standard', '--', ...filePaths],
        { cwd: this.cwd, timeout: GIT_TIMEOUT_MS },
      );
      const untrackedPaths = untrackedOutput.trim().split('\n').filter(Boolean);
      for (const path of untrackedPaths) {
        // Only include if not already in diff output (avoid duplicates)
        if (!files.some(f => f.path === path)) {
          const content = await this.readFileContent(path);
          const lines = content.split('\n');
          files.push({
            path,
            status: 'added',
            additions: lines.length,
            deletions: 0,
            diff: formatNewFileDiff(path, content),
          });
        }
      }
    } catch (err) {
      logger.warn('diff', `Failed to get diff for agent ${shortAgentId(agentId)}`, {
        error: (err as Error).message,
      });
    }

    const summary: DiffSummary = {
      filesChanged: files.length,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };

    const result: DiffResult = {
      agentId,
      files,
      summary,
      cachedAt: new Date().toISOString(),
    };

    this.cacheResult(agentId, result);
    return result;
  }

  /** Get lightweight summary only (no diff content) */
  async getSummary(agentId: string): Promise<DiffSummary & { agentId: string }> {
    const result = await this.getDiff(agentId);
    return { agentId, ...result.summary };
  }

  /** Invalidate cache for an agent */
  invalidate(agentId: string): void {
    this.cache.delete(agentId);
  }

  private cacheResult(agentId: string, result: DiffResult): void {
    this.cache.set(agentId, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private async readFileContent(relativePath: string): Promise<string> {
    try {
      return await readFile(resolve(this.cwd, relativePath), 'utf-8');
    } catch {
      return '';
    }
  }
}

// ── Diff Parsing ──────────────────────────────────────────────────

/** Parse unified diff output into structured FileDiff objects */
export function parseDiffOutput(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileDiffs) {
    const lines = chunk.split('\n');
    const headerLine = lines[0] ?? '';

    // Extract file path from "a/path b/path"
    const pathMatch = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!pathMatch) continue;

    const filePath = pathMatch[2];

    // Detect status
    let status: FileDiff['status'] = 'modified';
    if (lines.some(l => l.startsWith('new file mode'))) status = 'added';
    if (lines.some(l => l.startsWith('deleted file mode'))) status = 'deleted';

    // Count additions and deletions (lines starting with + or - in hunks)
    let additions = 0;
    let deletions = 0;
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        inHunk = true;
        continue;
      }
      if (inHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }
    }

    files.push({
      path: filePath,
      status,
      additions,
      deletions,
      diff: `diff --git ${chunk}`,
    });
  }

  return files;
}

/** Format a new (untracked) file as a unified diff */
function formatNewFileDiff(path: string, content: string): string {
  const lines = content.split('\n');
  const diffLines = lines.map(l => `+${l}`);
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...diffLines,
  ].join('\n');
}
