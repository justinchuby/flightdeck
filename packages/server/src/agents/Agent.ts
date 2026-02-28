import { v4 as uuid } from 'uuid';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { AcpConnection } from '../acp/AcpConnection.js';
import type { ToolCallInfo, PlanEntry } from '../acp/AcpConnection.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { agentFlagForRole } from './agentFiles.js';

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
}

export interface AgentJSON {
  id: string;
  role: Role;
  status: AgentStatus;
  autopilot: boolean;
  task?: string;
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
}

export class Agent {
  public readonly id: string;
  public readonly role: Role;
  public readonly createdAt: Date;
  public readonly autopilot: boolean;
  public status: AgentStatus = 'creating';
  public task?: string;
  public parentId?: string;
  public childIds: string[] = [];
  public plan: PlanEntry[] = [];
  public toolCalls: ToolCallInfo[] = [];
  public messages: string[] = [];
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
  /** Cumulative token usage from ACP PromptResponse */
  public inputTokens = 0;
  public outputTokens = 0;
  /** Context window info from ACP usage_update */
  public contextWindowSize = 0;
  public contextWindowUsed = 0;
  private terminated = false;

  private acpConnection: AcpConnection | null = null;
  private config: ServerConfig;
  private dataListeners: Array<(data: string) => void> = [];
  private contentListeners: Array<(content: any) => void> = [];
  private thinkingListeners: Array<(text: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private hungListeners: Array<(elapsedMs: number) => void> = [];
  private statusListeners: Array<(status: AgentStatus) => void> = [];
  private pendingMessages: string[] = [];
  private toolCallListeners: Array<(info: ToolCallInfo) => void> = [];
  private planListeners: Array<(entries: PlanEntry[]) => void> = [];
  private permissionRequestListeners: Array<(request: any) => void> = [];
  private sessionReadyListeners: Array<(sessionId: string) => void> = [];
  private contextCompactedListeners: Array<(info: { previousUsed: number; currentUsed: number; percentDrop: number }) => void> = [];
  private static readonly MAX_MESSAGES = 500;
  private static readonly MAX_TOOL_CALLS = 200;
  private peers: AgentContextInfo[];

  /** Resume a previous session by its Copilot session ID */
  public resumeSessionId?: string;

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
    this.ensureSharedWorkspace();
    const isResume = !!this.resumeSessionId;

    if (isResume) {
      this.startAcp(undefined);
    } else {
      const contextManifest = this.buildContextManifest(this.peers, this.budget);
      const taskAssignment = `You are acting as the "${this.role.name}" role. ${this.task ? `Your assigned task is: ${this.task}` : 'Awaiting task assignment.'}`;
      const initialPrompt = `${this.role.systemPrompt}\n\n${contextManifest}\n\n${taskAssignment}`;
      this.startAcp(initialPrompt);
    }
  }

  private ensureSharedWorkspace(): void {
    const sharedDir = join(this.cwd || process.cwd(), '.ai-crew', 'shared');
    if (!existsSync(sharedDir)) {
      try { mkdirSync(sharedDir, { recursive: true }); } catch (err) { logger.debug('agent', 'Shared dir already exists or cannot be created'); }
    }
  }

  private startAcp(initialPrompt?: string): void {
    this.acpConnection = new AcpConnection({ autopilot: this.autopilot });
    this.status = 'running';
    this.wireAcpEvents();

    const cliArgs = [
      ...this.config.cliArgs,
      `--agent=${agentFlagForRole(this.role.id)}`,
      ...(this.model || this.role.model ? ['--model', this.model || this.role.model!] : []),
      ...(this.resumeSessionId ? ['--resume', this.resumeSessionId] : []),
    ];

    this.acpConnection.start({
      cliCommand: this.config.cliCommand,
      cliArgs,
      cwd: this.cwd || process.cwd(),
    }).then((sessionId) => {
      this.sessionId = sessionId;
      for (const listener of this.sessionReadyListeners) listener(sessionId);
      // Only send initial prompt for new sessions; resumed sessions already have context
      if (initialPrompt) {
        return this.acpConnection!.prompt(initialPrompt);
      }
    }).catch((err) => {
      this.status = 'failed';
      for (const listener of this.exitListeners) {
        listener(1);
      }
    });
  }


