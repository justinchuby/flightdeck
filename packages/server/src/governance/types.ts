import type { Agent } from '../agents/Agent.js';
import type { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';

/**
 * Represents a parsed command before it's dispatched to its handler.
 */
export interface GovernanceAction {
  /** Command name, e.g. 'CREATE_AGENT', 'LOCK_FILE', 'COMMIT' */
  commandName: string;
  /** The raw matched text including delimiters */
  rawText: string;
  /** Parsed JSON payload (if parseable), or null */
  payload: Record<string, unknown> | null;
  /** The agent that issued the command */
  agent: Readonly<{
    id: string;
    roleId: string;
    roleName: string;
    status: string;
    dagTaskId?: string;
  }>;
  /** Timestamp of the command */
  timestamp: number;
}

/**
 * Context available to hooks for making governance decisions.
 */
export interface HookContext {
  /** Look up any agent by ID */
  getAgent(id: string): Agent | undefined;
  /** All currently running agents */
  getAllAgents(): Agent[];
  /** Current count of running agents */
  getRunningCount(): number;
  /** Max concurrent agent limit */
  maxConcurrent: number;
  /** File lock registry for checking lock state */
  lockRegistry: FileLockRegistry;
  /** Task DAG for checking task state */
  taskDAG: TaskDAG;
  /** Project ID for the agent, if available */
  projectId?: string;
}

/**
 * Result of a hook evaluation.
 */
export type HookDecision = 'allow' | 'block' | 'modify';

export interface HookResult {
  decision: HookDecision;
  /** Human-readable reason (shown to agent when blocked) */
  reason?: string;
  /** Modified payload (only when decision === 'modify') */
  modifiedPayload?: Record<string, unknown>;
  /** Modified raw text (only when decision === 'modify') */
  modifiedText?: string;
  /** Metadata for audit logging */
  meta?: Record<string, unknown>;
}

/**
 * Pre-execution hook — evaluated BEFORE the command handler runs.
 * Must be synchronous (no async) to avoid blocking the dispatch loop.
 */
export interface PreActionHook {
  /** Unique hook name */
  name: string;
  /** Priority (lower runs first). Ranges: 0-99 Security, 100-199 Permission,
   *  200-299 Validation, 300-399 Rate limiting, 400-499 Policy, 500-599 Approval */
  priority: number;
  /** Fast check: does this hook apply to this action? */
  match(action: GovernanceAction): boolean;
  /** Evaluate the action. Must be synchronous. */
  evaluate(action: GovernanceAction, context: HookContext): HookResult;
}

/**
 * Post-execution hook — runs AFTER the command handler completes.
 * May be async (fire-and-forget, does not block pipeline).
 */
export interface PostActionHook {
  /** Unique hook name */
  name: string;
  /** Priority (lower runs first) */
  priority: number;
  /** Fast check: does this hook apply to this action? */
  match(action: GovernanceAction): boolean;
  /** Post-execution callback. May be async. */
  afterExecute(action: GovernanceAction, context: HookContext): void | Promise<void>;
}

/**
 * Configuration for the governance pipeline.
 */
export interface GovernancePipelineConfig {
  /** Enable/disable the entire pipeline (default: true) */
  enabled: boolean;
  /** File write guard configuration */
  fileWriteGuard?: {
    protectedPatterns: string[];
    allowedRoles?: Record<string, string[]>;
  };
  /** Shell command blocklist */
  shellBlocklist?: {
    blockedPatterns: Array<string | RegExp>;
  };
  /** Rate limiting */
  rateLimits?: Record<string, { maxPerMinute?: number; maxPerHour?: number }>;
  /** Approval gates */
  approvalGates?: Record<string, 'always' | 'when_limit_near'>;
  /** Commit message validation */
  commitValidation?: {
    minLength?: number;
    maxLength?: number;
    mustNotContain?: Array<string | RegExp>;
  };
  /** Permission overrides (extend default role-based rules) */
  permissionOverrides?: Record<string, { allowedRoles: string[]; respectCapabilities?: boolean }>;
}
