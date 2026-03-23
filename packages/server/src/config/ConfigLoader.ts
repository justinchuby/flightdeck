// packages/server/src/config/ConfigLoader.ts
// Parses YAML, validates with Zod, and computes diffs against previous config.

import { parse as parseYaml } from 'yaml';
import { flightdeckConfigSchema, type FlightdeckConfig } from './configSchema.js';

export interface ConfigDiff {
  section: string;     // e.g. 'server', 'models', 'roles'
  field: string;       // e.g. 'maxConcurrentAgents', 'known'
  oldValue: unknown;
  newValue: unknown;
}

export interface LoadResult {
  config: FlightdeckConfig;
  diffs: ConfigDiff[];
  warnings: string[];
}

/**
 * Parses raw YAML content, validates against the schema, and diffs against `previous`.
 * Throws on parse or validation errors (caller should catch and keep last-known-good).
 */
export function loadConfig(content: string, previous: FlightdeckConfig | null): LoadResult {
  const warnings: string[] = [];

  // Parse YAML
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err: any) {
    throw new Error(`Config parse error: ${err.message}`);
  }

  // Handle empty file (parsed as null/undefined) → all defaults
  if (raw == null) raw = {};

  // Validate with Zod (fills defaults for missing fields)
  const result = flightdeckConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i: any) => `${i.path.join('.')}: ${i.message}`,
    );
    throw new Error(`Config validation failed:\n${issues.join('\n')}`);
  }

  const config = result.data;

  // Compute diff against previous config
  const diffs = previous ? computeDiffs(previous, config) : [];

  return { config, diffs, warnings };
}

// ── Diff computation ───────────────────────────────────────

function computeDiffs(prev: FlightdeckConfig, next: FlightdeckConfig): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const sections = ['server', 'heartbeat', 'models', 'roles', 'provider', 'telegram', 'notifications', 'predictions', 'providerSettings', 'providerRanking'] as const;

  for (const section of sections) {
    const prevSection = prev[section];
    const nextSection = next[section];
    if (Array.isArray(prevSection) || Array.isArray(nextSection)) {
      if (!deepEqual(prevSection, nextSection)) {
        diffs.push({ section, field: '*', oldValue: prevSection, newValue: nextSection });
      }
    } else {
      diffObjects(section, prevSection as any, nextSection as any, diffs);
    }
  }

  return diffs;
}

function diffObjects(
  section: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  diffs: ConfigDiff[],
): void {
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of allKeys) {
    const oldVal = prev[key];
    const newVal = next[key];
    if (!deepEqual(oldVal, newVal)) {
      diffs.push({ section, field: key, oldValue: oldVal, newValue: newVal });
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    for (const key of keys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}
