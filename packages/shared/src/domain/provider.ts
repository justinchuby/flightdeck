/**
 * Central Provider Registry — single source of truth for ALL provider metadata.
 *
 * Adding a new CLI provider? Add ONE entry here and implement a RoleFileWriter.
 * Every consumer (server adapters, model resolver, UI components) derives from this.
 *
 * @see docs/reference/ADDING_PROVIDERS.md
 */

// ── Types ──────────────────────────────────────────────────────

/** Canonical provider identifiers. Add new providers here. */
export type ProviderId = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude' | 'kimi' | 'qwen-code';

/** Tailwind color classes for provider-branded UI elements. */
export interface ProviderColors {
  /** Background tint for badges (e.g. 'bg-purple-500/15') */
  bg: string;
  /** Text color (e.g. 'text-purple-400') */
  text: string;
  /** Left-border accent (e.g. 'border-l-purple-500') */
  border: string;
  /** Tab highlight color (e.g. 'text-purple-400 border-purple-400') */
  tab: string;
}

/** A labeled URL for setup/installation documentation. */
export interface ProviderLink {
  label: string;
  url: string;
}

/** Model quality tiers — each provider maps these to a concrete model name. */
export interface ProviderTierModels {
  fast: string;
  standard: string;
  premium: string;
}

/**
 * Complete provider definition.
 *
 * This consolidates all metadata that was previously scattered across:
 * - presets.ts (CLI config)
 * - ModelResolver.ts (model mappings)
 * - providerColors.ts (UI colors)
 * - SetupWizard.tsx / ProvidersSection.tsx (icons, links, labels)
 * - configSchema.ts (valid provider IDs)
 */
export interface ProviderDefinition {
  // ── Identity ────────────────────────────────────
  /** Unique identifier (matches ProviderId) */
  id: ProviderId;
  /** Human-readable display name (e.g. "GitHub Copilot") */
  name: string;
  /** Emoji icon for UI lists (fallback when iconUrl unavailable) */
  icon: string;
  /** Path to SVG icon (e.g. '/provider-icons/copilot.svg') — preferred over emoji */
  iconUrl?: string;

  // ── CLI Configuration ──────────────────────────
  /** CLI binary name or path */
  binary: string;
  /** Default args for ACP stdio mode */
  args: string[];
  /** Transport protocol (all current providers use stdio) */
  transport: 'stdio';
  /** Env var keys the user must configure (values come from user env) */
  requiredEnvVars: string[];
  /** Whether the CLI supports session resume via session/load */
  supportsLoadSession: boolean;
  /** CLI flag for model selection (e.g. '--model'), undefined if N/A */
  modelFlag?: string;
  /** Default model when none specified */
  defaultModel?: string;
  /** Agent file format hint (e.g. '.agent.md', 'CLAUDE.md') */
  agentFileFormat?: string;
  /** Whether CLI supports --agent=<name> flag (Copilot only) */
  supportsAgentFlag?: boolean;
  /**
   * How the model name is passed to the CLI:
   * - 'flag': uses modelFlag (e.g. `--model gemini-2.5-pro`)
   * - 'config': uses configModelPrefix (e.g. `-c model=gpt-5.3-codex`)
   * - 'none': model cannot be specified via CLI args
   */
  modelArgStrategy: 'flag' | 'config' | 'none';
  /** For 'config' strategy, the CLI flags before the model value (e.g. ['-c', 'model=']) */
  configModelPrefix?: string[];

  // ── Model Resolution ───────────────────────────
  /** Which underlying model backends this CLI can access (e.g. ['anthropic', 'openai']) */
  nativeModelProviders: string[];
  /**
   * Per-backend model restrictions. When a backend is in nativeModelProviders
   * but only certain models are supported, list the allowed ones here.
   * Example: copilot → google → ['gemini-3-pro-preview']
   */
  restrictedModels?: Record<string, string[]>;
  /** Concrete model for each quality tier */
  tierModels: ProviderTierModels;
  /** CLI-specific model name aliases (e.g. Claude: 'claude-opus-4.6' → 'opus').
   *  Only needed when a CLI requires short names instead of full model IDs.
   *  Other providers accept full model names directly, so they don't need aliases. */
  modelAliases?: Record<string, string>;
  /** CLI-specific model name prefix per backend (e.g. OpenCode: { anthropic: 'anthropic' }) */
  modelPrefixes?: Record<string, string>;

