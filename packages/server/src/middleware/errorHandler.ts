/**
 * Express error-handling middleware — catches ApiError (and unexpected errors)
 * and returns a consistent JSON envelope.
 *
 * Mount this AFTER all routes in the Express app:
 *   app.use(apiErrorHandler);
 */
import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';
import { logger } from '../utils/logger.js';

export function apiErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      logger.error({ module: 'api', msg: err.message, status: err.status });
    }
    const body = err.toJSON();
    // Safety net: never expose details in 5xx responses
    if (err.status >= 500) {
      delete body.details;
    }
    res.status(err.status).json(body);
    return;
  }

  // Unexpected error — log and return generic 500
  logger.error({
    module: 'api',
    msg: 'Unhandled route error',
    err: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Internal server error' });
}
