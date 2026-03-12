/**
 * Per-provider color mapping for agent cards and badges.
 *
 * Colors are derived from the central ProviderRegistry in @flightdeck/shared.
 * To change a provider's color, update the registry entry.
 */

import { PROVIDER_REGISTRY, type ProviderColors } from '@flightdeck/shared';

export type ProviderColorSet = ProviderColors;

const PROVIDER_COLORS: Record<string, ProviderColorSet> = Object.fromEntries(
  Object.values(PROVIDER_REGISTRY).map((def) => [def.id, def.color]),
);

const DEFAULT_COLORS: ProviderColorSet = {
  bg: 'bg-zinc-500/15',
  text: 'text-zinc-400',
  border: 'border-l-zinc-500',
  tab: 'text-zinc-400 border-zinc-400',
};

/** Get the color set for a given provider ID. Falls back to neutral gray. */
export function getProviderColors(provider: string | undefined): ProviderColorSet {
  if (!provider) return DEFAULT_COLORS;
  return PROVIDER_COLORS[provider.toLowerCase()] ?? DEFAULT_COLORS;
}