  // ── Auth ────────────────────────────────────────
  /** Shell command to verify authentication (undefined → assume auth'd if installed) */
  authCommand?: string;
  /** Human-readable auth status label for UI */
  authLabel: string;

  // ── UI Metadata ────────────────────────────────
  /** Tailwind color classes for branded elements */
  color: ProviderColors;
  /** Primary documentation URL */
  docsUrl: string;
  /** Setup/installation links shown in settings */
  setupLinks: ProviderLink[];
  /** Whether this provider is in preview (non-GA) */
  isPreview: boolean;
  /** Human-readable login/auth instructions shown when not authenticated */
  loginInstructions: string;
}

// ── Registry ───────────────────────────────────────────────────

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDefinition> = {
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    icon: '🐙',
    iconUrl: '/provider-icons/copilot.svg',
    binary: 'copilot',
    args: ['--acp', '--stdio'],
    transport: 'stdio',
    requiredEnvVars: [],
    supportsLoadSession: true,
    modelFlag: '--model',
    agentFileFormat: '.agent.md',
    supportsAgentFlag: true,
    modelArgStrategy: 'flag',
    nativeModelProviders: ['anthropic', 'openai', 'google', 'xai'],
    restrictedModels: { google: ['gemini-3-pro-preview'] },
    tierModels: { fast: 'claude-haiku-4.5', standard: 'claude-sonnet-4.6', premium: 'claude-opus-4.6' },
    authCommand: 'gh auth status',
    authLabel: 'Authenticated via GitHub',
    color: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-l-purple-500', tab: 'text-purple-400 border-purple-400' },
    docsUrl: 'https://docs.github.com/en/copilot/github-copilot-in-the-cli',
    setupLinks: [{ label: 'Documentation', url: 'https://github.com/features/copilot/cli' }],
    isPreview: false,
    loginInstructions: 'Authenticate using the GitHub Copilot CLI',
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini CLI',
    icon: '💎',
    iconUrl: '/provider-icons/gemini.svg',
    binary: 'gemini',
    args: ['--acp'],
    transport: 'stdio',
    requiredEnvVars: ['GEMINI_API_KEY'],
    supportsLoadSession: true,
    modelFlag: '--model',
    defaultModel: 'gemini-2.5-pro',
    agentFileFormat: '.gemini/agents/*.md',
    modelArgStrategy: 'flag',
    nativeModelProviders: ['google'],
    tierModels: { fast: 'gemini-2.5-flash-lite', standard: 'gemini-2.5-flash', premium: 'gemini-2.5-pro' },
    authCommand: 'gemini --version',
    authLabel: 'Authenticated via Google',
    color: { bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-l-blue-500', tab: 'text-blue-400 border-blue-400' },
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    setupLinks: [{ label: 'Installation guide', url: 'https://geminicli.com/docs/get-started/installation/' }],
    isPreview: false,
    loginInstructions: 'Log in with gemini auth in your terminal',
  },

  claude: {
    id: 'claude',
    name: 'Claude Agent (ACP)',
    icon: '🟠',
    iconUrl: '/provider-icons/claude.svg',
    binary: 'claude-agent-acp',
    args: [],
    transport: 'stdio',
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    supportsLoadSession: true,
    modelFlag: '--model',
    defaultModel: 'claude-sonnet-4',
    agentFileFormat: 'CLAUDE.md',
    modelArgStrategy: 'flag',
    nativeModelProviders: ['anthropic'],
    tierModels: { fast: 'haiku', standard: 'default', premium: 'opus' },
    // Maps our model IDs to Claude CLI's ACP availableModels names.
    // These 3 IDs come from the CLI's newSession response: 'default', 'opus', 'haiku'.
    // Other providers accept full model names directly, so they don't need aliases.
    modelAliases: {
      'claude-opus-4.6': 'opus',
      'claude-sonnet-4.6': 'default',
      'claude-haiku-4.5': 'haiku',
    },
    authLabel: 'Authenticated via Anthropic API key',
    color: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-l-amber-500', tab: 'text-orange-400 border-orange-400' },
    docsUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview',
    setupLinks: [
      { label: 'ACP adapter', url: 'https://github.com/zed-industries/claude-agent-acp' },
      { label: 'Claude Code CLI', url: 'https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview' },
    ],
    isPreview: false,
    loginInstructions: 'Log in with claude auth in your terminal',
  },

  codex: {
    id: 'codex',
    name: 'Codex (ACP)',
    icon: '🤖',
    iconUrl: '/provider-icons/codex.svg',
    binary: 'codex-acp',
    args: [],
    transport: 'stdio',
    requiredEnvVars: ['OPENAI_API_KEY'],
    supportsLoadSession: true,
    defaultModel: 'gpt-5.3-codex',
    modelArgStrategy: 'config',
    configModelPrefix: ['-c', 'model='],
    nativeModelProviders: ['openai'],
    tierModels: { fast: 'gpt-5.1-codex-mini', standard: 'gpt-5.3-codex', premium: 'gpt-5.4' },
    authLabel: 'Authenticated via OpenAI',
    color: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-l-green-500', tab: 'text-green-400 border-green-400' },
    docsUrl: 'https://github.com/openai/codex',
    setupLinks: [
      { label: 'ACP adapter', url: 'https://github.com/zed-industries/codex-acp' },
      { label: 'CLI quickstart', url: 'https://developers.openai.com/codex/quickstart/?setup=cli' },
    ],
    isPreview: false,
    loginInstructions: 'Log in with codex auth in your terminal',
  },

  cursor: {
    id: 'cursor',
    name: 'Cursor',
    icon: '↗️',
    iconUrl: '/provider-icons/cursor.svg',
    binary: 'agent',
    args: ['acp'],
    transport: 'stdio',
    requiredEnvVars: ['CURSOR_API_KEY'],
    supportsLoadSession: true,
    agentFileFormat: '.cursorrules',
    modelArgStrategy: 'none',
    nativeModelProviders: ['anthropic', 'openai', 'google'],
    tierModels: { fast: 'claude-haiku-4.5', standard: 'claude-sonnet-4.6', premium: 'claude-opus-4.6' },
    authLabel: 'Authenticated via Cursor',
    color: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-l-cyan-500', tab: 'text-cyan-400 border-cyan-400' },
    docsUrl: 'https://www.cursor.com/',
    setupLinks: [{ label: 'Documentation', url: 'https://docs.cursor.com' }],
    isPreview: true,
    loginInstructions: 'Log in via the Cursor app',
  },

  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    icon: '🔓',
    iconUrl: '/provider-icons/opencode.svg',
    binary: 'opencode',
    args: ['acp'],
    transport: 'stdio',
    requiredEnvVars: [],
    supportsLoadSession: true,
    modelArgStrategy: 'none',
    nativeModelProviders: ['anthropic', 'openai', 'google', 'local'],
    tierModels: { fast: 'anthropic/claude-haiku-4-5', standard: 'anthropic/claude-sonnet-4-6', premium: 'anthropic/claude-opus-4-6' },
    modelPrefixes: { anthropic: 'anthropic', openai: 'openai', google: 'google' },
    authLabel: 'Manages own keys',
    color: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-l-zinc-500', tab: 'text-zinc-400 border-zinc-400' },
    docsUrl: 'https://github.com/nicholasgriffintn/opencode',
    setupLinks: [{ label: 'Documentation', url: 'https://opencode.ai/docs/' }],
    isPreview: true,
    loginInstructions: 'Authentication is managed by OpenCode',
  },

  kimi: {
    id: 'kimi',
    name: 'Kimi CLI',
    icon: '🌙',
    iconUrl: '/provider-icons/kimi.svg',
    binary: 'kimi',
    args: ['acp'],
    transport: 'stdio',
    requiredEnvVars: [],
    supportsLoadSession: true, // Probe: sessionCapabilities.list + resume, loadSession: true
    modelFlag: '--model',
    defaultModel: 'kimi-latest',
    modelArgStrategy: 'flag',
    nativeModelProviders: ['moonshot'],
    tierModels: { fast: 'moonshot-v1-8k', standard: 'kimi-latest', premium: 'kimi-latest' },
    authCommand: 'kimi --version',
    authLabel: 'Authenticated via Kimi',
    color: { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-l-violet-500', tab: 'text-violet-400 border-violet-400' },
    docsUrl: 'https://github.com/MoonshotAI/kimi-cli',
    setupLinks: [{ label: 'GitHub', url: 'https://github.com/MoonshotAI/kimi-cli' }],
    isPreview: false,
    loginInstructions: 'Run kimi login in your terminal',
  },

  'qwen-code': {
    id: 'qwen-code',
    name: 'Qwen Code',
    icon: '🔮',
    iconUrl: '/provider-icons/qwen-code.svg',
    binary: 'qwen',
    args: ['--acp', '--experimental-skills'],
    transport: 'stdio',
    requiredEnvVars: [],
    supportsLoadSession: true, // Probe: sessionCapabilities.list + resume, loadSession: true
    modelFlag: '--model',
    defaultModel: 'qwen-coder-plus-latest',
    modelArgStrategy: 'flag',
    nativeModelProviders: ['qwen', 'openai'],
    tierModels: { fast: 'qwen-coder-plus-latest', standard: 'qwen-coder-plus-latest', premium: 'qwen-coder-plus-latest' },
    authLabel: 'Qwen OAuth or OPENAI_API_KEY',
    color: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', border: 'border-l-indigo-500', tab: 'text-indigo-400 border-indigo-400' },
    docsUrl: 'https://github.com/QwenLM/qwen-code',
    setupLinks: [{ label: 'GitHub', url: 'https://github.com/QwenLM/qwen-code' }],
    isPreview: false,
    loginInstructions: 'Run qwen --auth-type=qwen-oauth or set OPENAI_API_KEY',
  },
};

