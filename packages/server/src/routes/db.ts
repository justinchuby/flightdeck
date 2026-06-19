import { Router } from 'express';
import { badRequest } from '../errors/index.js';
import { agentMemory, conversations, messages, decisions, activityLog, dagTasks } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import type { AppContext } from './context.js';

export function dbRoutes(ctx: AppContext): Router {
  const { db: _db } = ctx;
  const router = Router();

  // --- Database Browser ---

  router.get('/db/memory', (_req, res) => {
    const rows = _db.drizzle.select().from(agentMemory).orderBy(desc(agentMemory.createdAt)).all();
    res.json(rows);
  });

  router.delete('/db/memory/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) throw badRequest('Invalid ID');
    _db.drizzle.delete(agentMemory).where(eq(agentMemory.id, id)).run();
    res.json({ ok: true });
  });

  router.get('/db/conversations', (_req, res) => {
    const rows = _db.drizzle.select().from(conversations).orderBy(desc(conversations.createdAt)).all();
    res.json(rows);
  });

  router.get('/db/conversations/:id/messages', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit) || '100', 10) || 100, 1000);
    const rows = _db.drizzle.select().from(messages)
      .where(eq(messages.conversationId, req.params.id as string))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();
    res.json(rows.reverse());
  });

  router.delete('/db/conversations/:id', (req, res) => {
    const cid = req.params.id as string;
    _db.drizzle.delete(messages).where(eq(messages.conversationId, cid)).run();
    _db.drizzle.delete(conversations).where(eq(conversations.id, cid)).run();
    res.json({ ok: true });
  });

  router.get('/db/decisions', (_req, res) => {
    const rows = _db.drizzle.select().from(decisions).orderBy(desc(decisions.createdAt)).all();
    res.json(rows);
  });

  router.delete('/db/decisions/:id', (req, res) => {
    _db.drizzle.delete(decisions).where(eq(decisions.id, req.params.id as string)).run();
    res.json({ ok: true });
  });

  router.get('/db/activity', (_req, res) => {
    const limit = Math.min(parseInt(String(_req.query.limit) || '200', 10) || 200, 2000);
    const rows = _db.drizzle.select().from(activityLog).orderBy(desc(activityLog.timestamp)).limit(limit).all();
    res.json(rows);
  });

  router.delete('/db/activity/:id', (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) throw badRequest('Invalid ID');
    _db.drizzle.delete(activityLog).where(eq(activityLog.id, id)).run();
    res.json({ ok: true });
  });

  router.get('/db/stats', (_req, res) => {
    const memoryCount = _db.drizzle.select({ count: sql`count(*)` }).from(agentMemory).get();
    const conversationCount = _db.drizzle.select({ count: sql`count(*)` }).from(conversations).get();
    const messageCount = _db.drizzle.select({ count: sql`count(*)` }).from(messages).get();
    const decisionCount = _db.drizzle.select({ count: sql`count(*)` }).from(decisions).get();
    const activityCount = _db.drizzle.select({ count: sql`count(*)` }).from(activityLog).get();
    const dagTaskCount = _db.drizzle.select({ count: sql`count(*)` }).from(dagTasks).get();
    res.json({
      memory: Number(memoryCount?.count ?? 0),
      conversations: Number(conversationCount?.count ?? 0),
      messages: Number(messageCount?.count ?? 0),
      decisions: Number(decisionCount?.count ?? 0),
      activity: Number(activityCount?.count ?? 0),
      dagTasks: Number(dagTaskCount?.count ?? 0),
    });
  });

  return router;
}
