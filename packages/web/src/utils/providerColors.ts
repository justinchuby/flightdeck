/**
 * Per-provider color mapping for agent cards and badges.
 *
 * Each provider gets a distinct color for visual differentiation:
 * - Background tint (bg) for micro-pill badges
 * - Text color (text) for provider name
 * - Border color (border) for card left-border accent
 *
 * Colors chosen to match brand associations:
 *   Copilot → purple (GitHub), Gemini → blue (Google),
 *   Claude → amber (Anthropic), Codex → green (OpenAI),
 *   Cursor → cyan (brand), OpenCode → neutral
 */

export interface ProviderColorSet {
  /** Background class for pills/badges (e.g. 'bg-purple-500/15') */
  bg: string;
  /** Text color class (e.g. 'text-purple-400') */
  text: string;
  /** Border color class for card left-border accent (e.g. 'border-purple-500') */
  border: string;
}

const PROVIDER_COLORS: Record<string, ProviderColorSet> = {
  copilot: { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500' },
  gemini:  { bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500' },
  claude:  { bg: 'bg-amber-500/15',  text: 'text-amber-400',  border: 'border-amber-500' },
  codex:   { bg: 'bg-green-500/15',  text: 'text-green-400',  border: 'border-green-500' },
  cursor:  { bg: 'bg-cyan-500/15',   text: 'text-cyan-400',   border: 'border-cyan-500' },
  opencode: { bg: 'bg-zinc-500/15',  text: 'text-zinc-400',   border: 'border-zinc-500' },
};

const DEFAULT_COLORS: ProviderColorSet = {
  bg: 'bg-zinc-500/15',
  text: 'text-zinc-400',
  border: 'border-zinc-500',
};

/** Get the color set for a given provider ID. Falls back to neutral gray. */
export function getProviderColors(provider: string | undefined): ProviderColorSet {
  if (!provider) return DEFAULT_COLORS;
  return PROVIDER_COLORS[provider.toLowerCase()] ?? DEFAULT_COLORS;
}
