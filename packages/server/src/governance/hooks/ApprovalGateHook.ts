import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

export interface ApprovalGateConfig {
  /** Commands requiring approval and when */
  requireApproval?: Record<string, 'always' | 'when_limit_near'>;
  /** Threshold for 'when_limit_near' (0.0 - 1.0, default 0.8) */
  limitThreshold?: number;
  /** Callback when a command is gated — creates a decision for user */
  onGate?: (action: GovernanceAction, reason: string) => void;
}

const DEFAULT_GATES: Record<string, 'always' | 'when_limit_near'> = {
  TERMINATE_AGENT: 'always',
  RESET_DAG: 'always',
  REQUEST_LIMIT_CHANGE: 'always',
  CREATE_AGENT: 'when_limit_near',
};

/**
 * ApprovalGateHook (Priority 500)
 *
 * Requires human approval for high-impact commands.
 * When triggered: blocks the command, queues it for approval, notifies the agent.
 *
 * Pending approvals are stored in memory. When a user approves,
 * the command is replayed through the dispatcher.
 */
export function createApprovalGateHook(config: ApprovalGateConfig = {}): PreActionHook & {
  /** Pending approval entries */
  getPending(): Array<{ id: string; action: GovernanceAction; reason: string; timestamp: number }>;
  /** Approve a pending command by ID */
  approve(id: string): GovernanceAction | undefined;
  /** Reject a pending command by ID */
  reject(id: string): GovernanceAction | undefined;
} {
  const gates = { ...DEFAULT_GATES, ...config.requireApproval };
  const limitThreshold = config.limitThreshold ?? 0.8;
  const commandsWithGates = new Set(Object.keys(gates));

  const pendingApprovals = new Map<
    string,
    { id: string; action: GovernanceAction; reason: string; timestamp: number }
  >();

  let nextId = 1;

  function generateId(): string {
    return `approval-${nextId++}`;
  }

  const hook: PreActionHook & {
    getPending(): Array<{ id: string; action: GovernanceAction; reason: string; timestamp: number }>;
    approve(id: string): GovernanceAction | undefined;
    reject(id: string): GovernanceAction | undefined;
  } = {
    name: 'approval-gate',
    priority: 500,

    match(action: GovernanceAction): boolean {
      return commandsWithGates.has(action.commandName);
    },

    evaluate(action: GovernanceAction, context: HookContext): HookResult {
      const gateType = gates[action.commandName];
      if (!gateType) return { decision: 'allow' };

      if (gateType === 'when_limit_near') {
        const ratio = context.getRunningCount() / context.maxConcurrent;
        if (ratio < limitThreshold) {
          return { decision: 'allow' };
        }
      }

      // Gate triggered — queue for approval
      const id = generateId();
      const reason =
        gateType === 'always'
          ? `${action.commandName} requires human approval.`
          : `${action.commandName} requires approval (${context.getRunningCount()}/${context.maxConcurrent} agents, threshold: ${Math.round(limitThreshold * 100)}%).`;

      pendingApprovals.set(id, {
        id,
        action,
        reason,
        timestamp: Date.now(),
      });

      config.onGate?.(action, reason);

      return {
        decision: 'block',
        reason: `This action requires approval. A decision has been created (ID: ${id}).`,
        meta: { approvalId: id, gateType },
      };
    },

    getPending() {
      return [...pendingApprovals.values()];
    },

    approve(id: string) {
      const entry = pendingApprovals.get(id);
      if (!entry) return undefined;
      pendingApprovals.delete(id);
      return entry.action;
    },

    reject(id: string) {
      const entry = pendingApprovals.get(id);
      if (!entry) return undefined;
      pendingApprovals.delete(id);
      return entry.action;
    },
  };

  return hook;
}
