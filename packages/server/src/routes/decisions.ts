import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { AppContext } from './context.js';
import { DECISION_CATEGORIES, TRUST_PRESETS, type DecisionCategory, type TrustPreset, type IntentAction } from '../coordination/decisions/DecisionLog.js';

export function decisionsRoutes(ctx: AppContext): Router {
  const { agentManager, decisionLog } = ctx;
  const router = Router();

  // --- Decisions ---
  router.get('/decisions', (req, res) => {
    const { needs_confirmation, projectId, grouped } = req.query;
    if (grouped === 'true') {
      return res.json(decisionLog.getPendingGrouped());
    }
    let decisions;
    if (needs_confirmation === 'true') {
      decisions = decisionLog.getNeedingConfirmation();
    } else {
      decisions = decisionLog.getAll();
    }
    if (projectId) {
      decisions = decisions.filter((d: { projectId?: string | null }) => d.projectId === projectId);
    }
    res.json(decisions);
  });

  router.post('/decisions/:id/confirm', (req, res) => {
    const decisionId = req.params.id as string;
    const { reason } = req.body ?? {};
    const decision = decisionLog.confirm(decisionId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });

    // Check for pending system actions tied to this decision
    const sysAction = agentManager.consumePendingSystemAction(decisionId);
    if (sysAction && sysAction.type === 'set_max_concurrent') {
      agentManager.setMaxConcurrent(sysAction.value);
      logger.info('api', `System action executed: max concurrent agents set to ${sysAction.value} (approved by user)`);
    }

    // Notify the lead agent about the approval
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      const extra = sysAction ? ` The agent limit has been changed to ${sysAction.value}.` : '';
      const reasonText = reason ? ` User comment: "${reason}"` : '';
      lead.sendMessage(`[Decision Approved] "${decision.title}" by ${decision.agentRole} has been approved by the user.${extra}${reasonText}`);
    }
    res.json(decision);
  });

  router.post('/decisions/:id/reject', (req, res) => {
    const decisionId = req.params.id as string;
    const { reason } = req.body ?? {};
    const decision = decisionLog.reject(decisionId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });

    // Discard any pending system action
    agentManager.consumePendingSystemAction(decisionId);

    // Notify the lead agent about the rejection
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      const reasonText = reason ? ` User comment: "${reason}"` : '';
      lead.sendMessage(`[Decision Rejected] "${decision.title}" by ${decision.agentRole} has been REJECTED by the user. Please revise your approach.${reasonText}`);
    }
    res.json(decision);
  });

  // Dismiss — silently removes from queue without notifying the lead agent
  router.post('/decisions/:id/dismiss', (req, res) => {
    const decisionId = req.params.id as string;
    const decision = decisionLog.dismiss(decisionId);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    // Discard any pending system action
    agentManager.consumePendingSystemAction(decisionId);
    // No lead notification — dismiss is silent
    res.json(decision);
  });

  router.post('/decisions/:id/respond', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const decision = decisionLog.confirm(req.params.id);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    const agent = agentManager.get(decision.agentId);
    if (agent && (agent.status === 'running' || agent.status === 'idle')) {
      agent.sendMessage(`[User feedback on decision "${decision.title}"] ${message}`);
    }
    res.json(decision);
  });

  // User feedback on a non-confirmation decision (doesn't change status, just notifies the lead)
  router.post('/decisions/:id/feedback', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const decision = decisionLog.getById(req.params.id as string);
    if (!decision) return res.status(404).json({ error: 'Decision not found' });
    // Send feedback to the lead agent
    const leadId = decision.leadId || decision.agentId;
    const lead = agentManager.get(leadId);
    if (lead && (lead.status === 'running' || lead.status === 'idle')) {
      lead.sendMessage(`[User Feedback on Decision] "${decision.title}": ${message}\n\nPlease consider this feedback. If the user disagrees with this decision, revise your approach accordingly.`);
    }
    res.json({ ok: true, decision });
  });

  // --- Batch Operations ---
  router.post('/decisions/batch', (req, res) => {
    const { ids, action, reason } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (action !== 'confirm' && action !== 'reject' && action !== 'dismiss') {
      return res.status(400).json({ error: 'action must be "confirm", "reject", or "dismiss"' });
    }

    const result = action === 'confirm'
      ? decisionLog.confirmBatch(ids)
      : action === 'reject'
        ? decisionLog.rejectBatch(ids)
        : decisionLog.dismissBatch(ids);

    // Notify lead agents and execute system actions for each confirmed decision
    for (const decision of result.results) {
      const leadId = decision.leadId || decision.agentId;
      const lead = agentManager.get(leadId);

      if (action === 'confirm') {
        const sysAction = agentManager.consumePendingSystemAction(decision.id);
        if (sysAction && sysAction.type === 'set_max_concurrent') {
          agentManager.setMaxConcurrent(sysAction.value);
          logger.info('api', `System action executed: max concurrent agents set to ${sysAction.value} (batch approved)`);
        }
        if (lead && (lead.status === 'running' || lead.status === 'idle')) {
          const reasonText = reason ? ` User comment: "${reason}"` : '';
          lead.sendMessage(`[Decision Approved] "${decision.title}" by ${decision.agentRole} has been approved by the user (batch).${reasonText}`);
        }
      } else if (action === 'reject') {
        agentManager.consumePendingSystemAction(decision.id);
        if (lead && (lead.status === 'running' || lead.status === 'idle')) {
          const reasonText = reason ? ` User comment: "${reason}"` : '';
          lead.sendMessage(`[Decision Rejected] "${decision.title}" by ${decision.agentRole} has been REJECTED by the user (batch). Please revise your approach.${reasonText}`);
        }
      } else {
        // dismiss — discard system action, no lead notification
        agentManager.consumePendingSystemAction(decision.id);
      }
    }

    res.json(result);
  });

  // --- Intent Rules ---
  router.get('/intents', (_req, res) => {
    res.json(decisionLog.getIntentRules());
  });

  router.post('/intents', (req, res) => {
    const { category, name, roles, conditions, priority, action, enabled } = req.body ?? {};
    if (!DECISION_CATEGORIES.includes(category as DecisionCategory)) {
      return res.status(400).json({ error: `category must be one of: ${DECISION_CATEGORIES.join(', ')}` });
    }
    const validActions = ['allow', 'alert', 'require-review'];
    const ruleAction = validActions.includes(action) ? action : 'allow';
    const rule = decisionLog.addIntentRule(category as DecisionCategory, 'manual', {
      name,
      roles,
      conditions,
      priority,
      action: ruleAction,
      enabled: enabled ?? true,
    });
    res.status(201).json(rule);
  });

  router.patch('/intents/:id', (req, res) => {
    const rules = decisionLog.getIntentRules();
    const rule = rules.find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ error: 'Intent rule not found' });
    const { name, roles, conditions, priority, enabled, action } = req.body ?? {};
    if (name !== undefined) rule.name = name;
    if (roles !== undefined) rule.match.roles = roles;
    if (conditions !== undefined) rule.conditions = conditions;
    if (priority !== undefined) rule.priority = priority;
    if (enabled !== undefined) rule.enabled = enabled;
    if (action !== undefined && ['allow', 'alert', 'require-review'].includes(action)) rule.action = action as IntentAction;
    (decisionLog as any).saveIntentRules();
    res.json(rule);
  });

  router.post('/intents/reorder', (req, res) => {
    const { ids } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array of rule IDs' });
    }
    const updated = decisionLog.reorderIntentRules(ids);
    res.json({ updated });
  });

  router.delete('/intents/:id', (req, res) => {
    const deleted = decisionLog.deleteIntentRule(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: 'Intent rule not found' });
    res.json({ deleted: true });
  });

  // --- Trust Presets ---
  router.get('/intents/presets', (_req, res) => {
    res.json(TRUST_PRESETS);
  });

  router.post('/intents/presets/:preset', (req, res) => {
    const preset = req.params.preset as TrustPreset;
    if (!TRUST_PRESETS[preset]) {
      return res.status(400).json({ error: `Unknown preset. Must be one of: ${Object.keys(TRUST_PRESETS).join(', ')}` });
    }
    try {
      const rules = decisionLog.applyTrustPreset(preset);
      res.json({ applied: preset, rules });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Timer Pause (REST alternative to queue_open/queue_closed WebSocket messages) ---

  router.post('/decisions/pause-timer', (req, res) => {
    const { paused } = req.body;
    if (typeof paused !== 'boolean') {
      return res.status(400).json({ error: 'paused must be a boolean' });
    }
    if (paused) {
      decisionLog.pauseTimers();
    } else {
      decisionLog.resumeTimers();
    }
    res.json({ paused: decisionLog.isTimersPaused });
  });

  return router;
}
