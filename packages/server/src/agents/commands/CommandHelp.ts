/**
 * Command reference for the ACP system.
 *
 * Help text is built dynamically from CommandEntry.help metadata
 * co-located with each command's definition. This ensures adding a
 * new command automatically includes it in the help menu.
 */

import type { CommandEntry, CommandArg } from './types.js';

export interface CommandRef {
  name: string;
  description: string;
  example: string;
  args?: CommandArg[];
}

/** Category display order — unlisted categories appear at the end. */
const CATEGORY_ORDER = [
  'Agent Lifecycle',
  'Communication',
  'Groups',
  'Task DAG',
  'Coordination',
  'System',
  'Timers',
  'Capabilities',
  'Deferred Issues',
];

/**
 * The registered command patterns — set once by CommandDispatcher at init.
 * Allows buildCommandHelp/getCommandExample to read from the live registry.
 */
let registeredPatterns: CommandEntry[] = [];

/** Called by CommandDispatcher to register patterns for help generation. */
export function setRegisteredPatterns(patterns: CommandEntry[]): void {
  registeredPatterns = patterns;
}

/** Build grouped reference from registered patterns' help metadata. */
function buildReferenceFromPatterns(patterns: CommandEntry[]): Record<string, CommandRef[]> {
  const grouped: Record<string, CommandRef[]> = {};
  const seen = new Set<string>();

  for (const entry of patterns) {
    if (!entry.help) continue;
    // Deduplicate aliases (e.g. QUERY_TASKS is an alias for TASK_STATUS)
    const key = entry.help.example;
    if (seen.has(key)) continue;
    seen.add(key);

    const cat = entry.help.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      name: entry.name,
      description: entry.help.description,
      example: entry.help.example,
      args: entry.help.args,
    });
  }

  // Sort categories by CATEGORY_ORDER, then alphabetical for unlisted ones
  const ordered: Record<string, CommandRef[]> = {};
  for (const cat of CATEGORY_ORDER) {
    if (grouped[cat]) {
      ordered[cat] = grouped[cat];
      delete grouped[cat];
    }
  }
  for (const cat of Object.keys(grouped).sort()) {
    ordered[cat] = grouped[cat];
  }
  return ordered;
}

/** Format argument list: `<name: type>` for required, `[name: type = default]` for optional. */
function formatArgs(args: CommandArg[]): string {
  return args.map(a => {
    if (a.required) {
      return `<${a.name}: ${a.type}>`;
    }
    const def = a.default !== undefined ? ` = ${a.default}` : '';
    return `[${a.name}: ${a.type}${def}]`;
  }).join(' ');
}

/** Build a formatted help text listing all available commands. */
export function buildCommandHelp(): string {
  const ref = buildReferenceFromPatterns(registeredPatterns);
  const lines: string[] = ['[System] Available commands:\n'];

  for (const [category, commands] of Object.entries(ref)) {
    lines.push(`== ${category} ==`);
    for (const cmd of commands) {
      lines.push(`  ${cmd.name} — ${cmd.description}`);
      if (cmd.args && cmd.args.length > 0) {
        lines.push(`    Args: ${formatArgs(cmd.args)}`);
      }
      lines.push(`    ${cmd.example}`);
    }
    lines.push('');
  }

  lines.push('All commands use the format: COMMAND_NAME {json_payload}');
  lines.push('');
  lines.push('== Escaping ==');
  lines.push('Do NOT include literal command brackets in messages or task descriptions.');
  lines.push('Refer to commands by name: "use COMMIT when done" or "run QUERY_CREW".');
  return lines.join('\n');
}

/** Get the example for a specific command. Returns undefined if not found. */
export function getCommandExample(commandName: string): string | undefined {
  const upper = commandName.toUpperCase();
  for (const entry of registeredPatterns) {
    if (entry.help && entry.name.toUpperCase() === upper) return entry.help.example;
  }
  return undefined;
}
