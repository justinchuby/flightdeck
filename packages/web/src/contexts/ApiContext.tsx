import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';

export type ApiContextValue = ReturnType<typeof useApi>;

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/**
 * Hook to access the API methods from the nearest ApiProvider.
 * Throws if used outside of an ApiProvider.
 */
export function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error('useApiContext must be used within an ApiProvider');
  }
  return ctx;
}
