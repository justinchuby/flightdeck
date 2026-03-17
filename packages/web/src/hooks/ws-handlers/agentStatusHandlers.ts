import type { WsHandlerContext, AcpTextChunk } from './types';
import { useToastStore } from '../../components/Toast';
import { shortAgentId } from '../../utils/agentLabel';
import { useMessageStore } from '../../stores/messageStore';

/**
 * Handlers for agent lifecycle events:
 * init, agent:spawned, agent:terminated, agent:exit, agent:status,
 * agent:sub_spawned, agent:spawn_error, agent:model_fallback,
 * agent:session_ready, agent:session_resume_failed
 */

export function handleInit(msg: any, ctx: WsHandlerContext): void {
  ctx.setAgents(msg.agents);
  ctx.getAppState().setLoading(false);
  if (msg.systemPaused !== undefined) {
    ctx.getAppState().setSystemPaused(msg.systemPaused);
  }
}

export function handleAgentSpawned(msg: any, ctx: WsHandlerContext): void {
  ctx.addAgent(msg.agent);
}

export function handleAgentTerminated(msg: any, ctx: WsHandlerContext): void {
  ctx.updateAgent(msg.agentId, { status: 'terminated' });
}

export function handleAgentExit(msg: any, ctx: WsHandlerContext): void {
  // Don't overwrite 'terminated' with 'failed' — explicit termination takes precedence
  const prev = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  if (prev?.status === 'terminated') return;
  ctx.updateAgent(msg.agentId, {
    status: msg.code === 0 ? 'completed' : 'failed',
    exitError: msg.error,
    exitCode: msg.code ?? null,
  });
}

export function handleAgentStatus(msg: any, ctx: WsHandlerContext): void {
  const prev = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  const wasIdle = prev && (prev.status === 'idle' || prev.status === 'completed');
  ctx.updateAgent(msg.agentId, { status: msg.status });

  // When agent transitions from idle back to running, insert a turn separator.
  if (msg.status === 'running' && wasIdle) {
    const store = useMessageStore.getState();
    const channel = store.channels[msg.agentId];
    const messages = channel?.messages ?? [];
    if (messages.length) {
      const msgs = [...messages];
      const last = msgs[msgs.length - 1];
      if (last?.sender === 'agent') {
        const separator: AcpTextChunk = { type: 'text', text: '---', sender: 'system' };
        if (last.timestamp && Date.now() - last.timestamp < 2000 && msgs.length >= 2) {
          const prev = msgs[msgs.length - 2];
          if (prev?.sender === 'agent' || prev?.sender === undefined) {
            msgs.splice(msgs.length - 1, 0, separator);
          } else {
            msgs.push(separator);
          }
        } else {
          msgs.push(separator);
        }
        store.setMessages(msg.agentId, msgs);
      }
    }
  }
}

export function handleSubSpawned(msg: any, ctx: WsHandlerContext): void {
  ctx.addAgent(msg.child);
  ctx.updateAgent(msg.parentId, {
    childIds: [
      ...(ctx.getAppState().agents.find((a: any) => a.id === msg.parentId)?.childIds || []),
      msg.child.id,
    ],
  });
}

export function handleSpawnError(msg: any, ctx: WsHandlerContext): void {
  const parentAgent = ctx.getAppState().agents.find((a: any) => a.id === msg.agentId);
  const label = parentAgent?.role?.name ?? shortAgentId(msg.agentId) ?? 'Agent';
  useToastStore.getState().add('error', `Spawn failed (${label}): ${msg.message}`);
}

export function handleModelFallback(msg: any, ctx: WsHandlerContext): void {
  ctx.updateAgent(msg.agentId, {
    model: msg.resolved,
    modelResolution: {
      requested: msg.requested,
      resolved: msg.resolved,
      translated: true,
      reason: msg.reason,
    },
  });
  useToastStore.getState().add('info', `🔄 ${msg.agentRole}: ${msg.requested} → ${msg.resolved} (${msg.provider})`);
}

export function handleSessionReady(msg: any, ctx: WsHandlerContext): void {
  ctx.updateAgent(msg.agentId, { sessionId: msg.sessionId });
}

export function handleSessionResumeFailed(msg: any, _ctx: WsHandlerContext): void {
  const agentId = shortAgentId(msg.agentId ?? '');
  const error = msg.error ?? 'Unknown error';
  useToastStore.getState().add('error', `Session resume failed (agent ${agentId}): ${error}`);
}
