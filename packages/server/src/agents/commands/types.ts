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
import type { FileLockRegistry } from '../../coordination/files/FileLockRegistry.js';
import type { ActivityLedger } from '../../coordination/activity/ActivityLedger.js';
import type { MessageBus } from '../../comms/MessageBus.js';
import type { DecisionLog } from '../../coordination/decisions/DecisionLog.js';
import type { AgentMemory } from '../AgentMemory.js';
import type { ChatGroupRegistry } from '../../comms/ChatGroupRegistry.js';
import type { TaskDAG } from '../../tasks/TaskDAG.js';
import type { DeferredIssueRegistry } from '../../tasks/DeferredIssueRegistry.js';
import type { TimerRegistry } from '../../coordination/scheduling/TimerRegistry.js';
import type { CapabilityInjector } from '../capabilities/CapabilityInjector.js';
import type { TaskTemplateRegistry } from '../../tasks/TaskTemplates.js';
import type { TaskDecomposer } from '../../tasks/TaskDecomposer.js';
import type { GovernancePipeline } from '../../governance/GovernancePipeline.js';
import type { ActiveDelegationRepository } from '../../db/ActiveDelegationRepository.js';
import type { AgentRosterRepository } from '../../db/AgentRosterRepository.js';

// ── Delegation record ────────────────────────────────────────────────

import type { Delegation } from '@flightdeck/shared';
export type { Delegation, DelegationStatus } from '@flightdeck/shared';

// ── CommandContext — bridge from AgentManager ─────────────────────────

export interface CommandContext {
  getAgent(id: string): Agent | undefined;
  getAllAgents(): Agent[];
  getProjectIdForAgent(agentId: string): string | undefined;
  getRunningCount(): number;
  spawnAgent(role: Role, task?: string, parentId?: string, model?: string, cwd?: string, options?: { projectName?: string; projectId?: string; provider?: string }): Agent;
  terminateAgent(id: string): boolean | Promise<boolean>;
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
  governancePipeline?: GovernancePipeline;
  activeDelegationRepository?: ActiveDelegationRepository;
  agentRosterRepository?: AgentRosterRepository;
  integrationRouter?: import('../../integrations/IntegrationRouter.js').IntegrationRouter;
  providerManager?: import('../../providers/ProviderManager.js').ProviderManager;
  projectRegistry?: import('../../projects/ProjectRegistry.js').ProjectRegistry;
}

// ── CommandHandlerContext — CommandContext + shared mutable state ──────

export interface CommandHandlerContext extends CommandContext {
  delegations: Map<string, Delegation>;
  reportedCompletions: Set<string>;
  pendingSystemActions: Map<string, { type: string; value: number; agentId: string }>;
}

// ── CommandArg — structured argument metadata for help generation ─────

export interface CommandArg {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

// ── CommandEntry — uniform return type from all modules ──────────────

export interface CommandEntry {
  regex: RegExp;
  name: string;
  handler: (agent: Agent, data: string) => void;
  /** Help metadata — used to auto-generate the command help menu. */
  help?: {
    description: string;
    example: string;
    category: string;
    args?: CommandArg[];
  };
}
