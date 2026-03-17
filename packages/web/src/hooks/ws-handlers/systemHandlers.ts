import type { WsHandlerContext } from './types';
import { useTimerStore } from '../../stores/timerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { apiFetch } from '../useApi';

/**
 * Handlers for system-level events:
 * system:paused, timer:*, lead:decision, decision:*, decisions:batch, attention:changed
 */

export function handleSystemPaused(msg: any, ctx: WsHandlerContext): void {
  ctx.getAppState().setSystemPaused(msg.paused);
}

export function handleTimerCreated(msg: any): void {
  const ts = useTimerStore.getState();
  if (msg.timer) ts.addTimer(msg.timer);
}

export function handleTimerFired(msg: any): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) {
    ts.fireTimer(timerId);
    ts.scheduleFireRemoval(timerId);
  }
}

export function handleTimerCancelled(msg: any): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) ts.removeTimer(timerId);
}

export function handleLeadDecision(msg: any, ctx: WsHandlerContext): void {
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
      status: 'recorded',
      autoApproved: msg.autoApproved ?? false,
      confirmedAt: msg.confirmedAt ?? null,
      category: msg.category,
      timestamp: msg.timestamp || new Date().toISOString(),
    });
  }
}

export function handleDecisionResolved(msg: any, ctx: WsHandlerContext): void {
  const decisionId = msg.decisionId ?? msg.id;
  if (decisionId) {
    ctx.getAppState().removePendingDecision(decisionId);
  }
}

export function handleDecisionsBatch(msg: any, ctx: WsHandlerContext): void {
  const decisions = msg.decisions ?? [];
  for (const d of decisions) {
    if (d.id) ctx.getAppState().removePendingDecision(d.id);
  }
}

export function handleAttentionChanged(): void {
  window.dispatchEvent(new CustomEvent('attention:changed'));
}
