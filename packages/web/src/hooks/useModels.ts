/**
 * useModels — single source of truth for model data on the frontend.
 *
 * Fetches from GET /models once, caches across all consumers.
 * Replaces the static AVAILABLE_MODELS constant and per-component
 * MODEL_NAMES dictionaries.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from './useApi';

// ── Types ────────────────────────────────────────────────────

interface ModelsResponse {
  models: string[];
  defaults: Record<string, string[]>;
  modelsByProvider?: Record<string, string[]>;
  activeProvider?: string;
}

export interface ModelsData {
  /** All known model IDs (ordered) */
  models: string[];
  /** Models filtered to only the active provider (use in model selectors) */
  filteredModels: string[];
  /** Default model config per role */
  defaults: Record<string, string[]>;
  /** Models grouped by provider (copilot, claude, gemini, codex, cursor, opencode) */
  modelsByProvider: Record<string, string[]>;
  /** The currently active provider ID from server config */
  activeProvider: string;
  /** Human-readable display name for a model ID */
  modelName: (id: string) => string;
  /** Whether data has loaded */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

// ── Model display names ──────────────────────────────────────

/**
 * Derive a human-readable display name from a model ID.
 * Uses a deterministic transform so no hardcoded map is needed.
 *
 * Examples:
 *   claude-opus-4.6    → "Claude Opus 4.6"
 *   gpt-5.3-codex      → "GPT 5.3 Codex"
 *   gemini-3-pro-preview → "Gemini 3 Pro Preview"
 *   gpt-5.1-codex-mini → "GPT 5.1 Codex Mini"
 */
export function deriveModelName(id: string): string {
  return id
    .split('-')
    .map((part) => {
      if (part === 'gpt') return 'GPT';
      if (part === 'codex' && !id.startsWith('gpt-')) return 'Codex';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

// ── Module-level cache (shared across all hook instances) ────

let cachedData: { models: string[]; defaults: Record<string, string[]>; modelsByProvider: Record<string, string[]>; activeProvider: string } | null = null;
let fetchPromise: Promise<void> | null = null;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  subscribers.forEach((subscriber) => subscriber());
}

function fetchModels(): Promise<void> {
  if (cachedData) return Promise.resolve();
  if (fetchPromise) return fetchPromise;
  fetchPromise = apiFetch<ModelsResponse>('/models')
    .then((data) => {
      cachedData = {
        models: data.models ?? [],
        defaults: data.defaults ?? {},
        modelsByProvider: data.modelsByProvider ?? {},
        activeProvider: data.activeProvider ?? 'copilot',
      };
      notifySubscribers();
    })
    .catch(() => {
      // Allow retry on next mount
      fetchPromise = null;
    });
  return fetchPromise;
}

// ── Hook ─────────────────────────────────────────────────────

export function useModels(): ModelsData {
  const [loading, setLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    subscribers.add(rerender);

    if (cachedData) {
      setLoading(false);
      return () => {
        subscribers.delete(rerender);
      };
    }
    let mounted = true;
    fetchModels()
      .then(() => {
        if (mounted) {
          setLoading(false);
          rerender();
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Failed to load models');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
      subscribers.delete(rerender);
    };
  }, []);

  const models = cachedData?.models ?? [];
  const activeProvider = cachedData?.activeProvider ?? 'copilot';
  const providerModels = cachedData?.modelsByProvider[activeProvider];
  const filteredModels = providerModels
    ? models.filter((m) => providerModels.includes(m))
    : models;

  return {
    models,
    filteredModels,
    defaults: cachedData?.defaults ?? {},
    modelsByProvider: cachedData?.modelsByProvider ?? {},
    activeProvider,
    modelName: deriveModelName,
    loading,
    error,
  };
}

export function updateCachedActiveProvider(activeProvider: string): void {
  if (!cachedData || cachedData.activeProvider === activeProvider) return;
  cachedData = { ...cachedData, activeProvider };
  notifySubscribers();
}

/** Clear cached data (useful for tests) */
export function _resetModelsCache(): void {
  cachedData = null;
  fetchPromise = null;
  subscribers.clear();
}
