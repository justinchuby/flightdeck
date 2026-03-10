/**
 * HTTP request/response logging middleware (R5 Structured Logging).
 *
 * Logs each completed HTTP request with method, path, status code,
 * and duration. Uses the appropriate log level based on status code.
 * Context fields (requestId, agentId) come automatically from
 * the requestContext middleware via AsyncLocalStorage.
 *
 * GET requests are suppressed by default (they're mostly polling/status
 * checks). Set LOG_ALL_HTTP=true to log all methods. Error responses
 * (4xx/5xx) are always logged regardless of method.
 */
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

const logAllHttp = process.env.LOG_ALL_HTTP === 'true';

export function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const isError = res.statusCode >= 400;
    if (!logAllHttp && req.method === 'GET' && !isError) return;

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
