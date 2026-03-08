import { useState, useEffect } from 'react';
import { WifiOff, AlertTriangle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────

export type AgentServerConnectionState = 'connected' | 'degraded' | 'disconnected';

interface AgentServerStatusEvent {
  type: 'agentServerStatus';
  state: AgentServerConnectionState;
  detail?: string;
}

function isAgentServerStatusEvent(msg: unknown): msg is AgentServerStatusEvent {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>).type === 'agentServerStatus' &&
    typeof (msg as Record<string, unknown>).state === 'string'
  );
}

// ── Component ─────────────────────────────────────────────

/**
 * Banner that shows agent server connection health.
 * - Connected: hidden (no banner)
 * - Degraded: amber warning banner (auto-dismisses on recovery)
 * - Disconnected: red error banner (non-dismissible until recovery)
 *
 * Listens for 'agentServerStatus' events via the WebSocket message bus.
 */
export function AgentServerStatus() {
  const [state, setState] = useState<AgentServerConnectionState>('connected');
  const [detail, setDetail] = useState<string | undefined>();

  useEffect(() => {
    function onWsMessage(event: Event) {
      try {
        const raw = (event as MessageEvent).data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (isAgentServerStatusEvent(msg)) {
          setState(msg.state);
          setDetail(msg.detail);
        }
      } catch {
        // Ignore parse errors from non-JSON messages
      }
    }

    window.addEventListener('ws-message', onWsMessage);
    return () => window.removeEventListener('ws-message', onWsMessage);
  }, []);

  if (state === 'connected') return null;

  if (state === 'degraded') {
    return (
      <div
        className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 flex items-center justify-center gap-2"
        role="status"
        data-testid="agent-server-degraded"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-xs text-amber-400">
          Agent server connection degraded{detail ? ` — ${detail}` : ''}
        </span>
      </div>
    );
  }

  // disconnected
  return (
    <div
      className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center justify-center gap-2"
      role="alert"
      data-testid="agent-server-disconnected"
    >
      <WifiOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
      <span className="text-xs text-red-400">
        Agent server disconnected{detail ? ` — ${detail}` : ''}
      </span>
    </div>
  );
}
