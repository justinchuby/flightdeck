/**
 * Daemon module barrel — DEPRECATED.
 *
 * The daemon code has been replaced by the agent server architecture.
 * EventBuffer and MassFailureDetector have moved to transport/.
 * These re-exports exist only for backward compatibility.
 */
export { EventBuffer, type EventBufferOptions, type BufferedEvent, type BufferedEventType } from '../transport/EventBuffer.js';
// Backward compat aliases
export type { BufferedEvent as DaemonEvent, BufferedEventType as DaemonEventType } from '../transport/EventBuffer.js';
export {
  MassFailureDetector,
  detectCause,
  type ExitRecord,
  type MassFailureConfig,
  type MassFailureCallback,
  type MassFailureCause,
  type MassFailureData,
} from '../transport/MassFailureDetector.js';
