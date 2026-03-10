import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock logger before importing module
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../utils/logger.js', () => ({ logger: mockLogger }));

function makeReq(method: string, path: string = '/test'): Request {
  return { method, path } as unknown as Request;
}

function makeRes(statusCode: number): Response & { _fire: () => void } {
  const handlers: Record<string, Function> = {};
  const res = {
    statusCode,
    on(event: string, fn: Function) { handlers[event] = fn; },
  } as unknown as Response & { _fire: () => void };
  (res as any)._fire = () => handlers['finish']?.();
  return res as any;
}

describe('httpLoggerMiddleware', () => {
  const next: NextFunction = vi.fn();
  const origEnv = process.env.LOG_ALL_HTTP;

  beforeEach(() => {
    vi.resetModules();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    (next as any).mockClear();
    delete process.env.LOG_ALL_HTTP;
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.LOG_ALL_HTTP = origEnv;
    else delete process.env.LOG_ALL_HTTP;
  });

  it('logs POST requests at info level', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('POST', '/api/agents');
    const res = makeRes(201);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'http', msg: 'POST /api/agents', statusCode: 201 }),
    );
  });

  it('suppresses successful GET requests by default', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('GET');
    const res = makeRes(200);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs GET 4xx as warn', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('GET', '/missing');
    const res = makeRes(404);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'http', statusCode: 404 }),
    );
  });

  it('logs GET 5xx as error', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('GET', '/crash');
    const res = makeRes(500);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'http', statusCode: 500 }),
    );
  });

  it('logs all GET requests when LOG_ALL_HTTP=true', async () => {
    process.env.LOG_ALL_HTTP = 'true';
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('GET', '/status');
    const res = makeRes(200);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'http', msg: 'GET /status', statusCode: 200 }),
    );
  });

  it('logs DELETE requests', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    const req = makeReq('DELETE', '/api/agents/abc');
    const res = makeRes(200);
    httpLoggerMiddleware(req, res, next);
    res._fire();
    expect(mockLogger.info).toHaveBeenCalled();
  });

  it('calls next()', async () => {
    const { httpLoggerMiddleware } = await import('../httpLogger.js');
    httpLoggerMiddleware(makeReq('GET'), makeRes(200), next);
    expect(next).toHaveBeenCalled();
  });
});
