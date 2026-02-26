import { v4 as uuid } from 'uuid';
import { PtyManager } from '../pty/PtyManager.js';
import { AcpConnection } from '../acp/AcpConnection.js';
import type { ToolCallInfo, PlanEntry } from '../acp/AcpConnection.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { agentFlagForRole } from './agentFiles.js';

export type AgentMode = 'pty' | 'acp';
export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed';

export interface AgentContextInfo {
  id: string;
  role: string;
  roleName: string;
  status: AgentStatus;
  taskId?: string;
  lockedFiles: string[];
  model?: string;
  parentId?: string;
}

export interface AgentJSON {
  id: string;
  role: Role;
  status: AgentStatus;
  mode: AgentMode;
  autopilot: boolean;
  taskId?: string;
  parentId?: string;
  childIds: string[];
  createdAt: string;
  outputPreview: string;
  plan?: PlanEntry[];
  toolCalls?: ToolCallInfo[];
  sessionId?: string | null;
  projectName?: string;
  model?: string;
  cwd?: string;
}

export class Agent {
  public readonly id: string;
  public readonly role: Role;
  public readonly createdAt: Date;
  public readonly mode: AgentMode;
  public readonly autopilot: boolean;
  public status: AgentStatus = 'creating';
  public taskId?: string;
  public parentId?: string;
  public childIds: string[] = [];
  public plan: PlanEntry[] = [];
  public toolCalls: ToolCallInfo[] = [];
  public messages: string[] = [];
  public sessionId: string | null = null;
  public projectName?: string;
  /** Model override for this agent (e.g. "claude-opus-4.6"). Overrides role default. */
  public model?: string;
  /** Working directory for this agent's CLI process */
  public cwd?: string;
  private killed = false;

  private pty: PtyManager;
  private acpConnection: AcpConnection | null = null;
  private config: ServerConfig;
  private dataListeners: Array<(data: string) => void> = [];
  private contentListeners: Array<(content: any) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private hungListeners: Array<(elapsedMs: number) => void> = [];
  private statusListeners: Array<(status: AgentStatus) => void> = [];
  private toolCallListeners: Array<(info: ToolCallInfo) => void> = [];
  private planListeners: Array<(entries: PlanEntry[]) => void> = [];
  private permissionRequestListeners: Array<(request: any) => void> = [];
  private sessionReadyListeners: Array<(sessionId: string) => void> = [];
  private peers: AgentContextInfo[];

  /** Resume a previous session by its Copilot session ID */
  public resumeSessionId?: string;

  constructor(role: Role, config: ServerConfig, taskId?: string, parentId?: string, peers: AgentContextInfo[] = [], mode?: AgentMode, autopilot?: boolean) {
    this.id = uuid();
    this.role = role;
    this.config = config;
    this.taskId = taskId;
    this.parentId = parentId;
    this.createdAt = new Date();
    this.mode = mode ?? config.defaultAgentMode;
    this.autopilot = autopilot ?? false;
    this.pty = new PtyManager();
    this.peers = peers;
  }

  start(): void {
    const contextManifest = this.buildContextManifest(this.peers);
    // Include both the role system prompt and context manifest.
    // The system prompt is also in the .agent.md file (via --agent flag) for
    // persistence through context compression, but we include it here too
    // to ensure the agent always sees its role instructions on first message.
    const taskAssignment = `You are acting as the "${this.role.name}" role. ${this.taskId ? `Your assigned task ID is: ${this.taskId}` : 'Awaiting task assignment.'}`;
    const resumeHint = this.resumeSessionId
      ? `\n\n== SESSION RESUME ==\nYou are resuming a previous session. Your prior session ID was: ${this.resumeSessionId}\nPlease review your previous work from that session and continue where you left off.`
      : '';
    const initialPrompt = `${this.role.systemPrompt}\n\n${contextManifest}\n\n${taskAssignment}${resumeHint}`;

    if (this.mode === 'acp') {
      this.startAcp(initialPrompt);
    } else {
      this.startPty(initialPrompt);
    }
  }

