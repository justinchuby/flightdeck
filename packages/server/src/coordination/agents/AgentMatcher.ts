import type { AgentManager } from '../../agents/AgentManager.js';
import type { CapabilityRegistry } from './CapabilityRegistry.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import { isTerminalStatus } from '../../agents/Agent.js';

export interface MatchScore {
  agentId: string;
  agentRole: string;
  agentName: string;
  score: number;
  reasons: string[];
  status: string;
}

export interface MatchQuery {
  task: string;
  requiredRole?: string;
  files?: string[];
  technologies?: string[];
  keywords?: string[];
  preferIdle?: boolean;
}

export class AgentMatcher {
  constructor(
    private agentManager: AgentManager,
    private capabilityRegistry?: CapabilityRegistry,
    private activityLedger?: ActivityLedger,
  ) {}

  /**
   * Score and rank agents for a task.
   * Returns sorted list (best match first).
   */
  match(leadId: string, query: MatchQuery): MatchScore[] {
    const allAgents = this.agentManager.getAll();
    const teamAgents = allAgents.filter(a => {
      const agentLeadId = a.parentId || a.id;
      return agentLeadId === leadId && !isTerminalStatus(a.status);
    });

    const scores: MatchScore[] = teamAgents.map(agent => {
      let score = 0;
      const reasons: string[] = [];

      // 1. Role match (0.3)
      if (query.requiredRole && agent.role.id === query.requiredRole) {
        score += 0.3;
        reasons.push(`role match: ${query.requiredRole}`);
      }

      // 2. Availability bonus (0.2)
      if (agent.status === 'idle') {
        score += 0.2;
        reasons.push('idle (immediately available)');
      } else if (agent.status === 'running' && query.preferIdle) {
        score -= 0.1;
        reasons.push('busy (running)');
      }

      // 3. File expertise (0.25) — from capability registry
      if (this.capabilityRegistry && query.files?.length) {
        const capabilities = this.capabilityRegistry.query(leadId, {
          file: query.files[0],
          availableOnly: false,
        });
        const agentCap = capabilities.find(c => c.agentId === agent.id);
        if (agentCap && agentCap.score > 0) {
          const fileScore = Math.min(agentCap.score, 1) * 0.25;
          score += fileScore;
          reasons.push(`file expertise: ${(fileScore * 100 / 0.25).toFixed(0)}%`);
        }
      }

      // 4. Technology match (0.15) — from capability registry
      if (this.capabilityRegistry && query.technologies?.length) {
        const capabilities = this.capabilityRegistry.query(leadId, {
          technology: query.technologies[0],
          availableOnly: false,
        });
        const agentCap = capabilities.find(c => c.agentId === agent.id);
        if (agentCap && agentCap.score > 0) {
          score += 0.15;
          reasons.push(`tech match: ${query.technologies[0]}`);
        }
      }

      // 5. Task keyword match (0.1) — check agent's current/past tasks
      if (query.keywords?.length && this.activityLedger) {
        const recentEvents = this.activityLedger.getRecent(200)
          .filter(e => e.agentId === agent.id);
        const allText = recentEvents.map(e => e.summary).join(' ').toLowerCase();
        const matches = query.keywords.filter(kw => allText.includes(kw.toLowerCase()));
        if (matches.length > 0) {
          score += 0.1 * (matches.length / query.keywords.length);
          reasons.push(`keyword match: ${matches.join(', ')}`);
        }
      }

      // 6. Completion track record (0.1) — penalize agents with recent failures
      if (this.activityLedger) {
        const recent = this.activityLedger.getRecent(100).filter(e => e.agentId === agent.id);
        const completions = recent.filter(e => e.actionType === 'task_completed').length;
        const errors = recent.filter(e => e.actionType === 'error').length;
        if (completions > 0 && errors === 0) {
          score += 0.1;
          reasons.push(`clean track record (${completions} completions)`);
        } else if (errors > completions) {
          score -= 0.05;
          reasons.push(`recent errors (${errors})`);
        }
      }

      return {
        agentId: agent.id,
        agentRole: agent.role.id,
        agentName: agent.role.name,
        score: Math.round(score * 100) / 100,
        reasons,
        status: agent.status,
      };
    });

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /** Quick match — return the single best agent or null */
  bestMatch(leadId: string, query: MatchQuery): MatchScore | null {
    const matches = this.match(leadId, query);
    return matches.length > 0 ? matches[0] : null;
  }

  /** Recommend N agents for parallel work */
  topN(leadId: string, query: MatchQuery, n: number = 3): MatchScore[] {
    return this.match(leadId, query).slice(0, n);
  }
}
