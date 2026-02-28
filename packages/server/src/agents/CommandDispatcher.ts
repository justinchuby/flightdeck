/**
 * CommandDispatcher — Thin router for ACP commands.
 *
 * Scans agent text buffers for [[[ COMMAND {...} ]]] patterns and dispatches
 * to handler modules. All command logic lives in ./commands/*.ts.
 *
 * This file owns: buffer management, the dispatch loop, and public API
 * wrappers that AgentManager calls.
 */
import type { Agent } from './Agent.js';
import { logger } from '../utils/logger.js';
import type { CommandEntry, CommandContext, CommandHandlerContext, Delegation } from './commands/types.js';
import {
  getAgentCommands,
  notifyParentOfIdle as _notifyParentOfIdle,
  notifyParentOfCompletion as _notifyParentOfCompletion,
  getDelegations as _getDelegations,
  completeDelegationsForAgent as _completeDelegationsForAgent,
  cleanupStaleDelegations as _cleanupStaleDelegations,
  clearCompletionTracking as _clearCompletionTracking,
} from './commands/AgentCommands.js';
import { getCommCommands } from './commands/CommCommands.js';
import { getTaskCommands } from './commands/TaskCommands.js';
import { getCoordCommands } from './commands/CoordCommands.js';
import { getDeferredCommands } from './commands/DeferredCommands.js';
import { getSystemCommands } from './commands/SystemCommands.js';
import { getTimerCommands } from './commands/TimerCommands.js';
import { getExportCommands } from './commands/ExportCommands.js';
import { getCapabilityCommands } from './commands/CapabilityCommands.js';
import { getDirectMessageCommands } from './commands/DirectMessageCommands.js';
import { getTemplateCommands } from './commands/TemplateCommands.js';

// Re-export types for backward compatibility (AgentManager, HeartbeatMonitor import from here)
export type { Delegation, CommandContext } from './commands/types.js';

// ── CommandDispatcher ────────────────────────────────────────────────

export class CommandDispatcher {
  private textBuffers: Map<string, string> = new Map();
  private handlerCtx: CommandHandlerContext;
  private patterns: CommandEntry[];

  constructor(ctx: CommandContext) {
    // Build the extended handler context with shared mutable state
    const delegations = new Map<string, Delegation>();
    const reportedCompletions = new Set<string>();
    const pendingSystemActions = new Map<string, { type: string; value: number; agentId: string }>();

    this.handlerCtx = Object.assign(Object.create(null), ctx, {
      delegations,
      reportedCompletions,
      pendingSystemActions,
    }) as CommandHandlerContext;

    // Proxy mutable properties so modules see live values
    Object.defineProperty(this.handlerCtx, 'maxConcurrent', {
      get: () => ctx.maxConcurrent,
      set: (v: number) => { ctx.maxConcurrent = v; },
    });

    // Assemble the dispatch table ONCE at construction time
    this.patterns = [
      ...getAgentCommands(this.handlerCtx),
      ...getCommCommands(this.handlerCtx),
      ...getTaskCommands(this.handlerCtx),
      ...getCoordCommands(this.handlerCtx),
      ...getDeferredCommands(this.handlerCtx),
      ...getSystemCommands(this.handlerCtx),
      ...getTimerCommands(this.handlerCtx),
      ...getExportCommands(this.handlerCtx),
      ...getCapabilityCommands(this.handlerCtx),
      ...getDirectMessageCommands(this.handlerCtx),
      // Template commands — only registered when services are provided
      ...(this.handlerCtx.taskTemplateRegistry && this.handlerCtx.taskDecomposer
        ? getTemplateCommands(this.handlerCtx, this.handlerCtx.taskTemplateRegistry, this.handlerCtx.taskDecomposer)
        : []),
    ];
  }

  // ── Buffer management ──────────────────────────────────────────────

  appendToBuffer(agentId: string, data: string): void {
    const buf = (this.textBuffers.get(agentId) || '') + data;
    this.textBuffers.set(agentId, buf);
  }

  clearBuffer(agentId: string): void {
    this.textBuffers.delete(agentId);
  }

  // ── Dispatch loop ──────────────────────────────────────────────────

