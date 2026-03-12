/**
 * CommandDispatcher — Thin router for ACP commands.
 *
 * Scans agent text buffers for ⟦⟦ COMMAND {...} ⟧⟧ patterns and dispatches
 * to handler modules. All command logic lives in ./commands/*.ts.
 *
 * This file owns: buffer management, the dispatch loop, and public API
 * wrappers that AgentManager calls.
 */
import type { Agent } from './Agent.js';
import { logger } from '../utils/logger.js';
import { runWithAgentContext } from '../middleware/requestContext.js';
import type { CommandEntry, CommandContext, CommandHandlerContext, Delegation } from './commands/types.js';
import { GovernancePipeline } from '../governance/GovernancePipeline.js';
import type { HookContext } from '../governance/types.js';
import { buildCommandHelp, getCommandExample, setRegisteredPatterns } from './commands/CommandHelp.js';
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
import { getSystemCommands } from './commands/SystemCommands.js';
import { getTimerCommands } from './commands/TimerCommands.js';
import { getCapabilityCommands } from './commands/CapabilityCommands.js';
import { getDirectMessageCommands } from './commands/DirectMessageCommands.js';
import { getTemplateCommands } from './commands/TemplateCommands.js';

export type { Delegation, CommandContext } from './commands/types.js';

// ── CommandDispatcher ────────────────────────────────────────────────

