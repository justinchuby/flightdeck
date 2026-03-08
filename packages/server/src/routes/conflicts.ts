import { Router } from 'express';
import type { AppContext } from './context.js';
import { ConflictDetectionEngine } from '../coordination/decisions/ConflictDetectionEngine.js';

export function conflictRoutes(ctx: AppContext): Router {
  const engine = new ConflictDetectionEngine(ctx.db);
  const router = Router();

  // GET /conflicts — active conflicts
  router.get('/conflicts', (_req, res) => {
    res.json({ conflicts: engine.getConflicts() });
  });

  // GET /conflicts/all — all conflicts including resolved/dismissed
  router.get('/conflicts/all', (_req, res) => {
    res.json({ conflicts: engine.getAllConflicts() });
  });

  // GET /conflicts/config — detection config
  router.get('/conflicts/config', (_req, res) => {
    res.json(engine.getConfig());
  });

  // PUT /conflicts/config — update config
  router.put('/conflicts/config', (req, res) => {
    try {
      const config = engine.updateConfig(req.body);
      res.json(config);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // GET /conflicts/:id — single conflict
  router.get('/conflicts/:id', (req, res) => {
    const conflict = engine.getConflict(req.params.id);
    if (!conflict) return res.status(404).json({ error: 'Conflict not found' });
    res.json(conflict);
  });

  // POST /conflicts/:id/resolve — resolve with strategy
  router.post('/conflicts/:id/resolve', (req, res) => {
    const { resolution } = req.body;
    if (!resolution) return res.status(400).json({ error: 'Missing required field: resolution' });
    const resolved = engine.resolve(req.params.id, resolution);
    if (!resolved) return res.status(404).json({ error: 'Conflict not found or already resolved' });
    res.json({ ok: true });
  });

  // POST /conflicts/:id/dismiss — dismiss a conflict
  router.post('/conflicts/:id/dismiss', (req, res) => {
    const dismissed = engine.dismiss(req.params.id);
    if (!dismissed) return res.status(404).json({ error: 'Conflict not found or already resolved' });
    res.json({ ok: true });
  });

  // POST /conflicts/scan — manually trigger a scan
  router.post('/conflicts/scan', (req, res) => {
    const { locks, recentEdits } = req.body;
    if (!locks || !Array.isArray(locks)) {
      return res.status(400).json({ error: 'Missing required field: locks (array)' });
    }
    try {
      const conflicts = engine.scan(locks, recentEdits || []);
      res.json({ conflicts, count: conflicts.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
