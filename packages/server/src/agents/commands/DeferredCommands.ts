import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import {
  parseCommandPayload,
  deferIssueSchema,
  resolveDeferredSchema,
  queryDeferredSchema,
} from './commandSchemas.js';

// ── Regex patterns ──────────────────────────────────────────────────

const DEFER_ISSUE_REGEX = /⟦⟦\s*DEFER_ISSUE\s*(\{.*?\})\s*⟧⟧/s;
const QUERY_DEFERRED_REGEX = /⟦⟦\s*QUERY_DEFERRED\s*(\{.*?\})?\s*⟧⟧/s;
const RESOLVE_DEFERRED_REGEX = /⟦⟦\s*RESOLVE_DEFERRED\s*(\{.*?\})\s*⟧⟧/s;

// ── Exported: command entry list ─────────────────────────────────────

export function getDeferredCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: DEFER_ISSUE_REGEX, name: 'DEFER_ISSUE', handler: (a, d) => handleDeferIssue(ctx, a, d), help: { description: 'Defer an issue for later', example: 'DEFER_ISSUE {"title": "Tech debt", "description": "refactor later"}', category: 'Deferred Issues', args: [
      { name: 'description', type: 'string', required: true, description: 'Issue description' },
      { name: 'severity', type: 'string', required: false, description: 'Severity level (e.g. P1, P2)' },
      { name: 'sourceFile', type: 'string', required: false, description: 'Related file path' },
    ] } },
    { regex: QUERY_DEFERRED_REGEX, name: 'QUERY_DEFERRED', handler: (a, d) => handleQueryDeferred(ctx, a, d), help: { description: 'List deferred issues', example: 'QUERY_DEFERRED {}', category: 'Deferred Issues', args: [
      { name: 'status', type: 'string', required: false, description: 'Filter: "open", "resolved", or "dismissed"' },
    ] } },
    { regex: RESOLVE_DEFERRED_REGEX, name: 'RESOLVE_DEFERRED', handler: (a, d) => handleResolveDeferred(ctx, a, d), help: { description: 'Resolve a deferred issue', example: 'RESOLVE_DEFERRED {"id": "issue-id"}', category: 'Deferred Issues', args: [
      { name: 'id', type: 'number', required: true, description: 'Issue ID to resolve' },
      { name: 'dismiss', type: 'boolean', required: false, description: 'Dismiss instead of resolve' },
    ] } },
  ];
}

// ── Handler implementations ─────────────────────────────────────────

function handleDeferIssue(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(DEFER_ISSUE_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], deferIssueSchema, 'DEFER_ISSUE');
    if (!req) return;
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] Cannot defer issue: no lead context found.');
      return;
    }
    const issue = ctx.deferredIssueRegistry.add(
      leadId,
      agent.id,
      agent.role.name,
      req.description,
      req.severity || 'P1',
      req.sourceFile || req.file || '',
    );
    agent.sendMessage(`[System] Deferred issue #${issue.id} recorded (${issue.severity}): ${issue.description.slice(0, 100)}`);
    ctx.activityLedger.log(agent.id, agent.role.name, 'deferred_issue', `Deferred ${issue.severity}: ${issue.description.slice(0, 120)}`, {}, ctx.getProjectIdForAgent(agent.id) ?? '');
    ctx.emit('deferred_issue:created', { leadId, issue });
  } catch (err: any) {
    agent.sendMessage(`[System] DEFER_ISSUE error: ${err.message}`);
  }
}

function handleQueryDeferred(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
  if (!leadId) {
    agent.sendMessage('[System] No deferred issues context found.');
    return;
  }
  let statusFilter: 'open' | 'resolved' | 'dismissed' | undefined;
  const match = data.match(QUERY_DEFERRED_REGEX);
  if (match?.[1]) {
    // Note: invalid status values now return an error instead of silently showing all issues.
    // This is intentional — agents should use valid values: "open", "resolved", "dismissed".
    const req = parseCommandPayload(agent, match[1], queryDeferredSchema, 'QUERY_DEFERRED');
    if (!req) return;
    statusFilter = req.status;
  }
  const issues = ctx.deferredIssueRegistry.list(leadId, statusFilter);
  if (issues.length === 0) {
    agent.sendMessage(`[System] No deferred issues${statusFilter ? ` with status "${statusFilter}"` : ''}.`);
    return;
  }
  let msg = `== DEFERRED ISSUES (${issues.length}) ==\n`;
  for (const issue of issues) {
    const icon = ({ open: '🔴', resolved: '✅', dismissed: '⚪' } as Record<string, string>)[issue.status] || '?';
    msg += `\n${icon} #${issue.id} [${issue.severity}] ${issue.status.toUpperCase()}`;
    msg += `\n   ${issue.description.slice(0, 120)}`;
    if (issue.sourceFile) msg += `\n   File: ${issue.sourceFile}`;
    msg += `\n   Flagged by: ${issue.reviewerRole} (${issue.reviewerAgentId.slice(0, 8)}) at ${issue.createdAt}`;
  }
  agent.sendMessage(msg);
}

function handleResolveDeferred(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(RESOLVE_DEFERRED_REGEX);
  if (!match) return;
  try {
    const req = parseCommandPayload(agent, match[1], resolveDeferredSchema, 'RESOLVE_DEFERRED');
    if (!req) return;
    const leadId = agent.role.id === 'lead' ? agent.id : agent.parentId;
    if (!leadId) {
      agent.sendMessage('[System] No deferred issues context found.');
      return;
    }
    const action = req.dismiss ? 'dismiss' : 'resolve';
    const ok = action === 'dismiss'
      ? ctx.deferredIssueRegistry.dismiss(leadId, req.id)
      : ctx.deferredIssueRegistry.resolve(leadId, req.id);
    if (ok) {
      agent.sendMessage(`[System] Deferred issue #${req.id} ${action === 'dismiss' ? 'dismissed' : 'resolved'}.`);
    } else {
      agent.sendMessage(`[System] Deferred issue #${req.id} not found or already ${action === 'dismiss' ? 'dismissed' : 'resolved'}.`);
    }
  } catch (err: any) {
    agent.sendMessage(`[System] RESOLVE_DEFERRED error: ${err.message}`);
  }
}
