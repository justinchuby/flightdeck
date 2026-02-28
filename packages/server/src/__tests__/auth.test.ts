import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: any } {
  const res: any = { _status: 0, _json: null };
  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.json = (body: any) => {
    res._json = body;
    return res;
  };
  return res;
}

describe('authMiddleware', () => {
  const originalSecret = process.env.SERVER_SECRET;

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.SERVER_SECRET = originalSecret;
    } else {
      delete process.env.SERVER_SECRET;
    }
  });

  it('calls next() when SERVER_SECRET is not set (dev mode)', () => {
    delete process.env.SERVER_SECRET;
    const next = vi.fn();
    authMiddleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when SERVER_SECRET is set but no Authorization header', () => {
    process.env.SERVER_SECRET = 'test-secret';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._json.error).toMatch(/Authentication required/);
  });

  it('returns 401 when Authorization header is not Bearer scheme', () => {
    process.env.SERVER_SECRET = 'test-secret';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ authorization: 'Basic abc123' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 403 when bearer token does not match SERVER_SECRET', () => {
    process.env.SERVER_SECRET = 'test-secret';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ authorization: 'Bearer wrong-token' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(res._json.error).toMatch(/Invalid authentication token/);
  });

  it('calls next() when bearer token matches SERVER_SECRET', () => {
    process.env.SERVER_SECRET = 'test-secret';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ authorization: 'Bearer test-secret' }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0); // status was never set
  });

  it('handles empty bearer token', () => {
    process.env.SERVER_SECRET = 'test-secret';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ authorization: 'Bearer ' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });
});