// ── Lookup Helpers ──────────────────────────────────────────────

/** All registered provider IDs. */
export const PROVIDER_IDS = Object.keys(PROVIDER_REGISTRY) as ProviderId[];

/** Get a provider definition by ID. Returns undefined for unknown IDs. */
export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDER_REGISTRY[id as ProviderId];
}

/** Get all provider definitions as an array. */
export function getAllProviders(): ProviderDefinition[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** Type guard — check if a string is a valid ProviderId. */
export function isValidProviderId(id: string): id is ProviderId {
  return id in PROVIDER_REGISTRY;
}

// ── ACP Capabilities (from live probe, March 2026) ─────────────

/**
 * ACP capability probe results per provider.
 *
 * Data from live ACP probes against installed CLIs.
 * `undefined` fields mean the provider was not probed (preview/not installed).
 */
export interface AcpProviderCapabilities {
  /** CLI version probed */
  probeVersion?: string;
  /** Provider supports image content in prompts */
  images: boolean;
  /** Provider supports audio content in prompts */
  audio: boolean;
  /** Provider supports MCP server passthrough (HTTP) */
  mcpHttp: boolean;
  /** Provider supports MCP server passthrough (SSE) */
  mcpSse: boolean;
  /** Provider supports embedded context injection */
  embeddedContext: boolean;
  /** Provider supports loadSession (resume from session ID) */
  loadSession: boolean;
  /** Provider supports session list/resume/fork operations */
  sessionList: boolean;
  sessionResume: boolean;
  sessionFork: boolean;
  /** How the system prompt is delivered to the agent */
  systemPromptMethod: string;
  /** How the provider authenticates */
  authMethod: string;
  /** Whether this data is from a live probe or estimated */
  probed: boolean;
}

// ── Derive ACP_CAPABILITIES from probe JSON ────────────────────
//
// The probe script (scripts/query-acp-capabilities.ts) writes
// acp-capability-results.json. That file is the single source of truth
// for probe data. We import it and transform it at build time.

import probeResults from '../data/acp-capability-results.json' with { type: 'json' };

/** Raw probe result shape (subset we need). */
interface ProbeResult {
  providerId: string;
  installed: boolean;
  agentInfo?: { version?: string };
  agentCapabilities?: {
    loadSession?: boolean;
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    sessionCapabilities?: { list?: object; resume?: object; fork?: object };
  };
  authMethods?: Array<{ name?: string; description?: string }>;
}

/**
 * Non-probe metadata that cannot be determined automatically.
 * Keyed by ProviderId. Only providers with non-default values need entries.
 */
const CAPABILITY_OVERRIDES: Partial<Record<ProviderId, { systemPromptMethod?: string; authMethod?: string }>> = {
  copilot:      { systemPromptMethod: '--agent flag + .agent.md', authMethod: 'gh auth status (GitHub OAuth)' },
  claude:       { systemPromptMethod: '_meta.systemPrompt ACP extension', authMethod: 'ANTHROPIC_API_KEY env var' },
  gemini:       { authMethod: 'GEMINI_API_KEY env var' },
  codex:        { authMethod: 'OPENAI_API_KEY env var' },
  cursor:       { authMethod: 'CURSOR_API_KEY env var' },
  opencode:     { authMethod: 'Self-managed (opencode auth login)' },
  kimi:         { authMethod: 'kimi login (Moonshot account)' },
  'qwen-code':  { authMethod: 'Qwen OAuth or OPENAI_API_KEY' },
};

/** Defaults for unprobed/uninstalled providers. */
const UNPROBED_DEFAULTS: AcpProviderCapabilities = {
  images: false, audio: false,
  mcpHttp: false, mcpSse: false,
  embeddedContext: false,
  loadSession: false,
  sessionList: false, sessionResume: false, sessionFork: false,
  systemPromptMethod: 'First user message',
  authMethod: 'Unknown',
  probed: false,
};

function deriveCapabilities(result: ProbeResult): AcpProviderCapabilities {
  const id = result.providerId as ProviderId;
  const overrides = CAPABILITY_OVERRIDES[id] ?? {};

  if (!result.installed || !result.agentCapabilities) {
    return {
      ...UNPROBED_DEFAULTS,
      systemPromptMethod: overrides.systemPromptMethod ?? UNPROBED_DEFAULTS.systemPromptMethod,
      authMethod: overrides.authMethod ?? UNPROBED_DEFAULTS.authMethod,
    };
  }

  const caps = result.agentCapabilities;
  const prompt = caps.promptCapabilities ?? {};
  const mcp = caps.mcpCapabilities ?? {};
  const session = caps.sessionCapabilities ?? {};

  return {
    probeVersion: result.agentInfo?.version,
    images: prompt.image ?? false,
    audio: prompt.audio ?? false,
    mcpHttp: mcp.http ?? false,
    mcpSse: mcp.sse ?? false,
    embeddedContext: prompt.embeddedContext ?? false,
    loadSession: caps.loadSession ?? false,
    sessionList: 'list' in session,
    sessionResume: 'resume' in session,
    sessionFork: 'fork' in session,
    systemPromptMethod: overrides.systemPromptMethod ?? 'First user message',
    authMethod: overrides.authMethod ?? 'Unknown',
    probed: true,
  };
}

/**
 * ACP capabilities per provider — derived from acp-capability-results.json.
 *
 * The probe script generates the JSON; this constant is built from it.
 * Consumed by both ProvidersSection (Settings) and FindingsPage.
 */
export const ACP_CAPABILITIES: Record<ProviderId, AcpProviderCapabilities> = (() => {
  const results = (probeResults as { results: ProbeResult[] }).results;
  const map = {} as Record<ProviderId, AcpProviderCapabilities>;
  for (const r of results) {
    if (PROVIDER_IDS.includes(r.providerId as ProviderId)) {
      map[r.providerId as ProviderId] = deriveCapabilities(r);
    }
  }
  // Fill any providers missing from the probe file with defaults
  for (const id of PROVIDER_IDS) {
    if (!map[id]) {
      const overrides = CAPABILITY_OVERRIDES[id] ?? {};
      map[id] = {
        ...UNPROBED_DEFAULTS,
        systemPromptMethod: overrides.systemPromptMethod ?? UNPROBED_DEFAULTS.systemPromptMethod,
        authMethod: overrides.authMethod ?? UNPROBED_DEFAULTS.authMethod,
      };
    }
  }
  return map;
})();

/** Get ACP capabilities for a provider. */
export function getAcpCapabilities(id: string): AcpProviderCapabilities | undefined {
  return ACP_CAPABILITIES[id as ProviderId];
}
