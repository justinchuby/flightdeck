import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import type { AgentAdapter, ToolCallInfo, PlanEntry, PromptContent } from '../adapters/types.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { redact } from '../utils/redaction.js';
import { AgentEventEmitter } from './AgentEvents.js';
import type { UsageInfo, CompactionInfo } from './AgentEvents.js';
import { startAcp as startAcpBridge, ensureSharedWorkspace } from './AgentAcpBridge.js';
import { formatCrewUpdate } from '../coordination/agents/CrewFormatter.js';
import type { CrewMember } from '../coordination/agents/CrewFormatter.js';

import type { AgentStatus } from '@flightdeck/shared';
export type { AgentStatus } from '@flightdeck/shared';
import type { MessageQueueStore } from '../persistence/MessageQueueStore.js';

export function isTerminalStatus(status: AgentStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'terminated';
}

export interface AgentContextInfo {
  id: string;
  role: string;
  roleName: string;
  status: AgentStatus;
  task?: string;
  lockedFiles: string[];
  model?: string;
  parentId?: string;
  isSystemAgent?: boolean;
  pendingMessages?: number;
  createdAt?: string;
  contextWindowSize?: number;
  contextWindowUsed?: number;
}

export interface AgentJSON {
  id: string;
  role: Role;
  status: AgentStatus;
  autopilot: boolean;
  task?: string;
  dagTaskId?: string;
  parentId?: string;
  childIds: string[];
  createdAt: string;
  outputPreview: string;
  plan?: PlanEntry[];
  toolCalls?: ToolCallInfo[];
  sessionId?: string | null;
  projectName?: string;
  projectId?: string;
  model?: string;
  cwd?: string;
  inputTokens: number;
  outputTokens: number;
  contextWindowSize: number;
  contextWindowUsed: number;
  contextBurnRate: number;
  estimatedExhaustionMinutes: number | null;
  pendingMessages: number;
  isSubLead: boolean;
  hierarchyLevel: number;
  isSystemAgent?: boolean;
  /** CLI provider used to spawn this agent (e.g. 'copilot', 'claude', 'cursor') */
  provider?: string;
  /** Adapter backend type (e.g. 'acp', 'claude-sdk', 'copilot-sdk') */
  backend?: string;
}

export class Agent {
  public readonly id: string;
  public readonly role: Role;
  public readonly createdAt: Date;
  public autopilot: boolean;
  public status: AgentStatus = 'creating';
  public task?: string;
  public dagTaskId?: string;
  public parentId?: string;
  public childIds: string[] = [];
  public plan: PlanEntry[] = [];
  public toolCalls: ToolCallInfo[] = [];
  public messages: string[] = [];
  /** Index into messages[] marking the start of the current task's output */
  public taskOutputStartIndex: number = 0;
  public sessionId: string | null = null;
  public projectName?: string;
  public projectId?: string;
  /** Model override for this agent (e.g. "claude-opus-4.6"). Overrides role default. */
  public model?: string;
  /** Working directory for this agent's CLI process */
  public cwd?: string;
  /** Error message if agent failed to start (e.g., CLI binary not found) */
  public exitError?: string;
  /** Summary from COMPLETE_TASK command, used for knowledge extraction */
  public completionSummary?: string;
  /** Tracks when the last human message was received (for leads) */
  public lastHumanMessageAt: Date | null = null;
  public lastHumanMessageText: string | null = null;
  public humanMessageResponded: boolean = true;
  /** Concurrency budget info (set by AgentManager for leads) */
  public budget?: { maxConcurrent: number; runningCount: number };
  /** Hierarchy depth: 0 = root lead, 1 = sub-lead, 2 = sub-sub-lead, etc. */
  public hierarchyLevel: number = 0;
  /** Whether this agent was auto-created by the system (e.g., auto-secretary) */
  public isSystemAgent: boolean = false;
  /** CLI provider used to spawn this agent (e.g. 'copilot', 'claude', 'cursor') */
  public provider?: string;
  /** Adapter backend type (e.g. 'acp', 'claude-sdk', 'copilot-sdk') */
  public backend?: string;
  /** Organized artifact storage path (~/.flightdeck/artifacts/{projectId}/sessions/{leadId}/{role}-{shortId}/) */
  public artifactDir?: string;
  /** Cumulative token usage from ACP PromptResponse */
  public inputTokens = 0;
  public outputTokens = 0;
  /** Whether real usage data has been received from ACP (vs. estimated) */
  public hasRealUsageData = false;
  /** Estimated output tokens from content length (~4 chars per token) */
  private estimatedOutputTokens = 0;
  /** Context window info from ACP usage_update */
  public contextWindowSize = 0;
  public contextWindowUsed = 0;
  /** Token usage history for burn rate calculation */
  private tokenHistory: Array<{ timestamp: number; used: number }> = [];
  private static MIN_SAMPLE_INTERVAL_MS = 10_000;   // 10s dedup between samples
  private static MAX_WINDOW_AGE_MS = 600_000;        // 10min max window
  private static MIN_POINTS_FOR_PREDICTION = 3;      // minimum data points
  private static MIN_SPAN_MS = 30_000;               // minimum 30s span
  private terminated = false;
  /** Hash of the last CREW_UPDATE sent — used to skip duplicate updates */
  private lastUpdateHash: string = '';
  /** When true, message delivery is halted — messages stay queued */
  public systemPaused = false;

