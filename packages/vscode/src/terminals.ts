import * as vscode from 'vscode';
import type { FlightdeckConnection } from './connection';

/**
 * Pseudo-terminal that displays agent output and accepts user input.
 */
class AgentPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  private inputBuffer = '';

  constructor(
    private readonly agentId: string,
    private readonly agentName: string,
    private readonly connection: FlightdeckConnection,
  ) {}

  open(): void {
    this.writeEmitter.fire(`\x1b[1;36m── Flightdeck: ${this.agentName} (${this.agentId.slice(0, 8)}) ──\x1b[0m\r\n`);
    this.writeEmitter.fire(`\x1b[90mType a message and press Enter to send to this agent.\x1b[0m\r\n\r\n`);
  }

  close(): void {
    // Terminal was closed by the user
  }

  /** Write agent output to the terminal. */
  appendOutput(text: string): void {
    // Replace newlines with \r\n for terminal rendering
    const formatted = text.replace(/\n/g, '\r\n');
    this.writeEmitter.fire(`${formatted}\r\n`);
  }

  /** Handle keyboard input from the user. */
  handleInput(data: string): void {
    // Enter key
    if (data === '\r' || data === '\n') {
      this.writeEmitter.fire('\r\n');
      if (this.inputBuffer.trim()) {
        this.sendMessage(this.inputBuffer.trim());
      }
      this.inputBuffer = '';
      return;
    }

    // Backspace
    if (data === '\x7f') {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.writeEmitter.fire('\b \b');
      }
      return;
    }

    // Ctrl+C
    if (data === '\x03') {
      this.closeEmitter.fire();
      return;
    }

    // Regular character
    this.inputBuffer += data;
    this.writeEmitter.fire(data);
  }

  private async sendMessage(message: string): Promise<void> {
    this.writeEmitter.fire(`\x1b[90m→ Sending message...\x1b[0m\r\n`);
    try {
      const res = await fetch(
        `${this.connection.serverUrl}/api/agents/${this.agentId}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        },
      );
      if (!res.ok) {
        this.writeEmitter.fire(`\x1b[31m✗ Failed to send (${res.status})\x1b[0m\r\n`);
      }
    } catch (err) {
      this.writeEmitter.fire(`\x1b[31m✗ Error: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`);
    }
  }

  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

/**
 * Manages VS Code pseudo-terminals for agent output streams.
 */
export class AgentTerminalManager {
  private terminals = new Map<string, { terminal: vscode.Terminal; pty: AgentPseudoterminal }>();

  constructor(private readonly connection: FlightdeckConnection) {}

  /** Open or focus an agent's terminal. */
  openAgentTerminal(agentId: string, agentRole: string): vscode.Terminal {
    const existing = this.terminals.get(agentId);
    if (existing) {
      existing.terminal.show();
      return existing.terminal;
    }

    const name = `Flightdeck: ${agentRole} (${agentId.slice(0, 8)})`;
    const pty = new AgentPseudoterminal(agentId, agentRole, this.connection);
    const terminal = vscode.window.createTerminal({ name, pty });
    terminal.show();

    this.terminals.set(agentId, { terminal, pty });

    // Clean up when terminal is closed
    const disposable = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        this.terminals.delete(agentId);
        pty.dispose();
        disposable.dispose();
      }
    });

    return terminal;
  }

  /** Forward a message from the WebSocket to an agent's terminal. */
  onAgentMessage(agentId: string, text: string): void {
    const entry = this.terminals.get(agentId);
    if (entry) {
      entry.pty.appendOutput(text);
    }
  }

  dispose(): void {
    for (const [, entry] of this.terminals) {
      entry.pty.dispose();
      entry.terminal.dispose();
    }
    this.terminals.clear();
  }
}
