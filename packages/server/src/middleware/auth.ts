import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/**
 * Auto-generated token used when SERVER_SECRET is not explicitly set.
 * Generated once per server start — printed to console for the user.
 */
let autoToken: string | null = null;

export function getAuthSecret(): string | null {
  return process.env.SERVER_SECRET || autoToken;
}

/**
 * Initialize auth — auto-generates a token if SERVER_SECRET is not set.
 * Returns the token (or null if auth is explicitly disabled via AUTH=none).
 */
export function initAuth(): string | null {
  if (process.env.SERVER_SECRET) return process.env.SERVER_SECRET;
  if (process.env.AUTH === 'none') return null;

  autoToken = randomBytes(24).toString('base64url');
  return autoToken;
}

/**
 * Bearer token auth middleware.
 * If a secret exists (either SERVER_SECRET or auto-generated), requires auth.
 * Auth can be explicitly disabled with AUTH=none env var.
 * Localhost requests are allowed without auth for seamless local development.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = getAuthSecret();

  // If no secret configured, auth is disabled
  if (!secret) {
    next();
    return;
  }

  // Allow localhost requests without auth (local dev with Vite proxy, etc.)
  const ip = req.ip || req.socket?.remoteAddress || '';
  const isLocalhost = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1|localhost)$/.test(ip)
    || /^::ffff:127\./.test(ip);
  if (isLocalhost && !req.headers.authorization) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === secret) {
      next();
      return;
    }
    res.status(403).json({ error: 'Invalid authentication token.' });
    return;
  }

  // Check HttpOnly cookie (set by server on page load)
  const cookieToken = parseCookie(req.headers.cookie, 'flightdeck-token');
  if (cookieToken === secret) {
    next();
    return;
  }

  res.status(401).json({ error: 'Authentication required. Set Authorization: Bearer <token> header.' });
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.split(';').find(c => c.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1].trim()) : null;
}
