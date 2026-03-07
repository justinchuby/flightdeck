// packages/server/src/config/ConfigStore.ts
// Central config state with hot-reload and typed event emission.
// Registered as a Tier 1 singleton in the DI container.

import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { ConfigWatcher } from './ConfigWatcher.js';
import { loadConfig, type ConfigDiff } from './ConfigLoader.js';
import { type FlightdeckConfig, getDefaultConfig } from './configSchema.js';
import { logger } from '../utils/logger.js';

export interface ConfigReloadedEvent {
  config: FlightdeckConfig;
  diffs: ConfigDiff[];
  previous: FlightdeckConfig;
}

export interface ConfigSectionChangedEvent {
  config: unknown;
  diffs: ConfigDiff[];
}

export class ConfigStore extends EventEmitter {
  private _config: FlightdeckConfig;
  private watcher: ConfigWatcher | null = null;
  private readonly filePath: string;

  constructor(filePath: string) {
    super();
    this.filePath = filePath;

    // Synchronous initial load: parse file if it exists, else use defaults
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { config, warnings } = loadConfig(content, null);
        for (const w of warnings) logger.warn('config', w);
        this._config = config;
        logger.info('config', `Loaded config from ${filePath}`);
      } catch (err: any) {
        logger.warn('config', `Failed to load ${filePath}, using defaults: ${err.message}`);
        this._config = getDefaultConfig();
      }
    } else {
      this._config = getDefaultConfig();
      logger.info('config', `No config file at ${filePath} — using defaults`);
    }
  }

  get current(): Readonly<FlightdeckConfig> {
    return this._config;
  }

  /** Start watching the config file for changes. */
  start(): void {
    this.watcher = new ConfigWatcher(this.filePath);
    this.watcher.on('changed', (content: string) => this.handleChange(content));
    this.watcher.on('warning', (msg: string) => logger.warn('config', msg));
    this.watcher.on('error', (err: Error) => logger.error('config', `Watcher error: ${err.message}`));
    this.watcher.start();
  }

  /** Stop watching. */
  stop(): void {
    this.watcher?.stop();
    this.watcher = null;
  }

  /**
   * Writes a partial config update to the YAML file.
   * The watcher will detect the change and reload, keeping everything consistent.
   * Used by PATCH /api/config for round-trip consistency.
   */
  async writePartial(patch: Record<string, unknown>): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const content = await readFile(this.filePath, 'utf-8');
      existing = (parseYaml(content) as Record<string, unknown>) ?? {};
    } catch {
      // File doesn't exist or can't be read — start fresh
    }

    // Deep-merge the patch into existing
    const merged = deepMerge(existing, patch);
    const yaml = stringifyYaml(merged, { indent: 2, lineWidth: 120 });
    await writeFile(this.filePath, yaml, 'utf-8');
    // Watcher will pick up the change and emit events
  }

  private handleChange(content: string): void {
    try {
      const { config, diffs, warnings } = loadConfig(content, this._config);
      if (diffs.length === 0) return; // parsed but nothing changed

      const previous = this._config;
      this._config = config;

      for (const w of warnings) logger.warn('config', w);
      logger.info('config', `Config reloaded: ${diffs.length} change(s)`);
      for (const d of diffs) {
        logger.info('config', `  ${d.section}.${d.field}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
      }

      // Emit global reload event
      this.emit('config:reloaded', { config, diffs, previous } satisfies ConfigReloadedEvent);

      // Emit section-specific events for targeted listeners
      const sections = new Set(diffs.map(d => d.section));
      for (const section of sections) {
        const sectionConfig = config[section as keyof FlightdeckConfig];
        const sectionDiffs = diffs.filter(d => d.section === section);
        this.emit(`config:${section}:changed`, {
          config: sectionConfig,
          diffs: sectionDiffs,
        } satisfies ConfigSectionChangedEvent);
      }
    } catch (err: any) {
      logger.error('config', `Config reload failed — keeping previous config: ${err.message}`);
      this.emit('config:reload_failed', { error: err.message, content });
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      sVal && typeof sVal === 'object' && !Array.isArray(sVal) &&
      tVal && typeof tVal === 'object' && !Array.isArray(tVal)
    ) {
      result[key] = deepMerge(
        tVal as Record<string, unknown>,
        sVal as Record<string, unknown>,
      );
    } else {
      result[key] = sVal;
    }
  }
  return result;
}
