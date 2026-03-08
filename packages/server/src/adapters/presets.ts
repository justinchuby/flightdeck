/**
 * Provider presets for multi-CLI support.
 *
 * Each preset defines how to spawn a specific CLI tool via ACP stdio transport.
 * The AcpAdapter uses these presets to construct the correct spawn command
 * instead of hardcoding Copilot-specific flags.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── ProviderPreset Interface ────────────────────────────────

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
  supportsResume?: boolean;
  /** CLI flag for model selection (e.g., '--model') */
  modelFlag?: string;
  /** Default model for this provider */
  defaultModel?: string;
  /** Agent file format (e.g., '.agent.md', 'CLAUDE.md') */
  agentFileFormat?: string;
}

// ── Provider Preset ID Type ─────────────────────────────────

export type ProviderId = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude';

// ── Preset Definitions ──────────────────────────────────────

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    binary: 'copilot',
    args: ['--acp', '--stdio'],
    transport: 'stdio',
    supportsResume: true,
    modelFlag: '--model',
    agentFileFormat: '.agent.md',
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini CLI',
    binary: 'gemini',
    args: ['--experimental-acp'],
    requiredEnvVars: ['GEMINI_API_KEY'],
    transport: 'stdio',
    supportsResume: false,
    modelFlag: '--model',
    defaultModel: 'gemini-2.5-pro',
    agentFileFormat: '.gemini/agents/*.md',
  },

  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    binary: 'opencode',
    args: ['acp'],
    transport: 'stdio',
    supportsResume: false,
  },

  cursor: {
    id: 'cursor',
    name: 'Cursor',
    binary: 'agent',
    args: ['acp'],
    requiredEnvVars: ['CURSOR_API_KEY'],
    transport: 'stdio',
    supportsResume: true,
    agentFileFormat: '.cursorrules',
  },

  codex: {
    id: 'codex',
    name: 'Codex CLI',
    binary: 'codex',
    args: ['--acp'],
    requiredEnvVars: ['OPENAI_API_KEY'],
    transport: 'stdio',
    supportsResume: false,
    modelFlag: '--model',
    defaultModel: 'gpt-5',
  },

  claude: {
    id: 'claude',
    name: 'Claude Code',
    binary: 'claude',
    args: ['--acp', '--stdio'],
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    transport: 'stdio',
    supportsResume: true,
    modelFlag: '--model',
    defaultModel: 'claude-sonnet-4',
    agentFileFormat: 'CLAUDE.md',
  },
};

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
export function isValidProviderId(id: string): id is ProviderId {
  return id in PROVIDER_PRESETS;
}

// ── Detection ───────────────────────────────────────────────

/**
 * Check if a binary is available on PATH.
 * Uses `which` on Unix, `where` on Windows.
 */
async function isBinaryAvailable(binary: string): Promise<boolean> {
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execFileAsync(checkCmd, [binary], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

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
