import { Request, Response, NextFunction } from 'express';

/**
 * Bearer token auth middleware.
 * If SERVER_SECRET env var is set, requires `Authorization: Bearer <secret>` header.
 * If SERVER_SECRET is not set, auth is disabled (development mode).
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.SERVER_SECRET;

  // If no secret configured, auth is disabled (dev mode)
  if (!secret) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Set Authorization: Bearer <token> header.' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    res.status(403).json({ error: 'Invalid authentication token.' });
    return;
  }

  next();
}
