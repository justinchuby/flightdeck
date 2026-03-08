// packages/server/src/config/ConfigWatcher.ts
// Watches a config file for changes using fs.watch + poll fallback.
// Follows Symphony's triple-check pattern: mtime + size + contentHash.

import { EventEmitter } from 'events';
import { stat, readFile } from 'fs/promises';
import { watch, existsSync, type FSWatcher } from 'fs';
import { createHash } from 'crypto';

interface FileStamp {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export class ConfigWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastStamp: FileStamp | null = null;
  private checking = false; // guard against overlapping checks
  readonly filePath: string;
  private readonly pollMs: number;

  constructor(filePath: string, pollMs = 2000) {
    super();
    this.filePath = filePath;
    this.pollMs = pollMs;
  }

  start(): void {
    // Primary: fs.watch for immediate notification
    if (existsSync(this.filePath)) {
      try {
        this.watcher = watch(this.filePath, () => void this.check());
      } catch {
        // fs.watch may fail on some platforms/network mounts — poll-only fallback
      }
    }
    // Fallback: polling (catches cases where fs.watch misses events or file created later)
    this.pollInterval = setInterval(() => void this.check(), this.pollMs);
    // Initial load
    void this.check();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const st = await stat(this.filePath);
      // Quick reject: if mtime and size unchanged, skip hashing
      if (
        this.lastStamp &&
        st.mtimeMs === this.lastStamp.mtimeMs &&
        st.size === this.lastStamp.size
      ) {
        return;
      }
      const content = await readFile(this.filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      if (this.lastStamp && hash === this.lastStamp.contentHash) {
        // mtime changed (e.g. touch) but content identical — update stamp, no event
        this.lastStamp = { mtimeMs: st.mtimeMs, size: st.size, contentHash: hash };
        return;
      }
      this.lastStamp = { mtimeMs: st.mtimeMs, size: st.size, contentHash: hash };
      this.emit('changed', content);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File deleted or not yet created — emit warning, keep last-known-good
        this.emit('warning', `Config file not found: ${this.filePath}`);
      } else {
        this.emit('error', err);
      }
    } finally {
      this.checking = false;
    }
  }
}
