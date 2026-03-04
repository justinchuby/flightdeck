/**
 * Capability command handlers.
 *
 * Commands: ACQUIRE_CAPABILITY, LIST_CAPABILITIES, RELEASE_CAPABILITY
 *
 * Lets agents acquire additional capabilities beyond their core role.
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { parseCommandPayload, acquireCapabilitySchema, releaseCapabilitySchema } from './commandSchemas.js';
import { deriveArgs } from './CommandHelp.js';

// ── Regex patterns ────────────────────────────────────────────────────

const ACQUIRE_REGEX = /⟦⟦\s*ACQUIRE_CAPABILITY\s*(\{.*?\})\s*⟧⟧/s;
const LIST_REGEX = /⟦⟦\s*LIST_CAPABILITIES\s*⟧⟧/s;
const RELEASE_REGEX = /⟦⟦\s*RELEASE_CAPABILITY\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleAcquire(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  if (!ctx.capabilityInjector) {
    agent.sendMessage('[System] Capability system not available.');
    return;
  }
  const match = data.match(ACQUIRE_REGEX);
  if (!match) return;
  const parsed = parseCommandPayload(agent, match[1], acquireCapabilitySchema, 'ACQUIRE_CAPABILITY');
  if (!parsed) return;
  try {
    const { ok, message } = ctx.capabilityInjector.acquire(
      agent,
      parsed.capability,
      parsed.reason || 'No reason given',
      ctx.activityLedger,
    );
    agent.sendMessage(`[System] ${message}`);
  } catch {
    agent.sendMessage(
      '[System] ACQUIRE_CAPABILITY error: use {"capability": "code-review", "reason": "..."}',
    );
  }
}

function handleList(ctx: CommandHandlerContext, agent: Agent): void {
  if (!ctx.capabilityInjector) {
    agent.sendMessage('[System] Capability system not available.');
    return;
  }
  const all = ctx.capabilityInjector.getAllDefinitions();
  const acquired = ctx.capabilityInjector.getAgentCapabilities(agent.id);

  let msg = '== Available Capabilities ==\n';
  for (const cap of all) {
    const status = acquired.includes(cap.id) ? '✅' : '⬜';
    msg += `${status} **${cap.name}** (${cap.id}) — ${cap.description}`;
    if (cap.gatedCommands?.length) msg += ` [unlocks: ${cap.gatedCommands.join(', ')}]`;
    msg += '\n';
  }
  if (acquired.length > 0) {
    msg += `\nYour capabilities: ${acquired.join(', ')}`;
  }
  agent.sendMessage(`[System]\n${msg}`);
}

function handleRelease(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(RELEASE_REGEX);
  if (!match) return;
  const parsed = parseCommandPayload(agent, match[1], releaseCapabilitySchema, 'RELEASE_CAPABILITY');
  if (!parsed) return;
  // Not critical for v1 — just acknowledge
  agent.sendMessage(
    '[System] Capabilities are retained for the session. They will be cleared on termination.',
  );
}

// ── Exported: command entry list ──────────────────────────────────────

export function getCapabilityCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    {
      regex: ACQUIRE_REGEX,
      name: 'ACQUIRE_CAPABILITY',
      handler: (a, d) => handleAcquire(ctx, a, d),
      help: { description: 'Acquire a capability beyond your role', example: 'ACQUIRE_CAPABILITY {"capability": "code-review", "reason": "found bug"}', category: 'Capabilities', args: deriveArgs(acquireCapabilitySchema) },
    },
    {
      regex: LIST_REGEX,
      name: 'LIST_CAPABILITIES',
      handler: (a) => handleList(ctx, a),
      help: { description: 'List your current capabilities', example: 'LIST_CAPABILITIES {}', category: 'Capabilities' },
    },
    {
      regex: RELEASE_REGEX,
      name: 'RELEASE_CAPABILITY',
      handler: (a, d) => handleRelease(ctx, a, d),
      help: { description: 'Release an acquired capability', example: 'RELEASE_CAPABILITY {"capability": "code-review"}', category: 'Capabilities', args: deriveArgs(releaseCapabilitySchema) },
    },
  ];
}
