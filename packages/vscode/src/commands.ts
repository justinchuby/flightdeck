import * as vscode from 'vscode';
import type { FlightdeckConnection } from './connection';
import type { AgentsTreeProvider } from './providers/AgentsTreeProvider';
import type { TasksTreeProvider } from './providers/TasksTreeProvider';
import type { ServerManager } from './serverManager';
import { DashboardPanel } from './webview/DashboardPanel';

interface CommandDeps {
  connection: FlightdeckConnection;
  agentsProvider: AgentsTreeProvider;
  tasksProvider: TasksTreeProvider;
  serverManager: ServerManager;
  extensionUri: vscode.Uri;
  outputChannel: vscode.OutputChannel;
}

/**
 * Register all Flightdeck commands.
 * Returns disposables that should be added to context.subscriptions.
 */
export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { connection, agentsProvider, tasksProvider, serverManager, extensionUri, outputChannel } = deps;

  return [
    // ── Connection ────────────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.connect', async () => {
      if (connection.connected) {
        vscode.window.showInformationMessage('Flightdeck: Already connected');
        return;
      }

      // Run discovery with progress indicator
      const serverUrl = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering Flightdeck server...',
          cancellable: true,
        },
        async (_progress, token) => {
          const discovered = await connection.discoverServer();
          if (token.isCancellationRequested) return undefined;
          return discovered;
        },
      );

      if (serverUrl === undefined) return; // cancelled

      if (serverUrl) {
        outputChannel.appendLine(`Connecting to discovered server at ${serverUrl}...`);
        await connection.connect(serverUrl);
        if (connection.connected) {
          vscode.window.showInformationMessage(`Flightdeck: Connected to ${serverUrl}`);
        } else {
          vscode.window.showWarningMessage('Flightdeck: Failed to connect');
        }
      } else {
        // No server found — prompt for URL
        const input = await vscode.window.showInputBox({
          prompt: 'No Flightdeck server found. Enter server URL:',
          value: 'http://localhost:3001',
          placeHolder: 'http://localhost:3001',
        });
        if (!input) return;

        await connection.connect(input);
        if (connection.connected) {
          vscode.window.showInformationMessage(`Flightdeck: Connected to ${input}`);
        } else {
          vscode.window.showWarningMessage('Flightdeck: Failed to connect');
        }
      }
    }),

    // ── Disconnect ────────────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.disconnect', () => {
      connection.disconnect();
      outputChannel.appendLine('Disconnected');
      vscode.window.showInformationMessage('Flightdeck: Disconnected');
    }),

    // ── Dashboard ─────────────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.openDashboard', () => {
      outputChannel.appendLine('Opening dashboard...');
      DashboardPanel.createOrShow(extensionUri, connection);
    }),

    // ── Refresh ───────────────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.refreshAgents', () => {
      agentsProvider.refresh();
    }),

    vscode.commands.registerCommand('flightdeck.refreshTasks', () => {
      tasksProvider.refresh();
    }),

    // ── Agent messaging ───────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.sendMessage', async (item?: { agentId?: string }) => {
      if (!connection.connected) {
        vscode.window.showWarningMessage('Flightdeck: Not connected');
        return;
      }

      const agentId = item?.agentId;
      if (!agentId) {
        vscode.window.showWarningMessage('Flightdeck: No agent selected');
        return;
      }

      const message = await vscode.window.showInputBox({
        prompt: `Send message to agent ${agentId.slice(0, 8)}`,
        placeHolder: 'Type your message...',
      });
      if (!message) return;

      const res = await connection.postJson(`/agents/${agentId}/message`, {
        body: { text: message },
      });
      if (res.ok) {
        outputChannel.appendLine(`Message sent to ${agentId.slice(0, 8)}`);
        vscode.window.showInformationMessage('Flightdeck: Message sent');
      } else {
        vscode.window.showWarningMessage(`Flightdeck: Failed to send (${res.status})`);
      }
    }),

    // ── Agent termination ─────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.terminateAgent', async (item?: { agentId?: string }) => {
      if (!connection.connected || !item?.agentId) return;

      const shortId = item.agentId.slice(0, 8);
      const confirm = await vscode.window.showWarningMessage(
        `Terminate agent ${shortId}?`,
        { modal: true },
        'Terminate',
      );
      if (confirm !== 'Terminate') return;

      const res = await connection.postJson(`/agents/${item.agentId}/terminate`);
      if (res.ok) {
        outputChannel.appendLine(`Agent ${shortId} terminated`);
        agentsProvider.refresh();
      } else {
        vscode.window.showWarningMessage(`Flightdeck: Failed to terminate (${res.status})`);
      }
    }),

    // ── Decision approval ─────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.approveDecision', async (item?: { decisionId?: string }) => {
      if (!connection.connected) {
        vscode.window.showWarningMessage('Flightdeck: Not connected');
        return;
      }

      const decisionId = item?.decisionId;
      if (!decisionId) {
        vscode.window.showWarningMessage('Flightdeck: No decision selected');
        return;
      }

      const res = await connection.postJson(`/decisions/${decisionId}`, {
        method: 'PATCH',
        body: { status: 'accepted' },
      });
      if (res.ok) {
        outputChannel.appendLine(`Decision ${decisionId} approved`);
        vscode.window.showInformationMessage('Flightdeck: Decision approved');
      } else {
        vscode.window.showWarningMessage(`Flightdeck: Failed to approve (${res.status})`);
      }
    }),

    // ── Server management ─────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.startServer', async () => {
      outputChannel.appendLine('Starting server...');
      const serverUrl = await serverManager.start();
      if (serverUrl && !connection.connected) {
        outputChannel.appendLine('Auto-connecting to started server...');
        await connection.connect(serverUrl);
      }
    }),

    vscode.commands.registerCommand('flightdeck.stopServer', () => {
      serverManager.stop();
      connection.disconnect();
    }),
  ];
}
