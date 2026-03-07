import type { Database } from '../../db/database.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type PlaybookCategory =
  | 'development'
  | 'testing'
  | 'security'
  | 'devops'
  | 'documentation'
  | 'data'
  | 'design'
  | 'other';

export interface PlaybookReview {
  id: string;
  playbookId: string;
  rating: number; // 1-5
  comment?: string;
  createdAt: string;
}

export interface CommunityPlaybook {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  tags: string[];
  publisher: string;
  rating: { average: number; count: number };
  useCount: number;
  version: string; // semver
  publishedAt: string;
  updatedAt: string;
  featured: boolean;
  config: Record<string, unknown>;
  forkedFrom?: string;
  versions: PlaybookVersion[];
}

export interface PlaybookVersion {
  version: string;
  publishedAt: string;
  changelog?: string;
}

export interface PublishInput {
  name: string;
  description: string;
  category: PlaybookCategory;
  tags: string[];
  config: Record<string, unknown>;
  publisher?: string;
}

export interface ForkResult {
  id: string;
  name: string;
  forkedFrom: string;
}

// ── Constants ─────────────────────────────────────────────────────

const PLAYBOOKS_KEY = 'community_playbooks';
const REVIEWS_KEY = 'community_reviews';
const MAX_PLAYBOOKS = 500;
const MAX_REVIEWS = 2000;
const FEATURED_MIN_RATING = 3.5;
const FEATURED_MIN_COUNT = 3;

// Keys stripped from config during publish (privacy guardrails)
const SENSITIVE_KEYS = new Set([
  'systemPrompt', 'system_prompt', 'systemMessage', 'system_message',
  'token', 'apiKey', 'api_key', 'apiToken', 'api_token',
  'secret', 'password', 'credential', 'credentials',
  'pat', 'personalAccessToken', 'accessToken', 'access_token',
  'privateKey', 'private_key', 'secretKey', 'secret_key',
  'webhookUrl', 'webhook_url', 'webhookSecret', 'webhook_secret',
]);

/** Recursively strip sensitive keys from a config object */
export function sanitizeConfig(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof value === 'string' && looksLikeSecret(value)) continue;
    if (Array.isArray(value)) {
      result[key] = sanitizeArray(value);
    } else if (value !== null && typeof value === 'object') {
      result[key] = sanitizeConfig(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Sanitize array items: filter secret strings, recurse into objects */
function sanitizeArray(arr: unknown[]): unknown[] {
  return arr
    .filter(item => !(typeof item === 'string' && looksLikeSecret(item)))
    .map(item => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        return sanitizeConfig(item as Record<string, unknown>);
      }
      if (Array.isArray(item)) {
        return sanitizeArray(item);
      }
      return item;
    });
}

