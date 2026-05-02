import { Router } from 'express';
import { badRequest } from '../errors/index.js';
import { validateBody, registerRoleSchema } from '../validation/schemas.js';
import { writeAgentFiles } from '../agents/agentFiles.js';
import type { AppContext } from './context.js';

export function rolesRoutes(ctx: AppContext): Router {
  const { roleRegistry } = ctx;
  const router = Router();

  // --- Roles ---
  router.get('/roles', (_req, res) => {
    res.json(roleRegistry.getAll());
  });

  router.post('/roles', validateBody(registerRoleSchema), (req, res) => {
    const role = roleRegistry.register(req.body);
    writeAgentFiles([role]);
    res.status(201).json(role);
  });

  router.delete('/roles/:id', (req, res) => {
    const ok = roleRegistry.remove(req.params.id);
    res.json({ ok });
  });

  // POST /roles/test — dry-run a custom role with a test message
  router.post('/roles/test', (req, res) => {
    const { role, message } = req.body as { role?: Record<string, unknown>; message?: string };
    if (!role) throw badRequest('Missing required field: role');
    if (!message) throw badRequest('Missing required field: message');

    const name = (role.name as string) || 'Custom Role';
    const systemPrompt = (role.systemPrompt as string) || '';
    const description = (role.description as string) || '';

    // Build a simulated response based on role config (no actual LLM call)
    const response = [
      `[Test Mode] Role "${name}" configured successfully.`,
      description ? `Description: ${description}` : '',
      systemPrompt ? `System prompt: ${systemPrompt.slice(0, 200)}${systemPrompt.length > 200 ? '...' : ''}` : '',
      `Test message: "${message}"`,
      `This role would respond using model: ${(role.model as string) || 'default'}`,
    ].filter(Boolean).join('\n');

    res.json({ response, role: name, valid: true });
  });

  return router;
}
