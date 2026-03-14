import * as vscode from 'vscode';
import type { FlightdeckConnection } from './connection';
import type { AgentsTreeProvider } from './providers/AgentsTreeProvider';
import type { TasksTreeProvider } from './providers/TasksTreeProvider';
import { DashboardPanel } from './webview/DashboardPanel';

interface CommandDeps {
  connection: FlightdeckConnection;
  agentsProvider: AgentsTreeProvider;
  tasksProvider: TasksTreeProvider;
  extensionUri: vscode.Uri;
  outputChannel: vscode.OutputChannel;
}

/**
 * Register all Flightdeck commands.
 * Returns disposables that should be added to context.subscriptions.
 */
export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { connection, agentsProvider, tasksProvider, extensionUri, outputChannel } = deps;

  return [
    // ── Connection ────────────────────────────────────────────
    vscode.commands.registerCommand('flightdeck.connect', async () => {
      const config = vscode.workspace.getConfiguration('flightdeck');
      let serverUrl = config.get<string>('serverUrl', 'http://localhost:3001');

      // Prompt for URL if not default or if connection fails
      if (!connection.connected) {
        const input = await vscode.window.showInputBox({
          prompt: 'Flightdeck server URL',
          value: serverUrl,
          placeHolder: 'http://localhost:3001',
        });
        if (input === undefined) return; // cancelled
        if (input !== serverUrl) {
          await config.update('serverUrl', input, vscode.ConfigurationTarget.Workspace);
        }
      }

      outputChannel.appendLine(`Connecting to ${connection.serverUrl}...`);
      await connection.connect();

      if (connection.connected) {
        vscode.window.showInformationMessage('Flightdeck: Connected');
      } else {
        vscode.window.showWarningMessage('Flightdeck: Failed to connect');
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
      DashboardPanel.createOrShow(
        extensionUri,
        connection.connected ? connection.serverUrl : undefined,
      );
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

      try {
        const res = await fetch(`${connection.serverUrl}/api/agents/${agentId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });
        if (res.ok) {
          outputChannel.appendLine(`Message sent to ${agentId.slice(0, 8)}`);
          vscode.window.showInformationMessage('Flightdeck: Message sent');
        } else {
          vscode.window.showWarningMessage(`Flightdeck: Failed to send (${res.status})`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Flightdeck: ${err instanceof Error ? err.message : 'Send failed'}`);
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

      try {
        const res = await fetch(`${connection.serverUrl}/api/agents/${item.agentId}/terminate`, {
          method: 'POST',
        });
        if (res.ok) {
          outputChannel.appendLine(`Agent ${shortId} terminated`);
          agentsProvider.refresh();
        } else {
          vscode.window.showWarningMessage(`Flightdeck: Failed to terminate (${res.status})`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Flightdeck: ${err instanceof Error ? err.message : 'Terminate failed'}`);
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

      try {
        const res = await fetch(`${connection.serverUrl}/api/decisions/${decisionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'accepted' }),
        });
        if (res.ok) {
          outputChannel.appendLine(`Decision ${decisionId} approved`);
          vscode.window.showInformationMessage('Flightdeck: Decision approved');
        } else {
          vscode.window.showWarningMessage(`Flightdeck: Failed to approve (${res.status})`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Flightdeck: ${err instanceof Error ? err.message : 'Approve failed'}`);
      }
    }),
  ];
}
