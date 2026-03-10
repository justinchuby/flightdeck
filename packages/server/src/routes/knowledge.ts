import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import { rateLimit } from '../middleware/rateLimit.js';
import type { KnowledgeCategory } from '../knowledge/types.js';
import { sanitizeContent } from '../knowledge/index.js';
import { parseIntBounded } from '../utils/validation.js';

const VALID_CATEGORIES = new Set<string>(['core', 'episodic', 'procedural', 'semantic']);
const UI_WRITABLE_CATEGORIES = new Set<string>(['episodic', 'procedural', 'semantic']);
const MAX_SEARCH_QUERY_LENGTH = 500;

const knowledgeReadLimiter = rateLimit({ windowMs: 60_000, max: 120, message: 'Too many knowledge read requests' });
const knowledgeWriteLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many knowledge write requests' });
const knowledgeSearchLimiter = rateLimit({ windowMs: 60_000, max: 60, message: 'Too many knowledge search requests' });

function isValidCategory(cat: string): cat is KnowledgeCategory {
  return VALID_CATEGORIES.has(cat);
}

/** Extract a single string param (Express 5 may return string | string[]) */
function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] ?? '' : val ?? '';
}

/** Whitelist of metadata fields users may set via the UI */
const ALLOWED_METADATA_FIELDS = new Set(['description', 'tags', 'label', 'notes']);

/** Strip internal/reserved metadata fields — only allow safe user-provided ones */
function sanitizeMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;           // internal fields (_protectedHash, etc.)
    if (!ALLOWED_METADATA_FIELDS.has(k)) continue; // only whitelisted fields
    if (typeof v === 'string') {
      cleaned[k] = v.slice(0, 1000);           // cap string values
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      cleaned[k] = v;
    }
    // drop anything else (objects, arrays, functions)
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function knowledgeRoutes(ctx: AppContext): Router {
  const { knowledgeStore, hybridSearchEngine, memoryCategoryManager, trainingCapture } = ctx;
  const router = Router();

  // --- Knowledge CRUD ---

  /** List knowledge entries for a project, optionally filtered by category */
  router.get('/projects/:id/knowledge', knowledgeReadLimiter, (req, res) => {
    if (!knowledgeStore) return res.status(503).json({ error: 'Knowledge store not available' });
    const projectId = paramStr(req.params.id);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;

    if (category && !isValidCategory(category)) {
      return res.status(400).json({ error: `Invalid category: ${category}. Must be one of: core, episodic, procedural, semantic` });
    }

    const entries = category
      ? knowledgeStore.getByCategory(projectId, category as KnowledgeCategory)
      : knowledgeStore.getAll(projectId);
    res.json(entries);
  });

  /** Search knowledge entries using full-text search */
  router.get('/projects/:id/knowledge/search', knowledgeSearchLimiter, (req, res) => {
    const projectId = paramStr(req.params.id);
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!rawQuery) return res.status(400).json({ error: 'Query parameter "q" is required' });
    const query = rawQuery.slice(0, MAX_SEARCH_QUERY_LENGTH);

    // Prefer hybrid search if available, fall back to FTS5-only
    if (hybridSearchEngine) {
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const limit = parseIntBounded(req.query.limit, 1, 100, 20);
      const categories = category && isValidCategory(category) ? [category as KnowledgeCategory] : undefined;

      const results = hybridSearchEngine.search(projectId, query, { categories, limit });
      return res.json(results);
    }

    if (!knowledgeStore) return res.status(503).json({ error: 'Knowledge store not available' });
    const limit = parseIntBounded(req.query.limit, 1, 100, 20);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const entries = knowledgeStore.search(projectId, query, {
      limit,
      category: category && isValidCategory(category) ? category as KnowledgeCategory : undefined,
    });
    res.json(entries);
  });

  /** Get category stats for a project */
  router.get('/projects/:id/knowledge/stats', knowledgeReadLimiter, (req, res) => {
    if (!memoryCategoryManager) return res.status(503).json({ error: 'Knowledge manager not available' });
    const stats = memoryCategoryManager.getCategoryStats(paramStr(req.params.id));
    res.json(stats);
  });

  /** Get training summary (corrections + feedback) for a project */
  router.get('/projects/:id/knowledge/training', knowledgeReadLimiter, (req, res) => {
    if (!trainingCapture) return res.status(503).json({ error: 'Training capture not available' });
    const summary = trainingCapture.getTrainingSummary(paramStr(req.params.id));
    res.json(summary);
  });

  /** Create or update a knowledge entry */
  router.post('/projects/:id/knowledge', knowledgeWriteLimiter, (req, res) => {
    if (!memoryCategoryManager) return res.status(503).json({ error: 'Knowledge manager not available' });
    const projectId = paramStr(req.params.id);
    const { category, key, content, metadata } = req.body;

    if (!category || !key || !content) {
      return res.status(400).json({ error: 'category, key, and content are required' });
    }
    if (!isValidCategory(category)) {
      return res.status(400).json({ error: `Invalid category: ${category}. Must be one of: core, episodic, procedural, semantic` });
    }
    if (!UI_WRITABLE_CATEGORIES.has(category)) {
      return res.status(403).json({ error: 'Core entries cannot be created or modified via the UI' });
    }

    // Sanitize content to prevent prompt injection
    const sanitizedContent = sanitizeContent(String(content));
    const sanitizedKey = String(key).slice(0, 200).replace(/[^\w\s\-_.]/g, '');
    if (!sanitizedKey) {
      return res.status(400).json({ error: 'Invalid key after sanitization' });
    }
    const sanitizedMetadata = sanitizeMetadata(metadata);

    // Validate via category manager (enforces max limits, etc.)
    const validationError = memoryCategoryManager.validateMemory(projectId, category, sanitizedKey, sanitizedContent);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    try {
      const entry = memoryCategoryManager.putMemory(projectId, category, sanitizedKey, sanitizedContent, sanitizedMetadata);
      logger.info({ module: 'knowledge', msg: 'Knowledge entry created', projectId, category, key: sanitizedKey });
      res.status(201).json(entry);
    } catch (err: any) {
      logger.error({ module: 'knowledge', msg: 'Failed to create knowledge entry', err: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  /** Delete a knowledge entry */
  router.delete('/projects/:id/knowledge/:category/:key', knowledgeWriteLimiter, (req, res) => {
    if (!memoryCategoryManager) return res.status(503).json({ error: 'Knowledge manager not available' });
    const projectId = paramStr(req.params.id);
    const category = paramStr(req.params.category);
    const key = paramStr(req.params.key);

    if (!isValidCategory(category)) {
      return res.status(400).json({ error: `Invalid category: ${category}` });
    }

    const deleted = memoryCategoryManager.deleteMemory(projectId, category as KnowledgeCategory, key);
    if (!deleted) return res.status(404).json({ error: 'Entry not found' });

    logger.info({ module: 'knowledge', msg: 'Knowledge entry deleted', projectId, category, key });
    res.json({ ok: true });
  });

  return router;
}
