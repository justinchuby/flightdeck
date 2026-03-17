/**
 * ACP connection management for Agent — extracted from Agent.ts to reduce file size.
 * Handles startAgent(), wireAcpEvents(), and ensureSharedWorkspace().
 */
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { createAdapterForProvider, buildStartOptions } from '../adapters/AdapterFactory.js';
import { createRoleFileWriter, listRoleFileWriterProviders } from '../adapters/RoleFileWriter.js';
import type { RoleDefinition } from '../adapters/RoleFileWriter.js';
import type { AgentAdapter, ToolCallInfo, PlanEntry } from '../adapters/types.js';
import type { ServerConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { runWithAgentContext } from '../middleware/requestContext.js';
import { agentFlagForRole } from './agentFiles.js';
import type { Agent } from './Agent.js';

/** Set of provider IDs that have a RoleFileWriter. Cached at module load. */
const ROLE_FILE_PROVIDERS = new Set(listRoleFileWriterProviders());

/** Ensure the organized artifact directory exists for inter-agent artifact sharing. */
export function ensureSharedWorkspace(agent: Agent): void {
  // Create organized artifact directory
  if (agent.artifactDir) {
    try { mkdirSync(agent.artifactDir, { recursive: true }); } catch { /* already exists */ }

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
 * Write CLI-specific role/agent definition files so the spawned CLI process
 * can discover the agent's system prompt natively (e.g. AGENTS.md for Codex,
 * .github/agents/*.agent.md for Copilot, .gemini/agents/*.md for Gemini).
 *
 * Non-critical — if writing fails, the first-prompt fallback still delivers
 * the system prompt as user-message text.
 */
async function writeRoleFilesForProvider(provider: string, agent: Agent, cwd: string): Promise<void> {
  if (!ROLE_FILE_PROVIDERS.has(provider)) return;

  const roleDef: RoleDefinition = {
    role: agent.role.id,
    description: agent.role.description,
    instructions: agent.role.systemPrompt,
  };

  try {
    const writer = createRoleFileWriter(provider);
    const written = await writer.writeRoleFiles([roleDef], cwd);
    if (written.length > 0) {
      logger.info({
        module: 'agent-bridge',
        msg: `Wrote ${written.length} role file(s) for ${provider}`,
        agentId: agent.id,
        files: written.map(f => f.replace(cwd, '.')),
      });
    }
  } catch (err: any) {
    logger.warn({
      module: 'agent-bridge',
      msg: 'Role file write failed (non-critical — falling back to prompt delivery)',
      provider,
      agentId: agent.id,
      error: err?.message,
    });
  }
}

/**
 * Create and start an adapter connection for the agent.
 * Uses the unified AdapterFactory to pick the right backend (ACP or Claude SDK).
 * Wires all protocol events to the agent's state and listener arrays.
 */
export async function startAcp(agent: Agent, config: ServerConfig, initialPrompt?: string): Promise<void> {
  const rawModel = agent.model || agent.role.model;

  const effectiveProvider = agent.provider || config.provider || 'copilot';

  const adapterConfig = {
    provider: effectiveProvider,
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
  agent.provider = effectiveProvider;
  agent.backend = backend;
  agent.status = 'running';
  agent._notifyStatusChange(agent.status);
  wireAcpEvents(agent, conn);

  const { options: startOpts, modelResolution } = buildStartOptions(adapterConfig, {
    cwd: agent.cwd || process.cwd(),
    sessionId: agent.resumeSessionId,
    agentFlag: agentFlagForRole(agent.role.id),
    systemPrompt: agent.role.systemPrompt,
  });

  // Store model resolution metadata on the agent
  if (modelResolution) {
    agent.modelResolution = {
      requested: modelResolution.original,
      resolved: modelResolution.model,
      translated: modelResolution.translated,
      reason: modelResolution.reason ?? '',
    };
    // Update displayed model to the actual resolved model
    agent.model = modelResolution.model;
  }

  // Notify listeners when the model was translated to a different model.
  // This fires before conn.start() — intentional. The AgentManager listener
  // queues a system message to the lead (queued messages are delivered once
  // the lead's current prompt completes, so timing is safe).
  if (modelResolution?.translated) {
    agent._notifyModelFallback({
      requested: modelResolution.original,
      resolved: modelResolution.model,
      reason: modelResolution.reason ?? 'cross-provider equivalence',
      provider: effectiveProvider,
    });
  }

  // Write CLI-specific role files BEFORE spawning the process.
  // The CLI reads these from CWD on startup (e.g. AGENTS.md, .agent.md).
  const agentCwd = agent.cwd || process.cwd();
  await writeRoleFilesForProvider(effectiveProvider, agent, agentCwd);

  conn.start(startOpts).then(async (sessionId) => {
    agent.sessionId = sessionId;
    agent._notifySessionReady(sessionId);
    if (initialPrompt) {
      // Fresh agent — clear resume flag (it's false anyway) and start prompting.
      agent._clearResuming();
      return conn.prompt(initialPrompt);
    }
    // Resumed agents have no initial prompt — they're waiting for input.
    // The provider may be continuing an in-flight prompt from the crashed
    // session — cancel it so the agent starts clean and idle.
    if (conn.isPrompting) {
      try { await conn.cancel(); } catch (e) { logger.warn({ module: 'agent-bridge', msg: 'Resume cancel failed (best-effort)', err: (e as Error).message }); }
    }
    agent.status = 'idle';
    agent._notifyStatusChange(agent.status);
    // Clear AFTER session-ready and idle notifications have fired synchronously,
    // so all resume-suppression guards see isResuming === true.
    agent._clearResuming();
  }).catch((err) => {
    const errorMsg = err?.message || String(err);
    logger.error({ module: 'agent-bridge', msg: 'Adapter start failed', err: errorMsg, backend, cliCommand: config.cliCommand, cwd: agent.cwd || process.cwd(), role: agent.role?.id });

    // Kill the spawned process to prevent orphan leaks
    Promise.resolve(conn.terminate()).catch(() => { /* already exited */ });

    // Store error for exit event (text pipeline is buffered, races with immediate exit)
    agent.exitError = errorMsg;

    // Clear resume flag so notification guards don't stay permanently suppressed
    agent._clearResuming();

    agent.status = 'failed';
    agent._notifyExit(1);
  });
}

/** Wire ACP protocol events to Agent state and listeners. */
export function wireAcpEvents(agent: Agent, conn: AgentAdapter): void {
  const withCtx = <T>(fn: () => T): T =>
    runWithAgentContext(agent.id, agent.role.name, agent.projectId, fn);

  conn.on('text', (text: string) => withCtx(() => {
    if (agent._isTerminated || agent.isResuming) return;
    agent.messages.push(text);
    if (agent.messages.length > agent._maxMessages) {
      agent.messages = agent.messages.slice(-agent._maxMessages);
    }
    // Estimate tokens from content length when ACP doesn't provide usage events
    agent.estimateTokensFromContent(text);
    agent._notifyData(text);
  }));

  conn.on('content', (content: any) => withCtx(() => {
    if (agent.isResuming) return;
    agent._notifyContent(content);
  }));

  conn.on('thinking', (text: string) => withCtx(() => {
    if (agent.isResuming) return;
    agent._notifyThinking(text);
  }));

  conn.on('tool_call', (info: ToolCallInfo) => withCtx(() => {
    if (agent._isTerminated || agent.isResuming) return;
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
    if (agent.isResuming) return;
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

    // Flush buffered system notes as a single queued message
    const notes = conn.flushSystemNotes();
    if (notes) {
      agent.queueMessage(notes);
    }

    if (agent.status === 'running' && !conn.isPrompting) {
      if (!agent.systemPaused && agent.pendingMessageCount > 0) {
        agent._drainOneMessage();
        return;
      }
      agent.status = 'idle';
      agent._notifyStatusChange(agent.status);
    }
  }));

  conn.on('prompting', (active: boolean) => withCtx(() => {
    if (agent._isTerminated) return;
    if (active) {
      // If the provider resumes an in-flight prompt from the previous session,
      // cancel it immediately — resumed agents must start idle.
      if (agent.isResuming) {
        conn.cancel().catch(() => { /* best-effort */ });
        return;
      }
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
