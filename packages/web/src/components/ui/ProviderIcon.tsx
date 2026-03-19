import type { ProviderDefinition } from '@flightdeck/shared';

interface ProviderIconProps {
  provider: Pick<ProviderDefinition, 'icon' | 'iconUrl' | 'name'> | undefined;
  fallback?: string;
  className?: string;
}

/**
 * Renders a provider icon — prefers SVG iconUrl, falls back to emoji.
 * Use this wherever a provider's visual identity is shown.
 */
export function ProviderIcon({ provider, fallback = '🔧', className = 'w-5 h-5' }: ProviderIconProps) {
  if (provider?.iconUrl) {
    return <img src={provider.iconUrl} alt={provider.name} className={className} />;
  }
  return <span className={className} role="img" aria-label={provider?.name ?? 'Provider'}>{provider?.icon ?? fallback}</span>;
}
