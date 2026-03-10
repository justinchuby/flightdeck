import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

/** Default blocked shell patterns */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?!tmp)/,       // rm -rf outside /tmp
  /git\s+push\s+--force/,        // force push
  /git\s+add\s+-A/,              // add all (picks up other agents' work)
  /curl.*\|\s*(?:bash|sh)/,      // pipe to shell
  /\bpkill\b/,                   // name-based process killing
  /\bkillall\b/,                 // name-based process killing
];

export interface ShellCommandBlocklistConfig {
  blockedPatterns?: Array<string | RegExp>;
}

/**
 * ShellCommandBlocklistHook (Priority 100)
 *
 * Blocks dangerous patterns in COMMIT commands. We can't intercept bash execution
 * directly (that happens in the Copilot CLI), but we can block commits that
 * contain known-dangerous shell invocations in their message or staged text.
 */
export function createShellCommandBlocklistHook(
  config: ShellCommandBlocklistConfig = {},
): PreActionHook {
  const patterns = (config.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS).map(p =>
    typeof p === 'string' ? new RegExp(p) : p,
  );

  return {
    name: 'shell-command-blocklist',
    priority: 100,

    match(action: GovernanceAction): boolean {
      // Match all commands — check raw text for dangerous patterns
      return true;
    },

    evaluate(action: GovernanceAction, _context: HookContext): HookResult {
      const textToCheck = action.rawText;

      for (const pattern of patterns) {
        if (pattern.test(textToCheck)) {
          return {
            decision: 'block',
            reason: `Blocked: command text contains dangerous pattern \`${pattern.source}\`. Rephrase or remove the shell command.`,
            meta: { blockedPattern: pattern.source },
          };
        }
      }

      return { decision: 'allow' };
    },
  };
}
