import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_TIMEOUT_MS = 30_000;

/**
 * Manages a local Flightdeck server process.
 *
 * Handles spawning, health monitoring, log streaming, and cleanup
 * of the Flightdeck server from within the VS Code extension.
 */
export class ServerManager {
  private _process: ChildProcess | null = null;
  private _outputChannel: vscode.OutputChannel;
  private _running = false;

  private readonly _onDidChangeState = new vscode.EventEmitter<boolean>();
  readonly onDidChangeState = this._onDidChangeState.event;

  get running(): boolean {
    return this._running;
  }

  constructor() {
    this._outputChannel = vscode.window.createOutputChannel('Flightdeck Server');
  }

  /**
   * Start the Flightdeck server if not already running.
   * Returns the server URL once healthy.
   */
  async start(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('flightdeck');
    const serverUrl = config.get<string>('serverUrl', 'http://localhost:3001');

    // Check if a server is already running
    if (await this._isHealthy(serverUrl)) {
      vscode.window.showInformationMessage(`Flightdeck: Server already running at ${serverUrl}`);
      return serverUrl;
    }

    if (this._process) {
      vscode.window.showWarningMessage('Flightdeck: Server process exists but is not healthy — stopping and restarting');
      this.stop();
    }

    // Resolve the command and working directory
    const { cmd, args, cwd } = this._resolveServerCommand();

    this._outputChannel.show(true);
    this._outputChannel.appendLine(`Starting Flightdeck server: ${cmd} ${args.join(' ')}`);
    this._outputChannel.appendLine(`Working directory: ${cwd}`);

    try {
      this._process = spawn(cmd, args, {
        cwd,
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        detached: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._outputChannel.appendLine(`Failed to start: ${msg}`);
      vscode.window.showErrorMessage(`Flightdeck: Failed to start server — ${msg}`);
      return null;
    }

    // Pipe output to the channel
    this._process.stdout?.on('data', (data: Buffer) => {
      this._outputChannel.append(data.toString());
    });
    this._process.stderr?.on('data', (data: Buffer) => {
      this._outputChannel.append(data.toString());
    });

    this._process.on('exit', (code, signal) => {
      this._outputChannel.appendLine(
        `Server exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`,
      );
      this._process = null;
      this._setRunning(false);
    });

    this._process.on('error', (err) => {
      this._outputChannel.appendLine(`Server error: ${err.message}`);
      this._process = null;
      this._setRunning(false);
    });

    // Wait for health check
    const healthy = await this._waitForHealthy(serverUrl);
    if (healthy) {
      this._outputChannel.appendLine('Server is healthy');
      this._setRunning(true);
      vscode.window.showInformationMessage(`Flightdeck: Server started at ${serverUrl}`);
      return serverUrl;
    } else {
      this._outputChannel.appendLine('Server did not become healthy within timeout');
      vscode.window.showWarningMessage(
        'Flightdeck: Server started but health check timed out — check the Flightdeck Server output',
      );
      this._setRunning(true); // Process is running even if health check failed
      return serverUrl;
    }
  }

  /** Stop the running server process. */
  stop(): void {
    if (!this._process) {
      vscode.window.showInformationMessage('Flightdeck: No server process running');
      return;
    }

    this._outputChannel.appendLine('Stopping server...');

    try {
      // Send SIGTERM for graceful shutdown
      this._process.kill('SIGTERM');
    } catch {
      // Process may already be dead
    }

    // Force kill after 5 seconds
    const pid = this._process.pid;
    if (pid) {
      setTimeout(() => {
        try {
          process.kill(pid, 0); // check if alive
          process.kill(pid, 'SIGKILL');
          this._outputChannel.appendLine('Server force-killed after timeout');
        } catch {
          // Already dead — good
        }
      }, 5000);
    }

    this._process = null;
    this._setRunning(false);
    vscode.window.showInformationMessage('Flightdeck: Server stopped');
  }

  // ── Private ───────────────────────────────────────────────────

  private _resolveServerCommand(): { cmd: string; args: string[]; cwd: string } {
    const config = vscode.workspace.getConfiguration('flightdeck');
    const configuredPath = config.get<string>('serverPath', '');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // 1. User-configured server path
    if (configuredPath) {
      return { cmd: configuredPath, args: [], cwd: workspaceFolder };
    }

    // 2. Check if we're in the Flightdeck monorepo
    const serverPkgPath = path.join(workspaceFolder, 'packages', 'server', 'package.json');
    if (fs.existsSync(serverPkgPath)) {
      return { cmd: 'npm', args: ['start'], cwd: workspaceFolder };
    }

    // 3. Fall back to globally installed flightdeck
    return { cmd: 'npx', args: ['flightdeck'], cwd: workspaceFolder };
  }

  private async _isHealthy(serverUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${serverUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _waitForHealthy(serverUrl: string): Promise<boolean> {
    const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this._isHealthy(serverUrl)) return true;
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
    }
    return false;
  }

  private _setRunning(running: boolean): void {
    this._running = running;
    this._onDidChangeState.fire(running);
    vscode.commands.executeCommand('setContext', 'flightdeck.serverRunning', running);
  }

  dispose(): void {
    this.stop();
    this._onDidChangeState.dispose();
    this._outputChannel.dispose();
  }
}
