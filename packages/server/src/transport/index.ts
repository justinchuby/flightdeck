/**
 * Transport module barrel export.
 */
export type {
  // Transport interfaces
  AgentServerTransport,
  AgentServerListener,
  TransportConnection,
  TransportState,

  // Scope
  MessageScope,

  // Orchestrator → Agent Server
  SpawnAgentMessage,
  SendMessageMessage,
  TerminateAgentMessage,
  ListAgentsMessage,
  SubscribeMessage,
  PingMessage,
  AuthenticateMessage,
  OrchestratorMessage,

  // Agent Server → Orchestrator
  AgentSpawnedMessage,
  AgentEventMessage,
  AgentEventType,
  AgentExitedMessage,
  AgentListMessage,
  AgentInfo,
  AgentStatus,
  PongMessage,
  AuthResultMessage,
  ErrorMessage,
  ErrorCode,
  AgentServerMessage,

  // Combined
  TransportMessage,
} from './types.js';

export {
  isOrchestratorMessage,
  isAgentServerMessage,
  hasRequestId,
  hasScope,
  isValidScope,
  validateMessage,
} from './types.js';

export { ForkListener, type ForkListenerOptions, type ForkProcess } from './ForkListener.js';

export { ForkTransport } from './ForkTransport.js';
export type { ForkTransportOptions } from './ForkTransport.js';

export {
  AgentServerHealth,
  type HealthState,
  type HealthStateChange,
  type AgentServerHealthOptions,
  type PingSender,
} from '../agents/AgentServerHealth.js';
