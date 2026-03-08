import { Router } from 'express';
import type { AppContext } from './context.js';
import { CommunityPlaybookService } from '../coordination/playbooks/CommunityPlaybookService.js';
import type { PlaybookCategory } from '../coordination/playbooks/CommunityPlaybookService.js';

export function communityRoutes(ctx: AppContext): Router {
  const service = new CommunityPlaybookService(ctx.db);
  const router = Router();

  // GET /playbooks/community — browse/search community playbooks
  router.get('/playbooks/community', (req, res) => {
    const category = req.query.category as PlaybookCategory | undefined;
    const sort = req.query.sort as 'popular' | 'recent' | 'rating' | undefined;
    const search = req.query.search as string | undefined;
    res.json({ playbooks: service.getAll({ category, sort, search }) });
  });

  // GET /playbooks/community/featured — featured playbooks
  router.get('/playbooks/community/featured', (_req, res) => {
    res.json({ playbooks: service.getFeatured() });
  });

  // GET /playbooks/community/:id — single playbook
  router.get('/playbooks/community/:id', (req, res) => {
    const pb = service.getById(req.params.id);
    if (!pb) return res.status(404).json({ error: 'Playbook not found' });
    res.json(pb);
  });

  // POST /playbooks/community — publish a playbook
  router.post('/playbooks/community', (req, res) => {
    try {
      const pb = service.publish(req.body);
      res.status(201).json(pb);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // PUT /playbooks/community/:id — update a published playbook
  router.put('/playbooks/community/:id', (req, res) => {
    const pb = service.update(req.params.id, req.body);
    if (!pb) return res.status(404).json({ error: 'Playbook not found' });
    res.json(pb);
  });

  // DELETE /playbooks/community/:id — unpublish
  router.delete('/playbooks/community/:id', (req, res) => {
    const removed = service.unpublish(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Playbook not found' });
    res.json({ ok: true });
  });

  // GET /playbooks/community/:id/reviews — reviews for a playbook
  router.get('/playbooks/community/:id/reviews', (req, res) => {
    res.json({ reviews: service.getReviews(req.params.id) });
  });

  // POST /playbooks/community/:id/reviews — submit a review
  router.post('/playbooks/community/:id/reviews', (req, res) => {
    const { rating, comment } = req.body as { rating?: number; comment?: string };
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'Missing required field: rating' });
    }
    const review = service.addReview(req.params.id, rating, comment);
    if (!review) return res.status(404).json({ error: 'Playbook not found or invalid rating' });
    res.status(201).json(review);
  });

  // POST /playbooks/community/:id/fork — fork a playbook
  router.post('/playbooks/community/:id/fork', (req, res) => {
    const result = service.fork(req.params.id);
    if (!result) return res.status(404).json({ error: 'Playbook not found' });
    res.status(201).json(result);
  });

  // GET /playbooks/community/:id/versions — version history
  router.get('/playbooks/community/:id/versions', (req, res) => {
    const versions = service.getVersions(req.params.id);
    res.json({ versions });
  });

  // POST /playbooks/community/:id/versions — publish new version
  router.post('/playbooks/community/:id/versions', (req, res) => {
    const { version, changelog } = req.body as { version?: string; changelog?: string };
    if (!version) return res.status(400).json({ error: 'Missing required field: version' });
    const ok = service.publishVersion(req.params.id, version, changelog);
    if (!ok) return res.status(404).json({ error: 'Playbook not found' });
    res.json({ ok: true });
  });

  return router;
}
