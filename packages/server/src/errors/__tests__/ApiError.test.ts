import { describe, it, expect } from 'vitest';
import {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  unprocessable,
  tooManyRequests,
  internalError,
  serviceUnavailable,
  requireParam,
} from '../ApiError.js';

describe('ApiError', () => {
  it('stores status, message, code, and details', () => {
    const err = new ApiError(422, 'Validation failed', {
      code: 'INVALID_INPUT',
      details: { field: 'name' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(422);
    expect(err.message).toBe('Validation failed');
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('toJSON includes only defined fields', () => {
    const minimal = new ApiError(400, 'Bad');
    expect(minimal.toJSON()).toEqual({ error: 'Bad' });

    const full = new ApiError(400, 'Bad', { code: 'X', details: [1] });
    expect(full.toJSON()).toEqual({ error: 'Bad', code: 'X', details: [1] });
  });
});

describe('factory helpers', () => {
  it('badRequest → 400', () => {
    const err = badRequest('missing id', { field: 'id' });
    expect(err.status).toBe(400);
    expect(err.message).toBe('missing id');
    expect(err.details).toEqual({ field: 'id' });
  });

  it('unauthorized → 401 with default message', () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.message).toBe('Unauthorized');
  });

  it('forbidden → 403', () => {
    const err = forbidden('no access');
    expect(err.status).toBe(403);
    expect(err.message).toBe('no access');
  });

  it('notFound → 404', () => {
    const err = notFound('Agent not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Agent not found');
  });

  it('conflict → 409', () => {
    const err = conflict('Already exists');
    expect(err.status).toBe(409);
  });

  it('unprocessable → 422', () => {
    const err = unprocessable('Bad schema', { errors: ['a'] });
    expect(err.status).toBe(422);
    expect(err.details).toEqual({ errors: ['a'] });
  });

  it('tooManyRequests → 429 with RATE_LIMITED code', () => {
    const err = tooManyRequests();
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('internalError → 500', () => {
    expect(internalError().status).toBe(500);
  });

  it('serviceUnavailable → 503', () => {
    expect(serviceUnavailable().status).toBe(503);
  });
});

describe('requireParam', () => {
  it('does not throw for truthy values', () => {
    expect(() => requireParam('hello', 'needed')).not.toThrow();
    expect(() => requireParam(42, 'needed')).not.toThrow();
    expect(() => requireParam(true, 'needed')).not.toThrow();
  });

  it('throws badRequest for falsy values', () => {
    expect(() => requireParam('', 'id is required')).toThrow(ApiError);
    expect(() => requireParam(null, 'id is required')).toThrow(ApiError);
    expect(() => requireParam(undefined, 'id is required')).toThrow(ApiError);
    expect(() => requireParam(0, 'count is required')).toThrow(ApiError);

    try {
      requireParam(null, 'id is required');
    } catch (err) {
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe('id is required');
    }
  });
});
