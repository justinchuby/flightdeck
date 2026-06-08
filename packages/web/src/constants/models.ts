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
  // NOTE: This list is the frontend fallback only. It cannot import the canonical
  // KNOWN_MODEL_IDS from packages/server (web→server imports are forbidden by the
  // package import-boundary rule), so it must be kept manually in sync with
  // packages/server/src/projects/ModelConfigDefaults.ts (KNOWN_MODEL_IDS).
  // Anthropic
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-haiku-4.5',
  // Google
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
  'gemini-3.1-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // OpenAI
  'gpt-5.5',
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
  // Moonshot (Kimi)
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
  'kimi-latest',
  // Qwen
  'qwen-turbo',
  'qwen-plus',
  'qwen-max',
  'qwen-coder-plus-latest',
];
