import { Router } from 'express';
import type { AppContext } from './context.js';
import { ShareLinkService } from '../coordination/sharing/ShareLinkService.js';
import { SessionReplay } from '../coordination/sessions/SessionReplay.js';

export function sharedRoutes(ctx: AppContext): Router {
  const { db, agentManager, activityLedger, decisionLog, lockRegistry } = ctx;
  const shareService = new ShareLinkService(db);
  const router = Router();

  // Lazy-init replay service
  let replay: SessionReplay | null = null;
  function getReplay(): SessionReplay | null {
    if (replay) return replay;
    const taskDAG = agentManager.getTaskDAG?.();
    if (!taskDAG || !activityLedger || !decisionLog || !lockRegistry) return null;
    replay = new SessionReplay(activityLedger, taskDAG, decisionLog, lockRegistry);
    return replay;
  }

  // POST /api/replay/:leadId/share — create a share link
  router.post('/replay/:leadId/share', (req, res) => {
    try {
      const { leadId } = req.params;
      const { expiresInHours, label } = req.body ?? {};
      const link = shareService.create({ leadId, expiresInHours, label });
      res.status(201).json(link);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create share link', detail: (err as Error).message });
    }
  });

  // GET /api/replay/:leadId/shares — list share links for a lead
  router.get('/replay/:leadId/shares', (req, res) => {
    res.json(shareService.listForLead(req.params.leadId));
  });

  // DELETE /api/shared/:token — revoke a share link
  router.delete('/shared/:token', (req, res) => {
    const revoked = shareService.revoke(req.params.token);
    if (!revoked) return res.status(404).json({ error: 'Share link not found' });
    res.json({ revoked: true });
  });

  // GET /api/shared/:token — public replay access (no auth required)
  router.get('/shared/:token', (req, res) => {
    const link = shareService.validate(req.params.token);
    if (!link) {
      return res.status(404).json({ error: 'Share link not found or expired' });
    }

    const r = getReplay();
    if (!r) return res.status(503).json({ error: 'Replay service not available' });

    try {
      // Return keyframes + latest state for the shared session
      const keyframes = r.getKeyframes(link.leadId);
      const latestTimestamp = keyframes.length > 0
        ? keyframes[keyframes.length - 1].timestamp
        : new Date().toISOString();
      const state = r.getWorldStateAt(link.leadId, latestTimestamp);

      res.json({
        leadId: link.leadId,
        label: link.label,
        expiresAt: link.expiresAt,
        keyframes,
        state,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load shared replay', detail: (err as Error).message });
    }
  });

  // GET /api/shared/:token/state?at=<ISO> — public replay state at timestamp
  router.get('/shared/:token/state', (req, res) => {
    const link = shareService.validate(req.params.token);
    if (!link) return res.status(404).json({ error: 'Share link not found or expired' });

    const timestamp = req.query.at as string;
    if (!timestamp) return res.status(400).json({ error: 'Missing required query param: at' });

    const r = getReplay();
    if (!r) return res.status(503).json({ error: 'Replay service not available' });

    try {
      const state = r.getWorldStateAt(link.leadId, timestamp);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: 'Failed to reconstruct state', detail: (err as Error).message });
    }
  });

  return router;
}
