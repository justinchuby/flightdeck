/**
 * Server-side message classification and project health synthesis.
 *
 * Ports the client-side messageTiers.ts classification rules to the server,
 * enriching CREW_UPDATE with critical event awareness and structured health data.
 */
import type { ActivityEntry, ActionType } from './ActivityLedger.js';
import type { ActivityLedger } from './ActivityLedger.js';
import type { AgentManager } from '../agents/AgentManager.js';
import { isTerminalStatus } from '../agents/Agent.js';

// ── Classification patterns ─────────────────────────────────────────

const CRITICAL_PATTERNS: RegExp[] = [
  /build fail/i,
  /test fail/i,
  /compil(?:e|ation)\s+(?:error|fail)/i,
  /crash(?:ed|ing)?/i,
  /agent (?:stuck|hung|failed|crashed)/i,
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

export interface ProjectHealthSnapshot {
  criticalEvents: ActivityEntry[];
  recentCompletions: ActivityEntry[];
  pendingActions: { pendingDecisions: number; blockedTasks: number };
  agentHealth: { stuckAgents: string[]; highContextAgents: string[] };
}

export class SynthesisEngine {
  constructor(
    private activityLedger: ActivityLedger,
    private agentManager: AgentManager,
  ) {}

  /** Classify recent activity and return a structured health snapshot for a lead */
  synthesizeProjectHealth(leadId: string): ProjectHealthSnapshot {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const recentEvents = this.activityLedger.getSince(fifteenMinAgo);

    // Filter to events from this lead's agents
    const myAgents = this.agentManager.getAll().filter(a => a.parentId === leadId || a.id === leadId);
    const myAgentIds = new Set(myAgents.map(a => a.id));
    const myEvents = recentEvents.filter(e => myAgentIds.has(e.agentId));

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

    // Agent health: stuck (running >10min with no recent activity) or high context
    const tenMinAgo = Date.now() - 10 * 60_000;
    const stuckAgents: string[] = [];
    const highContextAgents: string[] = [];

    for (const agent of myAgents) {
      if (isTerminalStatus(agent.status)) continue;
      if (agent.status === 'running') {
        const agentEvents = myEvents.filter(e => e.agentId === agent.id);
        const lastEventTime = agentEvents.length > 0
          ? new Date(agentEvents[agentEvents.length - 1].timestamp).getTime()
          : 0;
        if (lastEventTime < tenMinAgo) {
          stuckAgents.push(`${agent.id.slice(0, 8)} (${agent.role.name})`);
        }
        // High context pressure: >85% of context window used
        const used = (agent as any).contextWindowUsed ?? 0;
        const total = (agent as any).contextWindowSize ?? 0;
        if (total > 0 && used / total > 0.85) {
          highContextAgents.push(`${agent.id.slice(0, 8)} (${agent.role.name}, ${Math.round(used / total * 100)}%)`);
        }
      }
    }

    return {
      criticalEvents,
      recentCompletions,
      pendingActions: { pendingDecisions, blockedTasks },
      agentHealth: { stuckAgents, highContextAgents },
    };
  }

  /** Format critical events as a string section for CREW_UPDATE */
  formatCriticalSection(leadId: string): string | null {
    const health = this.synthesizeProjectHealth(leadId);
    const lines: string[] = [];

    if (health.criticalEvents.length > 0) {
      lines.push('== ⚠️ CRITICAL EVENTS ==');
      for (const evt of health.criticalEvents) {
        const shortId = evt.agentId.slice(0, 8);
        const time = new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push(`[${time}] ${shortId} (${evt.agentRole}): ${evt.summary.slice(0, 120)}`);
      }
    }

    if (health.agentHealth.stuckAgents.length > 0) {
      lines.push(`⚠️ Stuck agents (no activity >10min): ${health.agentHealth.stuckAgents.join(', ')}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }
}