  /**
   * Scan accumulated text buffer for complete command patterns.
   * When a pattern is found, execute it and remove it from the buffer.
   * Keep only trailing text that might be the start of a new command.
   */
  scanBuffer(agent: Agent): void {
    let buf = this.textBuffers.get(agent.id) || '';
    if (!buf) return;

    let found = true;
    while (found) {
      found = false;
      // Find the leftmost match across ALL patterns to prevent inner [[[ from
      // being parsed before the outer command that contains them (issue #26).
      let best: { index: number; end: number; name: string; handler: (a: Agent, d: string) => void; text: string } | null = null;
      for (const { regex, name, handler } of this.patterns) {
        const match = buf.match(regex);
        if (match && match.index !== undefined) {
          if (!best || match.index < best.index) {
            best = { index: match.index, end: match.index + match[0].length, name, handler, text: match[0] };
          }
        }
      }
      if (best) {
        // Skip commands whose [[[ is nested inside another [[[ ]]] block
        if (CommandDispatcher.isInsideCommandBlock(buf, best.index)) {
          logger.debug('agent', `Skipped nested command: ${best.name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
          buf = buf.slice(0, best.index) + buf.slice(best.end);
          found = true;
        } else {
          logger.debug('agent', `Command: ${best.name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
          try {
            best.handler(agent, best.text);
          } catch (err) {
            logger.error('command', `Handler error for ${best.name} from ${agent.role.name}: ${(err as Error).message}`);
          }
          buf = buf.slice(0, best.index) + buf.slice(best.end);
          found = true;
        }
      }
    }

    // Lead processed output — mark human message as responded
    if (agent.role.id === 'lead' && !agent.humanMessageResponded) {
      agent.humanMessageResponded = true;
    }

    // Keep only last 500 chars that might contain an incomplete command
    const lastOpen = buf.lastIndexOf('[[[');
    if (lastOpen >= 0) {
      buf = buf.slice(lastOpen);
    } else if (buf.length > 500) {
      buf = buf.slice(-200);
    }
    this.textBuffers.set(agent.id, buf);
  }

  // ── Public API (delegates to command modules) ──────────────────────

  notifyParentOfIdle(agent: Agent): void {
    _notifyParentOfIdle(this.handlerCtx, agent);
  }

  notifyParentOfCompletion(agent: Agent, exitCode: number | null): void {
    _notifyParentOfCompletion(this.handlerCtx, agent, exitCode);
  }

  getDelegations(parentId?: string): Delegation[] {
    return _getDelegations(this.handlerCtx, parentId);
  }

  getDelegationsMap(): Map<string, Delegation> {
    return this.handlerCtx.delegations;
  }

  clearCompletionTracking(agentId: string): void {
    _clearCompletionTracking(this.handlerCtx, agentId);
  }

  completeDelegationsForAgent(agentId: string): void {
    _completeDelegationsForAgent(this.handlerCtx, agentId);
  }

  cleanupStaleDelegations(maxAgeMs = 300_000): number {
    return _cleanupStaleDelegations(this.handlerCtx, maxAgeMs);
  }

  consumePendingSystemAction(decisionId: string): { type: string; value: number; agentId: string } | undefined {
    const action = this.handlerCtx.pendingSystemActions.get(decisionId);
    if (action) this.handlerCtx.pendingSystemActions.delete(decisionId);
    return action;
  }

  /** Late-bind sessionExporter (created after AgentManager due to circular dep) */
  setSessionExporter(exporter: import('../coordination/SessionExporter.js').SessionExporter): void {
    this.handlerCtx.sessionExporter = exporter;
  }

  // ── Static helpers ─────────────────────────────────────────────────

  /**
   * Check if a position in the buffer is nested inside a [[[ ]]] command block.
   * Counts unmatched [[[ before the given position — depth > 0 means nested.
   * This prevents command injection via task text containing [[[ delimiters (#26).
   */
  static isInsideCommandBlock(buf: string, pos: number): boolean {
    let depth = 0;
    for (let i = 0; i < pos - 2; i++) {
      if (buf[i] === '[' && buf[i + 1] === '[' && buf[i + 2] === '[') {
        depth++;
        i += 2;
      } else if (buf[i] === ']' && buf[i + 1] === ']' && buf[i + 2] === ']') {
        depth = Math.max(0, depth - 1);
        i += 2;
      }
    }
    return depth > 0;
  }
}
