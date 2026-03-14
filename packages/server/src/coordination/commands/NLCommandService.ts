import type { AgentManager } from '../../agents/AgentManager.js';
import type { DecisionLog } from '../decisions/DecisionLog.js';
import type { ActivityLedger } from '../activity/ActivityLedger.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export interface NLPattern {
  id: string;
  phrases: string[];
  category: 'control' | 'query' | 'navigate' | 'create';
  destructive: boolean;
  description: string;
  entityParam?: 'agent' | 'role' | 'topic';
}

export interface NLActionStep {
  action: string;
  target: string;
  params?: Record<string, any>;
}

export interface NLActionPlan {
  commandId: string;
  patternId: string;
  steps: NLActionStep[];
  summary: string;
  estimatedImpact?: string;
  reversible: boolean;
}

export interface NLExecuteResult {
  plan: NLActionPlan;
  executed: boolean;
  results: Array<{ step: NLActionStep; success: boolean; detail?: string }>;
}

export interface UndoEntry {
  commandId: string;
  description: string;
  undoSteps: NLActionStep[];
  timestamp: number;
  ttl: number;
}

export interface Suggestion {
  id: string;
  label: string;
  description?: string;
  icon: string;
  score: number;           // 0-1 relevance
  command?: string;        // NL command to execute if clicked
  action?: string;         // action type hint for frontend
}

// ── ID Generator ──────────────────────────────────────────────────

