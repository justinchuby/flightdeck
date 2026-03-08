import { logger } from '../utils/logger.js';
import type {
  GovernanceAction,
  HookContext,
  HookResult,
  PreActionHook,
  PostActionHook,
  GovernancePipelineConfig,
} from './types.js';

/**
 * GovernancePipeline — single interception point for all command governance.
 *
 * Pre-hooks run synchronously before handler dispatch (security → permission →
 * validation → rate-limit → policy → approval order, controlled by priority).
 *
 * Post-hooks fire asynchronously after handler completes (audit, metrics).
 */
export class GovernancePipeline {
  private preHooks: PreActionHook[] = [];
  private postHooks: PostActionHook[] = [];
  private readonly config: GovernancePipelineConfig;

  constructor(config: Partial<GovernancePipelineConfig> = {}) {
    this.config = { enabled: true, ...config };
  }

  /** Whether the pipeline is active */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Toggle pipeline on/off at runtime */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Register a pre-execution hook. Hooks are sorted by priority (lower first).
   */
  registerPreHook(hook: PreActionHook): void {
    this.preHooks.push(hook);
    this.preHooks.sort((a, b) => a.priority - b.priority);
    logger.debug({ module: 'governance', msg: 'Registered pre-hook', hookName: hook.name, priority: hook.priority });
  }

  /**
   * Register a post-execution hook. Hooks are sorted by priority (lower first).
   */
  registerPostHook(hook: PostActionHook): void {
    this.postHooks.push(hook);
    this.postHooks.sort((a, b) => a.priority - b.priority);
    logger.debug({ module: 'governance', msg: 'Registered post-hook', hookName: hook.name, priority: hook.priority });
  }

  /** Remove a pre-hook by name */
  removePreHook(name: string): boolean {
    const idx = this.preHooks.findIndex(h => h.name === name);
    if (idx === -1) return false;
    this.preHooks.splice(idx, 1);
    return true;
  }

  /** Remove a post-hook by name */
  removePostHook(name: string): boolean {
    const idx = this.postHooks.findIndex(h => h.name === name);
    if (idx === -1) return false;
    this.postHooks.splice(idx, 1);
    return true;
  }

  /** Get registered pre-hook names (for debugging/inspection) */
  getPreHookNames(): string[] {
    return this.preHooks.map(h => h.name);
  }

  /** Get registered post-hook names (for debugging/inspection) */
  getPostHookNames(): string[] {
    return this.postHooks.map(h => h.name);
  }

  /**
   * Evaluate all pre-hooks for an action. Returns early on first block/modify.
   *
   * MUST be synchronous — called inside CommandDispatcher's buffer scan loop.
   */
  evaluatePre(action: GovernanceAction, context: HookContext): HookResult {
    if (!this.config.enabled) {
      return { decision: 'allow' };
    }

    for (const hook of this.preHooks) {
      if (!hook.match(action)) continue;

      try {
        const result = hook.evaluate(action, context);

        if (result.decision === 'block') {
          logger.info({ module: 'governance', msg: 'Hook blocked command', hookName: hook.name, command: action.commandName, targetAgentId: action.agent.id, reason: result.reason });
          return result;
        }

        if (result.decision === 'modify') {
          logger.debug({ module: 'governance', msg: 'Hook modified command', hookName: hook.name, command: action.commandName, targetAgentId: action.agent.id });
          return result;
        }
        // decision === 'allow' → continue to next hook
      } catch (err) {
        // Hook errors should not crash the dispatch loop. Log and continue.
        logger.error({ module: 'governance', msg: 'Pre-hook threw', hookName: hook.name, command: action.commandName, targetAgentId: action.agent.id, err: (err as Error).message });
        // Fail-open: a broken hook should not block all commands
      }
    }

    return { decision: 'allow' };
  }

  /**
   * Run all post-hooks for an action. Fire-and-forget (async, non-blocking).
   */
  runPost(action: GovernanceAction, context: HookContext): void {
    if (!this.config.enabled) return;

    for (const hook of this.postHooks) {
      if (!hook.match(action)) continue;

      try {
        const result = hook.afterExecute(action, context);
        // If the hook returns a promise, catch unhandled rejections
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(err => {
            logger.error({ module: 'governance', msg: 'Post-hook async error', hookName: hook.name, command: action.commandName, targetAgentId: action.agent.id, err: (err as Error).message });
          });
        }
      } catch (err) {
        logger.error({ module: 'governance', msg: 'Post-hook threw', hookName: hook.name, command: action.commandName, targetAgentId: action.agent.id, err: (err as Error).message });
      }
    }
  }

  /**
   * Build a GovernanceAction from command dispatch data.
   * Convenience method for CommandDispatcher integration.
   */
  static buildAction(
    commandName: string,
    rawText: string,
    agent: { id: string; role: { id: string; name: string }; status: string; dagTaskId?: string },
  ): GovernanceAction {
    let payload: Record<string, unknown> | null = null;
    // Try to extract JSON payload from the raw text
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        payload = JSON.parse(jsonMatch[0]);
      } catch {
        // Not valid JSON, leave payload as null
      }
    }

    return {
      commandName,
      rawText,
      payload,
      agent: {
        id: agent.id,
        roleId: agent.role.id,
        roleName: agent.role.name,
        status: agent.status,
        dagTaskId: agent.dagTaskId,
      },
      timestamp: Date.now(),
    };
  }
}
