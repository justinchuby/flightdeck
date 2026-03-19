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
export type ProviderId = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude';

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
  supportsResume: boolean;
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
    supportsResume: true,
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
    supportsResume: false, // Probe confirmed: no sessionCapabilities (no list/resume/fork)
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
    supportsResume: true,
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
    supportsResume: false,
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
    supportsResume: true,
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
    supportsResume: true,
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
