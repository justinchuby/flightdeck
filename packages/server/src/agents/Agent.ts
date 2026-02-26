import { v4 as uuid } from 'uuid';
import { PtyManager } from '../pty/PtyManager.js';
import { AcpConnection } from '../acp/AcpConnection.js';
import type { ToolCallInfo, PlanEntry } from '../acp/AcpConnection.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';

export type AgentMode = 'pty' | 'acp';
export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed';

export interface AgentContextInfo {
  id: string;
  role: string;
  roleName: string;
  status: AgentStatus;
  taskId?: string;
  lockedFiles: string[];
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
  private killed = false;

  private pty: PtyManager;
  private acpConnection: AcpConnection | null = null;
  private config: ServerConfig;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private hungListeners: Array<(elapsedMs: number) => void> = [];
  private toolCallListeners: Array<(info: ToolCallInfo) => void> = [];
  private planListeners: Array<(entries: PlanEntry[]) => void> = [];
  private permissionRequestListeners: Array<(request: any) => void> = [];
  private peers: AgentContextInfo[];

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
    const rolePrompt = `${this.role.systemPrompt}\n\nYou are acting as the "${this.role.name}" role. ${this.taskId ? `Your assigned task ID is: ${this.taskId}` : 'Awaiting task assignment.'}`;
    const initialPrompt = `${contextManifest}\n\n${rolePrompt}`;

    if (this.mode === 'acp') {
      this.startAcp(initialPrompt);
    } else {
      this.startPty(initialPrompt);
    }
  }

  private startPty(initialPrompt: string): void {
    this.pty.spawn({
      command: this.config.cliCommand,
      args: [...this.config.cliArgs],
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

    this.acpConnection.on('text', (text: string) => {
      this.messages.push(text);
      for (const listener of this.dataListeners) {
        listener(text);
      }
    });

    this.acpConnection.on('tool_call', (info: ToolCallInfo) => {
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

    this.acpConnection.on('tool_call_update', (update: Partial<ToolCallInfo> & { toolCallId: string }) => {
      const idx = this.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId);
      if (idx >= 0) {
        this.toolCalls[idx] = { ...this.toolCalls[idx], ...update };
      }
      for (const listener of this.toolCallListeners) {
        listener(this.toolCalls[idx] ?? update as ToolCallInfo);
      }
    });

    this.acpConnection.on('plan', (entries: PlanEntry[]) => {
      this.plan = entries;
      for (const listener of this.planListeners) {
        listener(entries);
      }
    });

    this.acpConnection.on('permission_request', (request: any) => {
      for (const listener of this.permissionRequestListeners) {
        listener(request);
      }
    });

    this.acpConnection.on('exit', (code: number) => {
      if (!this.killed) {
        this.status = code === 0 ? 'completed' : 'failed';
      }
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });

    this.acpConnection.start({
      cliCommand: this.config.cliCommand,
      cliArgs: this.config.cliArgs,
      cwd: process.cwd(),
    }).then((sessionId) => {
      this.sessionId = sessionId;
      return this.acpConnection!.prompt(initialPrompt);
    }).catch((err) => {
      this.status = 'failed';
      for (const listener of this.exitListeners) {
        listener(1);
      }
    });
  }

  buildContextManifest(peers: AgentContextInfo[]): string {
    const shortId = this.id.slice(0, 8);
    const taskLine = this.taskId ? this.taskId : 'Awaiting assignment';

    const peerLines = peers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.taskId || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    return `<!-- CREW_CONTEXT
You are agent ${shortId} with role "${this.role.name}".

== YOUR ASSIGNMENT ==
- Task: ${taskLine}
- You are responsible for: ${this.role.description}

== ACTIVE CREW MEMBERS ==
${peerLines || '(no other agents)'}

== COORDINATION RULES ==
1. DO NOT modify files that another agent has locked (listed above).
2. If you need to modify a shared file, request a lock first by outputting: <!-- LOCK_REQUEST {"filePath": "path/to/file", "reason": "why"} -->
3. When you finish editing a file, release the lock: <!-- LOCK_RELEASE {"filePath": "path/to/file"} -->
4. To communicate with another agent, use: <!-- AGENT_MESSAGE {"to": "agent-id", "content": "message"} -->
5. Stay within your role's scope. Defer to the appropriate specialist for work outside your expertise.
6. Log important decisions by outputting: <!-- ACTIVITY {"action": "decision_made", "summary": "what you decided"} -->

CREW_CONTEXT -->`;
  }

  injectContextUpdate(peers: AgentContextInfo[], recentActivity: string[]): void {
    const peerLines = peers
      .map((p) => {
        const pShort = p.id.slice(0, 8);
        const files = p.lockedFiles.length > 0 ? p.lockedFiles.join(', ') : 'none';
        return `- Agent ${pShort} (${p.roleName}) — Status: ${p.status}, Working on: ${p.taskId || 'idle'}, Files locked: ${files}`;
      })
      .join('\n');

    const activityLines = recentActivity.length > 0
      ? recentActivity.join('\n')
      : '(no recent activity)';

    const update = `<!-- CREW_UPDATE
== CURRENT CREW STATUS ==
${peerLines || '(no other agents)'}
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
        this.acpConnection.prompt(data).catch(() => {});
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

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  onHung(listener: (elapsedMs: number) => void): void {
    this.hungListeners.push(listener);
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
    };
  }
}
