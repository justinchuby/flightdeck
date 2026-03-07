/**
 * Daemon module barrel export.
 *
 * Provides the daemon process, client, protocol types, and event buffer
 * for agent lifecycle management across server restarts.
 */
export { DaemonProcess, type DaemonProcessOptions } from './DaemonProcess.js';
export { DaemonClient, type DaemonClientOptions, type DaemonClientEvents } from './DaemonClient.js';
export { EventBuffer, type EventBufferOptions } from './EventBuffer.js';
export {
  // Protocol types
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcError,
  type JsonRpcMessage,
  type DaemonEvent,
  type DaemonEventType,
  type DaemonAgentStatus,
  type AgentDescriptor,
  type MassFailureData,
  // Param types
  type AuthParams,
  type SpawnParams,
  type TerminateParams,
  type SendParams,
  type SubscribeParams,
  type ShutdownParams,
  type ConfigureParams,
  // Result types
  type AuthResult,
  type SpawnResult,
  type ListResult,
  type SubscribeResult,
  // Constants
  RPC_ERRORS,
  // Utilities
  serializeMessage,
  parseNdjsonBuffer,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  isRequest,
  isResponse,
  isNotification,
  getSocketDir,
} from './DaemonProtocol.js';
