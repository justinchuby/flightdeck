import { Router } from 'express';
import { badRequest } from '../errors/index.js';
import { messages, conversations, chatGroupMessages, dagTasks, decisions, activityLog } from '../db/schema.js';
import { eq, like, desc, or } from 'drizzle-orm';
import type { AppContext } from './context.js';

export function searchRoutes(ctx: AppContext): Router {
  const { agentManager, db: _db } = ctx;
  const router = Router();

  // --- Search ---
  router.get('/search', (req, res) => {
    const q = (req.query.q as string ?? '').trim();
    if (!q || q.length < 2) throw badRequest('query must be at least 2 characters');
    if (q.length > 200) throw badRequest('query too long (max 200 chars)');
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const pattern = `%${q}%`;

    // Search agent conversation messages
    const convResults = _db.drizzle
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        sender: messages.sender,
        content: messages.content,
        timestamp: messages.timestamp,
      })
      .from(messages)
      .where(like(messages.content, pattern))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();

    // Enrich with agent info from conversations table
    const enrichedConv = convResults.map((m) => {
      const conv = _db.drizzle
        .select({ agentId: conversations.agentId })
        .from(conversations)
        .where(eq(conversations.id, m.conversationId))
        .get();
      const agent = conv ? agentManager.get(conv.agentId) : null;
      return {
        source: 'conversation' as const,
        id: m.id,
        agentId: conv?.agentId ?? null,
        agentRole: agent?.role?.name ?? null,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
      };
    });

    // Search group chat messages
    const groupResults = _db.drizzle
      .select()
      .from(chatGroupMessages)
      .where(like(chatGroupMessages.content, pattern))
      .orderBy(desc(chatGroupMessages.timestamp))
      .limit(limit)
      .all();

    const enrichedGroup = groupResults.map((m) => ({
      source: 'group' as const,
      id: m.id,
      groupName: m.groupName,
      leadId: m.leadId,
      fromAgentId: m.fromAgentId,
      fromRole: m.fromRole,
      content: m.content,
      timestamp: m.timestamp,
    }));

    // Search DAG tasks (by id or description)
    const taskResults = _db.drizzle
      .select()
      .from(dagTasks)
      .where(or(like(dagTasks.id, pattern), like(dagTasks.description, pattern)))
      .orderBy(desc(dagTasks.createdAt))
      .limit(limit)
      .all();

    const enrichedTasks = taskResults.map((t) => ({
      source: 'task' as const,
      id: t.id,
      leadId: t.leadId,
      content: t.description,
      status: t.dagStatus,
      role: t.role,
      assignedAgentId: t.assignedAgentId,
      timestamp: t.createdAt,
    }));

    // Search decisions (by title or rationale)
    const decisionResults = _db.drizzle
      .select()
      .from(decisions)
      .where(or(like(decisions.title, pattern), like(decisions.rationale, pattern)))
      .orderBy(desc(decisions.createdAt))
      .limit(limit)
      .all();

    const enrichedDecisions = decisionResults.map((d) => ({
      source: 'decision' as const,
      id: d.id,
      agentId: d.agentId,
      agentRole: d.agentRole,
      leadId: d.leadId,
      content: d.title,
      rationale: d.rationale,
      status: d.status,
      needsConfirmation: d.needsConfirmation === 1,
      timestamp: d.createdAt,
    }));

    // Search activity log (by summary)
    const activityResults = _db.drizzle
      .select()
      .from(activityLog)
      .where(like(activityLog.summary, pattern))
      .orderBy(desc(activityLog.timestamp))
      .limit(limit)
      .all();

    const enrichedActivity = activityResults.map((a) => ({
      source: 'activity' as const,
      id: a.id,
      agentId: a.agentId,
      agentRole: a.agentRole,
      content: a.summary,
      actionType: a.actionType,
      timestamp: a.timestamp,
    }));

    // Merge and sort by timestamp descending
    const combined = [...enrichedConv, ...enrichedGroup, ...enrichedTasks, ...enrichedDecisions, ...enrichedActivity]
      .sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, limit);

    res.json({ query: q, count: combined.length, results: combined });
  });

  return router;
}
