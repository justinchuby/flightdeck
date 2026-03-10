import { existsSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './utils/logger.js';
import type { CloudProvider } from './config/configSchema.js';

/** Hard ceiling for auto-scaling concurrency. Prevents runaway agent spawning. */
export const MAX_CONCURRENCY_LIMIT = 200;

/** Default state directory for all runtime files. */
export const FLIGHTDECK_STATE_DIR = process.env.FLIGHTDECK_STATE_DIR ?? join(homedir(), '.flightdeck');

export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  /** Provider ID for the CLI adapter (e.g., 'copilot', 'gemini', 'claude') */
  provider: string;
  /** Override the preset binary (from config YAML provider.binaryOverride) */
  providerBinaryOverride?: string;
  /** Override the preset args (from config YAML provider.argsOverride) */
  providerArgsOverride?: string[];
  /** Extra env vars for the CLI process (from config YAML provider.envOverride) */
  providerEnvOverride?: Record<string, string>;
  /** Structured cloud provider config (Bedrock, Vertex, Anthropic) */
  cloudProvider?: CloudProvider;
  maxConcurrentAgents: number;
  dbPath: string;
}

/**
 * Resolve database path. Checks env var, then auto-migrates from legacy
 * CWD locations (./flightdeck.db, ./ai-crew.db) to ~/.flightdeck/.
 */
function resolveDbPath(explicit: string | undefined): string {
  if (explicit) return explicit;

  const defaultPath = join(FLIGHTDECK_STATE_DIR, 'flightdeck.db');
  const cwdPath = './flightdeck.db';
  const legacyPath = './ai-crew.db';

  // Ensure state directory exists
  mkdirSync(FLIGHTDECK_STATE_DIR, { recursive: true });

  // Auto-migrate from CWD flightdeck.db → ~/.flightdeck/flightdeck.db
  if (!existsSync(defaultPath) && existsSync(cwdPath)) {
    try {
      renameSync(cwdPath, defaultPath);
      for (const suffix of ['-shm', '-wal']) {
        if (existsSync(cwdPath + suffix)) renameSync(cwdPath + suffix, defaultPath + suffix);
      }
      logger.info({ module: 'config', msg: 'Database migrated to ~/.flightdeck/', from: cwdPath });
    } catch { /* keep CWD path if rename fails */ }
  }

  // Auto-migrate from legacy ai-crew.db → ~/.flightdeck/flightdeck.db
  if (!existsSync(defaultPath) && existsSync(legacyPath)) {
    try {
      renameSync(legacyPath, defaultPath);
      for (const suffix of ['-shm', '-wal']) {
        if (existsSync(legacyPath + suffix)) renameSync(legacyPath + suffix, defaultPath + suffix);
      }
      logger.info({ module: 'config', msg: 'Database migrated from legacy path', from: legacyPath });
    } catch { /* use default path anyway */ }
  }

  return defaultPath;
}

const defaults: ServerConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '127.0.0.1',
  provider: process.env.CLI_PROVIDER || 'copilot',
  cliCommand: process.env.COPILOT_CLI_PATH || 'copilot',
  cliArgs: [],
  maxConcurrentAgents: parseInt(process.env.MAX_AGENTS || '50', 10),
  dbPath: resolveDbPath(process.env.FLIGHTDECK_DB_PATH ?? process.env.DB_PATH),
};

let config: ServerConfig = { ...defaults };

export function getConfig(): ServerConfig {
  return config;
}

export function updateConfig(patch: Partial<ServerConfig>): ServerConfig {
  config = { ...config, ...patch };
  return config;
}
