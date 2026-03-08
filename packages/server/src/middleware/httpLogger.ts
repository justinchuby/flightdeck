/**
 * HTTP request/response logging middleware (R5 Structured Logging).
 *
 * Logs each completed HTTP request with method, path, status code,
 * and duration. Uses the appropriate log level based on status code.
 * Context fields (requestId, agentId) come automatically from
 * the requestContext middleware via AsyncLocalStorage.
 */
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      module: 'http',
      msg: `${req.method} ${req.path}`,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
