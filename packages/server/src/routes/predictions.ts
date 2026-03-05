import { Router } from 'express';
import type { AppContext } from './context.js';
import { PredictionService } from '../coordination/PredictionService.js';

export function predictionRoutes(ctx: AppContext): Router {
  const service = new PredictionService(ctx.db);
  const router = Router();

  // GET /predictions — active predictions
  router.get('/predictions', (_req, res) => {
    res.json({ predictions: service.getActive() });
  });

  // GET /predictions/history — resolved predictions
  router.get('/predictions/history', (_req, res) => {
    res.json({ predictions: service.getHistory() });
  });

  // GET /predictions/accuracy — accuracy stats
  router.get('/predictions/accuracy', (_req, res) => {
    res.json(service.getAccuracy());
  });

  // GET /predictions/config — get config
  router.get('/predictions/config', (_req, res) => {
    res.json(service.getConfig());
  });

  // PUT /predictions/config — update config
  router.put('/predictions/config', (req, res) => {
    try {
      const config = service.updateConfig(req.body);
      res.json(config);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /predictions/:id/dismiss — dismiss a prediction
  router.post('/predictions/:id/dismiss', (req, res) => {
    const dismissed = service.dismiss(req.params.id);
    if (!dismissed) return res.status(404).json({ error: 'Prediction not found' });
    res.json({ ok: true });
  });

  // POST /predictions/:id/resolve — resolve with outcome
  router.post('/predictions/:id/resolve', (req, res) => {
    const { outcome } = req.body as { outcome?: string };
    if (!outcome || !['correct', 'avoided', 'wrong'].includes(outcome)) {
      return res.status(400).json({ error: 'Invalid outcome. Must be: correct, avoided, or wrong' });
    }
    const resolved = service.resolve(req.params.id, outcome as 'correct' | 'avoided' | 'wrong');
    if (!resolved) return res.status(404).json({ error: 'Prediction not found' });
    res.json({ ok: true });
  });

  // POST /predictions/generate — manually trigger prediction generation
  // In production this would be called by a periodic check loop
  // Accepts { agents: AgentSnapshot[], budget?: BudgetSnapshot }
  router.post('/predictions/generate', (req, res) => {
    const { agents, budget } = req.body;
    if (!agents || !Array.isArray(agents)) {
      return res.status(400).json({ error: 'Missing required field: agents (array)' });
    }
    try {
      const predictions = service.generatePredictions(agents, budget);
      res.json({ predictions, count: predictions.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
