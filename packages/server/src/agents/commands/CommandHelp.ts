/**
 * Command reference for the ACP system.
 *
 * Help text is built dynamically from CommandEntry.help metadata
 * co-located with each command's definition. This ensures adding a
 * new command automatically includes it in the help menu.
 */

import type { CommandEntry, CommandArg } from './types.js';
import { z } from 'zod';

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

// ── Zod→CommandArg derivation ────────────────────────────────────────

// Zod internal _def access — these are runtime properties not exposed in types
type ZodDef = Record<string, any>;

/** Unwrap optional/nullable/default wrappers to get the inner Zod type. */
function unwrapOptional(field: z.ZodType): z.ZodType {
  const def = field._def as ZodDef;
  if (def?.type === 'optional' || def?.type === 'nullable' || def?.type === 'default') {
    return unwrapOptional(def.innerType);
  }
  return field;
}

/** Get the description from a Zod field, checking outer wrapper and inner type. */
function getDescription(field: z.ZodType): string | undefined {
  if (field.description) return field.description;
  const def = field._def as ZodDef;
  if (def?.type === 'optional' || def?.type === 'nullable' || def?.type === 'default') {
    return def.innerType?.description;
  }
  return undefined;
}

/** Extract the default value from a ZodDefault wrapper, if present. */
function getDefaultValue(field: z.ZodType): string | undefined {
  const def = field._def as ZodDef;
  if (def?.type === 'default') {
    return String(def.defaultValue);
  }
  if (def?.type === 'optional' || def?.type === 'nullable') {
    return getDefaultValue(def.innerType);
  }
  return undefined;
}

/** Derive a human-readable type name from a Zod field. */
function deriveTypeName(field: z.ZodType): string {
  const inner = unwrapOptional(field);
  const def = inner._def as ZodDef;
  const defType = def?.type as string | undefined;

  switch (defType) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return 'array';
    case 'record': return 'object';
    case 'enum': return 'string';
    case 'union': {
      const options = def.options as z.ZodType[] | undefined;
      if (options) {
        const types = options.map((o: z.ZodType) => (o._def as ZodDef)?.type as string).filter(Boolean);
        const unique = [...new Set(types)];
        return unique.join(' | ') || 'unknown';
      }
      return 'unknown';
    }
    case 'pipe': {
      const input = def.in as z.ZodType | undefined;
      if (input) return deriveTypeName(input);
      return 'unknown';
    }
    default: return defType || 'unknown';
  }
}

/**
 * Derive CommandArg[] from a Zod object schema.
 * Walks schema.shape and extracts name, type, required, and description for each field.
 */
export function deriveArgs(schema: z.ZodObject<any>): CommandArg[] {
  // Handle .refine() wrappers — get the underlying object schema
  const shape = schema.shape as Record<string, z.ZodType>;
  const args: CommandArg[] = [];

  for (const [name, field] of Object.entries(shape)) {
    const defaultVal = getDefaultValue(field);
    const arg: CommandArg = {
      name,
      type: deriveTypeName(field),
      required: !field.isOptional(),
      description: getDescription(field) ?? name,
    };
    if (defaultVal !== undefined) arg.default = defaultVal;
    args.push(arg);
  }

  return args;
}

/**
 * Convenience: derive help metadata from a Zod schema.
 * Returns { description, args, category } — spread into CommandEntry.help.
 * Example: `help: { ...deriveHelp(schema, 'Send a message', 'Communication'), example: '...' }`
 */
export function deriveHelp(
  schema: z.ZodObject<any>,
  description: string,
  category: string,
): { description: string; args: CommandArg[]; category: string } {
  return { description, args: deriveArgs(schema), category };
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

// ── Lead-only commands (excluded from non-lead reminders) ────────────

const LEAD_ONLY_COMMANDS = new Set([
  'DECLARE_TASKS', 'ADD_TASK', 'ASSIGN_TASK', 'REASSIGN_TASK',
  'CANCEL_TASK', 'RESET_DAG', 'FORCE_READY', 'PAUSE_TASK',
  'RESUME_TASK', 'RETRY_TASK', 'REOPEN_TASK', 'SKIP_TASK',
  'SPAWN_AGENT', 'TERMINATE_AGENT',
]);

/**
 * Build a compact command reminder grouped by category.
 * Each entry: `  NAME example — description`
 *
 * When role is provided and is not 'lead', lead-only commands are excluded.
 */
export function buildCommandReminder(role?: string): string {
  const isLead = !role || role === 'lead';
  const filtered = isLead
    ? registeredPatterns
    : registeredPatterns.filter((e) => !LEAD_ONLY_COMMANDS.has(e.name));

  const ref = buildReferenceFromPatterns(filtered);
  const lines: string[] = ['[System] Command Reference Reminder — available commands:', ''];

  for (const [category, commands] of Object.entries(ref)) {
    lines.push(`== ${category} ==`);
    for (const cmd of commands) {
      lines.push(`  ${cmd.name} ${cmd.example} — ${cmd.description}`);
    }
    lines.push('');
  }

  lines.push('Use these commands directly in your text response (not inside tool calls).');
  return lines.join('\n');
}
