import { Router } from 'express';
import { join } from 'node:path';
import { type SearchQuery } from '../coordination/knowledge/SearchEngine.js';
import { ReportGenerator } from '../coordination/reporting/ReportGenerator.js';
import { ParallelAnalyzer } from '../tasks/ParallelAnalyzer.js';
import { getRecentCommits } from './context.js';
import type { AppContext } from './context.js';

export function servicesRoutes(ctx: AppContext): Router {
  const {
    agentManager,
    decisionLog,
    alertEngine,
    eagerScheduler,
    capabilityRegistry,
    agentMatcher,
    sessionRetro,
    sessionExporter,
    fileDependencyGraph,
    retryManager,
    crashForensics,
    webhookManager,
    taskTemplateRegistry,
    taskDecomposer,
    searchEngine,
    performanceTracker,
    decisionRecordStore,
    coverageTracker,
    complexityMonitor,
    dependencyScanner,
    notificationManager,
    escalationManager,
    modelSelector,
    reportGenerator,
    projectTemplateRegistry,
    knowledgeTransfer,
  } = ctx;
  const router = Router();

  // --- Proactive Alerts ---
  router.get('/coordination/alerts', (_req, res) => {
    if (!alertEngine) {
      res.json([]);
      return;
    }
    res.json(alertEngine.getAlerts());
  });

  // --- Eager Scheduler ---
  router.get('/coordination/eager-schedule', (_req, res) => {
    if (!eagerScheduler) {
      res.json([]);
      return;
    }
    res.json(eagerScheduler.getPreAssignments());
  });

  // --- Capability Registry ---
  router.get('/coordination/capabilities', (req, res) => {
    if (!capabilityRegistry) {
      res.json([]);
      return;
    }
    const leadId = req.query.leadId as string | undefined;
    if (!leadId) {
      res.status(400).json({ error: 'leadId query parameter required' });
      return;
    }
    const query = {
      file: req.query.file as string | undefined,
      technology: req.query.technology as string | undefined,
      keyword: req.query.keyword as string | undefined,
      domain: req.query.domain as string | undefined,
      availableOnly: req.query.availableOnly === 'true',
    };
    res.json(capabilityRegistry.query(leadId, query));
  });

  // --- Agent Matcher ---
  router.get('/coordination/match-agent', (req, res) => {
    if (!agentMatcher) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    const query = {
      task: (req.query.task as string) || '',
      requiredRole: req.query.role as string | undefined,
      files: req.query.file ? [req.query.file as string] : undefined,
      technologies: req.query.tech ? [req.query.tech as string] : undefined,
      keywords: req.query.keyword ? (req.query.keyword as string).split(',') : undefined,
      preferIdle: req.query.preferIdle === 'true',
    };
    res.json(agentMatcher.match(leadId, query));
  });

  // --- Session Retrospectives ---
  router.get('/coordination/retros/:leadId', (req, res) => {
    if (!sessionRetro) {
      res.json([]);
      return;
    }
    res.json(sessionRetro.getRetros(req.params.leadId));
  });

  router.post('/coordination/retros/:leadId', (req, res) => {
    if (!sessionRetro) {
      res.status(503).json({ error: 'Session retro not available' });
      return;
    }
    const data = sessionRetro.generateRetro(req.params.leadId);
    res.json(data);
  });

  // --- Session Export ---
  router.get('/export/:leadId', (req, res) => {
    if (!sessionExporter) {
      res.status(503).json({ error: 'Session exporter not available' });
      return;
    }
    try {
      const outputDir = join(process.cwd(), '.flightdeck', 'exports');
      const result = sessionExporter.export(req.params.leadId, outputDir);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- File Dependency Graph ---
  router.get('/coordination/file-impact', (req, res) => {
    if (!fileDependencyGraph) {
      res.json({ directDependents: [], transitiveDependents: [], depth: 0 });
      return;
    }
    const file = req.query.file as string;
    if (!file) {
      res.status(400).json({ error: 'file query parameter required' });
      return;
    }
    res.json(fileDependencyGraph.getImpact(file));
  });

  // --- Auto-Retry ---
  router.get('/coordination/retries', (_req, res) => {
    if (!retryManager) { res.json([]); return; }
    res.json(retryManager.getRetries());
  });

  // --- Crash Forensics ---
  router.get('/coordination/crash-reports', (req, res) => {
    if (!crashForensics) { res.json([]); return; }
    const agentId = req.query.agentId as string | undefined;
    res.json(crashForensics.getReports(agentId));
  });

  // --- Webhooks ---
  router.get('/webhooks', (_req, res) => {
    if (!webhookManager) { res.json([]); return; }
    res.json(webhookManager.getWebhooks());
  });

  router.post('/webhooks', (req, res) => {
    if (!webhookManager) { res.status(503).json({ error: 'Webhooks not available' }); return; }
    const { url, events, secret, enabled } = req.body;
    if (!url || !events?.length) { res.status(400).json({ error: 'url and events[] required' }); return; }
    const webhook = webhookManager.register({ url, events, secret, enabled: enabled ?? true });
    res.status(201).json(webhook);
  });

  router.delete('/webhooks/:id', (req, res) => {
    if (!webhookManager) { res.status(503).json({ error: 'Webhooks not available' }); return; }
    const removed = webhookManager.unregister(req.params.id);
    res.json({ removed });
  });

  router.get('/webhooks/:id/deliveries', (req, res) => {
    if (!webhookManager) { res.json([]); return; }
    res.json(webhookManager.getDeliveries(req.params.id));
  });

  // --- Task Templates ---
  router.get('/coordination/templates', (_req, res) => {
    if (!taskTemplateRegistry) { res.json([]); return; }
    res.json(taskTemplateRegistry.getAll());
  });

  router.post('/coordination/decompose', (req, res) => {
    if (!taskDecomposer) { res.status(503).json({ error: 'Task decomposer not available' }); return; }
    const { task } = req.body;
    if (!task) { res.status(400).json({ error: 'task description required' }); return; }
    res.json(taskDecomposer.decompose(task));
  });

  // --- Performance Scorecards ---
  router.get('/coordination/scorecards', (req, res) => {
    if (!performanceTracker) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    res.json(performanceTracker.getCrewScorecards(leadId));
  });

  router.get('/coordination/scorecards/:agentId', (req, res) => {
    if (!performanceTracker) { res.json(null); return; }
    res.json(performanceTracker.getScorecard(req.params.agentId));
  });

  router.get('/coordination/leaderboard', (req, res) => {
    if (!performanceTracker) { res.json([]); return; }
    const leadId = req.query.leadId as string;
    if (!leadId) { res.status(400).json({ error: 'leadId required' }); return; }
    res.json(performanceTracker.getLeaderboard(leadId));
  });

  // --- Full-text Search ---
  router.get('/search', (req, res) => {
    if (!searchEngine) { res.json([]); return; }
    const query: SearchQuery = {
      query: (req.query.q as string) || '',
      types: req.query.types ? (req.query.types as string).split(',') as any : undefined,
      agentId: req.query.agentId as string,
      leadId: req.query.leadId as string,
      since: req.query.since as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    if (!query.query) { res.status(400).json({ error: 'q parameter required' }); return; }
    res.json(searchEngine.search(query));
  });

  // --- Decision Records (ADR-style) ---
  router.get('/coordination/decisions', (req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    const filter = {
      status: req.query.status as string | undefined,
      tag: req.query.tag as string | undefined,
      since: req.query.since as string | undefined,
    };
    res.json(decisionRecordStore.getAll(filter));
  });

  router.get('/coordination/decisions/tags', (_req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    res.json(decisionRecordStore.getTags());
  });

  router.get('/coordination/decisions/search', (req, res) => {
    if (!decisionRecordStore) { res.json([]); return; }
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'q parameter required' }); return; }
    res.json(decisionRecordStore.search(q));
  });

  router.get('/coordination/decisions/:id', (req, res) => {
    if (!decisionRecordStore) { res.status(404).json(null); return; }
    const record = decisionRecordStore.get(req.params.id);
    if (!record) { res.status(404).json({ error: 'not found' }); return; }
    res.json(record);
  });

  // ── Code Quality endpoints ──────────────────────────────────────────

  router.get('/coordination/coverage', (_req, res) => {
    if (!coverageTracker) { res.json({ history: [], latest: null, trend: { tests: [], durations: [] } }); return; }
    res.json({
      history: coverageTracker.getHistory(),
      latest: coverageTracker.getLatest() ?? null,
      trend: coverageTracker.getTrend(),
    });
  });

  router.get('/coordination/complexity', (_req, res) => {
    if (!complexityMonitor) { res.json({ alerts: [], files: [], highComplexity: [] }); return; }
    res.json({
      alerts: complexityMonitor.getAlerts(),
      files: complexityMonitor.getFiles(),
      highComplexity: complexityMonitor.getHighComplexity(),
    });
  });

  router.get('/coordination/dependencies', (_req, res) => {
    if (!dependencyScanner) { res.json({ workspaces: {}, counts: { production: 0, dev: 0, total: 0 } }); return; }
    res.json({
      workspaces: dependencyScanner.scanWorkspaces(),
      counts: dependencyScanner.getDependencyCount(),
    });
  });

  // ── Notifications ───────────────────────────────────────────────

  router.get('/notifications', (req, res) => {
    if (!notificationManager) { res.json({ notifications: [], unreadCount: 0 }); return; }
    const unreadOnly = req.query.unreadOnly === 'true';
    const category = req.query.category as import('../coordination/alerts/NotificationManager.js').NotificationCategory | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    res.json({
      notifications: notificationManager.getNotifications({ unreadOnly, category, limit }),
      unreadCount: notificationManager.getUnreadCount(),
    });
  });

  router.put('/notifications/read-all', (_req, res) => {
    if (!notificationManager) { res.json({ ok: true }); return; }
    notificationManager.markAllRead();
    res.json({ ok: true });
  });

  router.put('/notifications/:id/read', (req, res) => {
    if (!notificationManager) { res.status(404).json({ error: 'Notification manager not available' }); return; }
    const ok = notificationManager.markRead(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Notification not found' }); return; }
    res.json({ ok: true });
  });

  router.get('/notifications/preferences', (req, res) => {
    if (!notificationManager) { res.json(null); return; }
    const userId = (req.query.userId as string) || 'default';
    res.json(notificationManager.getPreferences(userId) ?? null);
  });

  router.put('/notifications/preferences', (req, res) => {
    if (!notificationManager) { res.status(503).json({ error: 'Notification manager not available' }); return; }
    const userId = (req.body.userId as string) || 'default';
    const prefs = notificationManager.setPreferences(userId, req.body);
    res.json(prefs);
  });

  // ── Escalations ─────────────────────────────────────────────────

  router.get('/coordination/escalations', (req, res) => {
    if (!escalationManager) { res.json({ active: [], all: [], rules: [] }); return; }
    const all = req.query.all === 'true';
    res.json({
      escalations: all ? escalationManager.getAll() : escalationManager.getActive(),
      rules: escalationManager.getRules(),
    });
  });

  router.put('/coordination/escalations/:id/resolve', (req, res) => {
    if (!escalationManager) { res.status(404).json({ error: 'Escalation manager not available' }); return; }
    const ok = escalationManager.resolve(req.params.id);
    if (!ok) { res.status(404).json({ error: 'Escalation not found' }); return; }
    res.json({ ok: true });
  });

  // ── Model Selector ──────────────────────────────────────────────────

  router.get('/coordination/model-selector', (_req, res) => {
    if (!modelSelector) {
      res.json({ models: [], overrides: {} });
      return;
    }
    res.json({
      models: modelSelector.getModels(),
      overrides: modelSelector.getRoleOverrides(),
    });
  });

  // ── Parallel Execution Analyzer ─────────────────────────────────────

  router.get('/coordination/parallel-analysis', (_req, res) => {
    const analyzer = new ParallelAnalyzer(agentManager.getTaskDAG());
    res.json(analyzer.analyze());
  });

  // --- Session Report ---
  router.get('/reports/session', (req, res) => {
    const rg = reportGenerator ?? new ReportGenerator();
    const format = req.query.format === 'md' ? 'md' : 'html';

    // Optional leadId filter; defaults to first running lead
    const leadId = req.query.leadId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const allAgents = projectId
      ? agentManager.getByProject(projectId)
      : agentManager.getAll();
    const lead = leadId
      ? allAgents.find(a => a.id === leadId)
      : allAgents.find(a => a.role?.id === 'lead');

    // Collect agents for the session (lead + its children, or all agents)
    const crewAgents = lead
      ? allAgents.filter(a => a.id === lead.id || a.parentId === lead.id)
      : allAgents;

    // Determine session time bounds from agent creation times
    const createdAts = crewAgents.map(a => new Date(a.createdAt ?? Date.now()).getTime()).filter(t => !isNaN(t));
    const sessionStart = createdAts.length > 0 ? Math.min(...createdAts) : Date.now() - 3_600_000;
    const sessionEnd = Date.now();

    // Tasks from DAG
    const dagTasks = lead
      ? (req.app.locals?.taskDAG?.getTasks?.(lead.id) ?? [])
      : [];

    // Decisions
    const rawDecisions = lead
      ? decisionLog.getByLeadId(lead.id)
      : decisionLog.getAll();

    // Recent git commits
    const commits = getRecentCommits();

    const projectName = lead?.projectName ?? lead?.task?.slice(0, 60) ?? 'Flightdeck Session';

    const data = {
      projectName,
      sessionStart,
      sessionEnd,
      agents: crewAgents.map(a => ({
        id: a.id,
        role: a.role?.name ?? a.role?.id ?? 'unknown',
        model: a.model ?? 'unknown',
        status: a.status,
        tokensUsed: (a.inputTokens ?? 0) + (a.outputTokens ?? 0),
      })),
      tasks: dagTasks.map((t: any) => ({
        id: t.id,
        description: t.description ?? t.id,
        status: t.dagStatus ?? t.status ?? 'pending',
        assignee: t.assignedTo ?? t.role,
      })),
      decisions: rawDecisions.map((d: any) => ({
        title: d.title,
        rationale: d.rationale,
        confirmedBy: d.confirmedBy,
      })),
      commits,
      testResults: undefined,
      highlights: [],
    };

    if (format === 'md') {
      res.type('text/markdown').send(rg.generateMarkdown(data));
    } else {
      res.type('text/html').send(rg.generateHTML(data));
    }
  });

  // --- Project Templates ---
  // NOTE: /search must be registered before /:id so Express does not match "search" as an ID.
  router.get('/coordination/project-templates/search', (req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    const keyword = (req.query.keyword as string ?? '').trim();
    if (!keyword) return res.status(400).json({ error: 'keyword query parameter required' });
    res.json(projectTemplateRegistry.findByKeyword(keyword));
  });

  router.get('/coordination/project-templates', (_req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    res.json(projectTemplateRegistry.getAll());
  });

  router.get('/coordination/project-templates/:id', (req, res) => {
    if (!projectTemplateRegistry) return res.status(503).json({ error: 'Project template registry not available' });
    const template = projectTemplateRegistry.get(req.params.id);
    if (!template) return res.status(404).json({ error: `Template '${req.params.id}' not found` });
    res.json(template);
  });

  // --- Knowledge Transfer ---
  router.get('/coordination/knowledge/search', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const q = (req.query.q as string ?? '').trim();
    if (!q) return res.status(400).json({ error: 'q query parameter required' });
    res.json(knowledgeTransfer.search(q));
  });

  router.get('/coordination/knowledge/popular', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    res.json(knowledgeTransfer.getPopular(limit));
  });

  router.get('/coordination/knowledge', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const { projectId, category, tag } = req.query;
    if (typeof projectId === 'string') return res.json(knowledgeTransfer.getByProject(projectId));
    if (typeof category === 'string') return res.json(knowledgeTransfer.getByCategory(category as import('../coordination/knowledge/KnowledgeTransfer.js').KnowledgeCategory));
    if (typeof tag === 'string') return res.json(knowledgeTransfer.getByTag(tag));
    res.json(knowledgeTransfer.getAll());
  });

  router.post('/coordination/knowledge', (req, res) => {
    if (!knowledgeTransfer) return res.status(503).json({ error: 'Knowledge transfer not available' });
    const { projectId, category, title, content, tags } = req.body as Record<string, unknown>;
    const validCategories = ['pattern', 'pitfall', 'tool', 'architecture', 'process'];
    if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'projectId required' });
    if (typeof category !== 'string' || !validCategories.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
    }
    if (typeof title !== 'string' || !title) return res.status(400).json({ error: 'title required' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const entryTags = Array.isArray(tags) ? (tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    const entry = knowledgeTransfer.capture({
      projectId,
      category: category as import('../coordination/knowledge/KnowledgeTransfer.js').KnowledgeCategory,
      title,
      content,
      tags: entryTags,
    });
    res.status(201).json(entry);
  });

  return router;
}
