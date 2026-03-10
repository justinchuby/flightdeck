import { Router } from 'express';
import type { AppContext } from './routes/context.js';
import { mountAllRoutes } from './routes/index.js';

export function apiRouter(ctx: AppContext): Router {
  const router = Router();
  mountAllRoutes(router, ctx);
  return router;
}
