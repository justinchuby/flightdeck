// packages/server/src/config/ConfigStore.ts
// Central config state with hot-reload and typed event emission.
// Registered as a Tier 1 singleton in the DI container.

import { EventEmitter } from 'events';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { dirname } from 'path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { ConfigWatcher } from './ConfigWatcher.js';
import { loadConfig, type ConfigDiff } from './ConfigLoader.js';
import { type FlightdeckConfig, flightdeckConfigSchema, getDefaultConfig } from './configSchema.js';
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
  /** Serializes concurrent writePartial calls to prevent read-modify-write races. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    super();
    this.filePath = filePath;

    // Synchronous initial load: parse file if it exists, else use defaults
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const { config, warnings } = loadConfig(content, null);
        for (const w of warnings) logger.warn({ module: 'config', msg: w });
        this._config = config;
        logger.info({ module: 'config', msg: 'Config loaded', filePath });
      } catch (err: any) {
        logger.warn({ module: 'config', msg: 'Config load failed, using defaults', filePath, err: err.message });
        this._config = getDefaultConfig();
      }
    } else {
      this._config = getDefaultConfig();
      // Auto-create config directory and file with defaults
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, '# flightdeck config — see flightdeck.config.example.yaml for options\n', 'utf-8');
        logger.info({ module: 'config', msg: 'Created default config file', filePath });
      } catch (err: any) {
        logger.warn({ module: 'config', msg: 'Could not create config file', filePath, err: err.message });
      }
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
   * Serialized via writeQueue to prevent concurrent read-modify-write races.
   */
  async writePartial(patch: Record<string, unknown>): Promise<void> {
    // Chain onto the write queue so concurrent calls are serialized.
    // Each call waits for the previous one to finish before reading the file,
    // ensuring it always merges into the latest on-disk state.
    const op = this.writeQueue.then(() => this.doWritePartial(patch));
    this.writeQueue = op.catch(() => {}); // keep queue moving even on failure
    return op; // propagate the actual error to the caller
  }

  private async doWritePartial(patch: Record<string, unknown>): Promise<void> {
    let existing: Record<string, unknown> = {};
    try {
      const content = await readFile(this.filePath, 'utf-8');
      existing = (parseYaml(content) as Record<string, unknown>) ?? {};
    } catch {
      // File doesn't exist or can't be read — start fresh
    }

    // Deep-merge the patch into existing
    const merged = deepMerge(existing, patch);

    // Validate merged config before writing — reject invalid configs
    const result = flightdeckConfigSchema.safeParse(merged);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Config validation failed, write rejected:\n${issues.join('\n')}`);
    }

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

      for (const w of warnings) logger.warn({ module: 'config', msg: w });
      logger.info({ module: 'config', msg: 'Config reloaded', changeCount: diffs.length });
      for (const d of diffs) {
        logger.info({ module: 'config', msg: 'Config change', section: d.section, field: d.field, oldValue: d.oldValue, newValue: d.newValue });
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
      logger.error({ module: 'config', msg: 'Config reload failed, keeping previous', err: err.message });
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
