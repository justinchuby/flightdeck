import { v4 as uuid } from 'uuid';
import { PtyManager } from '../pty/PtyManager.js';
import type { Role } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';

export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed';

export interface AgentJSON {
  id: string;
  role: Role;
  status: AgentStatus;
  taskId?: string;
  parentId?: string;
  childIds: string[];
  createdAt: string;
  outputPreview: string;
}

export class Agent {
  public readonly id: string;
  public readonly role: Role;
  public readonly createdAt: Date;
  public status: AgentStatus = 'creating';
  public taskId?: string;
  public parentId?: string;
  public childIds: string[] = [];

  private pty: PtyManager;
  private config: ServerConfig;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  constructor(role: Role, config: ServerConfig, taskId?: string, parentId?: string) {
    this.id = uuid();
    this.role = role;
    this.config = config;
    this.taskId = taskId;
    this.parentId = parentId;
    this.createdAt = new Date();
    this.pty = new PtyManager();
  }

  start(): void {
    const initialPrompt = `${this.role.systemPrompt}\n\nYou are acting as the "${this.role.name}" role. ${this.taskId ? `Your assigned task ID is: ${this.taskId}` : 'Awaiting task assignment.'}`;

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
      this.status = code === 0 ? 'completed' : 'failed';
      for (const listener of this.exitListeners) {
        listener(code);
      }
    });
  }

  write(data: string): void {
    if (this.pty.isRunning) {
      this.pty.write(data);
    }
  }

  kill(): void {
    this.pty.kill();
    this.status = 'completed';
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  getBufferedOutput(): string {
    return this.pty.getBufferedOutput();
  }

  toJSON(): AgentJSON {
    const output = this.pty.getBufferedOutput();
    return {
      id: this.id,
      role: this.role,
      status: this.status,
      taskId: this.taskId,
      parentId: this.parentId,
      childIds: this.childIds,
      createdAt: this.createdAt.toISOString(),
      outputPreview: output.slice(-500),
    };
  }
}
