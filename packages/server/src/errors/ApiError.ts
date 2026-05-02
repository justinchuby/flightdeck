/**
 * ApiError — Typed HTTP error class for consistent API error responses.
 *
 * Throw an ApiError (or use the factory helpers) anywhere in a route handler.
 * Express 5 catches async throws automatically and forwards them to the
 * error middleware in `middleware/errorHandler.ts`.
 *
 * Response format: `{ error: string, code?: string, details?: unknown }`
 */

export class ApiError extends Error {
  /** HTTP status code (4xx / 5xx) */
  readonly status: number;

  /** Optional machine-readable error code (e.g. 'MISSING_FIELD', 'RATE_LIMITED') */
  readonly code?: string;

  /** Optional structured details (validation errors, context, etc.) */
  readonly details?: unknown;

  constructor(status: number, message: string, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }

  /** Serialize to the standard JSON error envelope. */
  toJSON(): { error: string; code?: string; details?: unknown } {
    const body: { error: string; code?: string; details?: unknown } = { error: this.message };
    if (this.code) body.code = this.code;
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

// ── Factory helpers ─────────────────────────────────────────────────

/** 400 Bad Request */
export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, { details });
}

/** 401 Unauthorized */
export function unauthorized(message = 'Unauthorized'): ApiError {
  return new ApiError(401, message);
}

/** 403 Forbidden */
export function forbidden(message = 'Forbidden'): ApiError {
  return new ApiError(403, message);
}

/** 404 Not Found */
export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, message);
}

/** 409 Conflict */
export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, message, { details });
}

/** 422 Unprocessable Entity — validation errors */
export function unprocessable(message: string, details?: unknown): ApiError {
  return new ApiError(422, message, { details });
}

/** 429 Too Many Requests */
export function tooManyRequests(message = 'Too many requests'): ApiError {
  return new ApiError(429, message, { code: 'RATE_LIMITED' });
}

/** 500 Internal Server Error */
export function internalError(message = 'Internal server error'): ApiError {
  return new ApiError(500, message);
}

/** 503 Service Unavailable */
export function serviceUnavailable(message = 'Service unavailable'): ApiError {
  return new ApiError(503, message);
}

// ── Validation helpers ──────────────────────────────────────────────

/**
 * Assert a value is truthy — throws 400 Bad Request if falsy.
 * Useful for required-field checks:
 *
 *   requireParam(req.params.id, 'id is required');
 */
export function requireParam(value: unknown, message: string): asserts value {
  if (!value) throw badRequest(message);
}
