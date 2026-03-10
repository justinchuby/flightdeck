import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookManager } from '../coordination/alerts/WebhookManager.js';

// Helpers
function mockFetchOk(status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
  });
}

function mockFetchError(message = 'Network error') {
  return vi.fn().mockRejectedValue(new Error(message));
}

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new WebhookManager();
    fetchSpy = mockFetchOk(200);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Registration ────────────────────────────────────────────────

  it('registers a webhook with a generated ID', () => {
    const webhook = manager.register({
      url: 'https://example.com/hook',
      events: ['task_completed'],
      enabled: true,
    });

    expect(webhook.id).toMatch(/^wh-/);
    expect(webhook.url).toBe('https://example.com/hook');
    expect(webhook.events).toEqual(['task_completed']);
    expect(webhook.enabled).toBe(true);
    expect(typeof webhook.createdAt).toBe('number');
  });

  it('generates unique IDs for each registered webhook', () => {
    const a = manager.register({ url: 'https://a.com', events: ['error'], enabled: true });
    const b = manager.register({ url: 'https://b.com', events: ['error'], enabled: true });
    expect(a.id).not.toBe(b.id);
  });

  it('stores and retrieves registered webhooks', () => {
    manager.register({ url: 'https://example.com/hook', events: ['task_completed'], enabled: true });
    const all = manager.getWebhooks();
    expect(all).toHaveLength(1);
    expect(all[0].url).toBe('https://example.com/hook');
  });

  it('retrieves a webhook by ID', () => {
    const wh = manager.register({ url: 'https://example.com', events: ['*'], enabled: true });
    expect(manager.getWebhook(wh.id)).toBe(wh);
    expect(manager.getWebhook('nonexistent')).toBeUndefined();
  });

  // ── Unregister ──────────────────────────────────────────────────

  it('unregister removes a webhook and returns true', () => {
    const wh = manager.register({ url: 'https://example.com', events: ['error'], enabled: true });
    expect(manager.unregister(wh.id)).toBe(true);
    expect(manager.getWebhooks()).toHaveLength(0);
  });

  it('unregister returns false for unknown ID', () => {
    expect(manager.unregister('wh-unknown')).toBe(false);
  });

  // ── setEnabled ──────────────────────────────────────────────────

  it('setEnabled toggles webhook enabled state', () => {
    const wh = manager.register({ url: 'https://example.com', events: ['error'], enabled: true });
    expect(manager.setEnabled(wh.id, false)).toBe(true);
    expect(manager.getWebhook(wh.id)!.enabled).toBe(false);

    expect(manager.setEnabled(wh.id, true)).toBe(true);
    expect(manager.getWebhook(wh.id)!.enabled).toBe(true);
  });

  it('setEnabled returns false for unknown ID', () => {
    expect(manager.setEnabled('wh-unknown', false)).toBe(false);
  });

  // ── Fire — delivery ─────────────────────────────────────────────

  it('fires webhook for matching event', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['task_completed'], enabled: true });
    await manager.fire('task_completed', { agentId: 'a1' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.event).toBe('task_completed');
    expect(body.payload).toEqual({ agentId: 'a1' });
  });

  it('does not fire webhook for non-matching event', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['task_completed'], enabled: true });
    await manager.fire('error', { agentId: 'a1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not fire disabled webhooks', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['task_completed'], enabled: false });
    await manager.fire('task_completed', { agentId: 'a1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('supports wildcard * event matching', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['*'], enabled: true });
    await manager.fire('any_event', { agentId: 'a1' });
    await manager.fire('another_event', { agentId: 'a2' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('sends correct headers including X-Flightdeck-Event', async () => {
    const wh = manager.register({ url: 'https://example.com/hook', events: ['error'], enabled: true });
    await manager.fire('error', {});

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-Flightdeck-Event']).toBe('error');
    expect(init.headers['X-Flightdeck-Webhook-Id']).toBe(wh.id);
  });

  it('sends HMAC signature header when secret is set', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['error'], enabled: true, secret: 'my-secret' });
    await manager.fire('error', {});

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['X-Flightdeck-Signature']).toBeDefined();
    expect(typeof init.headers['X-Flightdeck-Signature']).toBe('string');
    expect(init.headers['X-Flightdeck-Signature']).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  // ── Error handling ──────────────────────────────────────────────

  it('handles HTTP error responses gracefully (no throw)', async () => {
    vi.stubGlobal('fetch', mockFetchOk(500));
    manager.register({ url: 'https://example.com/hook', events: ['error'], enabled: true });

    await expect(manager.fire('error', {})).resolves.toBeUndefined();

    const deliveries = manager.getDeliveries();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].statusCode).toBe(500);
    expect(deliveries[0].error).toBe('HTTP 500');
  });

  it('handles network errors gracefully (no throw)', async () => {
    vi.stubGlobal('fetch', mockFetchError('ECONNREFUSED'));
    manager.register({ url: 'https://example.com/hook', events: ['error'], enabled: true });

    await expect(manager.fire('error', {})).resolves.toBeUndefined();

    const deliveries = manager.getDeliveries();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].error).toBe('ECONNREFUSED');
    expect(deliveries[0].statusCode).toBeUndefined();
  });

  // ── Delivery history ─────────────────────────────────────────────

  it('tracks delivery history with correct fields', async () => {
    const wh = manager.register({ url: 'https://example.com/hook', events: ['task_completed'], enabled: true });
    await manager.fire('task_completed', { agentId: 'a1' });

    const deliveries = manager.getDeliveries();
    expect(deliveries).toHaveLength(1);
    const d = deliveries[0];
    expect(d.webhookId).toBe(wh.id);
    expect(d.event).toBe('task_completed');
    expect(d.status).toBe('delivered');
    expect(d.statusCode).toBe(200);
    expect(d.attempts).toBe(1);
    expect(typeof d.deliveredAt).toBe('number');
  });

  it('filters delivery history by webhookId', async () => {
    const wh1 = manager.register({ url: 'https://a.com', events: ['error'], enabled: true });
    const wh2 = manager.register({ url: 'https://b.com', events: ['error'], enabled: true });

    await manager.fire('error', {});

    const d1 = manager.getDeliveries(wh1.id);
    const d2 = manager.getDeliveries(wh2.id);
    expect(d1).toHaveLength(1);
    expect(d1[0].webhookId).toBe(wh1.id);
    expect(d2).toHaveLength(1);
    expect(d2[0].webhookId).toBe(wh2.id);
  });

  it('respects limit on getDeliveries', async () => {
    manager.register({ url: 'https://example.com/hook', events: ['*'], enabled: true });
    for (let i = 0; i < 10; i++) {
      await manager.fire('task_completed', { i });
    }

    const limited = manager.getDeliveries(undefined, 3);
    expect(limited).toHaveLength(3);
  });

  it('trims old deliveries beyond maxDeliveryHistory', async () => {
    const tightManager = new WebhookManager(5); // max 5 deliveries
    vi.stubGlobal('fetch', mockFetchOk(200));
    tightManager.register({ url: 'https://example.com/hook', events: ['*'], enabled: true });

    for (let i = 0; i < 8; i++) {
      await tightManager.fire('task_completed', { i });
    }

    const deliveries = tightManager.getDeliveries(undefined, 100);
    expect(deliveries).toHaveLength(5);
  });

  it('fires to multiple matching webhooks independently', async () => {
    manager.register({ url: 'https://a.com/hook', events: ['error'], enabled: true });
    manager.register({ url: 'https://b.com/hook', events: ['error'], enabled: true });
    manager.register({ url: 'https://c.com/hook', events: ['task_completed'], enabled: true }); // no match

    await manager.fire('error', {});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((call: any[]) => call[0] as string);
    expect(urls).toContain('https://a.com/hook');
    expect(urls).toContain('https://b.com/hook');
    expect(urls).not.toContain('https://c.com/hook');
  });
});