/** Heuristic: detect strings that look like tokens/secrets */
export function looksLikeSecret(value: string): boolean {
  // GitHub PATs
  if (/^gh[ps]_[A-Za-z0-9]{36,}$/.test(value)) return true;
  // Generic long hex/base64 tokens (40+ chars, no spaces)
  if (value.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return true;
  // Bearer tokens
  if (/^Bearer\s+/i.test(value)) return true;
  return false;
}

// ── CommunityPlaybookService ──────────────────────────────────────

export class CommunityPlaybookService {
  private playbooks: CommunityPlaybook[] = [];
  private reviews: PlaybookReview[] = [];

  constructor(private db: Database) {
    this.playbooks = this.loadPlaybooks();
    this.reviews = this.loadReviews();
  }

  // ── Browse / Search ─────────────────────────────

  getAll(options?: {
    category?: PlaybookCategory;
    sort?: 'popular' | 'recent' | 'rating';
    search?: string;
  }): CommunityPlaybook[] {
    let results = [...this.playbooks];

    if (options?.category) {
      results = results.filter(p => p.category === options.category);
    }

    if (options?.search) {
      const term = options.search.toLowerCase();
      results = results.filter(
        p =>
          p.name.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term) ||
          p.tags.some(t => t.toLowerCase().includes(term)),
      );
    }

    if (options?.sort) {
      switch (options.sort) {
        case 'popular':
          results.sort((a, b) => b.useCount - a.useCount);
          break;
        case 'recent':
          results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
          break;
        case 'rating':
          results.sort((a, b) => b.rating.average - a.rating.average);
          break;
      }
    }

    return results;
  }

  getById(id: string): CommunityPlaybook | undefined {
    return this.playbooks.find(p => p.id === id);
  }

  getFeatured(): CommunityPlaybook[] {
    return this.playbooks.filter(p => p.featured);
  }

  // ── Publish ─────────────────────────────────────

  publish(input: PublishInput): CommunityPlaybook {
    if (!input.name?.trim()) {
      throw new Error('Playbook name is required');
    }
    if (!input.description?.trim()) {
      throw new Error('Playbook description is required');
    }
    if (!input.category) {
      throw new Error('Playbook category is required');
    }

    if (this.playbooks.length >= MAX_PLAYBOOKS) {
      throw new Error(`Maximum number of community playbooks (${MAX_PLAYBOOKS}) reached`);
    }

    const now = new Date().toISOString();
    const safeConfig = sanitizeConfig(input.config ?? {});
    const playbook: CommunityPlaybook = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name.trim(),
      description: input.description.trim(),
      category: input.category,
      tags: input.tags ?? [],
      publisher: input.publisher?.trim() || 'anonymous',
      rating: { average: 0, count: 0 },
      useCount: 0,
      version: '1.0.0',
      publishedAt: now,
      updatedAt: now,
      featured: false,
      config: safeConfig,
      versions: [{ version: '1.0.0', publishedAt: now }],
    };

    this.playbooks.push(playbook);
    this.savePlaybooks();
    logger.info({ module: 'project', msg: 'Playbook published', playbookId: playbook.id, name: playbook.name });
    return playbook;
  }

  update(
    id: string,
    updates: Partial<Pick<CommunityPlaybook, 'name' | 'description' | 'category' | 'tags' | 'config'>>,
  ): CommunityPlaybook | undefined {
    const playbook = this.playbooks.find(p => p.id === id);
    if (!playbook) return undefined;

    if (updates.name !== undefined) playbook.name = updates.name;
    if (updates.description !== undefined) playbook.description = updates.description;
    if (updates.category !== undefined) playbook.category = updates.category;
    if (updates.tags !== undefined) playbook.tags = updates.tags;
    if (updates.config !== undefined) playbook.config = sanitizeConfig(updates.config);
    playbook.updatedAt = new Date().toISOString();

    this.savePlaybooks();
    logger.info({ module: 'project', msg: 'Playbook updated', playbookId: id, name: playbook.name });
    return playbook;
  }

  unpublish(id: string): boolean {
    const idx = this.playbooks.findIndex(p => p.id === id);
    if (idx === -1) return false;

    const removed = this.playbooks.splice(idx, 1)[0];
    // Also remove associated reviews
    this.reviews = this.reviews.filter(r => r.playbookId !== id);
    this.savePlaybooks();
    this.saveReviews();
    logger.info({ module: 'project', msg: 'Playbook unpublished', playbookId: id, name: removed.name });
    return true;
  }

  // ── Reviews ─────────────────────────────────────

  getReviews(playbookId: string): PlaybookReview[] {
    return this.reviews.filter(r => r.playbookId === playbookId);
  }

  addReview(playbookId: string, rating: number, comment?: string): PlaybookReview | undefined {
    const playbook = this.playbooks.find(p => p.id === playbookId);
    if (!playbook) return undefined;

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating must be an integer between 1 and 5');
    }

    if (this.reviews.length >= MAX_REVIEWS) {
      // Evict oldest reviews to stay within limit
      this.reviews.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      this.reviews = this.reviews.slice(this.reviews.length - MAX_REVIEWS + 1);
    }

    const review: PlaybookReview = {
      id: `cpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      playbookId,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    };

    this.reviews.push(review);
    this.recalculateRating(playbookId);
    this.saveReviews();
    logger.info({ module: 'project', msg: 'Review added', playbookId, playbookName: playbook.name, rating });
    return review;
  }

  // ── Fork / Version ──────────────────────────────

  fork(id: string): ForkResult | undefined {
    const source = this.playbooks.find(p => p.id === id);
    if (!source) return undefined;

    if (this.playbooks.length >= MAX_PLAYBOOKS) {
      throw new Error(`Maximum number of community playbooks (${MAX_PLAYBOOKS}) reached`);
    }

    const now = new Date().toISOString();
    const forked: CommunityPlaybook = {
      ...structuredClone(source),
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${source.name} (Fork)`,
      rating: { average: 0, count: 0 },
      useCount: 0,
      featured: false,
      forkedFrom: source.id,
      publishedAt: now,
      updatedAt: now,
      version: '1.0.0',
      versions: [{ version: '1.0.0', publishedAt: now }],
    };

    this.playbooks.push(forked);
    this.savePlaybooks();
    logger.info({ module: 'project', msg: 'Playbook forked', sourceId: id, forkId: forked.id, sourceName: source.name, forkName: forked.name });

    return {
      id: forked.id,
      name: forked.name,
      forkedFrom: source.id,
    };
  }

  getVersions(id: string): PlaybookVersion[] {
    const playbook = this.playbooks.find(p => p.id === id);
    if (!playbook) return [];
    return playbook.versions;
  }

  publishVersion(id: string, version: string, changelog?: string): boolean {
    const playbook = this.playbooks.find(p => p.id === id);
    if (!playbook) return false;

    const entry: PlaybookVersion = {
      version,
      publishedAt: new Date().toISOString(),
      changelog,
    };

    playbook.versions.push(entry);
    playbook.version = version;
    playbook.updatedAt = entry.publishedAt;
    this.savePlaybooks();
    logger.info({ module: 'project', msg: 'Version published', playbookId: id, version, name: playbook.name });
    return true;
  }

  // ── Admin ───────────────────────────────────────

  setFeatured(id: string, featured: boolean): boolean {
    const playbook = this.playbooks.find(p => p.id === id);
    if (!playbook) return false;

    if (featured) {
      if (playbook.rating.average < FEATURED_MIN_RATING || playbook.rating.count < FEATURED_MIN_COUNT) {
        return false;
      }
    }

    playbook.featured = featured;
    this.savePlaybooks();
    logger.info({ module: 'project', msg: 'Featured status changed', playbookId: id, featured, name: playbook.name });
    return true;
  }

  incrementUseCount(id: string): void {
    const playbook = this.playbooks.find(p => p.id === id);
    if (!playbook) return;

    playbook.useCount++;
    this.savePlaybooks();
  }

  // ── Private ─────────────────────────────────────

  private recalculateRating(playbookId: string): void {
    const playbook = this.playbooks.find(p => p.id === playbookId);
    if (!playbook) return;

    const playbookReviews = this.reviews.filter(r => r.playbookId === playbookId);
    if (playbookReviews.length === 0) {
      playbook.rating = { average: 0, count: 0 };
      return;
    }

    const sum = playbookReviews.reduce((acc, r) => acc + r.rating, 0);
    playbook.rating = {
      average: Math.round((sum / playbookReviews.length) * 100) / 100,
      count: playbookReviews.length,
    };
  }

  private loadPlaybooks(): CommunityPlaybook[] {
    try {
      const raw = this.db.getSetting(PLAYBOOKS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* use empty */
    }
    return [];
  }

  private savePlaybooks(): void {
    this.db.setSetting(PLAYBOOKS_KEY, JSON.stringify(this.playbooks));
  }

  private loadReviews(): PlaybookReview[] {
    try {
      const raw = this.db.getSetting(REVIEWS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* use empty */
    }
    return [];
  }

  private saveReviews(): void {
    this.db.setSetting(REVIEWS_KEY, JSON.stringify(this.reviews));
  }
}
