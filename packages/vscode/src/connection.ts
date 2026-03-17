import * as vscode from 'vscode';
import WebSocket from 'ws';
import * as http from 'http';
import * as https from 'https';
import type { ServerMessage } from './types';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export { ServerMessage };

/** Bump this when the extension requires a new server API version. */
export const EXPECTED_API_VERSION = 1;

export interface ServerVersionInfo {
  version: string;
  apiVersion: number;
}

/**
 * Manages the WebSocket + REST connection to the Flightdeck server.
 *
 * Features:
 * - Health check before WebSocket connect
 * - Auto-reconnect on disconnect (3s interval)
 * - Heartbeat monitoring via WebSocket pong (45s timeout)
 * - Subscribe to all channels on connect
 * - State change and message events for UI updates
 * - REST fetch helper for on-demand data loading
 */
export class FlightdeckConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: ConnectionState = 'disconnected';
  private _serverUrl = '';
  private _serverVersion: ServerVersionInfo | null = null;
  private shouldReconnect = false;

  private readonly _onStateChange = new vscode.EventEmitter<ConnectionState>();
  readonly onStateChange = this._onStateChange.event;

  private readonly _onMessage = new vscode.EventEmitter<ServerMessage>();
  readonly onMessage = this._onMessage.event;

  private readonly RECONNECT_INTERVAL = 3000;
  private readonly HEARTBEAT_TIMEOUT = 45000;

  /** Tracks the last emitted connected boolean to avoid duplicate fires. */
  private _lastConnectedValue = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {}

  get state(): ConnectionState {
    return this._state;
  }

  /** Whether the WebSocket is currently connected. */
  get connected(): boolean {
    return this._state === 'connected';
  }

  get serverUrl(): string {
    return this._serverUrl;
  }

  /** Server version info from the last successful connect, or null. */
  get serverVersion(): ServerVersionInfo | null {
    return this._serverVersion;
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this._onStateChange.fire(state);
  }

  /**
   * Convenience: subscribe to connected/disconnected transitions only.
   * Derived from onStateChange — fires true/false when the boolean changes.
   */
  onDidChangeConnection(listener: (connected: boolean) => void): vscode.Disposable {
    return this.onStateChange((state) => {
      const isConnected = state === 'connected';
      if (isConnected !== this._lastConnectedValue) {
        this._lastConnectedValue = isConnected;
        listener(isConnected);
      }
    });
  }

  private static readonly DISCOVERY_PORT_START = 3001;
  private static readonly DISCOVERY_PORT_END = 3010;
  private static readonly DISCOVERY_TIMEOUT_MS = 2000;
  private static readonly GLOBAL_STATE_LAST_URL = 'flightdeck.lastServerUrl';

  /**
   * Discover a running Flightdeck server.
   *
   * Priority:
   * 1. Explicit `serverUrl` parameter
   * 2. VS Code setting `flightdeck.serverUrl` (if user has changed it)
   * 3. Last successful URL from globalState (fast reconnect)
   * 4. `FLIGHTDECK_PORT` environment variable → `http://localhost:{port}`
   * 5. Parallel port scan of localhost:3001–3010
   * 6. null (not found — caller decides whether to prompt)
   */
  async discoverServer(serverUrl?: string): Promise<string | null> {
    // 1. Explicit URL
    if (serverUrl) {
      this.log.appendLine(`Discovery: using explicit URL ${serverUrl}`);
      return serverUrl;
    }

    // 2. VS Code setting (only if user has customized it)
    const configUrl = vscode.workspace
      .getConfiguration('flightdeck')
      .get<string>('serverUrl');
    if (configUrl) {
      if (await this.probeHealth(configUrl)) {
        this.log.appendLine(`Discovery: found server at configured URL ${configUrl}`);
        return configUrl;
      }
      this.log.appendLine(`Discovery: configured URL ${configUrl} not responding`);
    }

    // 3. Last successful URL (persisted in globalState)
    const lastUrl = this.context.globalState.get<string>(
      FlightdeckConnection.GLOBAL_STATE_LAST_URL,
    );
    if (lastUrl) {
      if (await this.probeHealth(lastUrl)) {
        this.log.appendLine(`Discovery: found server at last-known URL ${lastUrl}`);
        return lastUrl;
      }
      this.log.appendLine(`Discovery: last-known URL ${lastUrl} not responding`);
    }

    // 4. FLIGHTDECK_PORT env var
    const envPort = process.env.FLIGHTDECK_PORT;
    if (envPort) {
      const envUrl = `http://localhost:${envPort}`;
      if (await this.probeHealth(envUrl)) {
        this.log.appendLine(`Discovery: found server via FLIGHTDECK_PORT=${envPort}`);
        return envUrl;
      }
      this.log.appendLine(`Discovery: FLIGHTDECK_PORT=${envPort} not responding`);
    }

    // 5. Parallel port scan
    this.log.appendLine(
      `Discovery: scanning ports ${FlightdeckConnection.DISCOVERY_PORT_START}–${FlightdeckConnection.DISCOVERY_PORT_END}...`,
    );
    const found = await this.scanPorts();
    if (found) {
      this.log.appendLine(`Discovery: found server at ${found}`);
      return found;
    }

    this.log.appendLine('Discovery: no server found');
    return null;
  }

  /**
   * Probe a single URL's /health endpoint. Returns true if status is 'ok'.
   */
  private async probeHealth(url: string): Promise<boolean> {
    try {
      const urlObj = new URL('/health', url);
      const lib = urlObj.protocol === 'https:' ? https : http;
      return await new Promise<boolean>((resolve) => {
        const req = lib.get(urlObj, (res) => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            resolve(false);
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body).status === 'ok');
            } catch {
              resolve(false);
            }
          });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(FlightdeckConnection.DISCOVERY_TIMEOUT_MS, () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * Scan ports 3001–3010 in parallel.
   * Returns the URL of the first healthy server, or null.
   * Uses a race pattern to return as soon as any port responds healthy.
   */
  private async scanPorts(): Promise<string | null> {
    const ports: number[] = [];
    for (
      let p = FlightdeckConnection.DISCOVERY_PORT_START;
      p <= FlightdeckConnection.DISCOVERY_PORT_END;
      p++
    ) {
      ports.push(p);
    }

    // Race: resolve with the first healthy URL, or null if none respond
    return new Promise<string | null>((resolve) => {
      let resolved = false;
      let pending = ports.length;

      for (const port of ports) {
        const url = `http://localhost:${port}`;
        this.probeHealth(url).then((healthy) => {
          if (healthy && !resolved) {
            resolved = true;
            resolve(url);
          }
          if (--pending === 0 && !resolved) {
            resolve(null);
          }
        });
      }
    });
  }

  /**
   * Connect to the Flightdeck server.
   *
   * Runs discovery (port scan, env vars, settings, last-known URL) then
   * health-checks and establishes a WebSocket. Stores the successful URL
   * in globalState for faster reconnect next time.
   *
   * If `serverUrl` is provided it is used directly (skips discovery).
   */
  async connect(serverUrl?: string): Promise<void> {
    if (this._state === 'connecting' || this._state === 'connected') {
      return;
    }

    this.setState('connecting');

    const discovered = await this.discoverServer(serverUrl);

    // Guard: disconnect() may have been called during async discovery
    if (!this.shouldReconnect) {
      this.log.appendLine('Connect aborted — disconnected during discovery');
      return;
    }

    if (!discovered) {
      this.log.appendLine('No server found during connect');
      this.setState('disconnected');
      return;
    }

    this._serverUrl = discovered;
    this.shouldReconnect = true;
    this.log.appendLine(`Connecting to ${this._serverUrl}...`);

    // Note: discoverServer() already verified /health — no redundant probe needed.

    // Fetch server version and check API compatibility
    try {
      this._serverVersion = await this.fetchRaw<ServerVersionInfo>('/version');
      this.log.appendLine(`Server version: ${this._serverVersion.version}, API version: ${this._serverVersion.apiVersion}`);

      if (this._serverVersion.apiVersion !== EXPECTED_API_VERSION) {
        vscode.window.showWarningMessage(
          `Flightdeck server v${this._serverVersion.version} may not be compatible with this extension. ` +
          `Expected API version ${EXPECTED_API_VERSION}, got ${this._serverVersion.apiVersion}. Some features may not work.`,
        );
      }
    } catch {
      this._serverVersion = null;
      this.log.appendLine('Server does not support /version endpoint — skipping compatibility check');
    }

    // Persist successful URL for faster reconnect
    await this.context.globalState.update(
      FlightdeckConnection.GLOBAL_STATE_LAST_URL,
      this._serverUrl,
    );

    this.connectWebSocket();
  }

  /** Disconnect from the server and stop reconnection attempts. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    this.setState('disconnected');
    this.log.appendLine('Disconnected');
  }

  /** Send a JSON message over the WebSocket. No-op if not connected. */
  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Make a GET request to the server using a raw path (no /api prefix).
   * Use fetchJson() or postJson() for API-prefixed requests.
   * @param path - Path relative to server URL (e.g. `/health`, `/version`)
   * @returns Parsed JSON response body
   */
  async fetchRaw<T>(path: string): Promise<T> {
    const baseUrl = this._serverUrl || 'http://localhost:3001';
    const url = new URL(path, baseUrl);
    const lib = url.protocol === 'https:' ? https : http;

    return new Promise<T>((resolve, reject) => {
      const req = lib.get(url, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${path}`));
          res.resume();
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error(`Invalid JSON from ${path}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy(new Error(`Request timeout: ${path}`));
      });
    });
  }

  /**
   * Fetch JSON from the Flightdeck REST API. Returns null on failure.
   * Used by tree providers and decorations for data loading.
   */
  async fetchJson<T>(path: string): Promise<T | null> {
    if (!this.connected) return null;
    try {
      return await this.fetchRaw<T>(`/api${path}`);
    } catch {
      return null;
    }
  }

  /**
   * Make a POST/PATCH/etc request to the server REST API.
   * @param path - API path relative to server URL (e.g. `/api/agents/:id/message`)
   * @param options - method, body, headers
   * @returns { ok, status, data } — never throws
   */
  async postJson<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<{ ok: boolean; status: number; data?: T }> {
    const baseUrl = this._serverUrl || 'http://localhost:3001';
    const url = new URL(`/api${path}`, baseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const method = options.method ?? 'POST';
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    return new Promise((resolve) => {
      const req = lib.request(url, { method, headers: {
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          let data: T | undefined;
          try { data = JSON.parse(body) as T; } catch { /* non-JSON response */ }
          resolve({ ok, status: res.statusCode ?? 0, data });
        });
      });

      req.on('error', () => resolve({ ok: false, status: 0 }));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ ok: false, status: 0 });
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  /** Clean up all resources. Call from extension deactivate(). */
  dispose(): void {
    this.disconnect();
    this._onStateChange.dispose();
    this._onMessage.dispose();
  }

  // --- Private helpers ---

  private connectWebSocket(): void {
    const wsUrl = this._serverUrl.replace(/^http/, 'ws') + '/ws';
    this.log.appendLine(`WebSocket connecting to ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.appendLine(`WebSocket creation failed: ${msg}`);
      this.setState('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.log.appendLine('WebSocket connected');
      this.setState('connected');
      this.send({ type: 'subscribe', agentId: '*' });
      this.startHeartbeatMonitor();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.resetHeartbeatMonitor();
      try {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        this._onMessage.fire(msg);
      } catch {
        this.log.appendLine(
          `Invalid message: ${data.toString().slice(0, 200)}`,
        );
      }
    });

    this.ws.on('pong', () => {
      this.resetHeartbeatMonitor();
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.log.appendLine(`WebSocket closed: ${code} ${reason.toString()}`);
      this.cleanup();
      this.setState('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      this.log.appendLine(`WebSocket error: ${err.message}`);
      // 'close' event follows — reconnection handled there
    });
  }

  private startHeartbeatMonitor(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.log.appendLine('Heartbeat timeout — reconnecting');
      this.ws?.terminate();
    }, this.HEARTBEAT_TIMEOUT);
  }

  private resetHeartbeatMonitor(): void {
    if (this._state === 'connected') {
      this.startHeartbeatMonitor();
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    this.log.appendLine(
      `Reconnecting in ${this.RECONNECT_INTERVAL / 1000}s...`,
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;

      // Re-discover in case the server restarted on a different port.
      // Note: discoverServer() includes port scanning which may take a few
      // seconds, so the RECONNECT_INTERVAL is a minimum delay, not exact.
      const discovered = await this.discoverServer();

      // Guard: disconnect() may have been called during async discovery
      if (!this.shouldReconnect) return;

      if (discovered && discovered !== this._serverUrl) {
        this.log.appendLine(`Server moved to ${discovered} (was ${this._serverUrl})`);
        this._serverUrl = discovered;
        await this.context.globalState.update(
          FlightdeckConnection.GLOBAL_STATE_LAST_URL,
          discovered,
        );
      }

      if (this._serverUrl) {
        this.connectWebSocket();
      }
    }, this.RECONNECT_INTERVAL);
  }

  private cleanup(): void {
    this.clearHeartbeatTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