export class CommandDispatcher {
  private textBuffers: Map<string, string> = new Map();
  private handlerCtx: CommandHandlerContext;
  private patterns: CommandEntry[];
  private governance: GovernancePipeline | null;

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
      ...getSystemCommands(this.handlerCtx),
      ...getTimerCommands(this.handlerCtx),
      ...getCapabilityCommands(this.handlerCtx),
      ...getDirectMessageCommands(this.handlerCtx),
      // Template commands — only registered when services are provided
      ...(this.handlerCtx.taskTemplateRegistry && this.handlerCtx.taskDecomposer
        ? getTemplateCommands(this.handlerCtx, this.handlerCtx.taskTemplateRegistry, this.handlerCtx.taskDecomposer)
        : []),
    ];

    // Register patterns so CommandHelp can build help from live metadata
    setRegisteredPatterns(this.patterns);

    // Governance pipeline — optional, injected from container
    this.governance = ctx.governancePipeline ?? null;
  }

  /** Late-inject IntegrationRouter to break circular dependency. */
  setIntegrationRouter(router: import('../integrations/IntegrationRouter.js').IntegrationRouter): void {
    this.handlerCtx.integrationRouter = router;
  }

  /** Late-inject ProviderManager so QUERY_PROVIDERS sees live state. */
  setProviderManager(pm: import('../providers/ProviderManager.js').ProviderManager): void {
    this.handlerCtx.providerManager = pm;
  }

  /** Late-inject ProjectRegistry so commands can read project config. */
  setProjectRegistry(reg: import('../projects/ProjectRegistry.js').ProjectRegistry): void {
    this.handlerCtx.projectRegistry = reg;
  }

  // ── Buffer management ──────────────────────────────────────────────

  appendToBuffer(agentId: string, data: string): void {
    const buf = (this.textBuffers.get(agentId) || '') + data;
    this.textBuffers.set(agentId, buf);
  }

  clearBuffer(agentId: string): void {
    this.textBuffers.delete(agentId);
  }

  /** Build the HookContext snapshot for governance hooks */
  private buildHookContext(): HookContext {
    const ctx = this.handlerCtx;
    return {
      getAgent: (id) => ctx.getAgent(id),
      getAllAgents: () => ctx.getAllAgents(),
      getRunningCount: () => ctx.getRunningCount(),
      maxConcurrent: ctx.maxConcurrent,
      lockRegistry: ctx.lockRegistry,
      taskDAG: ctx.taskDAG,
    };
  }

  // ── Dispatch loop ──────────────────────────────────────────────────

  /**
   * Scan accumulated text buffer for complete command patterns.
   * When a pattern is found, execute it and remove it from the buffer.
   * Keep only trailing text that might be the start of a new command.
   */
  scanBuffer(agent: Agent): void {
    const buf = this.textBuffers.get(agent.id) || '';
    if (!buf) return;

    runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
      this._scanBufferInner(agent, buf);
    });
  }

  private _scanBufferInner(agent: Agent, initialBuf: string): void {
    let buf = initialBuf;
    let found = true;
    while (found) {
      found = false;
      // Find the leftmost match across ALL patterns to prevent inner ⟦⟦ from
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
        // Skip commands whose ⟦⟦ is nested inside another ⟦⟦ ⟧⟧ block
        if (CommandDispatcher.isInsideCommandBlock(buf, best.index)) {
          logger.debug({ module: 'command', msg: 'Skipped nested command', command: best.name });
          agent.sendMessage(
            `[System] Nested ${best.name} was stripped — it appeared inside another command's payload. ` +
            `To show command examples in text, refer to commands by name (e.g. "use the ${best.name} command") ` +
            `instead of including literal bracket delimiters.`,
          );
          buf = buf.slice(0, best.index) + buf.slice(best.end);
          found = true;
        } else {
          // ── Governance pre-hook evaluation ──
          if (this.governance?.enabled) {
            const action = GovernancePipeline.buildAction(best.name, best.text, agent);
            const hookCtx = this.buildHookContext();
            const hookResult = this.governance.evaluatePre(action, hookCtx);

            if (hookResult.decision === 'block') {
              agent.sendMessage(hookResult.reason || `[Governance] ${best.name} blocked by policy.`);
              buf = buf.slice(0, best.index) + buf.slice(best.end);
              found = true;
              continue;
            }

            // Apply modified text if hook rewrote the command
            if (hookResult.decision === 'modify' && hookResult.modifiedText) {
              best = { ...best, text: hookResult.modifiedText };
            }

            // Execute handler
            logger.debug({ module: 'command', msg: 'Command dispatched', command: best.name });
            try {
              best.handler(agent, best.text);
            } catch (err) {
              const errMsg = (err as Error).message;
              logger.error({ module: 'command', msg: 'Handler error', command: best.name, err: errMsg });
              const example = getCommandExample(best.name);
              const exampleHint = example ? `\nCorrect format: ${example}` : '';
              agent.sendMessage(`[System] ${best.name} failed: ${errMsg}${exampleHint}`);
            }

            // Post-hooks (fire-and-forget)
            this.governance.runPost(action, hookCtx);
          } else {
            // No governance pipeline — original path
            logger.debug({ module: 'command', msg: 'Command dispatched', command: best.name });
            try {
              best.handler(agent, best.text);
            } catch (err) {
              const errMsg = (err as Error).message;
              logger.error({ module: 'command', msg: 'Handler error', command: best.name, err: errMsg });
              const example = getCommandExample(best.name);
              const exampleHint = example ? `\nCorrect format: ${example}` : '';
              agent.sendMessage(`[System] ${best.name} failed: ${errMsg}${exampleHint}`);
            }
          }
          buf = buf.slice(0, best.index) + buf.slice(best.end);
          found = true;
        }
      }
    }

    // Detect unrecognized commands: ⟦⟦ UNKNOWN_WORD ... ⟧⟧ that didn't match any known pattern
    buf = CommandDispatcher.detectUnknownCommands(agent, buf, this.patterns);

    // Lead processed output — mark human message as responded
    if (agent.role.id === 'lead' && !agent.humanMessageResponded) {
      agent.humanMessageResponded = true;
    }

    // Keep only last 500 chars that might contain an incomplete command.
    // Cap buffer at 100KB to prevent unbounded growth when no closing bracket arrives.
    const MAX_BUFFER = 100_000;
    const lastOpen = buf.lastIndexOf('⟦⟦');
    if (lastOpen >= 0) {
      buf = buf.slice(lastOpen);
    } else if (buf.length > 500) {
      buf = buf.slice(-200);
    }
    if (buf.length > MAX_BUFFER) {
      buf = buf.slice(-MAX_BUFFER);
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

  // ── Static helpers ─────────────────────────────────────────────────

  /**
   * Check if a position in the buffer is nested inside a ⟦⟦ ⟧⟧ command block.
   * Only tracks JSON string state inside command blocks (depth > 0) to prevent:
   * - Command injection via task text containing ⟦⟦ delimiters (#26)
   * - Parsing ⟦⟦ inside JSON string values within command payloads
   * Quote characters in freeform agent text are ignored to avoid false positives
   * when agents use unmatched quotes in natural language output.
   */
  static isInsideCommandBlock(buf: string, pos: number): boolean {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < pos; i++) {
      const ch = buf[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }

      // Only track string state inside command blocks
      if (depth > 0) {
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
      }

      // Doubled brackets are the command delimiters
      if (buf[i] === '⟦' && buf[i + 1] === '⟦') {
        depth++;
        i++; // skip the second bracket
      } else if (buf[i] === '⟧' && buf[i + 1] === '⟧') {
        depth = Math.max(0, depth - 1);
        inString = false; // reset string state when exiting a block
        i++; // skip the second bracket
      }
    }
    return depth > 0;
  }

  /**
   * Detect unrecognized ⟦⟦ COMMAND ⟧⟧ blocks remaining in the buffer.
   * Sends a help message to the agent and strips the unrecognized block.
   */
  static detectUnknownCommands(agent: Agent, buf: string, knownPatterns: CommandEntry[]): string {
    // Match any complete ⟦⟦ WORD ... ⟧⟧ block
    const unknownRegex = /⟦⟦\s*([A-Z][A-Z0-9_]*)\s*(?:\{[\s\S]*?\})?\s*⟧⟧/;
    let match = unknownRegex.exec(buf);
    while (match && match.index !== undefined) {
      // Skip if inside a nested block or string
      if (CommandDispatcher.isInsideCommandBlock(buf, match.index)) {
        buf = buf.slice(0, match.index) + buf.slice(match.index + match[0].length);
        match = unknownRegex.exec(buf);
        continue;
      }
      const cmdName = match[1];
      logger.warn({ module: 'command', msg: 'Unknown command', command: cmdName });
      agent.sendMessage(
        `[System] Unknown command: ${cmdName}. Did you mean one of the available commands?\n\n${buildCommandHelp()}`,
      );
      buf = buf.slice(0, match.index) + buf.slice(match.index + match[0].length);
      match = unknownRegex.exec(buf);
    }
    return buf;
  }
}
