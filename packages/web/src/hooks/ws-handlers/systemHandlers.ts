import type { WsHandlerContext, WsServerMessageOf } from './types';
import { useTimerStore } from '../../stores/timerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { apiFetch } from '../useApi';

/**
 * Handlers for system-level events:
 * system:paused, timer:*, lead:decision, decision:*, decisions:batch, attention:changed
 */

export function handleSystemPaused(msg: WsServerMessageOf<'system:paused'>, ctx: WsHandlerContext): void {
  ctx.getAppState().setSystemPaused(msg.paused);
}

export function handleTimerCreated(msg: WsServerMessageOf<'timer:created'>): void {
  const ts = useTimerStore.getState();
  if (msg.timer) ts.addTimer(msg.timer as any);
}

export function handleTimerFired(msg: WsServerMessageOf<'timer:fired'>): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) {
    ts.fireTimer(timerId);
    ts.scheduleFireRemoval(timerId);
  }
}

export function handleTimerCancelled(msg: WsServerMessageOf<'timer:cancelled'>): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) ts.removeTimer(timerId);
}

export function handleLeadDecision(msg: WsServerMessageOf<'lead:decision'>, ctx: WsHandlerContext): void {
  if (msg.needsConfirmation && msg.id) {
    const effectiveLevel = useSettingsStore.getState().getEffectiveLevel(msg.projectId ?? undefined);
    if (effectiveLevel === 'autonomous') {
      apiFetch(`/decisions/${msg.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
      return;
    }
    ctx.getAppState().addPendingDecision({
      id: msg.id,
      agentId: msg.agentId,
      agentRole: msg.agentRole || 'Unknown',
      leadId: msg.leadId ?? null,
      projectId: msg.projectId ?? null,
      title: msg.title || 'Untitled decision',
      rationale: msg.rationale || '',
      needsConfirmation: true,
      status: msg.status ?? 'recorded',
      autoApproved: msg.autoApproved ?? false,
      confirmedAt: msg.confirmedAt ?? null,
      category: msg.category,
      timestamp: msg.timestamp || new Date().toISOString(),
    });
  }
}

/** Fields that may appear on decision:confirmed/rejected/dismissed events */
interface DecisionResolvedFields {
  decisionId?: string;
  id?: string;
  decision?: { decisionId?: string; id?: string };
}

type DecisionResolvedMsg = WsServerMessageOf<'decision:confirmed'> | WsServerMessageOf<'decision:rejected'> | WsServerMessageOf<'decision:dismissed'>;

export function handleDecisionResolved(msg: DecisionResolvedMsg, ctx: WsHandlerContext): void {
  // The server sends decision ID in multiple shapes; extract from flat or nested format
  const fields = msg as unknown as DecisionResolvedFields;
  const decisionId = fields.decisionId ?? fields.id ?? fields.decision?.decisionId ?? fields.decision?.id;
  if (decisionId) {
    ctx.getAppState().removePendingDecision(decisionId);
  }
}

export function handleDecisionsBatch(msg: WsServerMessageOf<'decisions:batch'>, ctx: WsHandlerContext): void {
  const decisions = msg.decisions ?? [];
  for (const d of decisions) {
    const decision = d as { id?: string };
    if (decision.id) ctx.getAppState().removePendingDecision(decision.id);
  }
}

export function handleAttentionChanged(): void {
  window.dispatchEvent(new CustomEvent('attention:changed'));
}
