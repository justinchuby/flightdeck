/**
 * Pure helper functions for permission dialog logic.
 * Shared between server and client for testability.
 */

export function formatArgs(args: Record<string, any> | undefined): string {
  if (!args || typeof args !== 'object') return '{}';
  const json = JSON.stringify(args, null, 2);
  return json.length > 400 ? json.slice(0, 400) + '\n…' : json;
}

export function getToolIconName(toolName: string | undefined): 'file' | 'terminal' | 'shield' {
  if (!toolName) return 'shield';
  if (toolName.startsWith('fs/') || toolName.includes('file')) return 'file';
  if (toolName.startsWith('terminal/') || toolName.includes('command')) return 'terminal';
  return 'shield';
}

export function getToolSummary(
  toolName: string | undefined,
  args: Record<string, any> | undefined,
): string | null {
  if (!toolName || !args) return null;
  if (toolName.includes('write') && args.path) return args.path;
  if (toolName.includes('create') && args.command) return args.command;
  if (args.command) return args.command;
  if (args.path) return args.path;
  return null;
}
