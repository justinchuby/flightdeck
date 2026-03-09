import { useAppStore } from '../../stores/appStore';
import { useTimerStore } from '../../stores/timerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { apiFetch } from '../useApi';
import type { HandlerContext } from './index';

export function handleInit(msg: any, ctx: HandlerContext): void {
  ctx.setAgents(msg.agents);
  useAppStore.getState().setLoading(false);
  if (msg.systemPaused !== undefined) {
    useAppStore.getState().setSystemPaused(msg.systemPaused);
  }
}

export function handleSystemPaused(msg: any, _ctx: HandlerContext): void {
  useAppStore.getState().setSystemPaused(msg.paused);
}

export function handleTimerCreated(msg: any, _ctx: HandlerContext): void {
  const ts = useTimerStore.getState();
  if (msg.timer) ts.addTimer(msg.timer);
}

export function handleTimerFired(msg: any, _ctx: HandlerContext): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) {
    ts.fireTimer(timerId);
    ts.scheduleFireRemoval(timerId);
  }
}

export function handleTimerCancelled(msg: any, _ctx: HandlerContext): void {
  const ts = useTimerStore.getState();
  const timerId = msg.timerId ?? msg.timer?.id;
  if (timerId) ts.removeTimer(timerId);
}

// Track pending decisions globally for the approval queue badge
export function handleLeadDecision(msg: any, _ctx: HandlerContext): void {
  if (msg.needsConfirmation && msg.id) {
    // Minimal oversight: auto-approve all decisions without user prompts
    const oversight = useSettingsStore.getState().oversightLevel;
    if (oversight === 'minimal') {
      apiFetch(`/decisions/${msg.id}/confirm`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
      return;
    }
    useAppStore.getState().addPendingDecision({
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

export function handleDecisionResolved(msg: any, _ctx: HandlerContext): void {
  const decisionId = msg.decisionId ?? msg.id;
  if (decisionId) {
    useAppStore.getState().removePendingDecision(decisionId);
  }
}

export function handleDecisionsBatch(msg: any, _ctx: HandlerContext): void {
  // Batch resolve — remove all resolved decisions
  const decisions = msg.decisions ?? [];
  for (const d of decisions) {
    if (d.id) useAppStore.getState().removePendingDecision(d.id);
  }
}
