import type { Agent } from '../Agent.js';
import type { CommandHandlerContext, CommandEntry } from './types.js';
import { logger } from '../../utils/logger.js';

// ── Regex patterns ──────────────────────────────────────────────────

const DEFER_ISSUE_REGEX = /\[\[\[\s*DEFER_ISSUE\s*(\{.*?\})\s*\]\]\]/s;
const QUERY_DEFERRED_REGEX = /\[\[\[\s*QUERY_DEFERRED\s*(\{.*?\})?\s*\]\]\]/s;
const RESOLVE_DEFERRED_REGEX = /\[\[\[\s*RESOLVE_DEFERRED\s*(\{.*?\})\s*\]\]\]/s;

// ── Exported: command entry list ─────────────────────────────────────

export function getDeferredCommands(ctx: CommandHandlerContext): CommandEntry[] {
  return [
    { regex: DEFER_ISSUE_REGEX, name: 'DEFER_ISSUE', handler: (a, d) => handleDeferIssue(ctx, a, d) },
    { regex: QUERY_DEFERRED_REGEX, name: 'QUERY_DEFERRED', handler: (a, d) => handleQueryDeferred(ctx, a, d) },
    { regex: RESOLVE_DEFERRED_REGEX, name: 'RESOLVE_DEFERRED', handler: (a, d) => handleResolveDeferred(ctx, a, d) },
  ];
}

// ── Handler implementations ─────────────────────────────────────────

function handleDeferIssue(ctx: CommandHandlerContext, agent: Agent, data: string): void {
  const match = data.match(DEFER_ISSUE_REGEX);
  if (!match) return;
  try {
    const req = JSON.parse(match[1]);
    if (!req.description) {
      agent.sendMessage('[System] DEFER_ISSUE requires a "description" field.');
      return;
    }
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
    ctx.activityLedger.log(agent.id, agent.role.name, 'deferred_issue', `Deferred ${issue.severity}: ${issue.description.slice(0, 120)}`);
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
    try {
      const req = JSON.parse(match[1]);
      if (req.status && ['open', 'resolved', 'dismissed'].includes(req.status)) {
        statusFilter = req.status;
      }
    } catch { /* no filter, show all */ }
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
    const req = JSON.parse(match[1]);
    if (!req.id) {
      agent.sendMessage('[System] RESOLVE_DEFERRED requires an "id" field.');
      return;
    }
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
