/**
 * Shared types for the command module decomposition.
 *
 * Each command module exports a getXCommands(ctx) function returning
 * CommandEntry[]. The router (CommandDispatcher) assembles these into
 * its dispatch table.
 */
import type { Agent } from '../Agent.js';
import type { Role, RoleRegistry } from '../RoleRegistry.js';
import type { ServerConfig } from '../../config.js';
import type { FileLockRegistry } from '../../coordination/FileLockRegistry.js';
import type { ActivityLedger } from '../../coordination/ActivityLedger.js';
import type { MessageBus } from '../../comms/MessageBus.js';
import type { DecisionLog } from '../../coordination/DecisionLog.js';
import type { AgentMemory } from '../AgentMemory.js';
import type { ChatGroupRegistry } from '../../comms/ChatGroupRegistry.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import type { DeferredIssueRegistry } from '../../tasks/DeferredIssueRegistry.js';
import type { TimerRegistry } from '../../coordination/TimerRegistry.js';
import type { CapabilityInjector } from '../capabilities/CapabilityInjector.js';
import type { TaskTemplateRegistry } from '../../tasks/TaskTemplates.js';
import type { TaskDecomposer } from '../../tasks/TaskDecomposer.js';

// ── Delegation record ────────────────────────────────────────────────

export interface Delegation {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  toRole: string;
  task: string;
  context?: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled' | 'terminated';
  createdAt: string;
  completedAt?: string;
  result?: string;
}

// ── CommandContext — bridge from AgentManager ─────────────────────────

export interface CommandContext {
  getAgent(id: string): Agent | undefined;
  getAllAgents(): Agent[];
  getProjectIdForAgent(agentId: string): string | undefined;
  getRunningCount(): number;
  spawnAgent(role: Role, task?: string, parentId?: string, autopilot?: boolean, model?: string, cwd?: string, options?: { projectName?: string; projectId?: string }): Agent;
  terminateAgent(id: string): boolean;
  emit(event: string, ...args: any[]): boolean;
  roleRegistry: RoleRegistry;
  config: ServerConfig;
  lockRegistry: FileLockRegistry;
  activityLedger: ActivityLedger;
  messageBus: MessageBus;
  decisionLog: DecisionLog;
  agentMemory: AgentMemory;
  chatGroupRegistry: ChatGroupRegistry;
  taskDAG: TaskDAG;
  deferredIssueRegistry: DeferredIssueRegistry;
  timerRegistry?: TimerRegistry;
  capabilityInjector?: CapabilityInjector;
  taskTemplateRegistry?: TaskTemplateRegistry;
  taskDecomposer?: TaskDecomposer;
  maxConcurrent: number;
  markHumanInterrupt(agentId: string): void;
}

// ── CommandHandlerContext — CommandContext + shared mutable state ──────

export interface CommandHandlerContext extends CommandContext {
  delegations: Map<string, Delegation>;
  reportedCompletions: Set<string>;
  pendingSystemActions: Map<string, { type: string; value: number; agentId: string }>;
}

// ── CommandEntry — uniform return type from all modules ──────────────

export interface CommandEntry {
  regex: RegExp;
  name: string;
  handler: (agent: Agent, data: string) => void;
}
