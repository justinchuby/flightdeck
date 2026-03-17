import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { FlightdeckConnection, ServerMessage } from '../connection';

/**
 * Manages the Flightdeck Dashboard webview panel.
 *
 * Creates a single webview panel that loads the React app from dist/webview/,
 * and bridges postMessage between the webview and the extension host's
 * FlightdeckConnection (no duplicate WebSocket).
 */
export class DashboardPanel {
  public static readonly viewType = 'flightdeck.dashboard';
  private static _instance: DashboardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  /** Show the dashboard panel, creating it if it doesn't exist. */
  static createOrShow(extensionUri: vscode.Uri, connection: FlightdeckConnection): DashboardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel._instance) {
      DashboardPanel._instance._panel.reveal(column);
      return DashboardPanel._instance;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'Flightdeck',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    DashboardPanel._instance = new DashboardPanel(panel, extensionUri, connection);
    return DashboardPanel._instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    connection: FlightdeckConnection,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set initial HTML content
    this._panel.webview.html = this._getWebviewContent(this._panel.webview);

    // Forward server messages to the webview
    const msgSubscription = connection.onMessage((msg: ServerMessage) => {
      this._panel.webview.postMessage({ type: 'ws:message', payload: msg });
    });
    this._disposables.push(msgSubscription);

    // Notify webview of connection state
    const connSubscription = connection.onDidChangeConnection((connected: boolean) => {
      this._panel.webview.postMessage({ type: connected ? 'ws:open' : 'ws:close' });
    });
    this._disposables.push(connSubscription);

    // Send initial open signal if already connected
    if (connection.connected) {
      this._panel.webview.postMessage({ type: 'ws:open' });
    }

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleWebviewMessage(msg, connection),
      null,
      this._disposables,
    );

    // Clean up on dispose
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private _handleWebviewMessage(msg: { type: string; payload?: unknown }, connection: FlightdeckConnection): void {
    switch (msg.type) {
      case 'ws:send':
        connection.send(msg.payload as Record<string, unknown>);
        break;
      case 'ready':
        // Webview loaded and ready
        if (connection.connected) {
          this._panel.webview.postMessage({ type: 'ws:open' });
        }
        break;
    }
  }

  // ── HTML generation ───────────────────────────────────────────

  private _getWebviewContent(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const distUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, 'assets', 'index.css'),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} data:;
    font-src ${webview.cspSource};
    connect-src ${webview.cspSource};
  " />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Flightdeck</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  // ── Cleanup ───────────────────────────────────────────────────

  dispose(): void {
    DashboardPanel._instance = undefined;

    this._panel.dispose();

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