  private acpConnection: AgentAdapter | null = null;
  private config: ServerConfig;
  /** Each pending message tracks its optional DB row ID for crash-safe delivery */
  private pendingMessages: Array<{ content: PromptContent; mqId?: number }> = [];
  private pendingPriorityCount = 0;
  private static readonly MAX_PENDING_MESSAGES = 200;
  private peers: AgentContextInfo[];
  private readonly events = new AgentEventEmitter();
  /** Optional crash-safe message persistence (write-on-enqueue pattern) */
  private messageQueueStore?: MessageQueueStore;

  /** Resume a previous session by its Copilot session ID */
  public resumeSessionId?: string;

  /** @internal True while agent is still in resume initialization — suppresses parent notifications */
  _isResuming = false;

  // ── Internal constants exposed for AgentAcpBridge ───────────────────────
  /** @internal */ readonly _maxMessages = 500;
  /** @internal */ readonly _maxToolCalls = 200;
  /** @internal */ get _isTerminated(): boolean { return this.terminated; }

  constructor(role: Role, config: ServerConfig, task?: string, parentId?: string, peers: AgentContextInfo[] = [], autopilot?: boolean, id?: string) {
    this.id = id || uuid();
    this.role = role;
    this.config = config;
    this.task = task;
    this.parentId = parentId;
    this.createdAt = new Date();
    this.autopilot = autopilot ?? false;
    this.peers = peers;
  }

  start(): void {
    ensureSharedWorkspace(this);
    const isResume = !!this.resumeSessionId;

    // On resume, send nothing — the SDK restores conversation history and the
    // agent is ready. The user decides when to send the next message.
    const initialPrompt = isResume ? undefined : this.buildFullPrompt();
    // Errors are handled internally by the bridge (sets agent status to 'failed').
    const bridgePromise = startAcpBridge(this, this.config, initialPrompt);
    bridgePromise.catch((err) => {
      logger.error({ module: 'agent', msg: 'Bridge startup failed', agentId: this.id, err: (err as Error).message });
      this.exitError = (err as Error).message;
      this.status = 'failed';
    });
  }

  // ── Internal methods used by AgentAcpBridge ─────────────────────────────
  /** @internal */ _setAcpConnection(conn: AgentAdapter): void { this.acpConnection = conn; }
  /** @internal */ _notifyData(data: string): void { this.events.notifyData(data); }
  /** @internal */ _notifyContent(content: any): void { this.events.notifyContent(content); }
  /** @internal */ _notifyThinking(text: string): void { this.events.notifyThinking(text); }
  /** @internal */ _notifyExit(code: number): void { this.events.notifyExit(code); }
  /** @internal */ _notifyHung(elapsedMs: number): void { this.events.notifyHung(elapsedMs); }
  /** @internal */ _notifyStatusChange(status: AgentStatus): void { this.events.notifyStatus(status); }
  /** @internal */ _notifyToolCall(info: ToolCallInfo): void { this.events.notifyToolCall(info); }
  /** @internal */ _notifyPlan(entries: PlanEntry[]): void { this.events.notifyPlan(entries); }
  /** @internal */ _notifyPermissionRequest(request: any): void { this.events.notifyPermissionRequest(request); }
  /** @internal */ _notifySessionReady(sessionId: string): void { this.events.notifySessionReady(sessionId); }
  /** @internal */ _notifySessionResumeFailed(info: { requestedSessionId: string; error: string }): void { this.events.notifySessionResumeFailed(info); }
  /** @internal */ _notifyContextCompacted(info: CompactionInfo): void { this.events.notifyContextCompacted(info); }
  /** @internal */ _notifyUsage(info: UsageInfo): void { this.events.notifyUsage(info); }
  /** @internal */ _notifyResponseStart(): void { this.events.notifyResponseStart(); }
  /** @internal */ _drainOneMessage(): void {
    if (this.pendingMessages.length > 0) {
      const next = this.pendingMessages.shift()!;
      if (this.pendingPriorityCount > 0) this.pendingPriorityCount--;
      this.write(next.content);
      if (next.mqId && this.messageQueueStore) {
        try { this.messageQueueStore.markDelivered(next.mqId); } catch { /* non-critical */ }
      }
    }
  }

