// Domain types — barrel export
export {
  type Branded,
  AgentId, ProjectId, SessionId, TaskId, MessageId, DelegationId, DecisionId,
  asAgentId, asProjectId, asSessionId, asTaskId, asMessageId, asDelegationId, asDecisionId,
  isValidId,
} from './entityIds.js';
export {
  PROVIDER_REGISTRY, PROVIDER_IDS, ACP_CAPABILITIES,
  getProvider, getAllProviders, isValidProviderId, getAcpCapabilities,
  type ProviderId, type ProviderDefinition, type ProviderColors,
  type ProviderLink, type ProviderTierModels, type AcpProviderCapabilities,
} from './provider.js';
export {
  SHORT_ID_LENGTH, shortAgentId,
  AgentStatusSchema, type AgentStatus,
  AgentPhaseSchema, type AgentPhase,
  isTerminalPhase, PHASE_TRANSITIONS, phaseToStatus,
  type HierarchyAgent, getCrewDescendants, getCrewMembers, isCrewDescendant,
} from './agent.js';
export { RoleSchema, type Role } from './role.js';
export {
  DagTaskStatusSchema, DagTaskSchema,
  type DagTaskStatus, type DagTask,
} from './task.js';
export {
  DelegationStatusSchema, DelegationSchema,
  type DelegationStatus, type Delegation,
} from './delegation.js';
export {
  ChatGroupSchema, GroupMessageSchema,
  type ChatGroup, type GroupMessage,
} from './group.js';
export {
  DecisionStatusSchema, DecisionCategorySchema, DecisionSchema,
  DECISION_CATEGORIES,
  type DecisionStatus, type DecisionCategory, type Decision,
} from './decision.js';
export {
  TimerStatusSchema, TimerSchema,
  type TimerStatus, type Timer,
} from './timer.js';
export {
  ProjectSchema, ProjectSessionSchema,
  type Project, type ProjectSession,
} from './project.js';
export {
  ActionTypeSchema, ActivityEntrySchema,
  type ActionType, type ActivityEntry,
} from './activity.js';
export {
  AlertSeveritySchema, AlertActionSchema, AlertSchema,
  type AlertSeverity, type AlertAction, type Alert,
} from './alert.js';
export { FileLockSchema, type FileLock } from './lock.js';
