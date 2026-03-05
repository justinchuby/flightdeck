import { Router } from 'express';
import type { AppContext } from './context.js';
import { agentsRoutes } from './agents.js';
import { rolesRoutes } from './roles.js';
import { configRoutes } from './config.js';
import { coordinationRoutes } from './coordination.js';
import { leadRoutes } from './lead.js';
import { decisionsRoutes } from './decisions.js';
import { searchRoutes } from './search.js';
import { browseRoutes } from './browse.js';
import { projectsRoutes } from './projects.js';
import { sessionsRoutes } from './sessions.js';
import { dbRoutes } from './db.js';
import { servicesRoutes } from './services.js';
import { diffRoutes } from './diff.js';
import { replayRoutes } from './replay.js';
import { commsRoutes } from './comms.js';

export function mountAllRoutes(router: Router, ctx: AppContext): void {
  router.use(agentsRoutes(ctx));
  router.use(rolesRoutes(ctx));
  router.use(configRoutes(ctx));
  router.use(coordinationRoutes(ctx));
  router.use(leadRoutes(ctx));
  router.use(decisionsRoutes(ctx));
  router.use(searchRoutes(ctx));
  router.use(browseRoutes(ctx));
  router.use(projectsRoutes(ctx));
  router.use(sessionsRoutes(ctx));
  router.use(dbRoutes(ctx));
  router.use(servicesRoutes(ctx));
  router.use(diffRoutes(ctx));
  router.use(replayRoutes(ctx));
  router.use(commsRoutes(ctx));
}
