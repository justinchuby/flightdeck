/**
 * ACP connection management for Agent — extracted from Agent.ts to reduce file size.
 * Handles startAgent(), wireAcpEvents(), and ensureSharedWorkspace().
 */
import { mkdirSync, existsSync, renameSync, symlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createAdapterForProvider, buildStartOptions } from '../adapters/AdapterFactory.js';
import type { AgentAdapter, ToolCallInfo, PlanEntry } from '../adapters/types.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { runWithAgentContext } from '../middleware/requestContext.js';
import { agentFlagForRole } from './agentFiles.js';
import type { Agent } from './Agent.js';

/** Ensure the shared workspace directory exists for inter-agent artifact sharing. */
export function ensureSharedWorkspace(agent: Agent): void {
  const baseDir = agent.cwd || process.cwd();
  const newBase = join(baseDir, '.flightdeck');
  const legacyBase = join(baseDir, '.ai-crew');

  // Backward-compat: migrate .ai-crew/ → .flightdeck/ if legacy exists.
  if (!existsSync(newBase) && existsSync(legacyBase)) {
    try {
      renameSync(legacyBase, newBase);
      logger.info({ module: 'agent', msg: 'Migrated workspace: .ai-crew/ → .flightdeck/' });
    } catch {
      logger.debug({ module: 'agent', msg: 'Could not migrate .ai-crew/ dir, creating fresh .flightdeck/' });
    }
  }

  const sharedDir = join(newBase, 'shared');
  if (!existsSync(sharedDir)) {
    try { mkdirSync(sharedDir, { recursive: true }); } catch (err) { logger.debug({ module: 'agent', msg: 'Shared dir already exists or cannot be created' }); }
  }

  // Create organized artifact directory and symlink from shared workspace
  if (agent.artifactDir) {
    try {
      mkdirSync(agent.artifactDir, { recursive: true });
    } catch { /* already exists */ }

    const shortId = agent.id.slice(0, 8);
    const linkPath = join(sharedDir, `${agent.role.id}-${shortId}`);
    if (!existsSync(linkPath)) {
      try {
        symlinkSync(agent.artifactDir, linkPath, 'dir');
      } catch {
        // Fallback: if symlink fails (Windows, permissions), create local dir
        try { mkdirSync(linkPath, { recursive: true }); } catch { /* ignore */ }
      }
    }

    // Write session metadata (once per session directory)
    const sessionDir = dirname(agent.artifactDir);
    const metaPath = join(sessionDir, '_meta.json');
    if (!existsSync(metaPath)) {
      try {
        writeFileSync(metaPath, JSON.stringify({
          startedAt: new Date().toISOString(),
          projectId: agent.projectId || '',
          leadId: agent.parentId || agent.id,
        }, null, 2));
      } catch { /* non-critical */ }
    }
  }
}

/**
 * Create and start an adapter connection for the agent.
 * Uses the unified AdapterFactory to pick the right backend (ACP or Claude SDK).
 * Wires all protocol events to the agent's state and listener arrays.
 */
export async function startAcp(agent: Agent, config: ServerConfig, initialPrompt?: string): Promise<void> {
  const rawModel = agent.model || agent.role.model;

  const adapterConfig = {
    provider: config.provider || 'copilot',
    autopilot: agent.autopilot,
    model: rawModel,
    binaryOverride: config.providerBinaryOverride,
    argsOverride: config.providerArgsOverride,
    envOverride: config.providerEnvOverride,
    cloudProvider: config.cloudProvider,
    cliArgs: config.cliArgs,
    cliCommand: config.cliCommand,
  };

  const { adapter: conn, backend, fallback, fallbackReason } = await createAdapterForProvider(adapterConfig);

  if (fallback) {
    logger.warn({
      module: 'agent-bridge',
      msg: `SDK fallback for ${agent.role.id}: ${fallbackReason}`,
      agentId: agent.id,
    });
  }

  logger.info({
    module: 'agent-bridge',
    msg: `Starting agent with ${backend} backend`,
    agentId: agent.id,
    role: agent.role.id,
    provider: config.provider,
  });

  agent._setAcpConnection(conn);
  agent.provider = config.provider || 'copilot';
  agent.backend = backend;
  agent.status = 'running';
  wireAcpEvents(agent, conn);

  const startOpts = buildStartOptions(adapterConfig, {
    cwd: agent.cwd || process.cwd(),
    sessionId: agent.resumeSessionId,
    agentFlag: agentFlagForRole(agent.role.id),
  });

  conn.start(startOpts).then((sessionId) => {
    agent.sessionId = sessionId;
    agent._notifySessionReady(sessionId);
    if (initialPrompt) {
      return conn.prompt(initialPrompt);
    }
    // Resumed agents have no initial prompt — they're waiting for input.
    // Transition to idle so the UI shows the correct state.
    agent.status = 'idle';
    agent._notifyStatusChange(agent.status);
  }).catch((err) => {
    const errorMsg = err?.message || String(err);
    logger.error({ module: 'agent-bridge', msg: 'Adapter start failed', err: errorMsg, backend, cliCommand: config.cliCommand, cwd: agent.cwd || process.cwd(), role: agent.role?.id });

    // Store error for exit event (text pipeline is buffered, races with immediate exit)
    agent.exitError = errorMsg;

    agent.status = 'failed';
    agent._notifyExit(1);
  });
}

