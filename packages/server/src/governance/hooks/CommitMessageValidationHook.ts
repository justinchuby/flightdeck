import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

export interface CommitMessageValidationConfig {
  minLength?: number;
  maxLength?: number;
  mustNotContain?: Array<string | RegExp>;
}

const DEFAULT_CONFIG: Required<CommitMessageValidationConfig> = {
  minLength: 10,
  maxLength: 500,
  mustNotContain: [/^fixup!/i, /^WIP\b/i, /^TODO\b/i],
};

/**
 * CommitMessageValidationHook (Priority 200)
 *
 * Enforces commit message conventions: minimum length, maximum length,
 * and banned patterns (e.g., WIP, TODO, fixup!).
 */
export function createCommitMessageValidationHook(
  config: CommitMessageValidationConfig = {},
): PreActionHook {
  const minLength = config.minLength ?? DEFAULT_CONFIG.minLength;
  const maxLength = config.maxLength ?? DEFAULT_CONFIG.maxLength;
  const mustNotContain = config.mustNotContain ?? DEFAULT_CONFIG.mustNotContain;

  return {
    name: 'commit-message-validation',
    priority: 200,

    match(action: GovernanceAction): boolean {
      return action.commandName === 'COMMIT';
    },

    evaluate(action: GovernanceAction, _context: HookContext): HookResult {
      const message = (action.payload?.message as string) || '';

      if (message.length < minLength) {
        return {
          decision: 'block',
          reason: `Commit message too short (${message.length} chars). Minimum: ${minLength} characters.`,
          meta: { messageLength: message.length, minLength },
        };
      }

      if (message.length > maxLength) {
        return {
          decision: 'block',
          reason: `Commit message too long (${message.length} chars). Maximum: ${maxLength} characters.`,
          meta: { messageLength: message.length, maxLength },
        };
      }

      for (const pattern of mustNotContain) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
        if (regex.test(message)) {
          return {
            decision: 'block',
            reason: `Commit message contains banned pattern: ${regex.source}. Please use a descriptive message.`,
            meta: { bannedPattern: regex.source },
          };
        }
      }

      return { decision: 'allow' };
    },
  };
}
