import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import type { AcpConnection, ToolCallInfo, PlanEntry } from '../acp/AcpConnection.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { AgentEventEmitter } from './AgentEvents.js';
import type { UsageInfo, CompactionInfo } from './AgentEvents.js';
import { startAcp as startAcpBridge, ensureSharedWorkspace } from './AgentAcpBridge.js';
import { formatCrewUpdate } from '../coordination/CrewFormatter.js';
import type { CrewMember } from '../coordination/CrewFormatter.js';

export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';

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
  pendingMessages: number;
  isSubLead: boolean;
  hierarchyLevel: number;
  isSystemAgent?: boolean;
}

export class Agent {
  public readonly id: string;
  public readonly role: Role;
  public readonly createdAt: Date;
  public readonly autopilot: boolean;
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
  /** Cumulative token usage from ACP PromptResponse */
  public inputTokens = 0;
  public outputTokens = 0;
  /** Context window info from ACP usage_update */
  public contextWindowSize = 0;
  public contextWindowUsed = 0;
  private terminated = false;
  /** Hash of the last CREW_UPDATE sent — used to skip duplicate updates */
  private lastUpdateHash: string = '';
  /** When true, message delivery is halted — messages stay queued */
  public systemPaused = false;

  private acpConnection: AcpConnection | null = null;
  private config: ServerConfig;
  private pendingMessages: string[] = [];
  private peers: AgentContextInfo[];
  private readonly events = new AgentEventEmitter();

  /** Resume a previous session by its Copilot session ID */
  public resumeSessionId?: string;

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

    if (isResume) {
      startAcpBridge(this, this.config, undefined);
    } else {
      const contextManifest = this.buildContextManifest(this.peers, this.budget);
      const taskAssignment = `You are acting as the "${this.role.name}" role. ${this.task ? `Your assigned task is: ${this.task}` : 'Awaiting task assignment.'}`;
      const initialPrompt = `${this.role.systemPrompt}\n\n${contextManifest}\n\n${taskAssignment}`;
      startAcpBridge(this, this.config, initialPrompt);
    }
  }

  // ── Internal methods used by AgentAcpBridge ─────────────────────────────
  /** @internal */ _setAcpConnection(conn: AcpConnection): void { this.acpConnection = conn; }
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
  /** @internal */ _notifyContextCompacted(info: CompactionInfo): void { this.events.notifyContextCompacted(info); }
  /** @internal */ _notifyUsage(info: UsageInfo): void { this.events.notifyUsage(info); }
  /** @internal */ _drainOneMessage(): void {
    if (this.pendingMessages.length > 0) {
      const next = this.pendingMessages.shift()!;
      this.write(next);
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
Path: .flightdeck/shared/ (inside your working directory)
Use this directory for documents, reports, or artifacts that other agents need to read.
Convention: .flightdeck/shared/<your-role>-<short-id>/<filename>
Example: .flightdeck/shared/architect-a1b2c3d4/design-doc.md
All team members have access to this directory. Create your subdirectory before writing files.

== COORDINATION RULES ==
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
        logger.warn('agent', `Context update failed for ${this.role.name} (${this.id.slice(0, 8)}): ${err?.message}`);
      });
    }
    return true;
  }

  write(data: string): void {
    if (this.terminated) return;
    if (this.acpConnection?.isConnected) {
      this.status = 'running';
      this.events.notifyStatus(this.status);
      this.acpConnection.prompt(data).catch((err) => {
        logger.error('agent', `Prompt failed for ${this.role.name} (${this.id.slice(0, 8)}): ${err?.message || err}`);
        // Reset status so agent doesn't get stuck as 'running'
        if (this.status === 'running') {
          this.status = 'idle';
          this.events.notifyStatus(this.status);
        }
      });
    }
  }

  /** Send a message to this agent (used for inter-agent communication and completion callbacks) */
  sendMessage(message: string): void {
    this.write(message);
  }

  /** Queue a message — delivered after the agent finishes its current prompt */
  queueMessage(message: string): void {
    if (this.systemPaused) {
      this.pendingMessages.push(message);
      return;
    }
    if (this.status === 'idle') {
      this.write(message);
    } else {
      this.pendingMessages.push(message);
    }
  }

  /** Interrupt current work, then send message */
  async interruptWithMessage(message: string): Promise<void> {
    if (this.acpConnection && this.status === 'running') {
      // Clear any queued messages — interrupt takes priority
      this.pendingMessages.length = 0;
      await this.acpConnection.cancel();
      // Small delay to let cancellation settle before sending new prompt
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.write(message);
  }

  /** Get the number of pending queued messages */
  get pendingMessageCount(): number {
    return this.pendingMessages.length;
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
      this.write(next);
    }
  }

  /** Clear all pending (queued, not yet started) messages. Returns the count and previews of cleared messages. */
  clearPendingMessages(): { count: number; previews: string[] } {
    const count = this.pendingMessages.length;
    const previews = this.pendingMessages.map((msg) => msg.slice(0, 100));
    this.pendingMessages.length = 0;
    return { count, previews };
  }

  /** Get summaries of pending messages for queue visibility (first 100 chars each) */
  getPendingMessageSummaries(): string[] {
    return this.pendingMessages.map((msg) => msg.slice(0, 100));
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

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.status = 'terminated';
    this.events.notifyStatus(this.status);
    if (this.acpConnection) {
      this.acpConnection.terminate();
      this.acpConnection = null;
    }
  }

  dispose(): void {
    this.events.dispose();
    this.pendingMessages.length = 0;
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
  onContextCompacted(listener: (info: { previousUsed: number; currentUsed: number; percentDrop: number }) => void): void { this.events.onContextCompacted(listener); }
  /** Register a listener for token usage updates (for cost tracking). */
  onUsage(listener: (info: { agentId: string; inputTokens: number; outputTokens: number; dagTaskId?: string }) => void): void { this.events.onUsage(listener); }
  onThinking(listener: (text: string) => void): void { this.events.onThinking(listener); }

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
      outputPreview: this.getRecentOutput(4000),
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
      pendingMessages: this.pendingMessageCount,
      isSubLead: this.role.id === 'lead' && !!this.parentId,
      hierarchyLevel: this.hierarchyLevel,
      isSystemAgent: this.isSystemAgent || undefined,
    };
  }
}
