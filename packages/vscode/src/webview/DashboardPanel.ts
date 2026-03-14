import * as vscode from 'vscode';
import { WebSocket } from 'ws';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Manages the Flightdeck Dashboard webview panel.
 *
 * Creates a single webview panel that loads the React app from dist/webview/,
 * and bridges postMessage between the webview and the Flightdeck server's
 * WebSocket connection.
 */
export class DashboardPanel {
  public static readonly viewType = 'flightdeck.dashboard';
  private static _instance: DashboardPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _ws: WebSocket | null = null;
  private _disposables: vscode.Disposable[] = [];

  /** Show the dashboard panel, creating it if it doesn't exist. */
  static createOrShow(extensionUri: vscode.Uri, serverUrl?: string): DashboardPanel {
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

    DashboardPanel._instance = new DashboardPanel(panel, extensionUri, serverUrl);
    return DashboardPanel._instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    serverUrl?: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set initial HTML content
    this._panel.webview.html = this._getWebviewContent(this._panel.webview);

    // Connect to Flightdeck server WebSocket
    if (serverUrl) {
      this._connectWebSocket(serverUrl);
    }

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );

    // Clean up on dispose
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  // ── WebSocket bridge ──────────────────────────────────────────

  private _connectWebSocket(serverUrl: string): void {
    const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws';
    this._ws = new WebSocket(wsUrl);

    this._ws.on('open', () => {
      this._panel.webview.postMessage({ type: 'ws:open' });
    });

    this._ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString());
        this._panel.webview.postMessage({ type: 'ws:message', payload });
      } catch {
        // Non-JSON message, forward as-is
        this._panel.webview.postMessage({ type: 'ws:message', payload: data.toString() });
      }
    });

    this._ws.on('close', () => {
      this._panel.webview.postMessage({ type: 'ws:close' });
    });

    this._ws.on('error', (err) => {
      console.error('[DashboardPanel] WebSocket error:', err.message);
    });
  }

  private _handleWebviewMessage(msg: { type: string; payload?: unknown }): void {
    switch (msg.type) {
      case 'ws:send':
        if (this._ws?.readyState === WebSocket.OPEN) {
          this._ws.send(JSON.stringify(msg.payload));
        }
        break;
      case 'ws:close':
        this._ws?.close();
        break;
      case 'ready':
        // Webview loaded and ready — could send initial state here
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

    this._ws?.close();
    this._ws = null;

    this._panel.dispose();

    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
