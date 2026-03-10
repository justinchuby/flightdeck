import type { AgentInfo, Decision, DagTask } from '../types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SuggestionInput {
  agents: AgentInfo[];
  pendingDecisions: Decision[];
  dagTasks?: DagTask[];
}

export interface Suggestion {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** 0–1 relevance score used for sorting. */
  score: number;
  /** Identifies the kind of action to perform. */
  actionType: string;
}

// ── Rule-based suggestion generator (no LLM) ───────────────────────────────

export function generateSuggestions(input: SuggestionInput): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Pending decisions → suggest review
  if (input.pendingDecisions.length > 0) {
    const n = input.pendingDecisions.length;
    suggestions.push({
      id: 'suggest-review-decisions',
      label: `Review ${n} pending decision${n > 1 ? 's' : ''}`,
      description: 'Open the approval queue to review',
      icon: '🎯',
      score: 0.9,
      actionType: 'open-approvals',
    });
  }

  // High context-window usage → suggest compact
  const criticalAgents = input.agents.filter((a) => {
    if (!a.contextWindowSize || !a.contextWindowUsed) return false;
    return a.contextWindowUsed / a.contextWindowSize > 0.85;
  });
  if (criticalAgents.length > 0) {
    const a = criticalAgents[0];
    const pct = Math.round((a.contextWindowUsed! / a.contextWindowSize!) * 100);
    suggestions.push({
      id: `suggest-compact-${a.id}`,
      label: `${a.role?.name ?? 'Agent'} at ${pct}% context`,
      description: 'Compact to free context space',
      icon: '⚠',
      score: 0.8,
      actionType: 'compact-agent',
    });
  }

  // Multiple idle agents
  const idleAgents = input.agents.filter((a) => a.status === 'idle');
  if (idleAgents.length >= 2) {
    suggestions.push({
      id: 'suggest-idle-agents',
      label: `${idleAgents.length} agents idle`,
      description: 'Assign work or reduce crew size',
      icon: '💤',
      score: 0.6,
      actionType: 'view-agents',
    });
  }

  // All tasks done
  if (
    input.dagTasks &&
    input.dagTasks.length > 0 &&
    input.dagTasks.every((t) => t.dagStatus === 'done')
  ) {
    suggestions.push({
      id: 'suggest-all-done',
      label: '🎉 All tasks complete!',
      description: 'Export session',
      icon: '✅',
      score: 1.0,
      actionType: 'export',
    });
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
}
