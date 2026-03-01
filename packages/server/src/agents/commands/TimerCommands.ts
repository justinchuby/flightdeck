/**
 * Timer command handlers.
 *
 * Commands: SET_TIMER, CANCEL_TIMER, LIST_TIMERS
 */
import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import {
  parseCommandPayload,
  setTimerSchema,
  cancelTimerSchema,
} from './commandSchemas.js';

// ── Regex patterns ────────────────────────────────────────────────────

const SET_TIMER_REGEX = /⟦⟦\s*SET_TIMER\s*(\{.*?\})\s*⟧⟧/s;
const CANCEL_TIMER_REGEX = /⟦⟦\s*CANCEL_TIMER\s*(\{.*?\})\s*⟧⟧/s;
const LIST_TIMERS_REGEX = /⟦⟦\s*LIST_TIMERS\s*(?:\{.*?\})?\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleSetTimer(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(SET_TIMER_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], setTimerSchema, 'SET_TIMER');
    if (!req) return;

    const delay = req.delay;

    const timer = ctx.timerRegistry!.create(agent.id, {
      label: req.label,
      message: req.message,
      delaySeconds: delay,
      repeat: req.repeat === true,
    });

    if (!timer) {
      agent.sendMessage('[System] Timer limit reached (max 20 per agent). Cancel some timers first with CANCEL_TIMER.');
      return;
    }

    const repeatNote = timer.repeat ? ' (repeating)' : '';
    agent.sendMessage(`[System] Timer "${timer.label}" set — fires in ${delay}s${repeatNote}. ID: ${timer.id}`);
    logger.info('timer', `${agent.role.name} (${agent.id.slice(0, 8)}) set timer "${timer.label}" for ${delay}s${repeatNote}`);
  } catch (err) {
    logger.debug('command', 'Failed to parse SET_TIMER command', { error: (err as Error).message });
  }
}

function handleCancelTimer(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(CANCEL_TIMER_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], cancelTimerSchema, 'CANCEL_TIMER');
    if (!req) return;
    const timerId = (req.id || req.name)!;
    // timerId is guaranteed non-empty by the schema's refine check

    // Try by ID first, then by label
    let cancelled = ctx.timerRegistry!.cancel(timerId, agent.id);
    if (!cancelled) {
      // Search by label
      const agentTimers = ctx.timerRegistry!.getAgentTimers(agent.id);
      const byLabel = agentTimers.find(t => t.label === timerId);
      if (byLabel) {
        cancelled = ctx.timerRegistry!.cancel(byLabel.id, agent.id);
      }
    }

    if (cancelled) {
      agent.sendMessage(`[System] Timer cancelled: ${timerId}`);
    } else {
      agent.sendMessage(`[System] Timer not found: ${timerId}. Use LIST_TIMERS to see your active timers.`);
    }
  } catch (err) {
    logger.debug('command', 'Failed to parse CANCEL_TIMER command', { error: (err as Error).message });
  }
}

function handleListTimers(ctx: CommandHandlerContext, agent: Agent, _data: string): void {
  const isLeadOrSecretary = agent.role.id === 'lead' || agent.role.id === 'secretary';
  const timers = isLeadOrSecretary
    ? ctx.timerRegistry!.getAllTimers()
    : ctx.timerRegistry!.getAgentTimers(agent.id);

  if (timers.length === 0) {
    agent.sendMessage('[System] No active timers.');
    return;
  }

  const lines = timers.map(t => {
    const remaining = Math.max(0, Math.round((t.fireAt - Date.now()) / 1000));
    const repeat = t.repeat ? ' 🔁' : '';
    const owner = isLeadOrSecretary ? ` (${t.agentId.slice(0, 8)})` : '';
    return `  • ${t.label}${owner}: "${t.message.slice(0, 60)}" — ${remaining}s remaining${repeat}`;
  });

  agent.sendMessage(`[System] Active timers (${timers.length}):\n${lines.join('\n')}`);
}

// ── Module export ─────────────────────────────────────────────────────

export function getTimerCommands(ctx: CommandHandlerContext): CommandEntry[] {
  if (!ctx.timerRegistry) return [];
  return [
    { regex: SET_TIMER_REGEX, name: 'SET_TIMER', handler: (a, d) => handleSetTimer(ctx, a, d) },
    { regex: CANCEL_TIMER_REGEX, name: 'CANCEL_TIMER', handler: (a, d) => handleCancelTimer(ctx, a, d) },
    { regex: LIST_TIMERS_REGEX, name: 'LIST_TIMERS', handler: (a, d) => handleListTimers(ctx, a, d) },
  ];
}
