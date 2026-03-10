import type { PreActionHook, GovernanceAction, HookContext, HookResult } from '../types.js';

/**
 * Simple glob-to-regex converter for basic patterns:
 * - `*` matches any characters within a segment (no /)
 * - `**` matches across directory segments
 * - `?` matches a single character
 * - Dot and other regex specials are escaped
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      // ** matches anything including /
      regexStr += '.*';
      i += 2;
      if (pattern[i] === '/') i++; // skip trailing slash after **
    } else if (ch === '*') {
      // * matches anything except /
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`);
}

/** Default protected file patterns */
const DEFAULT_PROTECTED_PATTERNS = [
  '.env*',
  '**/*.secret',
  'node_modules/**',
  '.git/**',
  'package-lock.json',
];

export interface FileWriteGuardConfig {
  protectedPatterns?: string[];
  /** Per-role overrides: pattern → allowed role IDs */
  allowedRoles?: Record<string, string[]>;
}

/**
 * FileWriteGuardHook (Priority 400)
 *
 * Blocks agents from writing to protected file paths.
 * Matches LOCK_FILE and COMMIT commands.
 */
export function createFileWriteGuardHook(config: FileWriteGuardConfig = {}): PreActionHook {
  const patterns = config.protectedPatterns ?? DEFAULT_PROTECTED_PATTERNS;
  const allowedRoles = config.allowedRoles ?? {};

  // Pre-compile glob patterns to regexes
  const compiledPatterns = patterns.map(p => ({
    glob: p,
    regex: globToRegex(p),
    allowedRoles: allowedRoles[p] || [],
  }));

  const FILE_COMMANDS = new Set(['LOCK_FILE', 'COMMIT']);

  function extractFilePaths(action: GovernanceAction): string[] {
    const paths: string[] = [];
    if (action.payload) {
      // LOCK_FILE has filePath
      if (typeof action.payload.filePath === 'string') {
        paths.push(action.payload.filePath);
      }
      // COMMIT may have files array
      if (Array.isArray(action.payload.files)) {
        for (const f of action.payload.files) {
          if (typeof f === 'string') paths.push(f);
        }
      }
    }
    return paths;
  }

  return {
    name: 'file-write-guard',
    priority: 400,

    match(action: GovernanceAction): boolean {
      return FILE_COMMANDS.has(action.commandName);
    },

    evaluate(action: GovernanceAction, _context: HookContext): HookResult {
      const filePaths = extractFilePaths(action);
      if (filePaths.length === 0) return { decision: 'allow' };

      for (const filePath of filePaths) {
        for (const pattern of compiledPatterns) {
          if (pattern.regex.test(filePath)) {
            // Check if role is allowed to bypass this pattern
            if (pattern.allowedRoles.includes(action.agent.roleId)) {
              continue;
            }
            return {
              decision: 'block',
              reason: `File write blocked: \`${filePath}\` matches protected pattern \`${pattern.glob}\`.${
                pattern.allowedRoles.length > 0
                  ? ` Only ${pattern.allowedRoles.join(', ')} role can modify this file.`
                  : ''
              }`,
              meta: { filePath, pattern: pattern.glob },
            };
          }
        }
      }

      return { decision: 'allow' };
    },
  };
}
