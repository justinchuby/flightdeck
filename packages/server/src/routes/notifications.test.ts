/**
 * Notification route tests.
 *
 * Covers: composite settings endpoint (PUT /notifications/settings),
 * routing matrix endpoint (GET /notifications/routing).
 * These endpoints bridge the NotificationPreferencesPanel UI format
 * with the server's preference/quiet-hours data model.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// Bypass rate limiters in tests
vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { Database } from '../db/database.js';
import { notificationRoutes } from './notifications.js';
import type { AppContext } from './context.js';

let app: express.Express;
let server: Server;
let baseUrl: string;
let db: Database;

function createMockContext(): AppContext {
  db = new Database(':memory:');
  return {
    db,
    agentManager: {} as any,
    wsServer: { broadcastEvent: vi.fn() } as any,
    providerManager: {} as any,
  } as unknown as AppContext;
}

beforeEach(() => {
  app = express();
  app.use(express.json());
  const ctx = createMockContext();
  app.use('/api', notificationRoutes(ctx));

  return new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterEach(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('GET /api/notifications/routing', () => {
  it('returns empty routing when no preferences configured', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/routing`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('routing');
    expect(data).toHaveProperty('preset');
    expect(typeof data.routing).toBe('object');
  });

  it('returns routing matrix with channel types after preferences are set', async () => {
    // First create a channel
    const channelRes = await fetch(`${baseUrl}/api/notifications/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'desktop',
        config: { sound: true, showPreview: true },
      }),
    });
    expect(channelRes.status).toBe(201);
    const channel = await channelRes.json();

    // Set preferences that route agent_crashed to this channel
    await fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: [{
          event: 'agent_crashed',
          tier: 'interrupt',
          channels: [channel.id],
          enabled: true,
        }],
      }),
    });

    // Now check routing
    const routingRes = await fetch(`${baseUrl}/api/notifications/routing`);
    expect(routingRes.status).toBe(200);
    const data = await routingRes.json();
    expect(data.routing.agent_crashed).toContain('desktop');
  });
});

describe('PUT /api/notifications/settings', () => {
  it('saves routing matrix and converts to preferences', async () => {
    // Create a desktop channel first
    const channelRes = await fetch(`${baseUrl}/api/notifications/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'desktop',
        config: { sound: true, showPreview: true },
      }),
    });
    const channel = await channelRes.json();

    // Save settings with routing that maps agent_crashed to desktop
    const saveRes = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing: {
          agent_crashed: ['desktop'],
          session_completed: [],
        },
      }),
    });
    expect(saveRes.status).toBe(200);
    const saveData = await saveRes.json();
    expect(saveData.ok).toBe(true);

    // Verify preferences were set correctly
    const prefsRes = await fetch(`${baseUrl}/api/notifications/preferences`);
    const prefs = await prefsRes.json();
    const crashPref = prefs.find((p: any) => p.event === 'agent_crashed');
    expect(crashPref).toBeDefined();
    expect(crashPref.channels).toContain(channel.id);
    expect(crashPref.enabled).toBe(true);
  });

  it('saves quiet hours configuration', async () => {
    const saveRes = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quietHours: { start: '23:00', end: '07:00' },
      }),
    });
    expect(saveRes.status).toBe(200);

    // Verify quiet hours were set
    const qhRes = await fetch(`${baseUrl}/api/notifications/quiet-hours`);
    const qh = await qhRes.json();
    expect(qh.enabled).toBe(true);
    expect(qh.start).toBe('23:00');
    expect(qh.end).toBe('07:00');
  });

  it('disables quiet hours when null is passed', async () => {
    // First enable quiet hours
    await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quietHours: { start: '22:00', end: '08:00' },
      }),
    });

    // Now disable by passing null
    const saveRes = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quietHours: null,
      }),
    });
    expect(saveRes.status).toBe(200);

    const qhRes = await fetch(`${baseUrl}/api/notifications/quiet-hours`);
    const qh = await qhRes.json();
    expect(qh.enabled).toBe(false);
  });

  it('updates channel enabled states', async () => {
    // Create a channel
    const channelRes = await fetch(`${baseUrl}/api/notifications/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'desktop',
        config: { sound: true, showPreview: true },
      }),
    });
    const channel = await channelRes.json();
    expect(channel.enabled).toBe(true);

    // Disable it via composite settings endpoint
    const saveRes = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channels: [{ id: channel.id, enabled: false }],
      }),
    });
    expect(saveRes.status).toBe(200);

    // Verify channel is disabled
    const channelsRes = await fetch(`${baseUrl}/api/notifications/channels`);
    const channels = await channelsRes.json();
    const updated = channels.find((c: any) => c.id === channel.id);
    expect(updated.enabled).toBe(false);
  });

  it('handles empty body gracefully', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});
