import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

/**
 * Default permission rules: which roles can execute which commands.
 * 'respectCapabilities' means an agent with an acquired capability gets access.
 */
const DEFAULT_PERMISSION_RULES: Record<string, { allowedRoles: string[]; respectCapabilities?: boolean }> = {
  CREATE_AGENT: { allowedRoles: ['lead', 'architect'], respectCapabilities: true },
  DELEGATE: { allowedRoles: ['lead', 'architect'], respectCapabilities: true },
  TERMINATE_AGENT: { allowedRoles: ['lead'] },
  RESET_DAG: { allowedRoles: ['lead'] },
  REQUEST_LIMIT_CHANGE: { allowedRoles: ['lead'] },
  DECLARE_TASKS: { allowedRoles: ['lead'] },
  BROADCAST: { allowedRoles: ['lead', 'architect'] },
};

export interface PermissionHookConfig {
  rules?: Record<string, { allowedRoles: string[]; respectCapabilities?: boolean }>;
  /** Optional capability checker — returns true if the agent has acquired the command capability */
  hasCapability?: (agentId: string, commandName: string) => boolean;
}

/**
 * PermissionHook (Priority 100)
 *
 * Consolidates scattered role-based permission checks into a single hook.
 * Replaces ad-hoc checks in handleCreateAgent, handleDelegate, etc.
 */
export function createPermissionHook(config: PermissionHookConfig = {}): PreActionHook {
  const rules = { ...DEFAULT_PERMISSION_RULES, ...config.rules };
  const commandsWithRules = new Set(Object.keys(rules));

  return {
    name: 'permission',
    priority: 100,

    match(action: GovernanceAction): boolean {
      return commandsWithRules.has(action.commandName);
    },

    evaluate(action: GovernanceAction, _context: HookContext): HookResult {
      const rule = rules[action.commandName];
      if (!rule) return { decision: 'allow' };

      const { roleId } = action.agent;

      // Check role-based access
      if (rule.allowedRoles.includes(roleId)) {
        return { decision: 'allow' };
      }

      // Check capability-based access
      if (rule.respectCapabilities && config.hasCapability) {
        if (config.hasCapability(action.agent.id, action.commandName)) {
          return { decision: 'allow' };
        }
      }

      return {
        decision: 'block',
        reason: `${action.commandName} requires role: ${rule.allowedRoles.join(' or ')}. Your role: ${action.agent.roleName}.`,
        meta: { requiredRoles: rule.allowedRoles, actualRole: roleId },
      };
    },
  };
}
