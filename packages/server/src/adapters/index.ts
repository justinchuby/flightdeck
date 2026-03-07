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
export { DaemonAdapter } from './DaemonAdapter.js';
export type { DaemonAdapterOptions } from './DaemonAdapter.js';
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

import { AcpAdapter } from './AcpAdapter.js';
import { MockAdapter } from './MockAdapter.js';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import type { AgentAdapter, AdapterFactoryOptions } from './types.js';

/**
 * Create an adapter instance. Register this as a singleton factory in the DI container.
 * Individual adapters are transient (one per agent).
 */
export function createAdapter(opts: AdapterFactoryOptions): AgentAdapter {
  switch (opts.type) {
    case 'acp':
      return new AcpAdapter({ autopilot: opts.autopilot });
    case 'claude-sdk':
      return new ClaudeSdkAdapter({ autopilot: opts.autopilot, model: opts.model });
    case 'mock':
      return new MockAdapter();
    default:
      throw new Error(`Unknown adapter type: ${(opts as any).type}`);
  }
}
