import { Router } from 'express';
import type { AppContext } from './context.js';
import type { DagTask } from '../tasks/TaskDAG.js';

/**
 * Global task routes — cross-project task queries and the attention items
 * endpoint used by the KanbanBoard, AttentionBar, and HomeDashboard.
 */
export function tasksRoutes(ctx: AppContext): Router {
  const { agentManager, decisionLog } = ctx;
  const router = Router();

  // ── Global task query ─────────────────────────────────────────────
  /**
   * GET /tasks
   *   ?scope=global|project
   *   &projectId=<id>        (required when scope=project)
   *   &status=running,failed  (comma-separated filter)
   *   &role=developer          (filter by role)
   *   &assignedAgentId=<id>   (filter by assigned agent)
   *   &limit=200              (max results, default 200, capped at 1000)
   *   &offset=0               (skip N results for pagination)
   *
   * Returns paginated tasks across all projects (scope=global) or filtered
   * to a single project.
   */
  router.get('/tasks', (req, res) => {
    const taskDAG = agentManager.getTaskDAG();
    const scope = (req.query.scope as string) || 'global';
    const projectId = req.query.projectId as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const roleFilter = req.query.role as string | undefined;
    const agentFilter = req.query.assignedAgentId as string | undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    let tasks: DagTask[];

    if (scope === 'project') {
      if (!projectId) {
        return res.status(400).json({ error: 'projectId is required when scope=project' });
      }
      tasks = taskDAG.getTasksByProject(projectId, { includeArchived });
    } else {
      tasks = taskDAG.getAll({ includeArchived });
    }

    // Apply optional filters
    if (statusFilter) {
      const statuses = new Set(statusFilter.split(',').map(s => s.trim()));
      tasks = tasks.filter(t => statuses.has(t.dagStatus));
    }
    if (roleFilter) {
      tasks = tasks.filter(t => t.role === roleFilter);
    }
    if (agentFilter) {
      tasks = tasks.filter(t => t.assignedAgentId === agentFilter);
    }

    const total = tasks.length;

    // Apply pagination after filtering
    const paginated = tasks.slice(offset, offset + limit);

    return res.json({
      tasks: paginated,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      scope,
      ...(projectId ? { projectId } : {}),
    });
  });

  // ── Unarchive a task ────────────────────────────────────────────────
  /**
   * PATCH /tasks/:leadId/:taskId/unarchive
   * Restores an archived task by clearing its archivedAt timestamp.
   */
  router.patch('/tasks/:leadId/:taskId/unarchive', (req, res) => {
    const taskDAG = agentManager.getTaskDAG();
    const { leadId, taskId } = req.params;
    const restored = taskDAG.unarchiveTask(leadId, taskId);
    if (!restored) {
      return res.status(404).json({ error: 'Task not found or not archived' });
    }
    return res.json(restored);
  });

  // ── Attention items endpoint ──────────────────────────────────────
  /**
   * GET /attention
   *   ?scope=global|project
   *   &projectId=<id>
   *
   * Aggregates items that need user attention:
   *   - Failed tasks (with failureReason)
   *   - Blocked tasks (duration exceeds threshold)
   *   - Pending decisions (needsConfirmation && status === 'recorded')
   *
   * Used by: AttentionBar, KanbanBoard Command Center, HomeDashboard
   */
  router.get('/attention', (req, res) => {
    const taskDAG = agentManager.getTaskDAG();
    const scope = (req.query.scope as string) || 'global';
    const projectId = req.query.projectId as string | undefined;

    // Get tasks scoped appropriately
    let tasks: DagTask[];
    if (scope === 'project' && projectId) {
      tasks = taskDAG.getTasksByProject(projectId);
    } else {
      tasks = taskDAG.getAll();
    }

    const now = Date.now();

    // Failed tasks
    const failed = tasks
      .filter(t => t.dagStatus === 'failed')
      .map(t => ({
        type: 'failed' as const,
        severity: 'critical' as const,
        task: t,
        reason: t.failureReason || 'Unknown failure',
        failedAt: t.completedAt || t.startedAt || t.createdAt,
      }));

    // Blocked tasks
    const blocked = tasks
      .filter(t => t.dagStatus === 'blocked')
      .map(t => {
        const blockedSince = t.startedAt || t.createdAt;
        const durationMs = now - new Date(blockedSince).getTime();
        return {
          type: 'blocked' as const,
          severity: (durationMs > 30 * 60 * 1000 ? 'warning' : 'info') as 'warning' | 'info',
          task: t,
          durationMs,
          blockedSince,
        };
      });

    // Pending decisions
    const pendingDecisions = decisionLog.getNeedingConfirmation()
      .filter(d => {
        if (scope === 'project' && projectId) {
          return d.projectId === projectId;
        }
        return true;
      })
      .map(d => ({
        type: 'decision' as const,
        severity: 'warning' as const,
        decision: {
          id: d.id,
          title: d.title,
          rationale: d.rationale,
          agentId: d.agentId,
          agentRole: d.agentRole,
          projectId: d.projectId,
          timestamp: d.timestamp,
          category: d.category,
        },
      }));

    // Summary counts for the attention strip
    const summary = {
      failedCount: failed.length,
      blockedCount: blocked.length,
      decisionCount: pendingDecisions.length,
      totalCount: failed.length + blocked.length + pendingDecisions.length,
    };

    // Escalation level: green / yellow / red
    let escalation: 'green' | 'yellow' | 'red' = 'green';
    if (summary.totalCount > 0) escalation = 'yellow';
    if (failed.length > 0) escalation = 'red';

    return res.json({
      scope,
      ...(projectId ? { projectId } : {}),
      escalation,
      summary,
      items: [
        ...failed,
        ...pendingDecisions,
        ...blocked,
      ],
    });
  });

  return router;
}
