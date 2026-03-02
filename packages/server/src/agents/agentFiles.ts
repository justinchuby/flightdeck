import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Role } from './RoleRegistry.js';
import { logger } from '../utils/logger.js';

const AGENTS_DIR = join(homedir(), '.copilot', 'agents');
const PREFIX = 'flightdeck-';

/**
 * Build the .agent.md content for a role.
 * The system prompt becomes the agent's persistent instructions that survive
 * context compression in Copilot CLI.
 */
function buildAgentFile(role: Role): string {
  const lines = [
    '---',
    `name: ${PREFIX}${role.id}`,
    `description: "Flightdeck ${role.name}: ${role.description}"`,
    'tools:',
    '  - read',
    '  - edit',
    '  - search',
    '  - shell',
    '---',
    '',
    `# ${role.name} — Flightdeck Agent`,
    '',
    role.systemPrompt,
    '',
  ];
  return lines.join('\n');
}

/** Get the --agent flag value for a role */
export function agentFlagForRole(roleId: string): string {
  return `${PREFIX}${roleId}`;
}

const LEGACY_PREFIX = 'ai-crew-';

/** Remove leftover ai-crew-*.agent.md files so they don't shadow the new ones. */
function cleanupLegacyAgentFiles(): void {
  try {
    if (!existsSync(AGENTS_DIR)) return;
    for (const file of readdirSync(AGENTS_DIR)) {
      if (file.startsWith(LEGACY_PREFIX) && file.endsWith('.agent.md')) {
        unlinkSync(join(AGENTS_DIR, file));
      }
    }
  } catch {
    // Best-effort cleanup — don't block agent startup
  }
}

/**
 * Write .agent.md files for all provided roles into ~/.copilot/agents/.
 * Safe to call multiple times — overwrites existing files.
 * Also removes any legacy ai-crew-*.agent.md files to prevent duplicates.
 */
export function writeAgentFiles(roles: Role[]): void {
  try {
    if (!existsSync(AGENTS_DIR)) {
      mkdirSync(AGENTS_DIR, { recursive: true });
    }
    cleanupLegacyAgentFiles();
    for (const role of roles) {
      const filePath = join(AGENTS_DIR, `${PREFIX}${role.id}.agent.md`);
      writeFileSync(filePath, buildAgentFile(role), 'utf-8');
    }
    logger.info('agents', `Wrote ${roles.length} agent files to ${AGENTS_DIR}`);
  } catch (err: any) {
    logger.warn('agents', `Failed to write agent files: ${err.message}`);
  }
}
