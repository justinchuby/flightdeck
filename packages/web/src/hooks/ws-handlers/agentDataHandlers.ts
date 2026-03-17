import type { WsHandlerContext } from './types';

/**
 * Handlers for agent data events:
 * agent:plan, agent:usage
 */

export function handleAgentPlan(msg: any, ctx: WsHandlerContext): void {
  ctx.updateAgent(msg.agentId, { plan: msg.plan });
}

export function handleAgentUsage(msg: any, ctx: WsHandlerContext): void {
  ctx.updateAgent(msg.agentId, {
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    ...(msg.cacheReadTokens != null ? { cacheReadTokens: msg.cacheReadTokens } : {}),
    ...(msg.cacheWriteTokens != null ? { cacheWriteTokens: msg.cacheWriteTokens } : {}),
    ...(msg.contextWindowUsed != null ? { contextWindowUsed: msg.contextWindowUsed } : {}),
    ...(msg.contextWindowSize != null ? { contextWindowSize: msg.contextWindowSize } : {}),
  });
}
