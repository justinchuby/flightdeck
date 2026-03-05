import { Router } from 'express';
import type { AppContext } from './context.js';
import { PlaybookService } from '../coordination/PlaybookService.js';

export function playbookRoutes(ctx: AppContext): Router {
  const { db } = ctx;
  const service = new PlaybookService(db);
  const router = Router();

  // GET /api/playbooks — list all playbooks
  router.get('/playbooks', (_req, res) => {
    res.json(service.list());
  });

  // GET /api/playbooks/:id — get a single playbook
  router.get('/playbooks/:id', (req, res) => {
    const playbook = service.get(req.params.id);
    if (!playbook) return res.status(404).json({ error: 'Playbook not found' });
    res.json(playbook);
  });

  // POST /api/playbooks — create a new playbook
  router.post('/playbooks', (req, res) => {
    const { name, description, roles, taskTemplates, settings } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ error: 'roles array is required and must not be empty' });
    }

    try {
      const playbook = service.create({
        name,
        description: description || '',
        roles,
        taskTemplates: taskTemplates || [],
        settings: settings || {},
      });
      res.status(201).json(playbook);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('already exists')) {
        return res.status(409).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  // PATCH /api/playbooks/:id — update a playbook
  router.patch('/playbooks/:id', (req, res) => {
    try {
      const updated = service.update(req.params.id, req.body);
      res.json(updated);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) return res.status(404).json({ error: message });
      if (message.includes('already exists')) return res.status(409).json({ error: message });
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/playbooks/:id — delete a playbook
  router.delete('/playbooks/:id', (req, res) => {
    const deleted = service.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Playbook not found' });
    res.json({ deleted: true });
  });

  // POST /api/playbooks/:id/apply — generate crew config from playbook
  router.post('/playbooks/:id/apply', (req, res) => {
    try {
      const config = service.apply(req.params.id);
      res.json(config);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) return res.status(404).json({ error: message });
      res.status(500).json({ error: message });
    }
  });

  return router;
}
