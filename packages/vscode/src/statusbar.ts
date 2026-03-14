import * as vscode from 'vscode';
import type { AgentInfo } from './types';

/**
 * Manages Flightdeck status bar items.
 *
 * Three items:
 * 1. Connection status (left) — connected/disconnected indicator
 * 2. Agent count — number of active agents
 * 3. Pending decisions — shown only when decisions need attention
 */
export class StatusBarManager {
  private readonly _connectionItem: vscode.StatusBarItem;
  private readonly _agentItem: vscode.StatusBarItem;
  private readonly _decisionItem: vscode.StatusBarItem;

  constructor() {
    // Connection status — highest priority (leftmost)
    this._connectionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 52,
    );
    this._connectionItem.name = 'Flightdeck Connection';
    this.updateConnection(false);
    this._connectionItem.show();

    // Agent count
    this._agentItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 51,
    );
    this._agentItem.name = 'Flightdeck Agents';
    this._agentItem.command = 'flightdeck.openDashboard';
    this._agentItem.tooltip = 'Open Flightdeck Dashboard';
    this.updateAgents([]);

    // Pending decisions
    this._decisionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, 50,
    );
    this._decisionItem.name = 'Flightdeck Decisions';
    this._decisionItem.command = 'flightdeck.openDashboard';
    this.updateDecisions(0);
  }

  /** Update the connection status indicator. */
  updateConnection(connected: boolean): void {
    if (connected) {
      this._connectionItem.text = '$(plug) Flightdeck: Connected';
      this._connectionItem.tooltip = 'Connected to Flightdeck server — click to disconnect';
      this._connectionItem.command = 'flightdeck.disconnect';
      this._connectionItem.backgroundColor = undefined;
    } else {
      this._connectionItem.text = '$(debug-disconnect) Flightdeck: Disconnected';
      this._connectionItem.tooltip = 'Not connected — click to connect';
      this._connectionItem.command = 'flightdeck.connect';
      this._connectionItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    }
  }

  /** Update the agent count display. */
  updateAgents(agents: AgentInfo[]): void {
    const active = agents.filter(
      (a) => a.status !== 'terminated' && a.status !== 'completed' && a.status !== 'failed',
    );
    const count = active.length;

    if (count > 0) {
      this._agentItem.text = `$(person) ${count} agent${count !== 1 ? 's' : ''}`;
      this._agentItem.tooltip = `${count} active agent${count !== 1 ? 's' : ''} — click to open dashboard`;
      this._agentItem.show();
    } else {
      this._agentItem.hide();
    }
  }

  /** Update the pending decisions badge. Hidden when count is 0. */
  updateDecisions(count: number): void {
    if (count > 0) {
      this._decisionItem.text = `$(bell) ${count} pending`;
      this._decisionItem.tooltip = `${count} decision${count !== 1 ? 's' : ''} awaiting approval`;
      this._decisionItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
      this._decisionItem.show();
    } else {
      this._decisionItem.hide();
    }
  }

  dispose(): void {
    this._connectionItem.dispose();
    this._agentItem.dispose();
    this._decisionItem.dispose();
  }
}
