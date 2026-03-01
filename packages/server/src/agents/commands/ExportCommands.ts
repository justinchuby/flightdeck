/**
 * Export command handlers.
 *
 * Commands: EXPORT_SESSION
 */
import { join } from 'path';
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';

// ── Regex patterns ────────────────────────────────────────────────────

const EXPORT_SESSION_REGEX = /⟦⟦\s*EXPORT_SESSION\s*(?:\{.*?\})?\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleExportSession(ctx: CommandHandlerContext, agent: Agent, _data: string): void {
  if (!ctx.sessionExporter) {
    agent.sendMessage('[System] Session exporter not available.');
    return;
  }

  // Only lead or secretary can export
  if (agent.role.id !== 'lead' && agent.role.id !== 'secretary') {
    agent.sendMessage('[System] EXPORT_SESSION is only available to lead and secretary roles.');
    return;
  }

  const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
  if (!leadId) {
    agent.sendMessage('[System] Could not determine lead ID for export.');
    return;
  }

  try {
    const outputDir = join(process.cwd(), '.ai-crew', 'exports');
    const result = ctx.sessionExporter.export(leadId, outputDir);
    agent.sendMessage(
      `[System] Session exported successfully.\n` +
      `  Path: ${result.outputDir}\n` +
      `  Files: ${result.files.length} (${result.agentCount} agents, ${result.eventCount} events)\n` +
      `  Contents: ${result.files.join(', ')}`,
    );
    logger.info('export', `Session exported by ${agent.role.name} (${agent.id.slice(0, 8)}): ${result.outputDir}`);
  } catch (err) {
    const message = (err as Error).message;
    agent.sendMessage(`[System] Export failed: ${message}`);
    logger.error('export', `Export failed for ${agent.role.name}: ${message}`);
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getExportCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: EXPORT_SESSION_REGEX, name: 'EXPORT_SESSION', handler: (a, d) => handleExportSession(ctx, a, d) },
  ];
}
