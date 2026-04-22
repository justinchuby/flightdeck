import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { ApiError, badRequest, notFound, serviceUnavailable } from '../../errors/ApiError.js';
import { apiErrorHandler } from '../errorHandler.js';

// Suppress logger output in tests
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Spin up a tiny Express 5 app with the error middleware. */
function createTestApp() {
  const app = express();

  // Route that throws ApiError
  app.get('/api-error', (_req, res) => {
    throw badRequest('Missing field', { field: 'name' });
  });

  // Route that throws notFound
  app.get('/not-found', () => {
    throw notFound('Widget not found');
  });

  // Route that throws serviceUnavailable
  app.get('/unavailable', () => {
    throw serviceUnavailable();
  });

  // Route that throws an unexpected error
  app.get('/unexpected', () => {
    throw new Error('Something broke');
  });

  // Async route that throws (Express 5 catches this)
  app.get('/async-error', async () => {
    await Promise.resolve();
    throw new ApiError(422, 'Invalid data', { code: 'VALIDATION', details: ['bad'] });
  });

  // Route that throws 500 with details (should be stripped by middleware)
  app.get('/server-error-with-details', () => {
    throw new ApiError(500, 'Something failed', { details: 'secret stack trace' });
  });

  app.use(apiErrorHandler);

  let server: Server;
  return {
    start: () =>
      new Promise<string>((resolve) => {
        server = app.listen(0, () => {
          const port = (server.address() as AddressInfo).port;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('apiErrorHandler middleware', () => {
  let base: string;
  let srv: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    srv = createTestApp();
    base = await srv.start();
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('returns 400 with error body for badRequest', async () => {
    const res = await fetch(`${base}/api-error`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Missing field', details: { field: 'name' } });
  });

  it('returns 404 for notFound', async () => {
    const res = await fetch(`${base}/not-found`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Widget not found' });
  });

  it('returns 503 for serviceUnavailable', async () => {
    const res = await fetch(`${base}/unavailable`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'Service unavailable' });
  });

  it('returns generic 500 for unexpected errors', async () => {
    const res = await fetch(`${base}/unexpected`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Internal server error' });
  });

  it('handles async route errors (Express 5 native catch)', async () => {
    const res = await fetch(`${base}/async-error`);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Invalid data',
      code: 'VALIDATION',
      details: ['bad'],
    });
  });

  it('strips details from 5xx ApiError responses', async () => {
    const res = await fetch(`${base}/server-error-with-details`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Something failed' });
    expect(body.details).toBeUndefined();
  });
});
