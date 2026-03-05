import { Router } from 'express';
import type { AppContext } from './context.js';
import { WorkflowService } from '../coordination/WorkflowService.js';

export function workflowRoutes(ctx: AppContext): Router {
  const service = new WorkflowService(ctx.db);
  const router = Router();

  // GET /workflows — list all rules
  router.get('/workflows', (_req, res) => {
    res.json({ rules: service.getRules() });
  });

  // GET /workflows/templates — list all templates
  router.get('/workflows/templates', (req, res) => {
    const category = req.query.category as string | undefined;
    if (category) {
      res.json({ templates: service.getTemplatesByCategory(category as any) });
    } else {
      res.json({ templates: service.getTemplates() });
    }
  });

  // GET /workflows/activity — activity log
  router.get('/workflows/activity', (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    res.json({ activity: service.getActivity(limit) });
  });

  // GET /workflows/:id — get single rule
  router.get('/workflows/:id', (req, res) => {
    const rule = service.getRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Workflow rule not found' });
    res.json(rule);
  });

  // POST /workflows — create rule
  router.post('/workflows', (req, res) => {
    try {
      const rule = service.createRule(req.body);
      res.status(201).json(rule);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // POST /workflows/from-template — create from template
  router.post('/workflows/from-template', (req, res) => {
    const { templateId, overrides } = req.body as { templateId?: string; overrides?: any };
    if (!templateId) return res.status(400).json({ error: 'Missing required field: templateId' });
    const rule = service.createFromTemplate(templateId, overrides);
    if (!rule) return res.status(404).json({ error: 'Template not found' });
    res.status(201).json(rule);
  });

  // PUT /workflows/:id — update rule
  router.put('/workflows/:id', (req, res) => {
    const rule = service.updateRule(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'Workflow rule not found' });
    res.json(rule);
  });

  // DELETE /workflows/:id — delete rule
  router.delete('/workflows/:id', (req, res) => {
    const deleted = service.deleteRule(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Workflow rule not found' });
    res.json({ ok: true });
  });

  // POST /workflows/:id/toggle — toggle enabled/disabled
  router.post('/workflows/:id/toggle', (req, res) => {
    const rule = service.toggleRule(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Workflow rule not found' });
    res.json(rule);
  });

  // POST /workflows/reorder — set rule priority order
  router.post('/workflows/reorder', (req, res) => {
    const { ruleIds } = req.body as { ruleIds?: string[] };
    if (!ruleIds || !Array.isArray(ruleIds)) {
      return res.status(400).json({ error: 'Missing required field: ruleIds (array)' });
    }
    service.reorderRules(ruleIds);
    res.json({ ok: true });
  });

  // POST /workflows/dry-run — check which rules would fire
  router.post('/workflows/dry-run', (req, res) => {
    const { context } = req.body;
    if (!context) return res.status(400).json({ error: 'Missing required field: context' });
    try {
      const results = service.dryRun(context);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /workflows/evaluate — trigger event evaluation (for testing/manual trigger)
  router.post('/workflows/evaluate', (req, res) => {
    const { event, context } = req.body;
    if (!event) return res.status(400).json({ error: 'Missing required field: event' });
    if (!context) return res.status(400).json({ error: 'Missing required field: context' });
    try {
      const results = service.evaluateEvent(event, context);
      // Record activity for each fired rule
      for (const result of results) {
        service.recordActivity({
          ruleId: result.rule.id,
          ruleName: result.rule.name,
          event,
          actionsExecuted: result.actions.map(a => a.type),
          success: true,
        });
      }
      res.json({ fired: results.length, results: results.map(r => ({
        ruleId: r.rule.id,
        ruleName: r.rule.name,
        matchedConditions: r.matchedConditions,
        actions: r.actions,
        notifications: r.notifications,
      })) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
