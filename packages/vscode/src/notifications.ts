import * as vscode from 'vscode';
import type { ServerMessage } from './types';

/**
 * Manages VS Code notifications for Flightdeck events.
 *
 * Shows native VS Code notifications for:
 * - Decisions needing confirmation (with Approve/View action buttons)
 * - Agent crashes
 * - Session completion
 *
 * Respects the `flightdeck.showNotifications` setting.
 */
export class NotificationManager {
  private readonly _outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this._outputChannel = outputChannel;
  }

  /** Process a server message and show a notification if appropriate. */
  handleMessage(msg: ServerMessage): void {
    if (!this._notificationsEnabled()) return;

    switch (msg.type) {
      case 'decision:pending':
        this._showDecisionNotification(msg.id, msg.title, msg.agentId);
        break;
      case 'agent:status':
        if (msg.status === 'failed') {
          this._showAgentCrashed(msg.agentId);
        }
        break;
      case 'agent:terminated':
        // Only log — termination is often intentional
        this._outputChannel.appendLine(`Agent ${msg.agentId.slice(0, 8)} terminated`);
        break;
    }
  }

  /** Show a notification that a session has completed. */
  showSessionCompleted(projectName?: string): void {
    if (!this._notificationsEnabled()) return;
    const label = projectName ? `Project "${projectName}"` : 'Session';
    vscode.window.showInformationMessage(
      `Flightdeck: ${label} completed`,
      'Open Dashboard',
    ).then((action) => {
      if (action === 'Open Dashboard') {
        vscode.commands.executeCommand('flightdeck.openDashboard');
      }
    });
  }

  // ── Private ───────────────────────────────────────────────────

  private async _showDecisionNotification(
    decisionId: string, title: string, agentId: string,
  ): Promise<void> {
    const shortAgent = agentId.slice(0, 8);
    const action = await vscode.window.showInformationMessage(
      `Flightdeck Decision: ${title} (from ${shortAgent})`,
      'Approve',
      'View',
    );

    if (action === 'Approve') {
      vscode.commands.executeCommand('flightdeck.approveDecision', { decisionId });
    } else if (action === 'View') {
      vscode.commands.executeCommand('flightdeck.openDashboard');
    }
  }

  private _showAgentCrashed(agentId: string): void {
    const shortId = agentId.slice(0, 8);
    vscode.window.showWarningMessage(
      `Flightdeck: Agent ${shortId} crashed`,
      'View Details',
    ).then((action) => {
      if (action === 'View Details') {
        vscode.commands.executeCommand('flightdeck.openDashboard');
      }
    });
  }

  private _notificationsEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('flightdeck')
      .get<boolean>('showNotifications', true);
  }
}
