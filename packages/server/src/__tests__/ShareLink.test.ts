import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareLinkService } from '../coordination/sharing/ShareLinkService.js';

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
  };
}

describe('ShareLinkService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: ShareLinkService;

  beforeEach(() => {
    db = createMockDb();
    service = new ShareLinkService(db as any);
  });

  it('creates a share link with token and expiry', () => {
    const link = service.create({ leadId: 'lead-1' });
    expect(link.token).toHaveLength(16);
    expect(link.leadId).toBe('lead-1');
    expect(link.accessCount).toBe(0);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('creates link with custom expiry', () => {
    const link = service.create({ leadId: 'lead-1', expiresInHours: 1 });
    const expiresIn = new Date(link.expiresAt).getTime() - new Date(link.createdAt).getTime();
    expect(expiresIn).toBe(3600_000);
  });

  it('creates link with label', () => {
    const link = service.create({ leadId: 'lead-1', label: 'Demo replay' });
    expect(link.label).toBe('Demo replay');
  });

  it('validate returns link and increments access count', () => {
    const link = service.create({ leadId: 'lead-1' });
    const validated = service.validate(link.token);
    expect(validated).not.toBeNull();
    expect(validated!.accessCount).toBe(1);
  });

  it('validate returns null for unknown token', () => {
    expect(service.validate('nonexistent')).toBeNull();
  });

  it('validate returns null for expired token', () => {
    const link = service.create({ leadId: 'lead-1', expiresInHours: 0 });
    // Patch expiry to past
    const links = JSON.parse(db.setSetting.mock.calls.at(-1)![1]);
    links[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    db.getSetting.mockReturnValue(JSON.stringify(links));
    expect(service.validate(link.token)).toBeNull();
  });

  it('listForLead returns links for specific lead', () => {
    service.create({ leadId: 'lead-1' });
    service.create({ leadId: 'lead-2' });
    service.create({ leadId: 'lead-1' });
    expect(service.listForLead('lead-1')).toHaveLength(2);
  });

  it('revoke removes a link', () => {
    const link = service.create({ leadId: 'lead-1' });
    expect(service.revoke(link.token)).toBe(true);
    expect(service.validate(link.token)).toBeNull();
  });

  it('revoke returns false for unknown token', () => {
    expect(service.revoke('nonexistent')).toBe(false);
  });

  it('cleanup removes expired links', () => {
    service.create({ leadId: 'lead-1' });
    // Add an expired link manually
    const links = JSON.parse(db.setSetting.mock.calls.at(-1)![1]);
    links.push({
      token: 'expired-token',
      leadId: 'lead-1',
      createdAt: new Date(Date.now() - 100000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      accessCount: 0,
    });
    db.getSetting.mockReturnValue(JSON.stringify(links));

    const removed = service.cleanup();
    expect(removed).toBe(1);
  });
});
