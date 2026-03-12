import { getProviderColors } from '../utils/providerColors';

interface ProviderBadgeProps {
  provider: string | undefined;
  /** 'sm' for compact list views (9px), 'md' for detail views (default) */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Reusable provider badge with per-provider colors.
 * Renders nothing if provider is undefined.
 */
export function ProviderBadge({ provider, size = 'sm', className = '' }: ProviderBadgeProps) {
  if (!provider) return null;
  const pc = getProviderColors(provider);

  const sizeClasses = size === 'sm'
    ? 'text-[9px] shrink-0 px-1 py-px rounded-sm font-medium'
    : 'text-xs px-1.5 py-px rounded font-medium';

  return (
    <span className={`${sizeClasses} ${pc.bg} ${pc.text} ${className}`}>
      {provider}
    </span>
  );
}
