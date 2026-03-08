import { logger } from '../../utils/logger.js';

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];  // e.g., ['task_completed', 'error', 'ci:complete']
  secret?: string;
  enabled: boolean;
  createdAt: number;
}

interface WebhookDelivery {
  webhookId: string;
  event: string;
  payload: any;
  status: 'pending' | 'delivered' | 'failed';
  statusCode?: number;
  error?: string;
  deliveredAt?: number;
  attempts: number;
}

export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveries: WebhookDelivery[] = [];
  private maxDeliveryHistory: number;

  constructor(maxDeliveryHistory: number = 200) {
    this.maxDeliveryHistory = maxDeliveryHistory;
  }

  /** Register a webhook */
  register(config: Omit<WebhookConfig, 'id' | 'createdAt'>): WebhookConfig {
    const id = `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const webhook: WebhookConfig = { ...config, id, createdAt: Date.now() };
    this.webhooks.set(id, webhook);
    logger.info('webhook', `Registered webhook ${id} for events: ${config.events.join(', ')}`);
    return webhook;
  }

  /** Remove a webhook */
  unregister(id: string): boolean {
    const removed = this.webhooks.delete(id);
    if (removed) logger.info('webhook', `Unregistered webhook ${id}`);
    return removed;
  }

  /** Fire an event to all matching webhooks */
  async fire(event: string, payload: any): Promise<void> {
    const matching = [...this.webhooks.values()].filter(
      wh => wh.enabled && (wh.events.includes(event) || wh.events.includes('*'))
    );

    for (const webhook of matching) {
      const delivery: WebhookDelivery = {
        webhookId: webhook.id,
        event,
        payload,
        status: 'pending',
        attempts: 1,
      };

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Flightdeck-Event': event,
          'X-Flightdeck-Webhook-Id': webhook.id,
        };

        if (webhook.secret) {
          // Simple HMAC signature
          const crypto = await import('crypto');
          const body = JSON.stringify({ event, payload, timestamp: Date.now() });
          const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
          headers['X-Flightdeck-Signature'] = signature;
        }

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ event, payload, timestamp: Date.now() }),
          signal: AbortSignal.timeout(10_000), // 10s timeout
        });

        delivery.statusCode = response.status;
        delivery.status = response.ok ? 'delivered' : 'failed';
        delivery.deliveredAt = Date.now();
        if (!response.ok) {
          delivery.error = `HTTP ${response.status}`;
        }
      } catch (err: any) {
        delivery.status = 'failed';
        delivery.error = err.message;
        logger.warn('webhook', `Failed to deliver to ${webhook.id}: ${err.message}`);
      }

      this.deliveries.push(delivery);
      if (this.deliveries.length > this.maxDeliveryHistory) {
        this.deliveries = this.deliveries.slice(-this.maxDeliveryHistory);
      }
    }
  }

  /** Get all registered webhooks */
  getWebhooks(): WebhookConfig[] { return [...this.webhooks.values()]; }

  /** Get delivery history */
  getDeliveries(webhookId?: string, limit: number = 50): WebhookDelivery[] {
    let results = this.deliveries;
    if (webhookId) results = results.filter(d => d.webhookId === webhookId);
    return results.slice(-limit);
  }

  /** Get a webhook by ID */
  getWebhook(id: string): WebhookConfig | undefined { return this.webhooks.get(id); }

  /** Toggle webhook enabled/disabled */
  setEnabled(id: string, enabled: boolean): boolean {
    const wh = this.webhooks.get(id);
    if (!wh) return false;
    wh.enabled = enabled;
    return true;
  }
}