  private wireAcpEvents(): void {
    const conn = this.acpConnection!;

    conn.on('text', (text: string) => {
      if (this.terminated) return;
      this.messages.push(text);
      if (this.messages.length > Agent.MAX_MESSAGES) {
        this.messages = this.messages.slice(-Agent.MAX_MESSAGES);
      }
      for (const listener of this.dataListeners) {
        listener(text);
      }
    });

    conn.on('content', (content: any) => {
      for (const listener of this.contentListeners) {
        listener(content);
      }
    });

    conn.on('thinking', (text: string) => {
      for (const listener of this.thinkingListeners) {
        listener(text);
      }
    });

    conn.on('tool_call', (info: ToolCallInfo) => {
      if (this.terminated) return;
      const idx = this.toolCalls.findIndex((t) => t.toolCallId === info.toolCallId);
      if (idx >= 0) {
        this.toolCalls[idx] = info;
      } else {
        this.toolCalls.push(info);
        if (this.toolCalls.length > Agent.MAX_TOOL_CALLS) {
          this.toolCalls = this.toolCalls.slice(-Agent.MAX_TOOL_CALLS);
        }
      }
      for (const listener of this.toolCallListeners) {
        listener(info);
      }
    });

    conn.on('tool_call_update', (update: Partial<ToolCallInfo> & { toolCallId: string }) => {
      const idx = this.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId);
      if (idx >= 0) {
        this.toolCalls[idx] = { ...this.toolCalls[idx], ...update };
      }
      for (const listener of this.toolCallListeners) {
        listener(this.toolCalls[idx] ?? update as ToolCallInfo);
      }
    });

    conn.on('plan', (entries: PlanEntry[]) => {
      this.plan = entries;
      for (const listener of this.planListeners) {
        listener(entries);
      }
    });

    conn.on('permission_request', (request: any) => {
      for (const listener of this.permissionRequestListeners) {
        listener(request);
      }
    });

    // Accumulate token usage from each prompt turn
    conn.on('usage', (usage: { inputTokens: number; outputTokens: number }) => {
      this.inputTokens = usage.inputTokens;
      this.outputTokens = usage.outputTokens;
    });

    // Track context window from usage_update events and detect compaction
    conn.on('usage_update', (info: { size: number; used: number }) => {
      const previousUsed = this.contextWindowUsed;
      this.contextWindowSize = info.size;
      this.contextWindowUsed = info.used;

      // Detect compaction: significant drop (>30%) in context usage
      if (previousUsed > 0 && info.used < previousUsed * 0.7 && previousUsed > 10000) {
        const percentDrop = Math.round(((previousUsed - info.used) / previousUsed) * 100);
        for (const listener of this.contextCompactedListeners) {
          listener({ previousUsed, currentUsed: info.used, percentDrop });
        }
      }
    });

    conn.on('exit', (code: number) => {
      if (!this.terminated) {
        this.status = code === 0 ? 'completed' : 'failed';
      }
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });

    // When a prompt finishes, mark delegated agents as idle (task done, awaiting next)
    conn.on('prompt_complete', (_stopReason: string) => {
      if (this.terminated) return;
      if (this.status === 'running' && !this.acpConnection?.isPrompting) {
        // Drain queued messages before going idle
        if (this.pendingMessages.length > 0) {
          const next = this.pendingMessages.shift()!;
          this.write(next);
          return;
        }
        this.status = 'idle';
        for (const listener of this.statusListeners) {
          listener(this.status);
        }
        for (const listener of this.hungListeners) {
          listener(0);
        }
      }
    });

