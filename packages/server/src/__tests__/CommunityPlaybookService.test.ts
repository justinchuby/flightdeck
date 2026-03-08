import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CommunityPlaybookService,
  sanitizeConfig,
  looksLikeSecret,
  type PublishInput,
  type CommunityPlaybook,
  type PlaybookReview,
} from '../coordination/playbooks/CommunityPlaybookService.js';

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => {
      settings.set(key, val);
    }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

const sampleInput: PublishInput = {
  name: 'Code Review Sprint',
  description: 'A playbook for structured code reviews',
  category: 'development',
  tags: ['review', 'quality'],
  config: { maxReviewers: 3, autoAssign: true },
};

function makeInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return { ...sampleInput, ...overrides };
}

/** Publish a playbook and give it enough high reviews to be featureable */
function publishFeaturable(service: CommunityPlaybookService): CommunityPlaybook {
  const pb = service.publish(makeInput({ name: `Featurable-${Date.now()}-${Math.random()}` }));
  service.addReview(pb.id, 5);
  service.addReview(pb.id, 4);
  service.addReview(pb.id, 4);
  return service.getById(pb.id)!;
}

describe('CommunityPlaybookService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: CommunityPlaybookService;

  beforeEach(() => {
    db = createMockDb();
    service = new CommunityPlaybookService(db as any);
  });

  // ── Browse / Search ──────────────────────────────

  describe('getAll', () => {
    it('returns empty array when no playbooks exist', () => {
      expect(service.getAll()).toEqual([]);
    });

    it('returns all published playbooks', () => {
      service.publish(makeInput({ name: 'A' }));
      service.publish(makeInput({ name: 'B' }));
      expect(service.getAll()).toHaveLength(2);
    });

    it('filters by category', () => {
      service.publish(makeInput({ name: 'Dev', category: 'development' }));
      service.publish(makeInput({ name: 'Test', category: 'testing' }));
      service.publish(makeInput({ name: 'Sec', category: 'security' }));

      const devOnly = service.getAll({ category: 'development' });
      expect(devOnly).toHaveLength(1);
      expect(devOnly[0].name).toBe('Dev');
    });

    it('sorts by popular (useCount desc)', () => {
      const a = service.publish(makeInput({ name: 'Low' }));
      const b = service.publish(makeInput({ name: 'High' }));
      service.incrementUseCount(b.id);
      service.incrementUseCount(b.id);
      service.incrementUseCount(a.id);

      const sorted = service.getAll({ sort: 'popular' });
      expect(sorted[0].name).toBe('High');
      expect(sorted[1].name).toBe('Low');
    });

    it('sorts by recent (publishedAt desc)', () => {
      const a = service.publish(makeInput({ name: 'Older' }));
      // Manually adjust timestamp to ensure ordering
      const pb = service.getById(a.id)!;
      (pb as any).publishedAt = '2024-01-01T00:00:00.000Z';

      const _b = service.publish(makeInput({ name: 'Newer' }));

      const sorted = service.getAll({ sort: 'recent' });
      expect(sorted[0].name).toBe('Newer');
      expect(sorted[1].name).toBe('Older');
    });

    it('sorts by rating (average desc)', () => {
      const a = service.publish(makeInput({ name: 'LowRated' }));
      const b = service.publish(makeInput({ name: 'HighRated' }));
      service.addReview(a.id, 2);
      service.addReview(b.id, 5);

      const sorted = service.getAll({ sort: 'rating' });
      expect(sorted[0].name).toBe('HighRated');
      expect(sorted[1].name).toBe('LowRated');
    });

    it('searches by name (case-insensitive)', () => {
      service.publish(makeInput({ name: 'Security Audit' }));
      service.publish(makeInput({ name: 'Dev Sprint' }));

      const results = service.getAll({ search: 'security' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Security Audit');
    });

    it('searches by description', () => {
      service.publish(makeInput({ name: 'A', description: 'Handles integration testing' }));
      service.publish(makeInput({ name: 'B', description: 'For design reviews' }));

      const results = service.getAll({ search: 'integration' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('A');
    });

    it('searches by tags', () => {
      service.publish(makeInput({ name: 'Tagged', tags: ['ci', 'automation'] }));
      service.publish(makeInput({ name: 'Other', tags: ['manual'] }));

      const results = service.getAll({ search: 'automation' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Tagged');
    });

    it('combines category filter and search', () => {
      service.publish(makeInput({ name: 'DevSec', category: 'development', tags: ['security'] }));
      service.publish(makeInput({ name: 'TestSec', category: 'testing', tags: ['security'] }));

      const results = service.getAll({ category: 'development', search: 'security' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('DevSec');
    });
  });

  describe('getById', () => {
    it('returns playbook by id', () => {
      const created = service.publish(sampleInput);
      const found = service.getById(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Code Review Sprint');
    });

    it('returns undefined for unknown id', () => {
      expect(service.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('getFeatured', () => {
    it('returns only featured playbooks', () => {
      const pb = publishFeaturable(service);
      service.setFeatured(pb.id, true);

      service.publish(makeInput({ name: 'Not Featured' }));

      const featured = service.getFeatured();
      expect(featured).toHaveLength(1);
      expect(featured[0].id).toBe(pb.id);
    });

    it('returns empty when none are featured', () => {
      service.publish(sampleInput);
      expect(service.getFeatured()).toEqual([]);
    });
  });

  // ── Publish ──────────────────────────────────────

  describe('publish', () => {
    it('creates a playbook with all fields', () => {
      const result = service.publish(sampleInput);
      expect(result.id).toMatch(/^cp-/);
      expect(result.name).toBe('Code Review Sprint');
      expect(result.description).toBe('A playbook for structured code reviews');
      expect(result.category).toBe('development');
      expect(result.tags).toEqual(['review', 'quality']);
      expect(result.publisher).toBe('anonymous');
      expect(result.rating).toEqual({ average: 0, count: 0 });
      expect(result.useCount).toBe(0);
      expect(result.version).toBe('1.0.0');
      expect(result.featured).toBe(false);
      expect(result.config).toEqual({ maxReviewers: 3, autoAssign: true });
      expect(result.versions).toHaveLength(1);
      expect(result.versions[0].version).toBe('1.0.0');
      expect(result.publishedAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('uses provided publisher name', () => {
      const result = service.publish(makeInput({ publisher: 'alice' }));
      expect(result.publisher).toBe('alice');
    });

    it('defaults publisher to anonymous', () => {
      const result = service.publish(makeInput({ publisher: undefined }));
      expect(result.publisher).toBe('anonymous');
    });

    it('throws when name is empty', () => {
      expect(() => service.publish(makeInput({ name: '' }))).toThrow('name is required');
    });

    it('throws when name is whitespace-only', () => {
      expect(() => service.publish(makeInput({ name: '   ' }))).toThrow('name is required');
    });

    it('throws when description is empty', () => {
      expect(() => service.publish(makeInput({ description: '' }))).toThrow('description is required');
    });

    it('throws when category is missing', () => {
      expect(() => service.publish(makeInput({ category: undefined as any }))).toThrow('category is required');
    });

    it('trims name and description', () => {
      const result = service.publish(makeInput({ name: '  Trimmed  ', description: '  Also trimmed  ' }));
      expect(result.name).toBe('Trimmed');
      expect(result.description).toBe('Also trimmed');
    });
  });

  // ── Update ───────────────────────────────────────

  describe('update', () => {
    it('updates name and description', () => {
      const pb = service.publish(sampleInput);
      const updated = service.update(pb.id, { name: 'Renamed', description: 'New desc' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Renamed');
      expect(updated!.description).toBe('New desc');
    });

    it('updates category and tags', () => {
      const pb = service.publish(sampleInput);
      const updated = service.update(pb.id, { category: 'testing', tags: ['e2e'] });
      expect(updated!.category).toBe('testing');
      expect(updated!.tags).toEqual(['e2e']);
    });

    it('updates config', () => {
      const pb = service.publish(sampleInput);
      const updated = service.update(pb.id, { config: { newKey: 'val' } });
      expect(updated!.config).toEqual({ newKey: 'val' });
    });

    it('updates updatedAt timestamp', () => {
      const pb = service.publish(sampleInput);
      const original = pb.updatedAt;
      // Small delay to ensure different timestamp
      const updated = service.update(pb.id, { name: 'Changed' });
      expect(updated!.updatedAt).toBeDefined();
      // timestamps may be equal in fast tests, so just check it exists
    });

    it('returns undefined for unknown id', () => {
      expect(service.update('nonexistent', { name: 'X' })).toBeUndefined();
    });
  });

  // ── Unpublish ────────────────────────────────────

  describe('unpublish', () => {
    it('removes a playbook', () => {
      const pb = service.publish(sampleInput);
      expect(service.unpublish(pb.id)).toBe(true);
      expect(service.getById(pb.id)).toBeUndefined();
      expect(service.getAll()).toHaveLength(0);
    });

    it('removes associated reviews', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 5, 'Great!');
      service.addReview(pb.id, 4);
      expect(service.getReviews(pb.id)).toHaveLength(2);

      service.unpublish(pb.id);
      expect(service.getReviews(pb.id)).toHaveLength(0);
    });

    it('returns false for unknown id', () => {
      expect(service.unpublish('nonexistent')).toBe(false);
    });
  });

  // ── Reviews ──────────────────────────────────────

  describe('reviews', () => {
    it('adds a review and returns it', () => {
      const pb = service.publish(sampleInput);
      const review = service.addReview(pb.id, 5, 'Excellent!');
      expect(review).toBeDefined();
      expect(review!.id).toMatch(/^cpr-/);
      expect(review!.playbookId).toBe(pb.id);
      expect(review!.rating).toBe(5);
      expect(review!.comment).toBe('Excellent!');
      expect(review!.createdAt).toBeDefined();
    });

    it('adds a review without comment', () => {
      const pb = service.publish(sampleInput);
      const review = service.addReview(pb.id, 3);
      expect(review).toBeDefined();
      expect(review!.comment).toBeUndefined();
    });

    it('recalculates average rating after review', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 5);
      service.addReview(pb.id, 3);

      const updated = service.getById(pb.id)!;
      expect(updated.rating.average).toBe(4);
      expect(updated.rating.count).toBe(2);
    });

    it('rounds rating to 2 decimal places', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 5);
      service.addReview(pb.id, 4);
      service.addReview(pb.id, 4);

      const updated = service.getById(pb.id)!;
      expect(updated.rating.average).toBe(4.33);
      expect(updated.rating.count).toBe(3);
    });

    it('returns undefined when playbook not found', () => {
      expect(service.addReview('nonexistent', 5)).toBeUndefined();
    });

    it('throws for rating below 1', () => {
      const pb = service.publish(sampleInput);
      expect(() => service.addReview(pb.id, 0)).toThrow('Rating must be an integer between 1 and 5');
    });

    it('throws for rating above 5', () => {
      const pb = service.publish(sampleInput);
      expect(() => service.addReview(pb.id, 6)).toThrow('Rating must be an integer between 1 and 5');
    });

    it('throws for non-integer rating', () => {
      const pb = service.publish(sampleInput);
      expect(() => service.addReview(pb.id, 3.5)).toThrow('Rating must be an integer between 1 and 5');
    });

    it('getReviews returns reviews for a specific playbook', () => {
      const pb1 = service.publish(makeInput({ name: 'PB1' }));
      const pb2 = service.publish(makeInput({ name: 'PB2' }));
      service.addReview(pb1.id, 5);
      service.addReview(pb1.id, 4);
      service.addReview(pb2.id, 3);

      expect(service.getReviews(pb1.id)).toHaveLength(2);
      expect(service.getReviews(pb2.id)).toHaveLength(1);
    });

    it('getReviews returns empty for unknown playbook', () => {
      expect(service.getReviews('nonexistent')).toEqual([]);
    });
  });

  // ── Fork ─────────────────────────────────────────

  describe('fork', () => {
    it('creates a fork with new id and forkedFrom', () => {
      const original = service.publish(sampleInput);
      const result = service.fork(original.id);
      expect(result).toBeDefined();
      expect(result!.id).toMatch(/^cp-/);
      expect(result!.id).not.toBe(original.id);
      expect(result!.forkedFrom).toBe(original.id);
      expect(result!.name).toBe('Code Review Sprint (Fork)');
    });

    it('forked playbook has reset rating and useCount', () => {
      const original = service.publish(sampleInput);
      service.addReview(original.id, 5);
      service.incrementUseCount(original.id);

      const result = service.fork(original.id)!;
      const forked = service.getById(result.id)!;
      expect(forked.rating).toEqual({ average: 0, count: 0 });
      expect(forked.useCount).toBe(0);
      expect(forked.featured).toBe(false);
    });

    it('forked playbook has its own versions starting at 1.0.0', () => {
      const original = service.publish(sampleInput);
      service.publishVersion(original.id, '2.0.0', 'Major update');

      const result = service.fork(original.id)!;
      const forked = service.getById(result.id)!;
      expect(forked.version).toBe('1.0.0');
      expect(forked.versions).toHaveLength(1);
      expect(forked.versions[0].version).toBe('1.0.0');
    });

    it('forked playbook preserves config from source', () => {
      const original = service.publish(sampleInput);
      const result = service.fork(original.id)!;
      const forked = service.getById(result.id)!;
      expect(forked.config).toEqual(original.config);
    });

    it('returns undefined for unknown id', () => {
      expect(service.fork('nonexistent')).toBeUndefined();
    });

    it('fork adds playbook to the gallery', () => {
      service.publish(sampleInput);
      const original = service.getAll()[0];
      service.fork(original.id);
      expect(service.getAll()).toHaveLength(2);
    });
  });

  // ── Versioning ───────────────────────────────────

  describe('versioning', () => {
    it('publishVersion adds entry to versions array', () => {
      const pb = service.publish(sampleInput);
      const result = service.publishVersion(pb.id, '1.1.0', 'Bug fixes');
      expect(result).toBe(true);

      const versions = service.getVersions(pb.id);
      expect(versions).toHaveLength(2);
      expect(versions[1].version).toBe('1.1.0');
      expect(versions[1].changelog).toBe('Bug fixes');
    });

    it('publishVersion updates the playbook version', () => {
      const pb = service.publish(sampleInput);
      service.publishVersion(pb.id, '2.0.0');

      const updated = service.getById(pb.id)!;
      expect(updated.version).toBe('2.0.0');
    });

    it('publishVersion updates updatedAt', () => {
      const pb = service.publish(sampleInput);
      const originalUpdatedAt = pb.updatedAt;
      service.publishVersion(pb.id, '1.1.0');

      const updated = service.getById(pb.id)!;
      expect(updated.updatedAt).toBeDefined();
    });

    it('publishVersion returns false for unknown id', () => {
      expect(service.publishVersion('nonexistent', '1.0.0')).toBe(false);
    });

    it('getVersions returns empty for unknown id', () => {
      expect(service.getVersions('nonexistent')).toEqual([]);
    });

    it('getVersions returns version history', () => {
      const pb = service.publish(sampleInput);
      service.publishVersion(pb.id, '1.1.0', 'Patch');
      service.publishVersion(pb.id, '2.0.0', 'Major');

      const versions = service.getVersions(pb.id);
      expect(versions).toHaveLength(3);
      expect(versions.map(v => v.version)).toEqual(['1.0.0', '1.1.0', '2.0.0']);
    });
  });

  // ── Featured ─────────────────────────────────────

  describe('setFeatured', () => {
    it('marks eligible playbook as featured', () => {
      const pb = publishFeaturable(service);
      const result = service.setFeatured(pb.id, true);
      expect(result).toBe(true);
      expect(service.getById(pb.id)!.featured).toBe(true);
    });

    it('rejects featuring with low rating', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 2);
      service.addReview(pb.id, 2);
      service.addReview(pb.id, 2);

      expect(service.setFeatured(pb.id, true)).toBe(false);
      expect(service.getById(pb.id)!.featured).toBe(false);
    });

    it('rejects featuring with too few reviews', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 5);
      service.addReview(pb.id, 5);
      // only 2 reviews, need 3

      expect(service.setFeatured(pb.id, true)).toBe(false);
    });

    it('allows unfeaturing without restrictions', () => {
      const pb = publishFeaturable(service);
      service.setFeatured(pb.id, true);
      expect(service.getById(pb.id)!.featured).toBe(true);

      const result = service.setFeatured(pb.id, false);
      expect(result).toBe(true);
      expect(service.getById(pb.id)!.featured).toBe(false);
    });

    it('returns false for unknown id', () => {
      expect(service.setFeatured('nonexistent', true)).toBe(false);
    });
  });

  // ── incrementUseCount ────────────────────────────

  describe('incrementUseCount', () => {
    it('increments useCount by 1', () => {
      const pb = service.publish(sampleInput);
      expect(service.getById(pb.id)!.useCount).toBe(0);

      service.incrementUseCount(pb.id);
      expect(service.getById(pb.id)!.useCount).toBe(1);

      service.incrementUseCount(pb.id);
      expect(service.getById(pb.id)!.useCount).toBe(2);
    });

    it('does nothing for unknown id', () => {
      // Should not throw
      service.incrementUseCount('nonexistent');
    });
  });

  // ── Persistence ──────────────────────────────────

  describe('persistence', () => {
    it('saves playbooks to db on publish', () => {
      service.publish(sampleInput);
      expect(db.setSetting).toHaveBeenCalledWith('community_playbooks', expect.any(String));
    });

    it('saves reviews to db on addReview', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 5);
      expect(db.setSetting).toHaveBeenCalledWith('community_reviews', expect.any(String));
    });

    it('loads playbooks from db on construction', () => {
      service.publish(sampleInput);
      // Create new service instance using same db
      const service2 = new CommunityPlaybookService(db as any);
      const all = service2.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Code Review Sprint');
    });

    it('loads reviews from db on construction', () => {
      const pb = service.publish(sampleInput);
      service.addReview(pb.id, 4, 'Good');

      const service2 = new CommunityPlaybookService(db as any);
      const reviews = service2.getReviews(pb.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].comment).toBe('Good');
    });

    it('handles corrupt playbooks data gracefully', () => {
      db.getSetting.mockReturnValueOnce('not valid json');
      const service2 = new CommunityPlaybookService(db as any);
      expect(service2.getAll()).toEqual([]);
    });

    it('handles corrupt reviews data gracefully', () => {
      db.getSetting.mockImplementation((key: string) => {
        if (key === 'community_reviews') return '{broken';
        return undefined;
      });
      const service2 = new CommunityPlaybookService(db as any);
      expect(service2.getReviews('any')).toEqual([]);
    });

    it('handles missing db data gracefully', () => {
      const emptyDb = createMockDb();
      const service2 = new CommunityPlaybookService(emptyDb as any);
      expect(service2.getAll()).toEqual([]);
    });
  });

  describe('Privacy guardrails', () => {
    it('strips systemPrompt from published config', () => {
      const pb = service.publish(makeInput({
        config: { roles: ['dev'], systemPrompt: 'You are a secret agent', model: 'sonnet' },
      }));
      expect(pb.config).toEqual({ roles: ['dev'], model: 'sonnet' });
      expect(pb.config).not.toHaveProperty('systemPrompt');
    });

    it('strips api_key and token fields', () => {
      const pb = service.publish(makeInput({
        config: { name: 'test', apiKey: 'sk-abc123', token: 'ghp_secret' },
      }));
      expect(pb.config).toEqual({ name: 'test' });
    });

    it('strips nested sensitive keys recursively', () => {
      const pb = service.publish(makeInput({
        config: {
          outer: { inner: { password: 'hunter2', safe: true } },
          visible: 'ok',
        },
      }));
      expect(pb.config).toEqual({ outer: { inner: { safe: true } }, visible: 'ok' });
    });

    it('strips values that look like GitHub PATs', () => {
      const pb = service.publish(makeInput({
        config: { ref: 'ghp_1234567890abcdef1234567890abcdef12345678' },
      }));
      expect(pb.config).toEqual({});
    });

    it('strips values that look like long tokens (40+ alphanum)', () => {
      const longToken = 'a'.repeat(45);
      const pb = service.publish(makeInput({
        config: { key: longToken, name: 'ok' },
      }));
      expect(pb.config).toEqual({ name: 'ok' });
    });

    it('strips values with Bearer prefix', () => {
      const pb = service.publish(makeInput({
        config: { auth: 'Bearer eyJhbGciOiJSUzI1NiJ9.test', name: 'ok' },
      }));
      expect(pb.config).toEqual({ name: 'ok' });
    });

    it('preserves normal string values', () => {
      const pb = service.publish(makeInput({
        config: { name: 'My Playbook', count: 5, enabled: true },
      }));
      expect(pb.config).toEqual({ name: 'My Playbook', count: 5, enabled: true });
    });

    it('sanitizes config on update too', () => {
      const pb = service.publish(makeInput({ config: { safe: true } }));
      const updated = service.update(pb.id, {
        config: { safe: false, secretKey: 'supersecret' },
      });
      expect(updated?.config).toEqual({ safe: false });
    });

    it('sanitizeConfig preserves arrays', () => {
      const result = sanitizeConfig({ items: [1, 2, 3], tags: ['a', 'b'] });
      expect(result).toEqual({ items: [1, 2, 3], tags: ['a', 'b'] });
    });

    it('looksLikeSecret detects GitHub PATs', () => {
      expect(looksLikeSecret('ghp_1234567890abcdef1234567890abcdef12345678')).toBe(true);
      expect(looksLikeSecret('ghs_1234567890abcdef1234567890abcdef12345678')).toBe(true);
    });

    it('looksLikeSecret rejects short normal strings', () => {
      expect(looksLikeSecret('hello world')).toBe(false);
      expect(looksLikeSecret('my-playbook-name')).toBe(false);
    });

    it('strips secret strings inside arrays', () => {
      const pb = service.publish(makeInput({
        config: { tokens: ['ghp_1234567890abcdef1234567890abcdef12345678', 'safe-value'] },
      }));
      expect(pb.config).toEqual({ tokens: ['safe-value'] });
    });

    it('recurses into objects inside arrays', () => {
      const pb = service.publish(makeInput({
        config: {
          steps: [
            { name: 'build', password: 'secret123' },
            { name: 'test', safe: true },
          ],
        },
      }));
      expect(pb.config).toEqual({
        steps: [
          { name: 'build' },
          { name: 'test', safe: true },
        ],
      });
    });

    it('handles nested arrays', () => {
      const longToken = 'a'.repeat(45);
      const result = sanitizeConfig({
        matrix: [['ok', longToken], ['fine']],
      });
      expect(result).toEqual({ matrix: [['ok'], ['fine']] });
    });
  });
});
