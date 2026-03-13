/**
 * Available models — re-exported from useModels hook for backward compatibility.
 *
 * @deprecated Import { useModels } from '../../hooks/useModels' instead.
 * This static list is only used as a fallback before the /models endpoint responds.
 * The canonical source is the backend GET /models endpoint.
 */
export { deriveModelName } from '../hooks/useModels';

/** @deprecated Use useModels() hook instead — this is a static fallback only */
export const AVAILABLE_MODELS: string[] = [
  // Anthropic (official Claude CLI model IDs)
  'claude-opus-4-6',
  'claude-opus-4-6-1m',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  // Google
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // OpenAI
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.1',
  'gpt-5.1-codex-mini',
  'gpt-5-mini',
  'gpt-4.1',
];
