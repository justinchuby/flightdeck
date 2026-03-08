import { existsSync, renameSync } from 'fs';
import { logger } from './utils/logger.js';

/** Hard ceiling for auto-scaling concurrency. Prevents runaway agent spawning. */
export const MAX_CONCURRENCY_LIMIT = 200;

export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  /** Provider ID for the CLI adapter (e.g., 'copilot', 'gemini', 'claude') */
  provider: string;
  /** Use in-process SDK instead of ACP subprocess (Claude only, default: false) */
  sdkMode: boolean;
  /** Override the preset binary (from config YAML provider.binaryOverride) */
  providerBinaryOverride?: string;
  /** Override the preset args (from config YAML provider.argsOverride) */
  providerArgsOverride?: string[];
  /** Extra env vars for the CLI process (from config YAML provider.envOverride) */
  providerEnvOverride?: Record<string, string>;
  maxConcurrentAgents: number;
  dbPath: string;
}

/**
 * Backward-compat: if the new flightdeck.db doesn't exist but the legacy
 * ai-crew.db does, auto-rename it so existing data is preserved.
 */
function resolveDbPath(explicit: string | undefined): string {
  if (explicit) return explicit;

  const newPath = './flightdeck.db';
  const legacyPath = './ai-crew.db';

  if (!existsSync(newPath) && existsSync(legacyPath)) {
    try {
      renameSync(legacyPath, newPath);
      // Also migrate WAL/SHM sidecar files if present
      for (const suffix of ['-shm', '-wal']) {
        if (existsSync(legacyPath + suffix)) {
          renameSync(legacyPath + suffix, newPath + suffix);
        }
      }
      logger.info({ module: 'config', msg: 'Database migrated', legacyPath, newPath });
    } catch {
      // If rename fails (e.g. permissions), fall back to legacy path
      return legacyPath;
    }
  }

  return newPath;
}

const defaults: ServerConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '127.0.0.1',
  provider: process.env.CLI_PROVIDER || 'copilot',
  sdkMode: process.env.SDK_MODE === 'true',
  cliCommand: process.env.COPILOT_CLI_PATH || 'copilot',
  cliArgs: [],
  maxConcurrentAgents: parseInt(process.env.MAX_AGENTS || '50', 10),
  dbPath: resolveDbPath(process.env.DB_PATH),
};

let config: ServerConfig = { ...defaults };

export function getConfig(): ServerConfig {
  return config;
}

export function updateConfig(patch: Partial<ServerConfig>): ServerConfig {
  config = { ...config, ...patch };
  return config;
}