  buildContextManifest(peers: AgentContextInfo[], budget?: { maxConcurrent: number; runningCount: number }): string {
    const shortId = this.id.slice(0, 8);
    const taskLine = this.task ? this.task : 'Awaiting assignment';

    // For leads: show "YOUR AGENTS" (children) separately from sibling leads
    const isLead = this.role.id === 'lead';
    const myChildren = isLead ? peers.filter((p) => p.parentId === this.id) : [];
    // Sibling peers: same-project agents that aren't this lead's children (and not self)
    const siblingPeers = isLead
      ? peers.filter((p) => p.parentId !== this.id && p.id !== this.id)
      : [];
    // Non-leads see all peers (pre-filtered to same project by the caller)
    const otherPeers = isLead ? [] : peers;

    const childLines = myChildren
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const modelStr = p.model ? ` [${p.model}]` : '';
        const systemStr = p.isSystemAgent ? ' (system)' : '';
        return `- ${pShort} — ${p.roleName}${systemStr}${modelStr} — ${p.status}${p.task ? `, task: ${p.task.slice(0, 80)}` : ''}`;
      })
      .join('\n');

    const siblingLines = siblingPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const systemStr = p.isSystemAgent ? ' (system)' : '';
        return `- Agent ${pShort} (${p.roleName}${systemStr}) — Status: ${p.status}, Working on: ${p.task ? p.task.slice(0, 80) : 'idle'}`;
      })
      .join('\n');

    const peerLines = otherPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        const systemStr = p.isSystemAgent ? ' (system)' : '';
        return `- Agent ${pShort} (${p.roleName}${systemStr}) — Status: ${p.status}, Working on: ${p.task || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    const siblingSection = isLead && siblingLines
      ? `\n== OTHER TEAM MEMBERS ==\n${siblingLines}`
      : '';

    const budgetSection = isLead && budget
      ? `\n== AGENT BUDGET ==
Max concurrent agents: ${budget.maxConcurrent}
Currently running: ${budget.runningCount} / ${budget.maxConcurrent}
Available slots: ${budget.maxConcurrent - budget.runningCount}
${budget.runningCount >= budget.maxConcurrent ? '⚠ AT CAPACITY — reuse idle agents via DELEGATE, or TERMINATE_AGENT as a last resort to free a slot.' : ''}`
      : '';

    const crewSection = isLead
      ? `== YOUR AGENTS ==
${childLines || '(no agents created yet — use CREATE_AGENT to create specialists)'}
Use agent IDs above with DELEGATE to assign tasks, or AGENT_MESSAGE to communicate.
${this.role.id === 'lead' && this.parentId ? `\n== HIERARCHY ==\nYou are a SUB-LEAD (level ${this.hierarchyLevel}). You report to lead ${this.parentId.slice(0, 8)}.\nFocus on your assigned domain. Create and manage your own sub-agents.\n${budget ? `Budget: ${budget.maxConcurrent} max concurrent agents total (shared across all leads).` : ''}` : ''}${siblingSection}`
      : `== ACTIVE CREW MEMBERS ==
${peerLines || '(no other agents)'}`;

    return `[CREW CONTEXT]
You are agent ${shortId} with role "${this.role.name}".

== YOUR ASSIGNMENT ==
- Task: ${taskLine}
- You are responsible for: ${this.role.description}

