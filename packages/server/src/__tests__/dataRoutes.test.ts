import { describe, it, expect, vi } from 'vitest';
import { dataRoutes } from '../routes/data.js';
import { ApiError } from '../errors/index.js';

/** Build a minimal mock drizzle chain that returns configurable values */
function makeMockDb(overrides?: { getReturnValue?: any; allReturnValue?: any[] }) {
  const mockGet = vi.fn().mockReturnValue(overrides?.getReturnValue ?? { count: 0 });
  const mockAll = vi.fn().mockReturnValue(overrides?.allReturnValue ?? []);
  const selectChain: any = () => ({
    from: selectChain,
    where: selectChain,
    orderBy: selectChain,
    limit: selectChain,
    get: mockGet,
    all: mockAll,
  });
  return {
    drizzle: {
      select: vi.fn(selectChain),
      delete: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn() })) })),
      transaction: vi.fn(),
    },
    _mockGet: mockGet,
    _mockAll: mockAll,
  };
}

/** Extract route handlers from an Express router */
function extractHandlers(router: any): Map<string, Function> {
  const handlers = new Map<string, Function>();
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const method = Object.keys(layer.route.methods)[0]?.toUpperCase();
      const path = layer.route.path;
      const handler = layer.route.stack?.[0]?.handle;
      if (method && path && handler) {
        handlers.set(`${method} ${path}`, handler);
      }
    }
  }
  return handlers;
}

function mockRes() {
  const res: any = { _status: 200, _body: null };
  res.status = vi.fn((code: number) => { res._status = code; return res; });
  res.json = vi.fn((body: any) => { res._body = body; return res; });
  return res;
}

describe('Data Routes', () => {
  it('exports dataRoutes function', () => {
    expect(typeof dataRoutes).toBe('function');
  });

  it('registers GET /data/stats and POST /data/cleanup', () => {
    const db = makeMockDb();
    const router = dataRoutes({ db, config: { dbPath: '/tmp/test.db' } } as any);
    const handlers = extractHandlers(router);
    expect(handlers.has('GET /data/stats')).toBe(true);
    expect(handlers.has('POST /data/cleanup')).toBe(true);
  });
});

describe('GET /data/stats', () => {
  it('returns expected shape', () => {
    const db = makeMockDb();
    const router = dataRoutes({ db, config: { dbPath: '/tmp/test.db' } } as any);
    const handler = extractHandlers(router).get('GET /data/stats')!;
    const res = mockRes();

    handler({}, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSizeBytes: expect.any(Number),
        tableCounts: expect.any(Object),
        totalRecords: expect.any(Number),
        oldestSession: null,
      }),
    );
  });
});

describe('POST /data/cleanup', () => {
  function getCleanupHandler() {
    const db = makeMockDb();
    const router = dataRoutes({ db, config: { dbPath: '/tmp/test.db' } } as any);
    return extractHandlers(router).get('POST /data/cleanup')!;
  }

  it('rejects missing olderThanDays', () => {
    const handler = getCleanupHandler();
    const res = mockRes();
    expect(() => handler({ body: {} }, res)).toThrow(ApiError);
    try { handler({ body: {} }, res); } catch (e: any) {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/olderThanDays/);
    }
  });

  it('rejects negative days', () => {
    const handler = getCleanupHandler();
    const res = mockRes();
    expect(() => handler({ body: { olderThanDays: -5 } }, res)).toThrow(ApiError);
    try { handler({ body: { olderThanDays: -5 } }, res); } catch (e: any) {
      expect(e.status).toBe(400);
    }
  });

  it('accepts zero days as purge-all', () => {
    const handler = getCleanupHandler();
    const res = mockRes();
    handler({ body: { olderThanDays: 0 } }, res);
    // 0 means "all data" — should NOT return 400
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it('rejects string days', () => {
    const handler = getCleanupHandler();
    const res = mockRes();
    expect(() => handler({ body: { olderThanDays: 'thirty' } }, res)).toThrow(ApiError);
    try { handler({ body: { olderThanDays: 'thirty' } }, res); } catch (e: any) {
      expect(e.status).toBe(400);
    }
  });

  it('returns zero counts when no old sessions exist', () => {
    const handler = getCleanupHandler();
    const res = mockRes();
    handler({ body: { olderThanDays: 30, dryRun: true } }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionsDeleted: 0,
        totalDeleted: 0,
        dryRun: true,
      }),
    );
  });
});

