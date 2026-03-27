/**
 * Provider presets for multi-CLI support.
 *
 * Each preset defines how to spawn a specific CLI tool via ACP stdio transport.
 * The AcpAdapter uses these presets to construct the correct spawn command
 * instead of hardcoding Copilot-specific flags.
 *
 * NOTE: Preset data is derived from the central ProviderRegistry in @flightdeck/shared.
 * To add a new provider, update the registry — presets are auto-generated.
 */
import {
  PROVIDER_REGISTRY, PROVIDER_IDS,
  type ProviderId, type ProviderDefinition,
} from '@flightdeck/shared';
import { isBinaryAvailable } from '../utils/platform.js';

// Re-export ProviderId from the shared registry (canonical source)
export type { ProviderId } from '@flightdeck/shared';

// ── ProviderPreset Interface ────────────────────────────────
// Kept for backward compatibility — fields are a subset of ProviderDefinition.

export interface ProviderPreset {
  /** Unique identifier (e.g., 'copilot', 'gemini', 'claude') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** CLI binary name or path */
  binary: string;
  /** Default args for ACP stdio mode */
  args: string[];
  /** Environment variables needed by this provider */
  env?: Record<string, string>;
  /** Environment variables needed by this provider (keys only — values come from user's env) */
  requiredEnvVars?: string[];
  /** Transport protocol (all use stdio for now) */
  transport: 'stdio';
  /** Whether the CLI supports session resume via session/load */
  supportsLoadSession?: boolean;
  /** CLI flag for model selection (e.g., '--model') */
  modelFlag?: string;
  /** Default model for this provider */
  defaultModel?: string;
  /** Agent file format (e.g., '.agent.md', 'CLAUDE.md') */
  agentFileFormat?: string;
  /** Whether the CLI supports `--agent=<name>` flag (only Copilot CLI). Defaults to false. */
  supportsAgentFlag?: boolean;
}

// ── Derive Presets from Registry ────────────────────────────

function toPreset(def: ProviderDefinition): ProviderPreset {
  return {
    id: def.id,
    name: def.name,
    binary: def.binary,
    args: def.args,
    requiredEnvVars: def.requiredEnvVars.length > 0 ? def.requiredEnvVars : undefined,
    transport: def.transport,
    supportsLoadSession: def.supportsLoadSession,
    modelFlag: def.modelFlag,
    defaultModel: def.defaultModel,
    agentFileFormat: def.agentFileFormat,
    supportsAgentFlag: def.supportsAgentFlag,
  };
}

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = Object.fromEntries(
  PROVIDER_IDS.map((id: ProviderId) => [id, toPreset(PROVIDER_REGISTRY[id])]),
) as Record<ProviderId, ProviderPreset>;

// ── Lookup Functions ────────────────────────────────────────

/** Get a preset by provider ID. Returns undefined if not found. */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[id as ProviderId];
}

/** List all available provider presets. */
export function listPresets(): ProviderPreset[] {
  return Object.values(PROVIDER_PRESETS);
}

/** Check if a string is a valid provider ID. */
export { isValidProviderId } from '@flightdeck/shared';

// ── Detection ───────────────────────────────────────────────

/** Signature for the binary checker function used by detectInstalledProviders. */
export type BinaryChecker = (binary: string) => Promise<boolean>;

/**
 * Detect which CLI providers are installed on the current system.
 * Checks each preset's binary against PATH.
 * Accepts an optional checker function for testing.
 */
export async function detectInstalledProviders(
  checker: BinaryChecker = isBinaryAvailable,
): Promise<ProviderPreset[]> {
  const presets = listPresets();
  const results = await Promise.all(
    presets.map(async (preset) => ({
      preset,
      available: await checker(preset.binary),
    })),
  );
  return results
    .filter((r) => r.available)
    .map((r) => r.preset);
}