${crewSection}
${budgetSection}

== SHARED WORKSPACE ==
Your artifact directory: .flightdeck/shared/${this.role.id}-${this.id.slice(0, 8)}/
Write reports, designs, and analysis files here. All crew members can read this directory.${this.artifactDir ? `\nOrganized storage: ${this.artifactDir}` : ''}
Convention: .flightdeck/shared/<your-role>-<short-id>/<filename>
Example: .flightdeck/shared/architect-a1b2c3d4/design-doc.md
All team members have access to this directory. Create your subdirectory before writing files.

== COORDINATION RULES ==
⚠ CRITICAL: Flightdeck commands (AGENT_MESSAGE, COMPLETE_TASK, BROADCAST, LOCK_FILE, COMMIT, etc.) are NOT tool calls.
They must appear directly in your text response using ⟦⟦ COMMAND ⟧⟧ syntax. The system parses them from your text stream.
- WRONG: Using bash echo or any tool to output a command block
- RIGHT: Writing the command block directly in your conversation text
Tools (bash, view, edit, grep, glob) are for filesystem work. Commands are for communicating with the flightdeck system and other agents.

1. DO NOT modify files that another agent has locked (listed above).
2. ALWAYS acquire a file lock BEFORE editing any file:
\`⟦⟦ LOCK_FILE {"filePath": "path/to/file", "reason": "why"} ⟧⟧\`
3. When CREATING new files, lock them with LOCK_FILE before COMMIT so they are included in the scoped commit. The COMMIT command only stages locked files — unlocked new files will be left behind.
4. When you finish editing a file, release the lock:
\`⟦⟦ UNLOCK_FILE {"filePath": "path/to/file"} ⟧⟧\`
5. To communicate with another agent, use:
\`⟦⟦ AGENT_MESSAGE {"to": "agent-id", "content": "message"} ⟧⟧\`
6. To broadcast a message to ALL team members, use:
\`⟦⟦ BROADCAST {"content": "message"} ⟧⟧\`
7. To send a message to a group you belong to:
\`⟦⟦ GROUP_MESSAGE {"group": "group-name", "content": "message"} ⟧⟧\`
8. To create a chat group with other agents for coordination:
\`⟦⟦ CREATE_GROUP {"name": "group-name", "members": ["agent-id-1", "agent-id-2"]} ⟧⟧\`
9. To list your groups: \`⟦⟦ LIST_GROUPS ⟧⟧\`
10. To get an updated roster of all agents and their IDs, use:
\`⟦⟦ QUERY_CREW ⟧⟧\`
11. Stay within your role's scope. Defer to the appropriate specialist for work outside your expertise.
12. When referencing other agents in messages, always use the @ prefix (e.g., @568c3298, not 568c3298). This enables clickable @mention tooltips in the UI.
13. Log important decisions by outputting:
\`⟦⟦ ACTIVITY {"action": "decision_made", "summary": "what you decided"} ⟧⟧\`
14. To defer a non-blocking issue for later:
\`⟦⟦ DEFER_ISSUE {"description": "issue details", "severity": "low"} ⟧⟧\`
\`⟦⟦ QUERY_DEFERRED {} ⟧⟧\`

== SKILLS (reusable knowledge for future work) ==
Skills are reusable instructions that Copilot CLI loads automatically when relevant. Use them to capture REUSABLE KNOWLEDGE — patterns, techniques, and approaches that will benefit future work sessions.

When to create a skill:
- You discover a reusable pattern, technique, or approach (e.g. "how to add a new API endpoint in this codebase")
- You learn a non-obvious debugging technique or workaround
- You figure out a build/test/deploy process that's tricky
- You identify conventions or gotchas that future agents should know

What skills are NOT for:
- One-time analysis reports or summaries — those are not reusable
- Task-specific notes that won't help future work
- Documentation that belongs in the code itself (use comments/READMEs instead)

How to create a skill:
1. Create a folder under .github/skills/<skill-name>/ (lowercase, hyphens for spaces)
2. Create a SKILL.md file with YAML frontmatter and Markdown body:

\`\`\`markdown
---
name: skill-name
description: When to use this skill and what it teaches. Be specific so Copilot loads it at the right time.
---

Instructions, examples, and guidelines here.
\`\`\`

Good examples: "how-to-add-api-routes", "testing-conventions", "database-migration-patterns", "error-handling-approach"
Bad examples: "analysis-report-feb-2026", "task-42-notes", "code-review-results"

== AGENT-FRIENDLY CODE ==
This codebase is worked on by AI agents as well as humans. Write code that is easy for agentic AI systems to navigate and modify:
- Use clear, searchable names for files, functions, and variables — avoid abbreviations and single-letter names
- Keep files small and focused on one responsibility
- Use consistent patterns across the codebase — predictability helps agents find and modify code
- Write self-documenting code; add comments only for "why", not "what"
- Include good error messages that explain what went wrong and suggest fixes
- Co-locate tests next to the code they test
- Prefer explicit over implicit — avoid magic numbers, hidden side effects, and clever tricks
- Define clear module boundaries with explicit exports

== COLLABORATIVE DEBATE ==
You are encouraged to challenge other agents' ideas and approaches — and to welcome challenges to your own. The goal is to reach the BEST decision, not to be right.
- If you disagree with another agent's approach, say so respectfully and explain your reasoning. Use AGENT_MESSAGE to start a discussion.
- If challenged, engage constructively — consider their point, provide evidence for your position, and be willing to change your mind.
- Propose alternatives with clear tradeoffs rather than just saying "no."
- When debating, focus on technical merit, not authority. A junior developer's insight can be better than a senior architect's assumption.
- After a productive debate, the agent with the relevant expertise makes the final call. If unresolved, escalate to the Project Lead.

== PROGRESS REPORTING ==
Report progress to your parent/lead REGULARLY while working — don't wait until you're completely done.
- After completing a significant step (e.g. finished reading files, made first edit, tests passing), send an update via AGENT_MESSAGE.
- Include: what you've done so far, what you're working on next, any blockers or questions.
- This helps the lead coordinate the team and avoids the team stalling because no one knows what's happening.

== SHARING LEARNINGS ==
When you discover something important about the codebase, a pattern, a gotcha, or a design convention:
- Use BROADCAST to share it with the whole team so everyone benefits.
- Examples: "This repo uses factory pattern for services", "Tests must be run with --experimental-vm-modules", "The API uses snake_case not camelCase"
- This prevents other agents from making the same mistakes or rediscovering the same things.
[/CREW CONTEXT]`;
  }

  /** Build the full initial prompt (system prompt + context manifest + task assignment). */
  buildFullPrompt(): string {
    const contextManifest = this.buildContextManifest(this.peers, this.budget);
    const taskAssignment = `You are acting as the "${this.role.name}" role. ${this.task ? `Your assigned task is: ${this.task}` : 'Awaiting task assignment.'}`;
    return `${this.role.systemPrompt}\n\n${contextManifest}\n\n${taskAssignment}`;
  }

  injectContextUpdate(peers: AgentContextInfo[], _recentActivity: string[], healthHeader?: string, alerts?: string[]): boolean {
    // Convert AgentContextInfo to CrewMember (compatible interfaces)
    const members: CrewMember[] = peers;

    const budget = this.budget
      ? { running: this.budget.runningCount, max: this.budget.maxConcurrent }
      : undefined;

    const formatted = formatCrewUpdate(members, {
      viewerId: this.id,
      viewerRole: this.role.id,
      healthHeader,
      budget,
      alerts,
    });

    const update = `⟦⟦ CREW_UPDATE\n${formatted}\nCREW_UPDATE ⟧⟧`;

    // Hash to skip duplicate updates
    const hash = createHash('md5').update(formatted).digest('hex');
    if (hash === this.lastUpdateHash) {
      return false;
    }
    this.lastUpdateHash = hash;

    if (this.acpConnection?.isConnected) {
      this.acpConnection.prompt(update).catch((err) => {
        logger.warn({ module: 'agent', msg: 'Context update failed', role: this.role.name, err: err?.message });
      });
    }
    return true;
  }

  write(data: PromptContent, opts?: { priority?: boolean }): void {
    if (this.terminated) return;
    if (this.acpConnection?.isConnected) {
      this.status = 'running';
      this.events.notifyStatus(this.status);
      this.acpConnection.prompt(data, opts).catch((err) => {
        logger.error({ module: 'agent', msg: 'Prompt failed', role: this.role.name, err: String(err?.message || err) });
        // Reset status so agent doesn't get stuck as 'running'
        if (this.status === 'running') {
          this.status = 'idle';
          this.events.notifyStatus(this.status);
        }
      });
    }
  }

  /** Send a message to this agent (used for inter-agent communication and completion callbacks) */
  sendMessage(message: PromptContent, opts?: { priority?: boolean }): void {
    this.write(message, opts);
  }

  /** Inject the crash-safe message queue store (called by AgentManager after construction) */
  setMessageQueueStore(store: MessageQueueStore): void {
    this.messageQueueStore = store;
  }

  /**
   * Queue a message for delivery after the agent finishes its current prompt.
   * If `opts.priority` is true, the message is inserted after existing priority
   * messages but before normal messages (FIFO within priority class).
   * Queue is capped at MAX_PENDING_MESSAGES — excess non-priority messages are dropped with a warning.
   * Priority messages (e.g. user messages) are NEVER dropped.
   */
  queueMessage(message: PromptContent, opts?: { priority?: boolean }): void {
    // Write to DB FIRST for crash safety (write-on-enqueue pattern)
    let mqId: number | undefined;
    if (this.messageQueueStore) {
      try {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        mqId = this.messageQueueStore.enqueue(this.id, 'agent_message', payload);
      } catch (err: any) {
        logger.warn({ module: 'comms', msg: 'Failed to persist message to queue', agentId: this.id, error: err.message });
      }
    }

    if (this.systemPaused) {
      this.enqueueMessage(message, opts?.priority, mqId);
      return;
    }
    if (this.status === 'idle') {
      this.write(message, opts);
      // Mark delivered immediately since we wrote directly
      if (mqId && this.messageQueueStore) {
        try { this.messageQueueStore.markDelivered(mqId); } catch { /* non-critical */ }
      }
    } else {
      this.enqueueMessage(message, opts?.priority, mqId);
    }
  }

  /** Internal: insert message into pendingMessages with FIFO priority ordering and rate limiting */
  private enqueueMessage(message: PromptContent, priority?: boolean, mqId?: number): void {
    if (!priority && this.pendingMessages.length >= Agent.MAX_PENDING_MESSAGES) {
      logger.warn({ module: 'agent', msg: 'Message queue full — dropping non-priority message', role: this.role.name, maxMessages: Agent.MAX_PENDING_MESSAGES });
      // Bug fix: mark the DB row as delivered so it doesn't replay on restart
      if (mqId && this.messageQueueStore) {
        try { this.messageQueueStore.markDelivered(mqId); } catch { /* non-critical */ }
      }
      return;
    }
    const entry = { content: message, mqId };
    if (priority) {
      this.pendingMessages.splice(this.pendingPriorityCount, 0, entry);
      this.pendingPriorityCount++;
    } else {
      this.pendingMessages.push(entry);
    }
  }

  /** Interrupt current work, then send message */
  async interruptWithMessage(message: PromptContent): Promise<void> {
    if (this.acpConnection && this.status === 'running') {
      // Mark cleared messages as delivered in DB before discarding
      if (this.messageQueueStore) {
        for (const { mqId } of this.pendingMessages) {
          if (mqId) {
            try { this.messageQueueStore.markDelivered(mqId); } catch { /* non-critical */ }
          }
        }
      }
      this.pendingMessages.length = 0;
      this.pendingPriorityCount = 0;
      await this.acpConnection.cancel();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.write(message);
  }

  /** Get the number of pending queued messages */
  get pendingMessageCount(): number {
    return this.pendingMessages.length;
  }

  /** Whether the agent's LLM supports image content blocks */
  get supportsImages(): boolean {
    return this.acpConnection?.supportsImages ?? false;
  }

  /** Whether this agent has an active/in-progress LLM call */
  get isPrompting(): boolean {
    return this.acpConnection?.isPrompting ?? false;
  }

  /** When the current LLM call started (null if not prompting) */
  get promptingStartedAt(): number | null {
    return this.acpConnection?.promptingStartedAt ?? null;
  }

  /** Drain one pending message if idle — called when system resumes */
  drainPendingMessages(): void {
    if (this.status === 'idle' && this.pendingMessages.length > 0 && !this.systemPaused) {
      const next = this.pendingMessages.shift()!;
      this.write(next.content);
      // Mark delivered in DB after successful write
      if (next.mqId && this.messageQueueStore) {
        try { this.messageQueueStore.markDelivered(next.mqId); } catch { /* non-critical */ }
      }
    }
  }

  /** Clear all pending (queued, not yet started) messages. Returns the count and previews of cleared messages. */
  clearPendingMessages(): { count: number; previews: string[] } {
    const count = this.pendingMessages.length;
    const previews = this.pendingMessages.map(({ content }) =>
      typeof content === 'string' ? content.slice(0, 100) : `[${(content as any[]).length} content block(s)]`,
    );
    // Mark all DB rows as delivered so they don't replay on restart
    if (this.messageQueueStore) {
      for (const { mqId } of this.pendingMessages) {
        if (mqId) {
          try { this.messageQueueStore.markDelivered(mqId); } catch { /* non-critical */ }
        }
      }
    }
    this.pendingMessages.length = 0;
    this.pendingPriorityCount = 0;
    return { count, previews };
  }

  /** Get summaries of pending messages for queue visibility (first 100 chars each) */
  getPendingMessageSummaries(): string[] {
    return this.pendingMessages.map(({ content }) =>
      typeof content === 'string' ? content.slice(0, 100) : `[${(content as any[]).length} content block(s)]`,
    );
  }

  /** Remove a pending message by index. Returns true if removed. */
  removePendingMessage(index: number): boolean {
    if (index < 0 || index >= this.pendingMessages.length) return false;
    this.pendingMessages.splice(index, 1);
    return true;
  }

  /** Move a pending message from one index to another. Returns true if moved. */
  reorderPendingMessage(fromIndex: number, toIndex: number): boolean {
    if (fromIndex < 0 || fromIndex >= this.pendingMessages.length) return false;
    if (toIndex < 0 || toIndex >= this.pendingMessages.length) return false;
    if (fromIndex === toIndex) return true;
    const [msg] = this.pendingMessages.splice(fromIndex, 1);
    this.pendingMessages.splice(toIndex, 0, msg);
    return true;
  }

  /** Cancel the agent's current work (ACP cancel signal) */
  async interrupt(): Promise<void> {
    if (this.acpConnection) {
      await this.acpConnection.cancel();
    }
  }

  resolvePermission(approved: boolean): void {
    if (this.acpConnection) {
      this.acpConnection.resolvePermission(approved);
    }
  }

  setAutopilot(enabled: boolean): void {
    this.autopilot = enabled;
    if (this.acpConnection) {
      this.acpConnection.setAutopilot(enabled);
    }
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    this.status = 'terminated';
    this.events.notifyStatus(this.status);
    if (this.acpConnection) {
      const conn = this.acpConnection;
      this.acpConnection = null;
      await conn.terminate();
    }
  }

  dispose(): void {
    this.events.dispose();
    this.pendingMessages.length = 0;
    this.pendingPriorityCount = 0;
    this.messages.length = 0;
    this.toolCalls.length = 0;
    this.lastUpdateHash = '';
  }

  // ── Event registration (delegated to AgentEventEmitter) ─────────────────
  onData(listener: (data: string) => void): void { this.events.onData(listener); }
  onContent(listener: (content: any) => void): void { this.events.onContent(listener); }
  onExit(listener: (code: number) => void): void { this.events.onExit(listener); }
  onHung(listener: (elapsedMs: number) => void): void { this.events.onHung(listener); }
  onStatus(listener: (status: AgentStatus) => void): void { this.events.onStatus(listener); }
  onToolCall(listener: (info: ToolCallInfo) => void): void { this.events.onToolCall(listener); }
  onPlan(listener: (entries: PlanEntry[]) => void): void { this.events.onPlan(listener); }
  onPermissionRequest(listener: (request: any) => void): void { this.events.onPermissionRequest(listener); }
  onSessionReady(listener: (sessionId: string) => void): void { this.events.onSessionReady(listener); }
  onSessionResumeFailed(listener: (info: { requestedSessionId: string; error: string }) => void): void { this.events.onSessionResumeFailed(listener); }
  onContextCompacted(listener: (info: { previousUsed: number; currentUsed: number; percentDrop: number }) => void): void { this.events.onContextCompacted(listener); }
  /** Register a listener for token usage updates (for cost tracking). */
  onUsage(listener: (info: UsageInfo) => void): void { this.events.onUsage(listener); }
  onThinking(listener: (text: string) => void): void { this.events.onThinking(listener); }
  onResponseStart(listener: () => void): void { this.events.onResponseStart(listener); }

  getBufferedOutput(): string {
    return this.messages.join('');
  }

  /** Get recent output efficiently — avoids joining the entire messages array */
  getRecentOutput(maxChars = 8000): string {
    let result = '';
    for (let i = this.messages.length - 1; i >= 0 && result.length < maxChars; i--) {
      result = this.messages[i] + result;
    }
    return result.length > maxChars ? result.slice(-maxChars) : result;
  }

  /** Get output scoped to the current task (from taskOutputStartIndex onward) */
  getTaskOutput(maxChars = 16000): string {
    let result = '';
    const startIdx = Math.max(this.taskOutputStartIndex, 0);
    for (let i = this.messages.length - 1; i >= startIdx && result.length < maxChars; i--) {
      result = this.messages[i] + result;
    }
    return result.length > maxChars ? result.slice(-maxChars) : result;
  }

  // ── Burn Rate Tracking ────────────────────────────────────────────

  /** Record a context window usage sample for burn rate calculation */
  recordTokenSample(used: number): void {
    const now = Date.now();
    const last = this.tokenHistory[this.tokenHistory.length - 1];
    if (last && now - last.timestamp < Agent.MIN_SAMPLE_INTERVAL_MS) return;
    this.tokenHistory.push({ timestamp: now, used });
    this.pruneTokenHistory();
  }

  private pruneTokenHistory(): void {
    const cutoff = Date.now() - Agent.MAX_WINDOW_AGE_MS;
    while (this.tokenHistory.length > 0 && this.tokenHistory[0].timestamp < cutoff) {
      this.tokenHistory.shift();
    }
  }

  /** Tokens per second burn rate based on the sliding window */
  get contextBurnRate(): number {
    this.pruneTokenHistory();
    if (this.tokenHistory.length < Agent.MIN_POINTS_FOR_PREDICTION) return 0;
    const first = this.tokenHistory[0];
    const last = this.tokenHistory[this.tokenHistory.length - 1];
    const dtMs = last.timestamp - first.timestamp;
    if (dtMs < Agent.MIN_SPAN_MS) return 0;
    const tokensConsumed = last.used - first.used;
    if (tokensConsumed <= 0) return 0;
    return tokensConsumed / (dtMs / 1000);
  }

  /** Estimated minutes until context window is exhausted, or null if unknown */
  get estimatedExhaustionMinutes(): number | null {
    if (this.contextBurnRate <= 0 || this.contextWindowSize <= 0) return null;
    const remaining = this.contextWindowSize - this.contextWindowUsed;
    if (remaining <= 0) return 0;
    return remaining / this.contextBurnRate / 60;
  }

  /** Estimate tokens from content length when ACP doesn't provide usage events (~4 chars/token) */
  estimateTokensFromContent(text: string): void {
    if (this.hasRealUsageData) return;
    const estimated = Math.ceil(text.length / 4);
    this.estimatedOutputTokens += estimated;
    this.outputTokens = this.estimatedOutputTokens;
  }

  toJSON(): AgentJSON {
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      autopilot: this.autopilot,
      task: this.task,
      dagTaskId: this.dagTaskId,
      parentId: this.parentId,
      childIds: this.childIds,
      createdAt: this.createdAt.toISOString(),
      outputPreview: redact(this.getRecentOutput(4000)).text,
      plan: this.plan,
      toolCalls: this.toolCalls.slice(-50),
      sessionId: this.sessionId,
      projectName: this.projectName,
      projectId: this.projectId,
      model: this.model || this.role.model,
      cwd: this.cwd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      contextWindowSize: this.contextWindowSize,
      contextWindowUsed: this.contextWindowUsed,
      contextBurnRate: this.contextBurnRate,
      estimatedExhaustionMinutes: this.estimatedExhaustionMinutes,
      pendingMessages: this.pendingMessageCount,
      isSubLead: this.role.id === 'lead' && !!this.parentId,
      hierarchyLevel: this.hierarchyLevel,
      isSystemAgent: this.isSystemAgent || undefined,
      provider: this.provider,
      backend: this.backend,
    };
  }
}
