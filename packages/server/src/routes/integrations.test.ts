import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { integrationRoutes } from './integrations.js';
import type { AppContext } from './context.js';
import type { MessagingAdapter, OutboundMessage, ChatSession } from '../integrations/types.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMockAdapter(): MessagingAdapter & { sentMessages: OutboundMessage[] } {
  const sentMessages: OutboundMessage[] = [];
  return {
    platform: 'telegram',
    sentMessages,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    sendMessage: vi.fn(async (msg: OutboundMessage) => { sentMessages.push(msg); }),
    onMessage: vi.fn(),
  };
}

function createMockSessions(): ChatSession[] {
  return [
    {
      chatId: 'chat-1', platform: 'telegram', projectId: 'proj-a',
      boundBy: 'api', createdAt: Date.now(), expiresAt: Date.now() + 3600_000,
    },
  ];
}

function createMockIntegrationRouter(adapter: MessagingAdapter, sessions: ChatSession[]) {
  return {
    getAdapter: vi.fn((platform: string) => platform === 'telegram' ? adapter : null),
    getAllSessions: vi.fn(() => sessions),
    bindSession: vi.fn((chatId: string, platform: string, projectId: string, boundBy: string) => ({
      chatId, platform, projectId, boundBy, createdAt: Date.now(), expiresAt: Date.now() + 3600_000,
    })),
    getBatcher: vi.fn(() => ({
      pendingCount: vi.fn(() => 0),
      getAllSubscriptions: vi.fn(() => []),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
  };
}

function createTestServer(ctx: Partial<AppContext>) {
  const app = express();
  app.use(express.json());
  app.use(integrationRoutes(ctx as AppContext));
  let server: Server;
  return {
    app,
    start: () => new Promise<string>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    }),
    stop: () => new Promise<void>((resolve) => { server?.close(() => resolve()); }),
  };
}

describe('C-2: Integration routes session validation', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const mockAdapter = createMockAdapter();
  const mockSessions = createMockSessions();
  const mockRouter = createMockIntegrationRouter(mockAdapter, mockSessions);

  beforeAll(async () => {
    const srv = createTestServer({ integrationRouter: mockRouter as any });
    baseUrl = await srv.start();
    stop = srv.stop;
  });
  afterAll(async () => { await stop?.(); });

  it('GET /integrations/status uses typed isRunning() (no as-any cast)', async () => {
    const res = await fetch(`${baseUrl}/integrations/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapters[0].running).toBe(true);
    expect(mockAdapter.isRunning).toHaveBeenCalled();
  });

  it('POST /integrations/test-message rejects unbound chatId', async () => {
    const res = await fetch(`${baseUrl}/integrations/test-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'telegram', chatId: 'unknown-chat', text: 'hello' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('No active session');
  });

  it('POST /integrations/test-message allows bound chatId', async () => {
    const res = await fetch(`${baseUrl}/integrations/test-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'telegram', chatId: 'chat-1', text: 'test' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(true);
  });

  it('POST /integrations/subscriptions rejects without active session', async () => {
    const res = await fetch(`${baseUrl}/integrations/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 'unknown-chat', projectId: 'proj-x' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('No active session');
  });

  it('POST /integrations/subscriptions allows with active session', async () => {
    const res = await fetch(`${baseUrl}/integrations/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 'chat-1', projectId: 'proj-a' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /integrations/sessions validates adapter exists', async () => {
    const res = await fetch(`${baseUrl}/integrations/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 'chat-2', platform: 'slack', projectId: 'proj-a' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('No adapter found');
  });
});
