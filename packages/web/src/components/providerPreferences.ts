interface ProviderWithId {
  id: string;
}

interface UsableProvider {
  id: string;
  enabled: boolean;
  installed: boolean | null;
}

export function normalizeProviderRanking<T extends ProviderWithId>(
  providers: T[],
  ranking?: string[],
): string[] {
  const knownIds = new Set(providers.map((provider) => provider.id));
  const preferred = (ranking ?? []).filter((id) => knownIds.has(id));
  const missing = providers
    .map((provider) => provider.id)
    .filter((id) => !preferred.includes(id));
  return [...preferred, ...missing];
}

export function findUsableProviderId<T extends UsableProvider>(
  providers: T[],
  preferredId?: string | null,
): string | null {
  if (preferredId) {
    const preferredProvider = providers.find((provider) => provider.id === preferredId);
    if (preferredProvider?.enabled && preferredProvider.installed === true) {
      return preferredId;
    }
  }

  return providers.find((provider) => provider.enabled && provider.installed === true)?.id ?? null;
}
