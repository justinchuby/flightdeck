/**
 * Secretary notification helper.
 *
 * Sends real-time notifications to the secretary agent about DAG events
 * (task completions, delegations, assignments) so it doesn't have to
 * rely solely on polling via ContextRefresher.
 */
import type { CommandHandlerContext } from './types.js';
import { isCrewMember } from '../crewUtils.js';

/**
 * Find the secretary agent for a given lead and send it a notification.
 * No-ops silently if no secretary exists (not all sessions have one).
 * Skips sending if the secretary is the originating agent (avoids self-notification).
 */
export function notifySecretary(
  ctx: CommandHandlerContext,
  leadId: string,
  message: string,
  fromAgentId?: string,
): void {
  const allAgents = ctx.getAllAgents?.();
  if (!allAgents) return;

  const secretary = allAgents.find(a =>
    isCrewMember(a, leadId) && a.id !== leadId &&
    a.role.id === 'secretary' &&
    a.status !== 'terminated' && a.status !== 'failed' && a.status !== 'completed'
  );
  if (secretary && secretary.id !== fromAgentId) {
    secretary.sendMessage(message);
  }
}
