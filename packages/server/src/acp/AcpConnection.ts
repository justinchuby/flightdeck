/**
 * Backward-compatibility shim (R9).
 *
 * Re-exports AcpAdapter as AcpConnection and adapter types for any code
 * that still imports from this path. New code should import from adapters/.
 *
 * @deprecated Use imports from '../adapters/' instead.
 */
export { AcpAdapter as AcpConnection } from '../adapters/AcpAdapter.js';
export type { ToolCallInfo, PlanEntry, PromptContent } from '../adapters/types.js';
export type { AdapterStartOptions as AcpConnectionOptions } from '../adapters/types.js';
