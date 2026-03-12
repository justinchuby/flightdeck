/**
 * Barrel exports for command modules.
 */
export type { CommandEntry, CommandContext, CommandHandlerContext, Delegation } from './types.js';
export { getTaskCommands } from './TaskCommands.js';
export { getCommCommands, maybeAutoCreateGroup } from './CommCommands.js';
export { getCoordCommands } from './CoordCommands.js';
export { getSystemCommands } from './SystemCommands.js';
export { getCapabilityCommands } from './CapabilityCommands.js';
export {
  getAgentCommands,
  notifyParentOfIdle,
  notifyParentOfCompletion,
  getDelegations,
  clearCompletionTracking,
  completeDelegationsForAgent,
  cleanupStaleDelegations,
} from './AgentCommands.js';
