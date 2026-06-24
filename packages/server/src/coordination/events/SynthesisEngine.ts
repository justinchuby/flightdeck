/**
 * Server-side message classification and project health synthesis.
 *
 * Ports the client-side messageTiers.ts classification rules to the server,
 * enriching CREW_UPDATE with critical event awareness and structured health data.
 */
import type { ActivityEntry, ActionType } from '../activity/ActivityLedger.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import type { AgentManager } from '../../agents/AgentManager.js';
import { isTerminalStatus } from '../../agents/Agent.js';
import { shortAgentId } from '@flightdeck/shared';
import { isCrewMember } from '../../agents/crewUtils.js';
import { asAgentId } from '../../types/brandedIds.js';

// ── Classification patterns ─────────────────────────────────────────

const CRITICAL_PATTERNS: RegExp[] = [
  /build fail/i,
  /test fail/i,
  /compil(?:e|ation)\s+(?:error|fail)/i,
  /crash(?:ed|ing)?/i,
  /agent (?:stuck|failed|crashed)/i,
  /\bblocked\b/i,
  /\bP0\b/,
  /\bURGENT\b/i,
  /(?:TypeError|SyntaxError|RuntimeError|ReferenceError)/,
  /\b5\d{2}\b/,
  /\bOOM\b|\bout of memory\b/i,
  /heap (?:out|limit|exceeded)/i,
  /segfault|segmentation fault|stack overflow/i,
  /\bENOMEM\b|\bSIGTERM\b|\bSIGKILL\b/,
  /decision (?:needed|pending|required)/i,
  /needsConfirmation/,
  /needs (?:input|decision)/i,
  /breaking change/i,
  /\btimeout\b/i,
  /\bfatal\b/i,
];

const NOTABLE_PATTERNS: RegExp[] = [
  /task completed|work completed|completed successfully/i,
  /all \d+ tests pass/i,
  /build (?:passes|succeeded)/i,
  /\bmerged?\b/i,
  /\bshipped\b/i,
  /review (?:complete|done|ready|submitted)/i,
  /\bprogress\b/i,
  /delegat(?:ed|ion)/i,
  /new feature/i,
  /\bfixed?\b/i,
  /\[Done\]/,
];

// Action types that are inherently critical or notable
const CRITICAL_ACTION_TYPES: Set<ActionType> = new Set(['error']);
const NOTABLE_ACTION_TYPES: Set<ActionType> = new Set([
  'task_completed',
  'delegated',
  'decision_made',
  'sub_agent_spawned',
  'agent_terminated',
]);
const ROUTINE_ACTION_TYPES: Set<ActionType> = new Set([
  'lock_acquired',
  'lock_released',
  'status_change',
  'heartbeat_halted',
]);

export type EventTier = 'critical' | 'notable' | 'routine';

// ── Classification ──────────────────────────────────────────────────

export function classifyEvent(event: ActivityEntry): EventTier {
  const text = event.summary;

  // Action-type shortcuts
  if (CRITICAL_ACTION_TYPES.has(event.actionType)) return 'critical';
  if (ROUTINE_ACTION_TYPES.has(event.actionType)) return 'routine';

  // Pattern matching on summary text
  for (const pat of CRITICAL_PATTERNS) {
    if (pat.test(text)) return 'critical';
  }
  for (const pat of NOTABLE_PATTERNS) {
    if (pat.test(text)) return 'notable';
  }

  // Notable action types (checked after patterns so critical patterns win)
  if (NOTABLE_ACTION_TYPES.has(event.actionType)) return 'notable';

  // Default: long messages are notable, short are routine
  return text.length > 200 ? 'notable' : 'routine';
}

// ── Health synthesis ────────────────────────────────────────────────

interface ProjectHealthSnapshot {
  criticalEvents: ActivityEntry[];
  recentCompletions: ActivityEntry[];
  pendingActions: { pendingDecisions: number; blockedTasks: number };
  agentHealth: { highContextAgents: string[] };
}

export class SynthesisEngine {
  constructor(
    private activityLedger: ActivityLedger,
    private agentManager: AgentManager,
  ) {}

  /** Classify recent activity and return a structured health snapshot for a lead */
  synthesizeProjectHealth(leadId: string, projectId?: string): ProjectHealthSnapshot {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const recentEvents = this.activityLedger.getSince(fifteenMinAgo, projectId);

    // Filter to events from this lead's agents
    const projectAgents = projectId
      ? this.agentManager.getByProject(projectId)
      : this.agentManager.getAll();
    const myAgents = projectAgents.filter(a => isCrewMember(a, leadId));
    const myAgentIds = new Set(myAgents.map(a => a.id));
    const myEvents = recentEvents.filter(e => myAgentIds.has(asAgentId(e.agentId)));

    // Critical events (last 5)
    const criticalEvents = myEvents
      .filter(e => classifyEvent(e) === 'critical')
      .slice(-5);

    // Recent completions
    const recentCompletions = myEvents
      .filter(e => e.actionType === 'task_completed');

    // Pending actions from DAG + decisions
    const taskDAG = this.agentManager.getTaskDAG();
    const dagStatus = taskDAG.getStatus(leadId);
    const blockedTasks = dagStatus.summary.blocked;

    const decisionLog = this.agentManager.getDecisionLog();
    const pendingDecisions = decisionLog.getByLeadId(leadId)
      .filter(d => d.needsConfirmation && d.status === 'recorded').length;

    // Agent health: high context pressure
    const highContextAgents: string[] = [];

    for (const agent of myAgents) {
      if (isTerminalStatus(agent.status)) continue;
      if (agent.status === 'running') {
        // High context pressure: >85% of context window used
        const used = (agent as any).contextWindowUsed ?? 0;
        const total = (agent as any).contextWindowSize ?? 0;
        if (total > 0 && used / total > 0.85) {
          highContextAgents.push(`${shortAgentId(agent.id)} (${agent.role.name}, ${Math.round(used / total * 100)}%)`);
        }
      }
    }

    return {
      criticalEvents,
      recentCompletions,
      pendingActions: { pendingDecisions, blockedTasks },
      agentHealth: { highContextAgents },
    };
  }

  /** Format critical events as a string section for CREW_UPDATE */
  formatCriticalSection(leadId: string, projectId?: string): string | null {
    const health = this.synthesizeProjectHealth(leadId, projectId);
    const lines: string[] = [];

    if (health.criticalEvents.length > 0) {
      lines.push('== ⚠️ CRITICAL EVENTS ==');
      for (const evt of health.criticalEvents) {
        const shortId = shortAgentId(evt.agentId);
        const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push(`[${time}] ${shortId} (${evt.agentRole}): ${evt.summary.slice(0, 120)}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }
}