  private startPty(initialPrompt: string): void {
    this.pty.spawn({
      command: this.config.cliCommand,
      args: [
        ...this.config.cliArgs,
        `--agent=${agentFlagForRole(this.role.id)}`,
        ...(this.model || this.role.model ? ['--model', this.model || this.role.model!] : []),
      ],
      cwd: this.cwd,
      env: {
        AI_CREW_AGENT_ID: this.id,
        AI_CREW_ROLE: this.role.id,
      },
    });

    this.status = 'running';

    // Send initial role context after a short delay for CLI to initialize
    setTimeout(() => {
      if (this.pty.isRunning) {
        this.pty.write(initialPrompt + '\n');
      }
    }, 1000);

    this.pty.on('data', (data: string) => {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    });

    this.pty.on('exit', (code: number) => {
      if (!this.killed) {
        this.status = code === 0 ? 'completed' : 'failed';
      }
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });

    this.pty.on('hung', (elapsedMs: number) => {
      this.status = 'idle';
      for (const listener of this.hungListeners) {
        listener(elapsedMs);
      }
    });
  }

  private startAcp(initialPrompt: string): void {
    this.acpConnection = new AcpConnection({ autopilot: this.autopilot });
    this.status = 'running';
    this.wireAcpEvents();

    this.acpConnection.start({
      cliCommand: this.config.cliCommand,
      cliArgs: [
        ...this.config.cliArgs,
        `--agent=${agentFlagForRole(this.role.id)}`,
        ...(this.model || this.role.model ? ['--model', this.model || this.role.model!] : []),
      ],
      cwd: this.cwd || process.cwd(),
    }).then((sessionId) => {
      this.sessionId = sessionId;
      for (const listener of this.sessionReadyListeners) listener(sessionId);
      return this.acpConnection!.prompt(initialPrompt);
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
      this.messages.push(text);
      for (const listener of this.dataListeners) {
        listener(text);
      }
    });

    conn.on('content', (content: any) => {
      for (const listener of this.contentListeners) {
        listener(content);
      }
    });

    conn.on('tool_call', (info: ToolCallInfo) => {
      const idx = this.toolCalls.findIndex((t) => t.toolCallId === info.toolCallId);
      if (idx >= 0) {
        this.toolCalls[idx] = info;
      } else {
        this.toolCalls.push(info);
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

    conn.on('exit', (code: number) => {
      if (!this.killed) {
        this.status = code === 0 ? 'completed' : 'failed';
      }
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });

    // When a prompt finishes, mark delegated agents as idle (task done, awaiting next)
    conn.on('prompt_complete', (_stopReason: string) => {
      if (this.status === 'running' && !this.acpConnection?.isPrompting) {
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
      if (active && this.status !== 'running') {
        this.status = 'running';
        for (const listener of this.statusListeners) {
          listener(this.status);
        }
      }
    });
  }

  buildContextManifest(peers: AgentContextInfo[]): string {
    const shortId = this.id.slice(0, 8);
    const taskLine = this.taskId ? this.taskId : 'Awaiting assignment';

    // For leads: show "YOUR AGENTS" (children) separately from other peers
    const isLead = this.role.id === 'lead';
    const myChildren = isLead ? peers.filter((p) => p.parentId === this.id) : [];
    const otherPeers = isLead ? peers.filter((p) => p.parentId !== this.id && p.id !== this.id) : peers;

    const childLines = myChildren
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const modelStr = p.model ? ` [${p.model}]` : '';
        return `- ${pShort} — ${p.roleName}${modelStr} — ${p.status}${p.taskId ? `, task: ${p.taskId.slice(0, 80)}` : ''}`;
      })
      .join('\n');

    const peerLines = otherPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.taskId || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    const crewSection = isLead
      ? `== YOUR AGENTS ==
${childLines || '(no agents created yet — use CREATE_AGENT to create specialists)'}
Use agent IDs above with DELEGATE to assign tasks, or AGENT_MESSAGE to communicate.
${otherPeers.length > 0 ? `\n== OTHER CREW MEMBERS ==\n${peerLines}` : ''}`
      : `== ACTIVE CREW MEMBERS ==
${peerLines || '(no other agents)'}`;

    return `[CREW CONTEXT]
You are agent ${shortId} with role "${this.role.name}".

== YOUR ASSIGNMENT ==
- Task: ${taskLine}
- You are responsible for: ${this.role.description}

${crewSection}

== COORDINATION RULES ==
1. DO NOT modify files that another agent has locked (listed above).
2. If you need to modify a shared file, request a lock first by outputting:
\`<!-- LOCK_REQUEST {"filePath": "path/to/file", "reason": "why"} -->\`
3. When you finish editing a file, release the lock:
\`<!-- LOCK_RELEASE {"filePath": "path/to/file"} -->\`
4. To communicate with another agent, use:
\`<!-- AGENT_MESSAGE {"to": "agent-id", "content": "message"} -->\`
5. To broadcast a message to ALL team members, use:
\`<!-- BROADCAST {"content": "message"} -->\`
6. To get an updated roster of all agents and their IDs, use:
\`<!-- QUERY_CREW -->\`
7. Stay within your role's scope. Defer to the appropriate specialist for work outside your expertise.
8. Log important decisions by outputting:
\`<!-- ACTIVITY {"action": "decision_made", "summary": "what you decided"} -->\`

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
        return `- ${pShort} — ${p.roleName}${modelStr} — ${p.status}${p.taskId ? `, task: ${p.taskId.slice(0, 80)}` : ''}`;
      })
      .join('\n');

    const peerLines = otherPeers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.taskId || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    const crewStatus = isLead
      ? `== YOUR AGENTS ==\n${childLines || '(no agents — use CREATE_AGENT)'}${otherPeers.length > 0 ? `\n== OTHER CREW ==\n${peerLines}` : ''}`
      : `== CURRENT CREW STATUS ==\n${peerLines || '(no other agents)'}`;

    const activityLines = recentActivity.length > 0
      ? recentActivity.join('\n')
      : '(no recent activity)';

    const update = `<!-- CREW_UPDATE
${crewStatus}
== RECENT ACTIVITY ==
${activityLines}
CREW_UPDATE -->`;

    if (this.mode === 'acp') {
      if (this.acpConnection?.isConnected) {
        this.acpConnection.prompt(update).catch(() => {});
      }
    } else {
      if (this.pty.isRunning) {
        this.pty.write(update + '\n');
      }
    }
  }

  write(data: string): void {
    if (this.mode === 'acp') {
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
    } else {
      if (this.pty.isRunning) {
        this.pty.write(data);
      }
    }
  }

  /** Send a message to this agent (used for inter-agent communication and completion callbacks) */
  sendMessage(message: string): void {
    this.write(message);
  }

  /** Cancel the agent's current work (ACP cancel signal) */
  async interrupt(): Promise<void> {
    if (this.mode === 'acp' && this.acpConnection) {
      await this.acpConnection.cancel();
    }
  }

  resolvePermission(approved: boolean): void {
    if (this.acpConnection) {
      this.acpConnection.resolvePermission(approved);
    }
  }

  kill(): void {
    this.killed = true;
    this.status = 'completed';
    if (this.mode === 'acp' && this.acpConnection) {
      this.acpConnection.kill();
      this.acpConnection = null;
    } else {
      this.pty.kill();
    }
  }

  dispose(): void {
    this.dataListeners.length = 0;
    this.contentListeners.length = 0;
    this.exitListeners.length = 0;
    this.hungListeners.length = 0;
    this.toolCallListeners.length = 0;
    this.planListeners.length = 0;
    this.permissionRequestListeners.length = 0;
  }

  resize(cols: number, rows: number): void {
    if (this.mode === 'pty') {
      this.pty.resize(cols, rows);
    }
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

  getBufferedOutput(): string {
    if (this.mode === 'acp') {
      return this.messages.join('');
    }
    return this.pty.getBufferedOutput();
  }

  toJSON(): AgentJSON {
    const output = this.mode === 'pty' ? this.pty.getBufferedOutput() : this.messages.join('');
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      mode: this.mode,
      autopilot: this.autopilot,
      taskId: this.taskId,
      parentId: this.parentId,
      childIds: this.childIds,
      createdAt: this.createdAt.toISOString(),
      outputPreview: output.slice(-500),
      plan: this.plan,
      toolCalls: this.toolCalls,
      sessionId: this.sessionId,
      projectName: this.projectName,
      model: this.model || this.role.model,
      cwd: this.cwd,
    };
  }
}