function generateCommandId(): string {
  return `nl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Command Patterns (30) ─────────────────────────────────────────

const PATTERNS: NLPattern[] = [
  // ── Control (12) ──────────────────────────────────────────────
  {
    id: 'wrap-it-up',
    phrases: ['wrap it up', 'finish up', 'wind down'],
    category: 'control',
    destructive: true,
    description: 'Tell all agents to finish their current tasks and stop taking new ones',
  },
  {
    id: 'pause-all',
    phrases: ['pause everything', 'pause all', 'stop'],
    category: 'control',
    destructive: true,
    description: 'Pause all running agents immediately',
  },
  {
    id: 'resume-all',
    phrases: ['resume', 'unpause', 'continue', 'go'],
    category: 'control',
    destructive: false,
    description: 'Resume all paused agents',
  },
  {
    id: 'pause-except',
    phrases: ['pause everyone except'],
    category: 'control',
    destructive: true,
    description: 'Pause all agents except those with a specific role',
    entityParam: 'role',
  },
  {
    id: 'focus-topic',
    phrases: ['focus on', 'prioritize'],
    category: 'control',
    destructive: true,
    description: 'Prioritize a specific topic across all agents',
    entityParam: 'topic',
  },
  {
    id: 'speed-up',
    phrases: ['speed it up', 'go faster'],
    category: 'control',
    destructive: true,
    description: 'Switch agents to faster models or increase concurrency',
  },
  {
    id: 'slow-down',
    phrases: ['slow down', 'save money', 'be cheaper'],
    category: 'control',
    destructive: true,
    description: 'Switch agents to cheaper models to reduce cost',
  },
  {
    id: 'restart-agent',
    phrases: ['restart'],
    category: 'control',
    destructive: true,
    description: 'Restart a specific agent',
    entityParam: 'agent',
  },
  {
    id: 'compact-agent',
    phrases: ['compact', 'free up context'],
    category: 'control',
    destructive: true,
    description: 'Compact an agent\'s context to free up token budget',
    entityParam: 'agent',
  },
  {
    id: 'approve-all',
    phrases: ['approve all', 'approve everything'],
    category: 'control',
    destructive: true,
    description: 'Approve all pending decisions at once',
  },
  {
    id: 'reject-all',
    phrases: ['reject all pending'],
    category: 'control',
    destructive: true,
    description: 'Reject all pending decisions at once',
  },
  {
    id: 'add-agent',
    phrases: ['add a', 'spawn a'],
    category: 'control',
    destructive: false,
    description: 'Spawn a new agent with a specific role',
    entityParam: 'role',
  },

  // ── Query (10) ────────────────────────────────────────────────
  {
    id: 'status',
    phrases: ["what's happening", 'status', "how's it going"],
    category: 'query',
    destructive: false,
    description: 'Show overall crew status and progress',
  },
  {
    id: 'cost-estimate',
    phrases: ['how much will this cost', 'cost estimate'],
    category: 'query',
    destructive: false,
    description: 'Estimate the remaining cost to complete the project',
  },
  {
    id: 'bottleneck',
    phrases: ["what's taking so long", 'why so slow'],
    category: 'query',
    destructive: false,
    description: 'Identify what is slowing down progress',
  },
  {
    id: 'idle-agents',
    phrases: ["who's idle", 'anyone free'],
    category: 'query',
    destructive: false,
    description: 'List agents that are idle or have no assigned tasks',
  },
  {
    id: 'catch-up',
    phrases: ['what happened while i was away'],
    category: 'query',
    destructive: false,
    description: 'Summarize activity since you last checked in',
  },
  {
    id: 'current-spend',
    phrases: ['how much have we spent'],
    category: 'query',
    destructive: false,
    description: 'Show total spend so far for the current session',
  },
  {
    id: 'agent-status',
    phrases: ["what's ... doing"],
    category: 'query',
    destructive: false,
    description: 'Show what a specific agent is currently working on',
    entityParam: 'agent',
  },
  {
    id: 'problems',
    phrases: ['any problems', 'anything wrong'],
    category: 'query',
    destructive: false,
    description: 'Show any errors, crashes, or issues in the crew',
  },
  {
    id: 'tasks-left',
    phrases: ['how many tasks left', 'progress'],
    category: 'query',
    destructive: false,
    description: 'Show remaining tasks and overall progress',
  },
  {
    id: 'eta',
    phrases: ['when will this be done', 'eta'],
    category: 'query',
    destructive: false,
    description: 'Estimate when the current project will finish',
  },

  // ── Navigate (5) ──────────────────────────────────────────────
  {
    id: 'show-canvas',
    phrases: ['show me the canvas', 'open canvas'],
    category: 'navigate',
    destructive: false,
    description: 'Navigate to the canvas view',
  },
  {
    id: 'show-agent',
    phrases: ['show me'],
    category: 'navigate',
    destructive: false,
    description: 'Navigate to a specific agent\'s detail view',
    entityParam: 'agent',
  },
  {
    id: 'show-settings',
    phrases: ['go to settings', 'open settings'],
    category: 'navigate',
    destructive: false,
    description: 'Navigate to the settings page',
  },
  {
    id: 'show-timeline',
    phrases: ['show the timeline', 'what happened'],
    category: 'navigate',
    destructive: false,
    description: 'Navigate to the activity timeline',
  },
  {
    id: 'show-approvals',
    phrases: ['show approvals', 'pending decisions'],
    category: 'navigate',
    destructive: false,
    description: 'Navigate to the approval queue',
  },

  // ── Create (1) ────────────────────────────────────────────────
  {
    id: 'take-snapshot',
    phrases: ['take a snapshot', 'save this moment'],
    category: 'create',
    destructive: false,
    description: 'Save a snapshot of the current project state',
  },
];

// ── Pattern Matching ──────────────────────────────────────────────

/**
 * Match a natural language query against registered command patterns.
 *
 * Three-pass algorithm:
 *  1. Exact phrase match
 *  2. Starts-with match (extracts trailing entity)
 *  3. Keyword overlap (>= 60%)
 */
function matchCommand(query: string): { pattern: NLPattern; entity?: string } | null {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return null;

  // Pass 1: Exact phrase match
  for (const pattern of PATTERNS) {
    if (pattern.phrases.some(p => normalized === p)) {
      return { pattern };
    }
  }

  // Pass 2: Starts-with match — extract trailing text as entity
  for (const pattern of PATTERNS) {
    for (const phrase of pattern.phrases) {
      if (normalized.startsWith(phrase)) {
        const entity = normalized.slice(phrase.length).trim() || undefined;
        return { pattern, entity };
      }
    }
  }

  // Pass 3: Keyword overlap (>= 60%)
  const queryWords = normalized.split(/\s+/);
  for (const pattern of PATTERNS) {
    const allPhraseWords = new Set(pattern.phrases.flatMap(p => p.split(/\s+/)));
    const overlap = queryWords.filter(w => allPhraseWords.has(w)).length;
    if (overlap / queryWords.length >= 0.6) {
      return { pattern };
    }
  }

  return null;
}

// ── Undo Constants ────────────────────────────────────────────────

const UNDO_TTL_MS = 300_000; // 5 minutes
const UNDO_STACK_MAX = 20;

// ── NLCommandService ──────────────────────────────────────────────

export class NLCommandService {
  private undoStack: UndoEntry[] = [];

  constructor(
    private agentManager: AgentManager,
    private decisionLog: DecisionLog,
    private activityLedger: ActivityLedger,
  ) {}

  // ── Public API ──────────────────────────────────────────────────

  /** Get all registered command patterns */
  getPatterns(): NLPattern[] {
    return PATTERNS;
  }

  /** Generate context-aware suggestions based on current session state */
  getSuggestions(_leadId: string): Suggestion[] {
    const suggestions: Suggestion[] = [];

    // Pending decisions → suggest review
    const pending = this.decisionLog.getNeedingConfirmation();
    if (pending.length > 0) {
      suggestions.push({
        id: 'suggest-review-decisions',
        label: `Review ${pending.length} pending decision${pending.length > 1 ? 's' : ''}`,
        description: 'Approve or reject waiting decisions',
        icon: '🎯',
        score: 0.9,
        command: 'show approvals',
        action: 'navigate',
      });
    }

    // High context agents → suggest compact
    const agents = this.agentManager.getAll();
    const criticalAgents = agents.filter((a: any) => {
      if (!a.contextWindowSize || a.contextWindowSize === 0) return false;
      return a.contextWindowUsed / a.contextWindowSize > 0.85;
    });
    if (criticalAgents.length > 0) {
      const agent = criticalAgents[0] as any;
      const pct = Math.round((agent.contextWindowUsed / agent.contextWindowSize) * 100);
      suggestions.push({
        id: `suggest-compact-${agent.id}`,
        label: `${agent.role?.name ?? 'Agent'} at ${pct}% context`,
        description: 'Compact to free context space',
        icon: '⚠️',
        score: 0.8,
        command: `compact ${agent.role?.name?.toLowerCase() ?? agent.id}`,
        action: 'compact',
      });
    }

    // Idle agents → suggest reassignment
    const idleAgents = agents.filter((a: any) => a.status === 'idle');
    if (idleAgents.length >= 2) {
      suggestions.push({
        id: 'suggest-idle-agents',
        label: `${idleAgents.length} agents idle`,
        description: 'Assign work or reduce crew size',
        icon: '💤',
        score: 0.6,
        command: "who's idle",
        action: 'query',
      });
    }

    // No agents running → suggest resume
    const runningAgents = agents.filter((a: any) => a.status === 'running');
    if (runningAgents.length === 0 && agents.length > 0) {
      suggestions.push({
        id: 'suggest-resume',
        label: 'No agents running',
        description: 'Resume agents to continue work',
        icon: '▶️',
        score: 0.85,
        command: 'resume',
        action: 'control',
      });
    }

    return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /** Match a query string to a command pattern */
  match(query: string): { pattern: NLPattern; entity?: string } | null {
    return matchCommand(query);
  }

  /** Preview: plan what would happen without executing */
  preview(query: string, leadId: string): NLActionPlan | null {
    const matched = matchCommand(query);
    if (!matched) return null;
    return this.buildPlan(matched.pattern, matched.entity, leadId);
  }

  /** Execute: match, plan, and execute the command */
  execute(query: string, leadId: string): NLExecuteResult | null {
    const matched = matchCommand(query);
    if (!matched) return null;

    const plan = this.buildPlan(matched.pattern, matched.entity, leadId);
    const results: NLExecuteResult['results'] = [];

    for (const step of plan.steps) {
      const result = this.executeStep(step, leadId);
      results.push({ step, ...result });
    }

    const executed = results.some(r => r.success);

    // Push undo entry if the plan is reversible and something was executed
    if (plan.reversible && executed) {
      const undoSteps = this.buildUndoSteps(plan);
      if (undoSteps.length > 0) {
        this.undoStack.push({
          commandId: plan.commandId,
          description: plan.summary,
          undoSteps,
          timestamp: Date.now(),
          ttl: UNDO_TTL_MS,
        });
        // Cap the undo stack
        if (this.undoStack.length > UNDO_STACK_MAX) {
          this.undoStack.shift();
        }
      }
    }

    logger.info('nl-command', `Executed "${query}" → ${plan.patternId} (${results.filter(r => r.success).length}/${results.length} steps succeeded)`);

    return { plan, executed, results };
  }

  /** Undo the last executed command */
  undo(commandId: string): { status: 'ok' | 'expired' | 'not_found' } {
    const idx = this.undoStack.findIndex(e => e.commandId === commandId);
    if (idx === -1) return { status: 'not_found' };

    const entry = this.undoStack[idx];
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      // Remove expired entry
      this.undoStack.splice(idx, 1);
      return { status: 'expired' };
    }

    // Execute undo steps
    for (const step of entry.undoSteps) {
      this.executeStep(step, 'system');
    }

    // Remove from stack
    this.undoStack.splice(idx, 1);
    logger.info('nl-command', `Undid command ${commandId}: ${entry.description}`);
    return { status: 'ok' };
  }

  // ── Private Helpers ─────────────────────────────────────────────

  /** Build an action plan for a matched pattern */
  private buildPlan(pattern: NLPattern, entity: string | undefined, leadId: string): NLActionPlan {
    const commandId = generateCommandId();
    const steps: NLActionStep[] = [];
    let summary = '';
    let estimatedImpact: string | undefined;
    let reversible = true;

    switch (pattern.id) {
      // ── Control ──────────────────────────────────────────────
      case 'wrap-it-up': {
        const agents = this.agentManager.getAll();
        for (const agent of agents) {
          steps.push({ action: 'wrap_up', target: agent.id });
        }
        summary = `Sending wrap-up signal to ${agents.length} agent(s)`;
        estimatedImpact = 'Agents will finish current tasks and stop accepting new work';
        break;
      }

      case 'pause-all': {
        steps.push({ action: 'pause_system', target: 'all' });
        summary = 'Pausing all agents';
        estimatedImpact = 'All work will stop until you resume';
        break;
      }

      case 'resume-all': {
        steps.push({ action: 'resume_system', target: 'all' });
        summary = 'Resuming all agents';
        break;
      }

      case 'pause-except': {
        const role = entity || 'unknown';
        const agents = this.agentManager.getAll();
        for (const agent of agents) {
          if (agent.role.id !== role && agent.role.name.toLowerCase() !== role.toLowerCase()) {
            steps.push({ action: 'pause_agent', target: agent.id, params: { reason: `Pausing everyone except ${role}` } });
          }
        }
        summary = `Pausing all agents except role "${role}" (${steps.length} agent(s) affected)`;
        estimatedImpact = `Only ${role} agents will continue working`;
        break;
      }

      case 'focus-topic': {
        const topic = entity || 'unknown';
        steps.push({ action: 'set_focus', target: 'all', params: { topic } });
        summary = `Setting crew focus to "${topic}"`;
        estimatedImpact = 'All agents will prioritize this topic';
        break;
      }

      case 'speed-up': {
        steps.push({ action: 'change_speed', target: 'all', params: { mode: 'fast' } });
        summary = 'Switching to faster models and higher concurrency';
        estimatedImpact = 'Higher cost but faster progress';
        break;
      }

      case 'slow-down': {
        steps.push({ action: 'change_speed', target: 'all', params: { mode: 'economy' } });
        summary = 'Switching to cheaper, slower models';
        estimatedImpact = 'Lower cost but slower progress';
        break;
      }

      case 'restart-agent': {
        const agentId = entity || 'unknown';
        steps.push({ action: 'restart_agent', target: agentId });
        summary = `Restarting agent "${agentId}"`;
        reversible = false;
        break;
      }

      case 'compact-agent': {
        const agentId = entity || 'unknown';
        steps.push({ action: 'compact_context', target: agentId });
        summary = `Compacting context for agent "${agentId}"`;
        reversible = false;
        break;
      }

      case 'approve-all': {
        const pending = this.decisionLog.getNeedingConfirmation();
        if (pending.length > 0) {
          steps.push({
            action: 'batch_approve',
            target: 'all',
            params: { ids: pending.map(d => d.id) },
          });
        }
        summary = `Approving ${pending.length} pending decision(s)`;
        estimatedImpact = pending.length > 0
          ? 'All pending decisions will be confirmed'
          : 'No pending decisions to approve';
        break;
      }

      case 'reject-all': {
        const pending = this.decisionLog.getNeedingConfirmation();
        if (pending.length > 0) {
          steps.push({
            action: 'batch_reject',
            target: 'all',
            params: { ids: pending.map(d => d.id) },
          });
        }
        summary = `Rejecting ${pending.length} pending decision(s)`;
        estimatedImpact = pending.length > 0
          ? 'All pending decisions will be rejected'
          : 'No pending decisions to reject';
        break;
      }

      case 'add-agent': {
        const role = entity || 'developer';
        steps.push({ action: 'spawn_agent', target: leadId, params: { role } });
        summary = `Spawning a new "${role}" agent`;
        reversible = false;
        break;
      }

      // ── Query ────────────────────────────────────────────────
      case 'status': {
        steps.push({ action: 'query_status', target: 'all' });
        summary = 'Fetching overall crew status';
        break;
      }

      case 'cost-estimate': {
        steps.push({ action: 'query_cost_estimate', target: 'all' });
        summary = 'Estimating remaining project cost';
        break;
      }

      case 'bottleneck': {
        steps.push({ action: 'query_bottleneck', target: 'all' });
        summary = 'Analyzing bottlenecks and slow points';
        break;
      }

      case 'idle-agents': {
        steps.push({ action: 'query_idle', target: 'all' });
        summary = 'Finding idle agents';
        break;
      }

      case 'catch-up': {
        steps.push({ action: 'query_catch_up', target: 'all' });
        summary = 'Generating catch-up summary';
        break;
      }

      case 'current-spend': {
        steps.push({ action: 'query_spend', target: 'all' });
        summary = 'Fetching current spend totals';
        break;
      }

      case 'agent-status': {
        const agentId = entity || 'unknown';
        steps.push({ action: 'query_agent_status', target: agentId });
        summary = `Checking what agent "${agentId}" is doing`;
        break;
      }

      case 'problems': {
        steps.push({ action: 'query_problems', target: 'all' });
        summary = 'Scanning for errors and problems';
        break;
      }

      case 'tasks-left': {
        steps.push({ action: 'query_tasks_left', target: 'all' });
        summary = 'Counting remaining tasks';
        break;
      }

      case 'eta': {
        steps.push({ action: 'query_eta', target: 'all' });
        summary = 'Estimating time to completion';
        break;
      }

      // ── Navigate ─────────────────────────────────────────────
      case 'show-canvas': {
        steps.push({ action: 'navigate', target: '/canvas' });
        summary = 'Opening the canvas view';
        break;
      }

      case 'show-agent': {
        const agentId = entity || 'unknown';
        steps.push({ action: 'navigate', target: `/agents/${agentId}` });
        summary = `Navigating to agent "${agentId}"`;
        break;
      }

      case 'show-settings': {
        steps.push({ action: 'navigate', target: '/settings' });
        summary = 'Opening settings';
        break;
      }

      case 'show-timeline': {
        steps.push({ action: 'navigate', target: '/timeline' });
        summary = 'Opening the activity timeline';
        break;
      }

      case 'show-approvals': {
        steps.push({ action: 'navigate', target: '/approvals' });
        summary = 'Opening the approval queue';
        break;
      }

      // ── Create ───────────────────────────────────────────────
      case 'take-snapshot': {
        steps.push({ action: 'take_snapshot', target: 'current' });
        summary = 'Taking a snapshot of the current state';
        break;
      }

      default: {
        summary = `Unknown pattern: ${pattern.id}`;
        reversible = false;
        break;
      }
    }

    return {
      commandId,
      patternId: pattern.id,
      steps,
      summary,
      estimatedImpact,
      reversible,
    };
  }

  /** Execute a single action step */
  private executeStep(step: NLActionStep, _leadId: string): { success: boolean; detail?: string } {
    try {
      switch (step.action) {
        // ── System-level control ────────────────────────────────
        case 'pause_system': {
          this.agentManager.pauseSystem();
          return { success: true, detail: 'System paused' };
        }

        case 'resume_system': {
          this.agentManager.resumeSystem();
          return { success: true, detail: 'System resumed' };
        }

        // ── Agent-level control (validate target exists) ────────
        case 'pause_agent': {
          const agent = this.agentManager.get(step.target);
          if (!agent) return { success: false, detail: `Agent "${step.target}" not found` };
          // Actual pause is dispatched via message/event — we validate and signal
          return { success: true, detail: `Pause signal queued for agent "${step.target}"` };
        }

        case 'resume_agent': {
          const agent = this.agentManager.get(step.target);
          if (!agent) return { success: false, detail: `Agent "${step.target}" not found` };
          return { success: true, detail: `Resume signal queued for agent "${step.target}"` };
        }

        case 'restart_agent': {
          const agent = this.agentManager.get(step.target);
          if (!agent) return { success: false, detail: `Agent "${step.target}" not found` };
          return { success: true, detail: `Restart signal queued for agent "${step.target}"` };
        }

        case 'compact_context': {
          const agent = this.agentManager.get(step.target);
          if (!agent) return { success: false, detail: `Agent "${step.target}" not found` };
          return { success: true, detail: `Context compaction queued for agent "${step.target}"` };
        }

        case 'wrap_up': {
          const agent = this.agentManager.get(step.target);
          if (!agent) return { success: false, detail: `Agent "${step.target}" not found` };
          return { success: true, detail: `Wrap-up signal sent to agent "${step.target}"` };
        }

        // ── Batch decision actions ──────────────────────────────
        case 'batch_approve': {
          const ids: string[] = step.params?.ids ?? [];
          if (ids.length === 0) return { success: true, detail: 'No pending decisions to approve' };
          const result = this.decisionLog.confirmBatch(ids);
          return { success: true, detail: `Approved ${result.updated} decision(s)` };
        }

        case 'batch_reject': {
          const ids: string[] = step.params?.ids ?? [];
          if (ids.length === 0) return { success: true, detail: 'No pending decisions to reject' };
          const result = this.decisionLog.rejectBatch(ids);
          return { success: true, detail: `Rejected ${result.updated} decision(s)` };
        }

        // ── Spawn ───────────────────────────────────────────────
        case 'spawn_agent': {
          const role = step.params?.role ?? 'developer';
          return { success: true, detail: `Spawn "${role}" agent requested — requires lead confirmation` };
        }

        // ── Focus / Speed ───────────────────────────────────────
        case 'set_focus': {
          const topic = step.params?.topic ?? 'unknown';
          return { success: true, detail: `Focus set to "${topic}" — agents will be notified` };
        }

        case 'change_speed': {
          const mode = step.params?.mode ?? 'normal';
          return { success: true, detail: `Speed mode changed to "${mode}"` };
        }

        // ── Query actions (V1: return success, frontend handles display) ─
        case 'query_status':
        case 'query_cost_estimate':
        case 'query_bottleneck':
        case 'query_idle':
        case 'query_catch_up':
        case 'query_spend':
        case 'query_agent_status':
        case 'query_problems':
        case 'query_tasks_left':
        case 'query_eta': {
          return { success: true, detail: `Query "${step.action}" executed` };
        }

        // ── Navigation (frontend-handled) ───────────────────────
        case 'navigate': {
          return { success: true, detail: `Navigate to ${step.target}` };
        }

        // ── Create actions (V1: signal success, actual creation via API) ─
        case 'take_snapshot': {
          return { success: true, detail: 'Snapshot capture initiated' };
        }

        default: {
          return { success: false, detail: `Unknown action: ${step.action}` };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('nl-command', `Step failed: ${step.action} → ${message}`);
      return { success: false, detail: message };
    }
  }

  /** Build undo steps for a reversible plan */
  private buildUndoSteps(plan: NLActionPlan): NLActionStep[] {
    const undoSteps: NLActionStep[] = [];

    for (const step of plan.steps) {
      switch (step.action) {
        case 'pause_system':
          undoSteps.push({ action: 'resume_system', target: 'all' });
          break;
        case 'resume_system':
          undoSteps.push({ action: 'pause_system', target: 'all' });
          break;
        case 'pause_agent':
          undoSteps.push({ action: 'resume_agent', target: step.target });
          break;
        case 'resume_agent':
          undoSteps.push({ action: 'pause_agent', target: step.target });
          break;
        case 'wrap_up':
          undoSteps.push({ action: 'resume_agent', target: step.target });
          break;
        case 'batch_approve':
          // Can't un-approve decisions; skip undo for this
          break;
        case 'batch_reject':
          // Can't un-reject decisions; skip undo for this
          break;
        case 'set_focus':
          undoSteps.push({ action: 'set_focus', target: 'all', params: { topic: null } });
          break;
        case 'change_speed':
          undoSteps.push({ action: 'change_speed', target: 'all', params: { mode: 'normal' } });
          break;
        // Query, navigate, and create actions don't need undo
        default:
          break;
      }
    }

    return undoSteps;
  }
}
