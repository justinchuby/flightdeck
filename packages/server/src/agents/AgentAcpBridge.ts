/**
 * ACP connection management for Agent — extracted from Agent.ts to reduce file size.
 * Handles startAcp(), wireAcpEvents(), and ensureSharedWorkspace().
 */
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { AcpConnection } from '../acp/AcpConnection.js';
import type { ToolCallInfo, PlanEntry } from '../acp/AcpConnection.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { agentFlagForRole } from './agentFiles.js';
import type { Agent } from './Agent.js';

/** Ensure the shared workspace directory exists for inter-agent artifact sharing. */
export function ensureSharedWorkspace(agent: Agent): void {
  const sharedDir = join(agent.cwd || process.cwd(), '.flightdeck', 'shared');
  if (!existsSync(sharedDir)) {
    try { mkdirSync(sharedDir, { recursive: true }); } catch (err) { logger.debug('agent', 'Shared dir already exists or cannot be created'); }
  }
}

/**
 * Create and start an ACP connection for the agent.
 * Wires all protocol events to the agent's state and listener arrays.
 */
export function startAcp(agent: Agent, config: ServerConfig, initialPrompt?: string): void {
  const conn = new AcpConnection({ autopilot: agent.autopilot });
  agent._setAcpConnection(conn);
  agent.status = 'running';
  wireAcpEvents(agent, conn);

  const cliArgs = [
    ...config.cliArgs,
    `--agent=${agentFlagForRole(agent.role.id)}`,
    ...(agent.model || agent.role.model ? ['--model', agent.model || agent.role.model!] : []),
    ...(agent.resumeSessionId ? ['--resume', agent.resumeSessionId] : []),
  ];

  conn.start({
    cliCommand: config.cliCommand,
    cliArgs,
    cwd: agent.cwd || process.cwd(),
  }).then((sessionId) => {
    agent.sessionId = sessionId;
    agent._notifySessionReady(sessionId);
    if (initialPrompt) {
      return conn.prompt(initialPrompt);
    }
  }).catch((_err) => {
    agent.status = 'failed';
    agent._notifyExit(1);
  });
}

/** Wire ACP protocol events to Agent state and listeners. */
function wireAcpEvents(agent: Agent, conn: AcpConnection): void {
  conn.on('text', (text: string) => {
    if (agent._isTerminated) return;
    agent.messages.push(text);
    if (agent.messages.length > agent._maxMessages) {
      agent.messages = agent.messages.slice(-agent._maxMessages);
    }
    agent._notifyData(text);
  });

  conn.on('content', (content: any) => {
    agent._notifyContent(content);
  });

  conn.on('thinking', (text: string) => {
    agent._notifyThinking(text);
  });

  conn.on('tool_call', (info: ToolCallInfo) => {
    if (agent._isTerminated) return;
    const idx = agent.toolCalls.findIndex((t) => t.toolCallId === info.toolCallId);
    if (idx >= 0) {
      agent.toolCalls[idx] = info;
    } else {
      agent.toolCalls.push(info);
      if (agent.toolCalls.length > agent._maxToolCalls) {
        agent.toolCalls = agent.toolCalls.slice(-agent._maxToolCalls);
      }
    }
    agent._notifyToolCall(info);
  });

  conn.on('tool_call_update', (update: Partial<ToolCallInfo> & { toolCallId: string }) => {
    const idx = agent.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId);
    if (idx >= 0) {
      agent.toolCalls[idx] = { ...agent.toolCalls[idx], ...update };
    }
    agent._notifyToolCall(agent.toolCalls[idx] ?? update as ToolCallInfo);
  });

  conn.on('plan', (entries: PlanEntry[]) => {
    agent.plan = entries;
    agent._notifyPlan(entries);
  });

  conn.on('permission_request', (request: any) => {
    agent._notifyPermissionRequest(request);
  });

  conn.on('usage', (usage: { inputTokens: number; outputTokens: number }) => {
    agent.inputTokens = usage.inputTokens;
    agent.outputTokens = usage.outputTokens;
    agent._notifyUsage({ agentId: agent.id, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, dagTaskId: agent.dagTaskId });
  });

  conn.on('usage_update', (info: { size: number; used: number }) => {
    const previousUsed = agent.contextWindowUsed;
    agent.contextWindowSize = info.size;
    agent.contextWindowUsed = info.used;

    // Detect compaction: significant drop (>30%) in context usage
    if (previousUsed > 0 && info.used < previousUsed * 0.7 && previousUsed > 10000) {
      const percentDrop = Math.round(((previousUsed - info.used) / previousUsed) * 100);
      agent._notifyContextCompacted({ previousUsed, currentUsed: info.used, percentDrop });
    }
  });

  conn.on('exit', (code: number) => {
    if (!agent._isTerminated) {
      agent.status = code === 0 ? 'completed' : 'failed';
    }
    agent._notifyExit(code);
  });

  conn.on('prompt_complete', (_stopReason: string) => {
    if (agent._isTerminated) return;
    if (agent.status === 'running' && !conn.isPrompting) {
      // Drain queued messages before going idle (unless system is paused)
      if (!agent.systemPaused && agent.pendingMessageCount > 0) {
        agent._drainOneMessage();
        return;
      }
      agent.status = 'idle';
      agent._notifyStatusChange(agent.status);
      agent._notifyHung(0);
    }
  });

  conn.on('prompting', (active: boolean) => {
    if (agent._isTerminated) return;
    if (active && agent.status !== 'running') {
      agent.status = 'running';
      agent._notifyStatusChange(agent.status);
    }
  });
}