    // When a prompt starts (including queued/drained prompts), ensure status is 'running'
    conn.on('prompting', (active: boolean) => {
      if (this.terminated) return;
      if (active && this.status !== 'running') {
        this.status = 'running';
        for (const listener of this.statusListeners) {
          listener(this.status);
        }
      }
    });
  }

  buildContextManifest(peers: AgentContextInfo[], budget?: { maxConcurrent: number; runningCount: number }): string {
    const shortId = this.id.slice(0, 8);
    const taskLine = this.task ? this.task : 'Awaiting assignment';

    // For leads: show "YOUR AGENTS" (children) separately from other peers
    const isLead = this.role.id === 'lead';
    const myChildren = isLead ? peers.filter((p) => p.parentId === this.id) : [];
    const otherPeers = isLead ? peers.filter((p) => p.parentId !== this.id && p.id !== this.id) : peers;

    const childLines = myChildren
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const modelStr = p.model ? ` [${p.model}]` : '';
        return `- ${pShort} — ${p.roleName}${modelStr} — ${p.status}${p.task ? `, task: ${p.task.slice(0, 80)}` : ''}`;
      })
      .join('\n');

    const peerLines = otherPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.task || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

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
${otherPeers.length > 0 ? `\n== OTHER CREW MEMBERS ==\n${peerLines}` : ''}${this.role.id === 'lead' && this.parentId ? `\n== HIERARCHY ==\nYou are a SUB-LEAD (level ${this.hierarchyLevel}). You report to lead ${this.parentId.slice(0, 8)}.\nFocus on your assigned domain. Create and manage your own sub-agents.\n${budget ? `Budget: ${budget.maxConcurrent} max concurrent agents total (shared across all leads).` : ''}` : ''}`
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
Path: .ai-crew/shared/ (inside your working directory)
Use this directory for documents, reports, or artifacts that other agents need to read.
Convention: .ai-crew/shared/<your-role>-<short-id>/<filename>
Example: .ai-crew/shared/architect-a1b2c3d4/design-doc.md
All team members have access to this directory. Create your subdirectory before writing files.

== COORDINATION RULES ==
1. DO NOT modify files that another agent has locked (listed above).
2. ALWAYS acquire a file lock BEFORE editing any file:
\`[[[ LOCK_FILE {"filePath": "path/to/file", "reason": "why"} ]]]\`
3. When you finish editing a file, release the lock:
\`[[[ UNLOCK_FILE {"filePath": "path/to/file"} ]]]\`
4. To communicate with another agent, use:
\`[[[ AGENT_MESSAGE {"to": "agent-id", "content": "message"} ]]]\`
5. To broadcast a message to ALL team members, use:
\`[[[ BROADCAST {"content": "message"} ]]]\`
6. To send a message to a group you belong to:
\`[[[ GROUP_MESSAGE {"group": "group-name", "content": "message"} ]]]\`
7. To create a chat group with other agents for coordination:
\`[[[ CREATE_GROUP {"name": "group-name", "members": ["agent-id-1", "agent-id-2"]} ]]]\`
8. To list your groups: \`[[[ LIST_GROUPS ]]]\`
9. To get an updated roster of all agents and their IDs, use:
\`[[[ QUERY_CREW ]]]\`
10. Stay within your role's scope. Defer to the appropriate specialist for work outside your expertise.
11. Log important decisions by outputting:
\`[[[ ACTIVITY {"action": "decision_made", "summary": "what you decided"} ]]]\`

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

  injectContextUpdate(peers: AgentContextInfo[], recentActivity: string[]): void {
    const isLead = this.role.id === 'lead';
    const myChildren = isLead ? peers.filter((p) => p.parentId === this.id) : [];
    const otherPeers = isLead ? peers.filter((p) => p.parentId !== this.id && p.id !== this.id) : peers;

    const childLines = myChildren
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const modelStr = p.model ? ` [${p.model}]` : '';
        return `- ${pShort} — ${p.roleName}${modelStr} — ${p.status}${p.task ? `, task: ${p.task.slice(0, 80)}` : ''}`;
      })
      .join('\n');

    const peerLines = otherPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.task || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    const crewStatus = isLead
      ? `== YOUR AGENTS ==\n${childLines || '(no agents — use CREATE_AGENT)'}${otherPeers.length > 0 ? `\n== OTHER CREW ==\n${peerLines}` : ''}`
      : `== CURRENT CREW STATUS ==\n${peerLines || '(no other agents)'}`;

    const activityLines = recentActivity.length > 0
      ? recentActivity.join('\n')
      : '(no recent activity)';

    const budgetLine = isLead && this.budget
      ? `\n== AGENT BUDGET ==\nRunning: ${this.budget.runningCount} / ${this.budget.maxConcurrent} | Available slots: ${Math.max(0, this.budget.maxConcurrent - this.budget.runningCount)}${this.budget.runningCount >= this.budget.maxConcurrent ? ' | ⚠ AT CAPACITY' : ''}`
      : '';

    const update = `[[[ CREW_UPDATE
${crewStatus}${budgetLine}
== RECENT ACTIVITY ==
${activityLines}
CREW_UPDATE ]]]`;

    if (this.acpConnection?.isConnected) {
      this.acpConnection.prompt(update).catch((err) => {
        logger.warn('agent', `Context update failed for ${this.role.name} (${this.id.slice(0, 8)}): ${err?.message}`);
      });
    }
  }

  write(data: string): void {
    if (this.terminated) return;
    if (this.acpConnection?.isConnected) {
      this.status = 'running';
      for (const listener of this.statusListeners) {
        listener(this.status);
      }
      this.acpConnection.prompt(data).catch((err) => {
        logger.error('agent', `Prompt failed for ${this.role.name} (${this.id.slice(0, 8)}): ${err?.message || err}`);
        // Reset status so agent doesn't get stuck as 'running'
        if (this.status === 'running') {
          this.status = 'idle';
          for (const listener of this.statusListeners) {
            listener(this.status);
          }
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
    for (const listener of this.statusListeners) {
      listener(this.status);
    }
    if (this.acpConnection) {
      this.acpConnection.terminate();
      this.acpConnection = null;
    }
  }

  dispose(): void {
    this.dataListeners.length = 0;
    this.contentListeners.length = 0;
    this.exitListeners.length = 0;
    this.hungListeners.length = 0;
    this.statusListeners.length = 0;
    this.sessionReadyListeners.length = 0;
    this.toolCallListeners.length = 0;
    this.planListeners.length = 0;
    this.permissionRequestListeners.length = 0;
    this.contextCompactedListeners.length = 0;
    this.thinkingListeners.length = 0;
    this.pendingMessages.length = 0;
    this.messages.length = 0;
    this.toolCalls.length = 0;
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onContent(listener: (content: any) => void): void {
    this.contentListeners.push(listener);
  }

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  onHung(listener: (elapsedMs: number) => void): void {
    this.hungListeners.push(listener);
  }

  onStatus(listener: (status: AgentStatus) => void): void {
    this.statusListeners.push(listener);
  }

  onToolCall(listener: (info: ToolCallInfo) => void): void {
    this.toolCallListeners.push(listener);
  }

  onPlan(listener: (entries: PlanEntry[]) => void): void {
    this.planListeners.push(listener);
  }

  onPermissionRequest(listener: (request: any) => void): void {
    this.permissionRequestListeners.push(listener);
  }

  onSessionReady(listener: (sessionId: string) => void): void {
    this.sessionReadyListeners.push(listener);
  }

  onContextCompacted(listener: (info: { previousUsed: number; currentUsed: number; percentDrop: number }) => void): void {
    this.contextCompactedListeners.push(listener);
  }

  onThinking(listener: (text: string) => void): void {
    this.thinkingListeners.push(listener);
  }

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

  toJSON(): AgentJSON {
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      autopilot: this.autopilot,
      task: this.task,
      parentId: this.parentId,
      childIds: this.childIds,
      createdAt: this.createdAt.toISOString(),
      outputPreview: this.getRecentOutput(500),
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
    };
  }
}
