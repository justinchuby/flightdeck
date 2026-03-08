/**
 * Request context middleware (R5 Structured Logging).
 *
 * Uses AsyncLocalStorage to thread contextual fields through all
 * async operations within an HTTP request or WebSocket message.
 * The logger automatically picks up these fields via logContext.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logContext, type LogContext } from '../utils/logger.js';

/**
 * Express middleware that wraps each request in an AsyncLocalStorage context.
 * All logger calls within the request automatically include requestId, method, path.
 */
export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  const ctx: LogContext = {
    requestId: randomUUID(),
    // agentId is populated later by route handlers via runWithAgentContext()
  };
  logContext.run(ctx, () => next());
}

/**
 * Enter a log context for an agent operation scope.
 * Use this when processing agent events, command dispatch, etc.
 */
export function runWithAgentContext<T>(
  agentId: string,
  agentRole: string,
  projectId: string | undefined,
  fn: () => T,
): T {
  const existing = logContext.getStore() ?? {};
  const ctx: LogContext = { ...existing, agentId, agentRole, projectId };
  return logContext.run(ctx, fn);
}

/**
 * Enter a log context for a WebSocket client scope.
 */
export function runWithWsContext<T>(
  wsClientId: string,
  projectId: string | undefined,
  fn: () => T,
): T {
  const existing = logContext.getStore() ?? {};
  const ctx: LogContext = { ...existing, wsClientId, projectId };
  return logContext.run(ctx, fn);
}
