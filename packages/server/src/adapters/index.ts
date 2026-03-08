/**
 * Adapter barrel export (R9).
 *
 * Re-exports all adapter types, implementations, and the factory function.
 */
export type {
  AgentAdapter,
  AdapterStartOptions,
  AdapterFactory,
  AdapterFactoryOptions,
  ContentBlock,
  PromptContent,
  PromptOptions,
  PromptResult,
  StopReason,
  UsageInfo,
  ToolCallInfo,
  ToolUpdateInfo,
  PlanEntry,
  AdapterCapabilities,
  PermissionRequest,
} from './types.js';

export { AcpAdapter } from './AcpAdapter.js';
export { MockAdapter } from './MockAdapter.js';
export { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
export type {
  SdkQuery,
  SdkMessage,
  SdkAssistantMessage,
  SdkUserMessage,
  SdkSystemMessage,
  SdkResultMessage,
  QueryOptions,
  SdkSessionInfo,
  CanUseToolCallback,
} from './claude-sdk-types.js';
export {
  createAdapterForProvider,
  buildStartOptions,
  resolveBackend,
} from './AdapterFactory.js';
export type {
  AdapterConfig,
  AdapterResult,
  BackendType,
} from './AdapterFactory.js';

export {
  PROVIDER_PRESETS,
  getPreset,
  listPresets,
  isValidProviderId,
  detectInstalledProviders,
} from './presets.js';
export type { ProviderPreset, ProviderId, BinaryChecker } from './presets.js';

export {
  resolveModel,
  isTierAlias,
  getTierModels,
  listTiers,
  isValidModel,
} from './ModelResolver.js';
export type { ModelResolution, ModelTier } from './ModelResolver.js';

export {
  CopilotRoleFileWriter,
  ClaudeRoleFileWriter,
  GeminiRoleFileWriter,
  CursorRoleFileWriter,
  CodexRoleFileWriter,
  OpenCodeRoleFileWriter,
  createRoleFileWriter,
  listRoleFileWriterProviders,
  FLIGHTDECK_MARKER,
} from './RoleFileWriter.js';
export type { RoleDefinition, RoleFileWriter } from './RoleFileWriter.js';