/** Wire ACP protocol events to Agent state and listeners. */
export function wireAcpEvents(agent: Agent, conn: AgentAdapter): void {
  const withCtx = <T>(fn: () => T): T =>
    runWithAgentContext(agent.id, agent.role.name, agent.projectId, fn);

  conn.on('text', (text: string) => withCtx(() => {
    if (agent._isTerminated) return;
    agent.messages.push(text);
    if (agent.messages.length > agent._maxMessages) {
      agent.messages = agent.messages.slice(-agent._maxMessages);
    }
    // Estimate tokens from content length when ACP doesn't provide usage events
    agent.estimateTokensFromContent(text);
    agent._notifyData(text);
  }));

  conn.on('content', (content: any) => withCtx(() => {
    agent._notifyContent(content);
  }));

  conn.on('thinking', (text: string) => withCtx(() => {
    agent._notifyThinking(text);
  }));

  conn.on('tool_call', (info: ToolCallInfo) => withCtx(() => {
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
  }));

  conn.on('tool_call_update', (update: Partial<ToolCallInfo> & { toolCallId: string }) => withCtx(() => {
    const idx = agent.toolCalls.findIndex((t) => t.toolCallId === update.toolCallId);
    if (idx >= 0) {
      agent.toolCalls[idx] = { ...agent.toolCalls[idx], ...update };
    }
    agent._notifyToolCall(agent.toolCalls[idx] ?? update as ToolCallInfo);
  }));

  conn.on('plan', (entries: PlanEntry[]) => withCtx(() => {
    agent.plan = entries;
    agent._notifyPlan(entries);
  }));

  conn.on('permission_request', (request: any) => withCtx(() => {
    agent._notifyPermissionRequest(request);
  }));

  conn.on('session_resume_failed', (info: { requestedSessionId: string; error: string }) => withCtx(() => {
    agent._notifySessionResumeFailed(info);
  }));

  conn.on('usage', (usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; durationMs?: number; model?: string }) => withCtx(() => {
    agent.inputTokens = usage.inputTokens;
    agent.outputTokens = usage.outputTokens;
    agent.hasRealUsageData = true;
    agent._notifyUsage({
      agentId: agent.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      dagTaskId: agent.dagTaskId,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costUsd: usage.costUsd,
      durationMs: usage.durationMs,
      model: usage.model,
    });
  }));

  conn.on('usage_update', (info: { size: number; used: number }) => withCtx(() => {
    const previousUsed = agent.contextWindowUsed;
    agent.contextWindowSize = info.size;
    agent.contextWindowUsed = info.used;

    agent.recordTokenSample(info.used);

    if (previousUsed > 0 && info.used < previousUsed * 0.7 && previousUsed > 10000) {
      const percentDrop = Math.round(((previousUsed - info.used) / previousUsed) * 100);
      agent._notifyContextCompacted({ previousUsed, currentUsed: info.used, percentDrop });
    }
  }));

  conn.on('exit', (code: number) => withCtx(() => {
    if (!agent._isTerminated) {
      agent.status = code === 0 ? 'completed' : 'failed';
    }
    agent._notifyExit(code);
  }));

  conn.on('prompt_complete', (_stopReason: string) => withCtx(() => {
    if (agent._isTerminated) return;
    if (agent.status === 'running' && !conn.isPrompting) {
      if (!agent.systemPaused && agent.pendingMessageCount > 0) {
        agent._drainOneMessage();
        return;
      }
      agent.status = 'idle';
      agent._notifyStatusChange(agent.status);
      agent._notifyHung(0);
    }
  }));

  conn.on('prompting', (active: boolean) => withCtx(() => {
    if (agent._isTerminated) return;
    if (active) {
      // Resume initialization is complete — agent is now doing real work.
      agent._isResuming = false;
      if (agent.status !== 'running') {
        agent.status = 'running';
        agent._notifyStatusChange(agent.status);
      }
    }
  }));

  conn.on('response_start', () => withCtx(() => {
    if (agent._isTerminated) return;
    agent._notifyResponseStart();
  }));
}
