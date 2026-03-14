/**
 * PostMessage bridge for VS Code webview.
 *
 * Replaces direct WebSocket connections in the React app. The webview
 * communicates with the extension host via `postMessage`, and the
 * extension host forwards messages to the Flightdeck server's WebSocket.
 *
 * Usage in the webview React app:
 *   import { sendToExtension, onMessage, removeMessageListener } from './bridge';
 */

/** VS Code webview API handle, acquired once at module load. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscodeApi: { postMessage(msg: unknown): void } = (window as any).acquireVsCodeApi?.()
  ?? { postMessage: () => console.warn('acquireVsCodeApi not available — not in a webview') };

// ── Outbound: webview → extension host ──────────────────────────

export interface BridgeMessage {
  type: string;
  payload?: unknown;
}

/**
 * Send a message from the webview to the extension host.
 * The extension host will forward it to the Flightdeck server.
 */
export function sendToExtension(msg: BridgeMessage): void {
  vscodeApi.postMessage(msg);
}

// ── Inbound: extension host → webview ───────────────────────────

export type MessageHandler = (msg: BridgeMessage) => void;

const listeners = new Set<MessageHandler>();

/** Register a handler for messages from the extension host. */
export function onMessage(handler: MessageHandler): void {
  listeners.add(handler);
}

/** Remove a previously registered handler. */
export function removeMessageListener(handler: MessageHandler): void {
  listeners.delete(handler);
}

// Single global listener dispatches to all registered handlers
window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as BridgeMessage;
  if (msg && typeof msg.type === 'string') {
    for (const handler of listeners) {
      try {
        handler(msg);
      } catch (err) {
        console.error('[bridge] handler error:', err);
      }
    }
  }
});

// ── WebSocket-compatible interface ──────────────────────────────

/**
 * Drop-in replacement for a WebSocket connection.
 * The web app can use this instead of `new WebSocket(url)`.
 */
export class WebviewSocket {
  private _onMessageHandler: ((data: string) => void) | null = null;
  private _onOpenHandler: (() => void) | null = null;
  private _onCloseHandler: (() => void) | null = null;

  constructor() {
    onMessage((msg) => {
      if (msg.type === 'ws:message' && this._onMessageHandler) {
        this._onMessageHandler(JSON.stringify(msg.payload));
      }
    });

    // Signal "open" on next tick so callers can attach handlers first
    setTimeout(() => this._onOpenHandler?.(), 0);
  }

  send(data: string): void {
    sendToExtension({ type: 'ws:send', payload: JSON.parse(data) });
  }

  set onmessage(handler: ((data: string) => void) | null) {
    this._onMessageHandler = handler;
  }

  set onopen(handler: (() => void) | null) {
    this._onOpenHandler = handler;
  }

  set onclose(handler: (() => void) | null) {
    this._onCloseHandler = handler;
  }

  close(): void {
    sendToExtension({ type: 'ws:close' });
    this._onCloseHandler?.();
  }
}
