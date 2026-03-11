import { Agent, isTerminalStatus } from './Agent.js';
import { generateProjectId } from '../utils/projectId.js';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentContextInfo } from './Agent.js';
import type { Role, RoleRegistry } from './RoleRegistry.js';
import type { ServerConfig } from '../config.js';
import type { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import type { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import type { MessageBus } from '../comms/MessageBus.js';
import type { DecisionLog } from '../coordination/decisions/DecisionLog.js';
import type { AgentMemory } from './AgentMemory.js';
import type { ChatGroupRegistry, ChatGroup, GroupMessage } from '../comms/ChatGroupRegistry.js';
import type { Database } from '../db/database.js';
import { ConversationStore } from '../db/ConversationStore.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import type { DeferredIssueRegistry } from '../tasks/DeferredIssueRegistry.js';
import type { TimerRegistry } from '../coordination/scheduling/TimerRegistry.js';
import type { CapabilityInjector } from './capabilities/CapabilityInjector.js';
import type { TaskTemplateRegistry } from '../tasks/TaskTemplates.js';
import type { TaskDecomposer } from '../tasks/TaskDecomposer.js';
import type { WorktreeManager } from '../coordination/files/WorktreeManager.js';
import type { CostTracker } from './CostTracker.js';
import type { MessageQueueStore } from '../persistence/MessageQueueStore.js';
import type { AgentRosterRepository } from '../db/AgentRosterRepository.js';
import type { ActiveDelegationRepository } from '../db/ActiveDelegationRepository.js';
import { logger } from '../utils/logger.js';
import { writeAgentFiles } from './agentFiles.js';
import { CommandDispatcher } from './CommandDispatcher.js';
import type { Delegation } from './CommandDispatcher.js';
import { HeartbeatMonitor } from './HeartbeatMonitor.js';
import { TypedEmitter } from '../utils/TypedEmitter.js';
import type { ToolCallInfo, PlanEntry } from '../adapters/types.js';
import { agentPlans } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { runWithAgentContext } from '../middleware/requestContext.js';
import type { SessionKnowledgeExtractor } from '../knowledge/SessionKnowledgeExtractor.js';
import type { SessionData, SessionMessage } from '../knowledge/types.js';
import type { KnowledgeInjector, InjectionContext } from '../knowledge/KnowledgeInjector.js';
import type { SkillsLoader } from '../knowledge/SkillsLoader.js';
import type { CollectiveMemory, MemoryCategory } from '../coordination/knowledge/CollectiveMemory.js';
import { KNOWLEDGE_TO_MEMORY_CATEGORY } from '../coordination/knowledge/CollectiveMemory.js';
import { DEFAULT_MODEL } from '../projects/ModelConfigDefaults.js';


// Re-export Delegation so existing consumers (api.ts, etc.) continue to work
export type { Delegation } from './CommandDispatcher.js';

// ── Oversight tier behavioral instructions injected into agent prompts ──
const OVERSIGHT_TIER_INSTRUCTIONS: Record<string, string> = {
  supervised: 'The user has set oversight to supervised mode. Be cautious and deliberate. Explain your reasoning before making changes. Show diffs and plans before executing. Prefer smaller, incremental steps.',
  balanced: 'The user has set oversight to balanced mode. Use good judgment. Explain significant decisions like architecture changes or file deletions, but proceed efficiently with routine work.',
  autonomous: 'The user has set oversight to autonomous mode. Work efficiently and independently. Focus on results over explanations. Make decisions confidently.',
};

// ── Typed event map for AgentManager ────────────────────────────────
export interface AgentManagerEvents {
  'agent:spawned': ReturnType<Agent['toJSON']>;
  'agent:terminated': string;
  'agent:exit': { agentId: string; code: number; error?: string };
  'agent:text': { agentId: string; text: string };
  'agent:response_start': { agentId: string };
  'agent:tool_call': { agentId: string; toolCall: ToolCallInfo };
  'agent:content': { agentId: string; content: string };
  'agent:thinking': { agentId: string; text: string };
  'agent:plan': { agentId: string; plan: PlanEntry[] };
  'agent:session_ready': { agentId: string; sessionId: string };
  'agent:session_resume_failed': { agentId: string; requestedSessionId: string; error: string };
  'agent:message_sent': { from: string; fromRole: string; to: string; toRole: string; content: string };
  'agent:context_compacted': { agentId: string; previousUsed: number; currentUsed: number; percentDrop: number };
  'agent:usage': { agentId: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd?: number; contextWindowUsed?: number; contextWindowSize?: number };
  'agent:status': { agentId: string; status: string };
  'agent:crashed': { agentId: string; code: number };
  'agent:auto_restarted': { agentId: string; crashCount: number };
  'agent:restart_limit': { agentId: string };
  'agent:restarted': { oldId: string; newAgent: ReturnType<Agent['toJSON']> };
  // Events emitted via CommandDispatcher pass-through
  'agent:sub_spawned': { parentId: string; child: ReturnType<Agent['toJSON']> };
  'agent:spawn_error': { agentId: string; message: string };
  'agent:delegated': { parentId: string; childId: string; delegation: Delegation };
  'agent:delegate_error': { agentId: string; message: string };
  'agent:completion_reported': { childId: string; parentId: string | undefined; status: string };
  'lead:decision': { id: number; agentId: string; agentRole: string; leadId: string; title: string; rationale: string; needsConfirmation: boolean; status: string };
  'lead:progress': Record<string, any>;
  'lead:stalled': { leadId: string; nudgeCount: number; idleDuration: number };
  'dag:updated': { leadId: string };
  'group:created': { group: ChatGroup; leadId: string };
  'group:message': { message: GroupMessage; groupName: string; leadId: string };
  'system:paused': { paused: boolean };
}

export class AgentManager extends TypedEmitter<AgentManagerEvents> {
  private agents: Map<string, Agent> = new Map();
  private config: ServerConfig;
  private roleRegistry: RoleRegistry;
  private maxConcurrent: number;
  private lockRegistry: FileLockRegistry;
  private activityLedger: ActivityLedger;
  private messageBus: MessageBus;
  private decisionLog: DecisionLog;
  private agentMemory: AgentMemory;
  private chatGroupRegistry: ChatGroupRegistry;
  private taskDAG: TaskDAG;
  private deferredIssueRegistry: DeferredIssueRegistry;
  private timerRegistry: TimerRegistry;
  private capabilityInjector?: CapabilityInjector;
  private db?: Database;
  private conversationStore?: ConversationStore;
  private agentThreads: Map<string, string> = new Map(); // agentId → conversationId
  private messageBuffers: Map<string, string> = new Map(); // agentId → buffered text
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private crashCounts: Map<string, number> = new Map();
  private maxRestarts: number;
  private autoRestart: boolean;
  private dispatcher: CommandDispatcher;
  private heartbeat: HeartbeatMonitor;
  private projectRegistry?: import('../projects/ProjectRegistry.js').ProjectRegistry;
  private worktreeManager?: WorktreeManager;
  private costTracker?: CostTracker;
  private messageQueueStore?: MessageQueueStore;
  private agentRosterRepository?: AgentRosterRepository;
  private activeDelegationRepository?: ActiveDelegationRepository;
  private knowledgeInjector?: KnowledgeInjector;
  private skillsLoader?: SkillsLoader;
  private sessionKnowledgeExtractor?: SessionKnowledgeExtractor;
  private collectiveMemory?: CollectiveMemory;
  private configStore?: import('../config/ConfigStore.js').ConfigStore;
  private providerManager?: import('../providers/ProviderManager.js').ProviderManager;
  private _systemPaused = false;
  private _shuttingDown = false;

  constructor(
    config: ServerConfig,
    roleRegistry: RoleRegistry,
    lockRegistry: FileLockRegistry,
    activityLedger: ActivityLedger,
    messageBus: MessageBus,
    decisionLog: DecisionLog,
    agentMemory: AgentMemory,
    chatGroupRegistry: ChatGroupRegistry,
    taskDAG: TaskDAG,
    { maxRestarts = 3, autoRestart = true, db, deferredIssueRegistry, timerRegistry, capabilityInjector, taskTemplateRegistry, taskDecomposer, worktreeManager, costTracker, governancePipeline, messageQueueStore, agentRosterRepository, activeDelegationRepository, knowledgeInjector }: { maxRestarts?: number; autoRestart?: boolean; db?: Database; deferredIssueRegistry?: DeferredIssueRegistry; timerRegistry?: TimerRegistry; capabilityInjector?: CapabilityInjector; taskTemplateRegistry?: TaskTemplateRegistry; taskDecomposer?: TaskDecomposer; worktreeManager?: WorktreeManager; costTracker?: CostTracker; governancePipeline?: import('../governance/GovernancePipeline.js').GovernancePipeline; messageQueueStore?: MessageQueueStore; agentRosterRepository?: AgentRosterRepository; activeDelegationRepository?: ActiveDelegationRepository; knowledgeInjector?: KnowledgeInjector } = {},
  ) {
    super();
    this.config = config;
    this.roleRegistry = roleRegistry;
    this.lockRegistry = lockRegistry;
    this.activityLedger = activityLedger;
    this.messageBus = messageBus;
    this.decisionLog = decisionLog;
    this.agentMemory = agentMemory;
    this.chatGroupRegistry = chatGroupRegistry;
    this.taskDAG = taskDAG;
    this.deferredIssueRegistry = deferredIssueRegistry ?? (null as any);
    this.timerRegistry = timerRegistry ?? (null as any);
    this.capabilityInjector = capabilityInjector;
    this.worktreeManager = worktreeManager;
    this.costTracker = costTracker;
    this.messageQueueStore = messageQueueStore;
    this.agentRosterRepository = agentRosterRepository;
    this.activeDelegationRepository = activeDelegationRepository;
    this.knowledgeInjector = knowledgeInjector;
    this.db = db;
    if (db) this.conversationStore = new ConversationStore(db);
    this.maxConcurrent = config.maxConcurrentAgents;
    this.maxRestarts = maxRestarts;
    this.autoRestart = autoRestart;
    const self = this;
    this.dispatcher = new CommandDispatcher({
      getAgent: (id) => this.agents.get(id),
      getAllAgents: () => this.getAll(),
      getProjectIdForAgent: (agentId) => this.getProjectIdForAgent(agentId),
      getRunningCount: () => this.getRunningCount(),
      spawnAgent: (role, task, parentId, model, cwd, options) => this.spawn(role, task, parentId, model, cwd, undefined, undefined, options),
      terminateAgent: (id) => this.terminate(id),
      emit: (event: string, ...args: any[]) => this.emit(event as any, args[0]),
      roleRegistry: this.roleRegistry,
      config: this.config,
      lockRegistry: this.lockRegistry,
      activityLedger: this.activityLedger,
      messageBus: this.messageBus,
      decisionLog: this.decisionLog,
      agentMemory: this.agentMemory,
      chatGroupRegistry: this.chatGroupRegistry,
      taskDAG: this.taskDAG,
      deferredIssueRegistry: this.deferredIssueRegistry,
      timerRegistry: this.timerRegistry,
      capabilityInjector: this.capabilityInjector,
      taskTemplateRegistry,
      taskDecomposer,
      maxConcurrent: this.maxConcurrent,
      markHumanInterrupt: (id) => this.markHumanInterrupt(id),
      governancePipeline,
      activeDelegationRepository,
      agentRosterRepository,
    });

    // Start heartbeat monitor to detect stalled teams
    this.heartbeat = new HeartbeatMonitor({
      getAllAgents: () => this.getAll(),
      getDelegationsMap: () => this.dispatcher.getDelegationsMap(),
      getDagSummary: (leadId: string) => {
        try {
          return this.taskDAG.getStatus(leadId).summary;
        } catch {
          return null;
        }
      },
      getTaskByAgent: (leadId: string, agentId: string) => {
        try {
          return this.taskDAG.getTaskByAgent(leadId, agentId);
        } catch {
          return null;
        }
      },
      getRemainingTasks: (leadId: string) => {
        try {
          const { tasks } = this.taskDAG.getStatus(leadId);
          return tasks
            .filter(t => ['pending', 'ready', 'blocked', 'paused'].includes(t.dagStatus))
            .map(t => ({ id: t.id, description: t.description, dagStatus: t.dagStatus }));
        } catch {
          return [];
        }
      },
      emit: (event: string, ...args: any[]) => this.emit(event as any, args[0]),
    });
    this.heartbeat.start();

    // Notify agents when their file locks expire
    this.lockRegistry.on('lock:expired', ({ filePath, agentId }: { filePath: string; agentId: string }) => {
      const agent = this.agents.get(agentId);
      if (agent && (agent.status === 'running' || agent.status === 'idle')) {
        agent.sendMessage(`[System] Your file lock on "${filePath}" has expired and was released. Re-acquire it if you still need it.`);
      }
    });

    // Write .agent.md files for all roles so Copilot CLI can load them
    writeAgentFiles(this.roleRegistry.getAll());

    // Route incoming bus messages to target agents
    this.messageBus.on('message', (msg) => {
      if (msg.to === '*') return; // broadcasts handled elsewhere
      const target = this.agents.get(msg.to);
      if (target && (target.status === 'running' || target.status === 'idle')) {
        const fromAgent = this.agents.get(msg.from);
        const fromLabel = fromAgent ? `${fromAgent.role.name} (${msg.from.slice(0, 8)})` : msg.from.slice(0, 8);
        logger.info({ module: 'comms', msg: 'Delivering message', targetAgentId: msg.to, targetRole: target.role.name, fromAgentId: msg.from, contentPreview: msg.content.slice(0, 80) });
        target.sendMessage(`[Message from ${fromLabel}]: ${msg.content}`);
      } else {
        logger.warn({ module: 'comms', msg: 'Delivery failed — target not found/running', targetAgentId: msg.to });
      }
    });
  }

  setProjectRegistry(registry: import('../projects/ProjectRegistry.js').ProjectRegistry): void {
    this.projectRegistry = registry;
    this.dispatcher.setProjectRegistry(registry);
  }

  setSessionKnowledgeExtractor(extractor: SessionKnowledgeExtractor): void {
    this.sessionKnowledgeExtractor = extractor;
  }

  setSkillsLoader(loader: SkillsLoader): void {
    this.skillsLoader = loader;
  }

  setCollectiveMemory(memory: CollectiveMemory): void {
    this.collectiveMemory = memory;
  }

  setConfigStore(store: import('../config/ConfigStore.js').ConfigStore): void {
    this.configStore = store;

    // Listen for oversight level changes and propagate prompt instructions to all running agents
    store.on('config:oversight:changed', ({ config: oversightConfig }: { config: { level: string; customInstructions?: string } }) => {
      const level = oversightConfig.level;
      const tierInstructions = OVERSIGHT_TIER_INSTRUCTIONS[level] ?? '';

      for (const agent of this.agents.values()) {
        if (isTerminalStatus(agent.status)) continue;

        // Skip agents with project-level oversight override
        if (agent.projectId && this.projectRegistry) {
          const projectOverride = this.projectRegistry.getOversightLevel(agent.projectId);
          if (projectOverride) continue;
        }

        // Send system message with new oversight instructions (prompt-only)
        const parts: string[] = [];
        if (tierInstructions) parts.push(tierInstructions);
        const custom = oversightConfig.customInstructions ?? '';
        if (custom) parts.push(`Additional user instructions: ${custom}`);
        if (parts.length > 0) {
          const msg = `[Oversight level changed to "${level}"]\n\n<oversight_instructions>\n${parts.join('\n\n')}\n</oversight_instructions>`;
          agent.sendMessage(msg);
        }
      }

      logger.info({
        module: 'agent-manager',
        msg: 'Oversight level changed — sent new instructions to all running agents',
        level,
        agentCount: [...this.agents.values()].filter(a => !isTerminalStatus(a.status)).length,
      });

      this.emit('oversight:changed' as any, { level });
    });
  }

  /** Late-inject ProviderManager so lead prompt and QUERY_PROVIDERS can include enabled providers. */
  setProviderManager(pm: import('../providers/ProviderManager.js').ProviderManager): void {
    this.providerManager = pm;
    this.dispatcher.setProviderManager(pm);
  }

  /** Late-inject IntegrationRouter to break circular dependency. */
  setIntegrationRouter(router: import('../integrations/IntegrationRouter.js').IntegrationRouter): void {
    this.dispatcher.setIntegrationRouter(router);
  }

  /** Resolve the effective oversight level for an agent: project override → global config → default. */
  private getEffectiveOversightLevel(projectId?: string): string {
    let level = 'autonomous';
    if (this.configStore) {
      level = this.configStore.current.oversight.level;
    }
    if (projectId && this.projectRegistry) {
      const override = this.projectRegistry.getOversightLevel(projectId);
      if (override) level = override;
    }
    return level;
  }

  /**
   * Resolve the effective model for a role based on project model config.
   *
   * Priority:
   *   1. If the requested model is in the allowed list → use it
   *   2. If the requested model is NOT in the allowed list → fall back to role default, log warning
   *   3. If no model requested → use the first allowed model from project config (role default)
   *   4. If no project config or no restrictions for role → return requestedModel unchanged
   */
  resolveModelForRole(roleId: string, requestedModel: string | undefined, projectId: string | undefined): { model: string; overridden: boolean; reason?: string } {
    if (!projectId || !this.projectRegistry) {
      return { model: requestedModel || DEFAULT_MODEL, overridden: false };
    }

    const { config } = this.projectRegistry.getModelConfig(projectId);
    const allowedModels = config[roleId];

    if (!allowedModels || allowedModels.length === 0) {
      return { model: requestedModel || DEFAULT_MODEL, overridden: false };
    }

    const roleDefault = allowedModels[0];

    if (!requestedModel) {
      return { model: roleDefault, overridden: false, reason: `Using project default model for role "${roleId}"` };
    }

    if (allowedModels.includes(requestedModel)) {
      return { model: requestedModel, overridden: false };
    }

    // Requested model is not in the allowed list — enforce config
    return {
      model: roleDefault,
      overridden: true,
      reason: `Model "${requestedModel}" is not in the allowed list for role "${roleId}". Using "${roleDefault}" instead. Allowed: [${allowedModels.join(', ')}]`,
    };
  }

  spawn(role: Role, task?: string, parentId?: string, model?: string, cwd?: string, resumeSessionId?: string, id?: string, options?: { projectName?: string; projectId?: string; provider?: string }): Agent {
    if (this.getRunningCount() >= this.maxConcurrent) {
      logger.error({ module: 'agent', msg: 'Concurrency limit reached', maxConcurrent: this.maxConcurrent, role: role.id });
      throw new Error(
        `Concurrency limit reached (${this.maxConcurrent}). Terminate an agent or increase the limit.`,
      );
    }

    // Enforce provider enabled state
    if (options?.provider && this.providerManager) {
      if (!this.providerManager.isProviderEnabled(options.provider as import('../adapters/presets.js').ProviderId)) {
        throw new Error(
          `Provider '${options.provider}' is disabled. Enable it in Settings or choose a different provider.`,
        );
      }
    }

    // Determine the project scope for this agent:
    // - explicit projectId from options
    // - inherited from parent
    // - undefined (no project scope)
    const effectiveProjectId = options?.projectId
      ?? (parentId ? this.getProjectIdForAgent(parentId) : undefined);

    // Enforce project model config: resolve the effective model for this role
    const modelResolution = this.resolveModelForRole(role.id, model, effectiveProjectId);
    const effectiveModel = modelResolution.model;
    if (modelResolution.overridden && modelResolution.reason) {
      logger.warn({ module: 'config', msg: modelResolution.reason! });
    } else if (modelResolution.reason) {
      logger.info({ module: 'config', msg: modelResolution.reason! });
    }

    // Filter initial peer list to same project to prevent cross-project visibility
    const allAgents = effectiveProjectId
      ? this.getByProject(effectiveProjectId)
      : this.getAll();
    const peers: AgentContextInfo[] = allAgents.map((a) => ({
      id: a.id,
      role: a.role.id,
      roleName: a.role.name,
      status: a.status,
      task: a.task,
      lockedFiles: [],
      model: a.model,
      parentId: a.parentId,
      isSystemAgent: a.isSystemAgent || undefined,
    }));

    // For lead agents, inject dynamic role list (including custom roles) before creating
    let effectiveRole = role;
    if (role.id === 'lead') {
      const roleList = this.roleRegistry.generateRoleList();
      const prompt = role.systemPrompt.replace('{{ROLE_LIST}}', roleList);
      effectiveRole = { ...role, systemPrompt: prompt };
    }

    // Inject relevant project knowledge into the agent's system prompt
    if (this.knowledgeInjector && effectiveProjectId) {
      const injectionCtx: InjectionContext = {
        task: task || undefined,
        role: role.id,
      };
      const injection = this.knowledgeInjector.injectKnowledge(effectiveProjectId, injectionCtx);
      if (injection.text) {
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n${injection.text}`,
        };
        logger.info({
          module: 'knowledge',
          msg: 'Injected project knowledge into agent prompt',
          projectId: effectiveProjectId,
          role: role.id,
          entriesIncluded: injection.entriesIncluded,
          totalTokens: injection.totalTokens,
        });
      }
    }

    // Inject .github/skills/ content into the agent's system prompt
    if (this.skillsLoader) {
      const skillsBlock = this.skillsLoader.formatForInjection();
      if (skillsBlock) {
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n${skillsBlock}`,
        };
        logger.info({
          module: 'knowledge',
          msg: 'Injected skills into agent prompt',
          role: role.id,
          skillCount: this.skillsLoader.count,
        });
      }
    }

    // Recall collective memories (cross-session patterns, decisions, gotchas)
    if (this.collectiveMemory && effectiveProjectId) {
      const categories: MemoryCategory[] = ['pattern', 'decision', 'gotcha'];
      const memories = categories.flatMap((cat) =>
        this.collectiveMemory!.recall(cat, undefined, effectiveProjectId),
      );
      if (memories.length > 0) {
        const memoriesBlock = memories
          .slice(0, 20) // cap to avoid prompt bloat
          .map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
          .join('\n');
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n<collective_memory>\n${memoriesBlock}\n</collective_memory>`,
        };
        logger.info({
          module: 'knowledge',
          msg: 'Injected collective memories into agent prompt',
          projectId: effectiveProjectId,
          role: role.id,
          memoriesIncluded: Math.min(memories.length, 20),
        });
      }
    }

    // Inject oversight tier behavioral instructions into agent prompt
    const effectiveOversightLevel = this.getEffectiveOversightLevel(effectiveProjectId);

    if (this.configStore) {
      const oversightConfig = this.configStore.current.oversight;
      const tierInstructions = OVERSIGHT_TIER_INSTRUCTIONS[effectiveOversightLevel] ?? '';
      const customInstructions = oversightConfig.customInstructions ?? '';
      const parts: string[] = [];
      if (tierInstructions) parts.push(tierInstructions);
      if (customInstructions) parts.push(`Additional user instructions: ${customInstructions}`);
      if (parts.length > 0) {
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n<oversight_instructions>\n${parts.join('\n\n')}\n</oversight_instructions>`,
        };
      }
    }

    const agent = new Agent(effectiveRole, this.config, task, parentId, peers, id);
    agent.model = effectiveModel;
    if (cwd) agent.cwd = cwd;
    if (resumeSessionId) agent.resumeSessionId = resumeSessionId;
    if (resumeSessionId) agent._isResuming = true;
    if (options?.projectName) agent.projectName = options.projectName;
    if (options?.projectId) agent.projectId = options.projectId;
    if (options?.provider) agent.provider = options.provider;
    if (role.id === 'lead') {
      agent.budget = { maxConcurrent: this.maxConcurrent, runningCount: this.getRunningCount() + 1 };
    }
    if (this._systemPaused) {
      agent.systemPaused = true;
    }
    if (this.messageQueueStore) {
      agent.setMessageQueueStore(this.messageQueueStore);
    }

    // Track parent-child relationship (deduplicate for restart with same ID)
    if (parentId) {
      const parent = this.agents.get(parentId);
      if (parent && !parent.childIds.includes(agent.id)) {
        parent.childIds.push(agent.id);
      }
      // Inherit projectId from parent if not explicitly set
      if (!agent.projectId && parent) {
        const parentProjectId = this.getProjectIdForAgent(parentId);
        if (parentProjectId) {
          agent.projectId = parentProjectId;
        }
      }
    }

    // Ensure root agents (no parent) always have a projectId.
    // This prevents "untitled project" scenarios where activities are logged
    // with projectId: '' and become invisible to scoped queries.
    if (!parentId && !agent.projectId) {
      agent.projectId = generateProjectId(agent.task || 'untitled');
      logger.warn({ module: 'agent', msg: 'Root agent spawned without projectId', generatedProjectId: agent.projectId });
    }

    // Compute organized artifact storage path
    const artifactProjectId = agent.projectId || '_unscoped';
    const leadId = agent.role.id === 'lead' ? agent.id : (agent.parentId || 'unknown');
    agent.artifactDir = join(
      homedir(), '.flightdeck', 'artifacts', artifactProjectId,
      'sessions', leadId, `${agent.role.id}-${agent.id.slice(0, 8)}`,
    );

    this.agents.set(agent.id, agent);

    // Persist agent to roster DB for crash recovery
    if (this.agentRosterRepository) {
      try {
        // teamId = root lead ID so all agents in a crew share the same team
        const teamId = this.getRootLeadId(agent.id);
        this.agentRosterRepository.upsertAgent(
          agent.id, role.id, effectiveModel, 'idle',
          undefined, agent.projectId,
          parentId ? { parentId } : undefined,
          teamId,
          agent.provider,
        );
      } catch (err: any) {
        logger.warn({ module: 'agent', msg: 'Failed to persist agent to roster', agentId: agent.id, error: err.message });
      }
    }

    // Create a conversation thread for this agent (for persistent message history)
    if (this.conversationStore) {
      const thread = this.conversationStore.createThread(agent.id, agent.task);
      this.agentThreads.set(agent.id, thread.id);
    }

    // Listen for data to detect sub-agent spawn requests and coordination commands
    agent.onData((data) => {
      runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
        this.emit('agent:text', { agentId: agent.id, text: data });
        this.bufferAgentMessage(agent.id, data);
        this.dispatcher.appendToBuffer(agent.id, data);
        this.dispatcher.scanBuffer(agent);
      });
    });

    agent.onToolCall((info) => {
      runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
        this.emit('agent:tool_call', { agentId: agent.id, toolCall: info });
      });
    });

    agent.onResponseStart(() => {
      this.emit('agent:response_start', { agentId: agent.id });
    });

    agent.onContent((content) => {
      this.emit('agent:content', { agentId: agent.id, content });
    });

    agent.onThinking((text) => {
      this.emit('agent:thinking', { agentId: agent.id, text });
    });

    agent.onPlan((entries) => {
      this.emit('agent:plan', { agentId: agent.id, plan: entries });
      // Persist plan to SQLite
      if (this.db) {
        this.db.drizzle
          .insert(agentPlans)
          .values({
            agentId: agent.id,
            leadId: agent.parentId || null,
            planJson: JSON.stringify(entries),
          })
          .onConflictDoUpdate({
            target: agentPlans.agentId,
            set: {
              planJson: JSON.stringify(entries),
              updatedAt: new Date().toISOString(),
            },
          })
          .run();
      }
    });

    // When an agent's session is established, broadcast session ID
    agent.onSessionReady((sessionId) => {
      this.emit('agent:session_ready', { agentId: agent.id, sessionId });

      // Track session ID for project persistence
      if (agent.role.id === 'lead' && !agent.parentId && agent.projectId && this.projectRegistry) {
        this.projectRegistry.setSessionId(agent.id, sessionId);
      }

      // Also report to parent lead so it can resume this agent later
      if (agent.parentId) {
        this.agentMemory.store(agent.parentId, agent.id, 'sessionId', sessionId);
        // Suppress notification during resume — the lead already knows about this agent.
        if (!agent._isResuming) {
          const parent = this.agents.get(agent.parentId);
          if (parent && (parent.status === 'running' || parent.status === 'idle')) {
            const msg = `[System] ${agent.role.name} (${agent.id.slice(0, 8)}) session ready: ${sessionId}`;
            parent.sendMessage(msg);
            this.emit('agent:message_sent', {
              from: agent.id,
              fromRole: agent.role.name,
              to: parent.id,
              toRole: parent.role.name,
              content: msg,
            });
          }
        }
      }
    });

    agent.onSessionResumeFailed((info) => {
      this.emit('agent:session_resume_failed', { agentId: agent.id, ...info });
    });

    agent.onContextCompacted((info) => {
      logger.info({ module: 'agent', msg: 'Context compacted', percentDrop: info.percentDrop });
      this.emit('agent:context_compacted', { agentId: agent.id, ...info });

      // Re-inject artifact directory path — survives context compression as belt-and-suspenders
      if (agent.artifactDir) {
        agent.sendMessage(`[System] Your artifact storage directory: ${agent.artifactDir}`);
      }
    });

    // Wire cost tracking: attribute token usage to the agent's current dagTaskId
    if (this.costTracker) {
      const tracker = this.costTracker;
      agent.onUsage(({ agentId, inputTokens, outputTokens, dagTaskId, cacheReadTokens, cacheWriteTokens, costUsd, contextWindowUsed, contextWindowSize }) => {
        if (dagTaskId && agent.parentId) {
          tracker.recordUsage(agentId, dagTaskId, agent.parentId, inputTokens, outputTokens, {
            cacheReadTokens, cacheWriteTokens, costUsd,
          });
        }
        this.emit('agent:usage', { agentId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, contextWindowUsed, contextWindowSize });
      });
    } else {
      agent.onUsage((info) => {
        this.emit('agent:usage', info);
      });
    }

    agent.onStatus((status) => {
      runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
        this.emit('agent:status', { agentId: agent.id, status });
        this.activityLedger.log(agent.id, agent.role.id, 'status_change', `Status: ${status}`, {}, this.getProjectIdForAgent(agent.id) ?? '');
        if (status === 'idle' || isTerminalStatus(status)) {
          this.flushAgentMessage(agent.id);
        }

        // Persist status to roster DB
        if (this.agentRosterRepository) {
          const rosterStatus = status === 'running' ? 'running' : status === 'idle' ? 'idle' : undefined;
          if (rosterStatus) {
            try { this.agentRosterRepository.updateStatus(agent.id, rosterStatus); } catch { /* non-critical */ }
          }
        }

        if (agent.role.id === 'lead') {
          if (status === 'idle') {
            this.heartbeat.trackIdle(agent.id);
          } else if (status === 'running') {
            this.heartbeat.trackActive(agent.id);
          }
        }

        if (status === 'idle' && agent.parentId && !agent._isResuming) {
          this.dispatcher.notifyParentOfIdle(agent);
        }
      });
    });

    agent.onExit((code) => {
      runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
      this.flushAgentMessage(agent.id);
      this.dispatcher.clearBuffer(agent.id);
      logger.info({ module: 'agent', msg: 'Agent exited', exitCode: code, role: agent.role.id, status: agent.status });

      // Release any file locks held by the exiting agent
      const releasedCount = this.lockRegistry.releaseAll(agent.id);
      if (releasedCount > 0) {
        logger.info({ module: 'files', msg: 'Auto-released locks for exiting agent', count: releasedCount });
      }

      // Clear any pending timers for the exiting agent
      if (this.timerRegistry) this.timerRegistry.clearAgent(agent.id);

      // G-1: Fail running DAG tasks when agent exits with error.
      // Without this, crashed agents leave tasks stuck in 'running' forever,
      // blocking dependents and showing 0% progress on the Home page.
      if (agent.parentId && code !== 0) {
        const reason = agent.exitError
          ? `Agent crashed: ${agent.exitError}`
          : `Agent exited with code ${code}`;
        this.failDagTaskForAgent(agent.parentId, agent.id, reason);
      }

      // Clean up parent-child reference
      if (agent.parentId) {
        const parent = this.agents.get(agent.parentId);
        if (parent) {
          parent.childIds = parent.childIds.filter(cid => cid !== agent.id);
        }
      }

      // Clean up heartbeat tracking for leads
      if (agent.role.id === 'lead') {
        this.heartbeat.trackRemoved(agent.id);
      }

      this.emit('agent:exit', { agentId: agent.id, code, error: agent.exitError });

      // Notify parent agent of child completion
      this.dispatcher.notifyParentOfCompletion(agent, code);

      // Track project session end for lead agents
      if (agent.role.id === 'lead' && !agent.parentId && agent.projectId && this.projectRegistry) {
        const status = (code !== null && code !== 0) ? 'crashed' : 'completed';
        this.projectRegistry.endSession(agent.id, status);
        logger.info({ module: 'project', msg: 'Session ended', status });
      }

      // Extract knowledge from completed sessions (all agents, not just leads)
      if (this.sessionKnowledgeExtractor && agent.projectId) {
        this.extractSessionKnowledge(agent);
      }

      // Clean up dedup tracking after a delay
      setTimeout(() => {
        this.dispatcher.clearCompletionTracking(agent.id);
      }, 10000);

      // Schedule removal from Map and dispose after grace period
      setTimeout(() => {
        this.agents.delete(agent.id);
        agent.dispose();
      }, 30_000);

      if (code !== null && code !== 0 && !isTerminalStatus(agent.status)) {
        const agentRole = agent.role?.id ?? 'unknown';
        const crashKey = `${agentRole}:${agent.task ?? ''}`;

        logger.error({ module: 'agent', msg: 'Agent crashed', exitCode: code, crashKey });
        this.activityLedger.log(agent.id, agentRole, 'error', `Agent crashed with exit code ${code}`, {}, this.getProjectIdForAgent(agent.id) ?? '');
        this.emit('agent:crashed', { agentId: agent.id, code });

        const count = (this.crashCounts.get(crashKey) ?? 0) + 1;
        this.crashCounts.set(crashKey, count);

        if (this.autoRestart && count < this.maxRestarts) {
          logger.warn({ module: 'agent', msg: 'Auto-restarting agent', attempt: count + 1, maxRestarts: this.maxRestarts });
          setTimeout(() => {
            try {
              // Verify parent is still alive before restarting
              if (agent.parentId) {
                const parent = this.agents.get(agent.parentId);
                if (!parent || isTerminalStatus(parent.status)) {
                  logger.warn({ module: 'agent', msg: 'Skipping auto-restart — parent no longer active', parentAgentId: agent.parentId });
                  return;
                }
              }
              const newAgent = this.spawn(agent.role, agent.task, agent.parentId, agent.model || undefined, agent.cwd, agent.sessionId || undefined, agent.id, { projectName: agent.projectName, projectId: agent.projectId });
              this.emit('agent:auto_restarted', { agentId: newAgent.id, crashCount: count });
            } catch (err) {
              logger.error({ module: 'agent', msg: 'Auto-restart failed', err: (err as Error).message });
            }
          }, 2000);
        } else if (count >= this.maxRestarts) {
          logger.error({ module: 'agent', msg: 'Restart limit reached', maxRestarts: this.maxRestarts });
          this.emit('agent:restart_limit', { agentId: agent.id });
        }
      } else {
        // Clear crash count on successful exit
        const crashKey = `${agent.role?.id ?? 'unknown'}:${agent.task ?? ''}`;
        this.crashCounts.delete(crashKey);
      }
      });
    });

    // Helper: post-start actions (emit events after cwd is set)
    const postSpawn = () => {
      logger.info({ module: 'agent', msg: 'Agent spawned', role: role.name, parentAgentId: parentId, task });
      this.emit('agent:spawned', agent.toJSON());
      this.updateLeadBudgets();
      // Auto-add to groups with matching role criteria (B4: group auto-add)
      if (parentId) {
        this.autoAddToRoleGroups(agent);
      }
    };

    // Helper: start the agent via local ACP adapter
    const startAgent = () => {
      agent.start();
    };

    // Create isolated worktree if manager is available (async — delays agent.start)
    if (this.worktreeManager && !cwd) {
      this.worktreeManager.create(agent.id)
        .then(worktreePath => {
          agent.cwd = worktreePath;
          logger.info({ module: 'files', msg: 'Using worktree', worktreePath });
        })
        .catch(err => {
          logger.warn({ module: 'files', msg: 'Worktree creation failed, using shared cwd', err: err.message });
        })
        .finally(() => {
          startAgent();
          postSpawn();
        });
    } else {
      startAgent();
      postSpawn();
    }

    return agent;
  }

  async terminate(id: string, visited: Set<string> = new Set()): Promise<boolean> {
    if (visited.has(id)) return false;
    visited.add(id);

    const agent = this.agents.get(id);
    if (!agent) return false;
    this.dispatcher.clearBuffer(id);

    // Release any file locks held by the terminated agent
    const releasedCount = this.lockRegistry.releaseAll(id);
    if (releasedCount > 0) {
      logger.info({ module: 'files', msg: 'Auto-released locks for terminated agent', targetAgentId: id, count: releasedCount });
    }

    // Fail running DAG tasks assigned to this agent.
    // Runs unconditionally (no exit code check) because explicit termination
    // always means the agent can't finish its work — unlike onExit which only
    // fails tasks on non-zero exit codes to allow clean completions.
    let dagTaskFailed = false;
    if (agent.parentId) {
      dagTaskFailed = this.failDagTaskForAgent(agent.parentId, id, 'Agent terminated');
    }

    // Cascade: terminate orphaned children recursively
    for (const childId of [...agent.childIds]) {
      const child = this.agents.get(childId);
      if (child && !isTerminalStatus(child.status)) {
        logger.info({ module: 'agent', msg: 'Cascade-terminating orphaned child', childAgentId: childId, childRole: child.role.name });
        await this.terminate(childId, visited);
      }
    }

    // Clean up delegation records for this agent
    this.dispatcher.completeDelegationsForAgent(id);

    // Notify parent of completion — skip if failDagTaskForAgent already
    // notified the parent to avoid double-messaging about the same termination.
    if (!dagTaskFailed) {
      this.dispatcher.notifyParentOfCompletion(agent, -1);
    }
    if (agent.parentId) {
      const parent = this.agents.get(agent.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(cid => cid !== id);
      }
    }

    await agent.terminate();
    this.emit('agent:terminated', id);

    // Persist terminated status to roster DB
    if (this.agentRosterRepository) {
      try { this.agentRosterRepository.updateStatus(id, 'terminated'); } catch { /* non-critical */ }
    }

    // Clean up agent timers
    if (this.timerRegistry) this.timerRegistry.clearAgent(id);

    // Clean up acquired capabilities
    if (this.capabilityInjector) this.capabilityInjector.clearAgent(id);

    // Merge worktree back and clean up (async, fire-and-forget)
    // Skip during shutdown — cleanupAll() handles bulk cleanup without merging
    if (this.worktreeManager?.getWorktree(id) && !this._shuttingDown) {
      this.worktreeManager.merge(id)
        .then(result => {
          if (!result.ok) {
            logger.warn({ module: 'files', msg: 'Worktree merge failed', targetAgentId: id, conflicts: result.conflicts });
          }
        })
        .finally(() => {
          this.worktreeManager!.cleanup(id).catch(err => {
            logger.warn({ module: 'files', msg: 'Worktree cleanup failed', targetAgentId: id, err: err.message });
          });
        });
    }

    // Clean up heartbeat tracking
    this.heartbeat.trackRemoved(id);

    // Schedule removal from Map after a grace period for event consumers
    setTimeout(() => {
      this.agents.delete(id);
      agent.dispose();
    }, 30_000);

    this.updateLeadBudgets();
    return true;
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  /** Return only agents belonging to a specific project */
  getByProject(projectId: string): Agent[] {
    return this.getAll().filter(a => this.getProjectIdForAgent(a.id) === projectId);
  }

  /** Resolve the projectId for a given agent, walking up the parent chain if needed */
  getProjectIdForAgent(agentId: string): string | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;
    if (agent.projectId) return agent.projectId;
    if (agent.parentId) {
      return this.getProjectIdForAgent(agent.parentId);
    }
    return undefined;
  }

  /** Walk up the parent chain to find the root lead agent's ID. */
  private getRootLeadId(agentId: string, visited = new Set<string>()): string {
    if (visited.has(agentId)) return agentId;
    visited.add(agentId);
    const agent = this.agents.get(agentId);
    if (!agent || !agent.parentId) return agentId;
    return this.getRootLeadId(agent.parentId, visited);
  }

  /** Auto-spawn a Secretary agent as a child of the given lead. Returns the secretary or null. */
  autoSpawnSecretary(leadAgent: Agent): Agent | null {
    // Only for root leads (sub-leads don't get auto-secretary)
    if (leadAgent.parentId) return null;

    // Skip if lead already has a secretary
    const existing = this.getAll().find(a =>
      a.parentId === leadAgent.id &&
      a.role.id === 'secretary' &&
      a.status !== 'terminated' && a.status !== 'failed' && a.status !== 'completed'
    );
    if (existing) return existing;

    const secretaryRole = this.roleRegistry.get('secretary');
    if (!secretaryRole) return null;

    try {
      // autoSpawnSecretary is a fallback for fresh starts only — resume is handled
      // by the team respawn path in projects.ts which includes all crew members.
      const secretary = this.spawn(
        secretaryRole,
        'You are the auto-created project secretary. Track DAG progress, provide status reports when asked, and assist with dependency inference for auto-DAG tasks.',
        leadAgent.id,
        'gpt-4.1',
        leadAgent.cwd,
        undefined,
        undefined,
        { projectName: leadAgent.projectName, projectId: leadAgent.projectId },
      );
      secretary.isSystemAgent = true;
      logger.info({ module: 'agent', msg: 'Auto-spawned secretary', secretaryId: secretary.id, leadAgentId: leadAgent.id });
      return secretary;
    } catch (err: any) {
      logger.warn({ module: 'agent', msg: 'Failed to auto-spawn secretary', err: err.message });
      setTimeout(() => {
        leadAgent.sendMessage(`[System] Auto-secretary spawn failed: ${err.message}. You can manually create one with CREATE_AGENT.`);
      }, 2000);
      return null;
    }
  }

  /** Count agents that are alive (running, idle, or creating) — used for concurrency limit */
  getRunningCount(): number {
    return this.getAll().filter((a) => a.status === 'running' || a.status === 'creating' || a.status === 'idle').length;
  }

  /** Count alive agents belonging to a specific project */
  getRunningCountByProject(projectId: string): number {
    return this.getByProject(projectId).filter(
      (a) => a.status === 'running' || a.status === 'creating' || a.status === 'idle',
    ).length;
  }

  async restart(id: string): Promise<Agent | null> {
    const agent = this.agents.get(id);
    if (!agent) return null;
    const { role, task, sessionId, parentId, model, cwd, projectName, projectId } = agent;
    await agent.terminate();
    this.agents.delete(id);
    // Re-spawn with same ID and resume the session if available
    const newAgent = this.spawn(role, task, parentId, model || undefined, cwd, sessionId || undefined, id, { projectName, projectId });
    this.emit('agent:restarted', { oldId: id, newAgent: newAgent.toJSON() });
    return newAgent;
  }

  setMaxConcurrent(n: number): void {
    const old = this.maxConcurrent;
    this.maxConcurrent = n;
    // Keep dispatcher context in sync
    (this.dispatcher as any).handlerCtx.maxConcurrent = n;
    if (n !== old) {
      // Notify all running leads about the change
      const running = this.getRunningCount();
      const available = Math.max(0, n - running);
      for (const agent of this.getAll()) {
        if (agent.role.id === 'lead' && (agent.status === 'running' || agent.status === 'idle')) {
          agent.budget = { maxConcurrent: n, runningCount: running };
          agent.sendMessage(`[System] Agent concurrency limit changed: ${old} → ${n}. You now have ${available} available slot(s) (${running} running).`);
        }
      }
    }
  }

  getRoleRegistry(): RoleRegistry {
    return this.roleRegistry;
  }

  setAutoRestart(enabled: boolean): void {
    this.autoRestart = enabled;
  }

  /** Pause the entire system — halt message delivery, notify agents */
  pauseSystem(): void {
    if (this._systemPaused) return;
    this._systemPaused = true;
    for (const agent of this.agents.values()) {
      agent.systemPaused = true;
      // Notify running/idle agents that the system is paused
      if (agent.status === 'running' || agent.status === 'idle') {
        agent.queueMessage('[System] ⏸️ The system has been paused by the user. Hold your current position — do not start new work or delegate tasks until resumed.');
      }
    }
    this.emit('system:paused', { paused: true });
    logger.info({ module: 'agent', msg: 'System paused by user' });
  }

  /** Resume the system — deliver queued messages, notify agents */
  resumeSystem(): void {
    if (!this._systemPaused) return;
    this._systemPaused = false;
    for (const agent of this.agents.values()) {
      agent.systemPaused = false;
      // Notify running/idle agents that the system has resumed
      if (agent.status === 'running' || agent.status === 'idle') {
        agent.queueMessage('[System] ▶️ The system has been resumed. You may continue your work.');
      }
    }
    this.emit('system:paused', { paused: false });
    logger.info({ module: 'agent', msg: 'System resumed by user' });
    // Drain pending messages on all idle agents
    for (const agent of this.agents.values()) {
      if (agent.status === 'idle' || agent.status === 'running') {
        agent.drainPendingMessages();
      }
    }
  }

  get isSystemPaused(): boolean {
    return this._systemPaused;
  }

  setMaxRestarts(n: number): void {
    this.maxRestarts = n;
  }

  async shutdownAll(): Promise<void> {
    this._shuttingDown = true;
    this.heartbeat.stop();
    const active = [...this.agents.values()]
      .filter(agent => !isTerminalStatus(agent.status));
    logger.info({ module: 'agent', msg: `Terminating ${active.length} active agent(s)...` });
    const results = await Promise.allSettled(active.map(agent => agent.terminate()));
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn({ module: 'agent', msg: `${failed.length} agent(s) failed to terminate cleanly` });
    }
    // Clean up all worktrees (async, best-effort)
    // Individual terminate() calls skip merge when _shuttingDown is true
    this.worktreeManager?.cleanupAll().catch(err => {
      logger.warn({ module: 'files', msg: 'Shutdown worktree cleanup failed', err: err.message });
    });
  }

  getDelegations(parentId?: string): import('./CommandDispatcher.js').Delegation[] {
    return this.dispatcher.getDelegations(parentId);
  }

  /** Remove completed/failed delegations older than the given age */
  cleanupStaleDelegations(maxAgeMs?: number): number {
    return this.dispatcher.cleanupStaleDelegations(maxAgeMs);
  }

  getDecisionLog(): DecisionLog {
    return this.decisionLog;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getChatGroupRegistry(): ChatGroupRegistry {
    return this.chatGroupRegistry;
  }

  getTaskDAG(): TaskDAG {
    return this.taskDAG;
  }

  getCostTracker(): CostTracker | undefined {
    return this.costTracker;
  }

  getTimerRegistry(): TimerRegistry {
    return this.timerRegistry;
  }

  /** Persist a human message to the agent's conversation history */
  persistHumanMessage(agentId: string, text: string): void {
    this.flushAgentMessage(agentId); // flush any buffered agent text first
    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'user', text);
    }
  }

  /** Mark a lead as human-interrupted so the heartbeat won't nudge it */
  markHumanInterrupt(agentId: string): void {
    this.heartbeat.trackHumanInterrupt(agentId);
  }

  /** Get and remove a pending system action by decision ID (for confirm/reject handling) */
  consumePendingSystemAction(decisionId: string): { type: string; value: number; agentId: string } | undefined {
    return this.dispatcher.consumePendingSystemAction(decisionId);
  }

  /** Persist a system message to the agent's conversation history */
  persistSystemMessage(agentId: string, text: string): void {
    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'system', text);
    }
  }

  /** Get recent messages from an agent's conversation history */
  getMessageHistory(agentId: string, limit = 200): import('../db/ConversationStore.js').ThreadMessage[] {
    if (!this.conversationStore) return [];
    this.flushAgentMessage(agentId); // flush pending buffer before reading
    return this.conversationStore.getRecentMessages(agentId, limit).reverse(); // chronological order
  }

  /**
   * Fail running DAG task assigned to an agent and notify the parent lead.
   * Shared by both onExit (crash path) and terminate (explicit kill path).
   * Returns true if a task was actually failed (used to skip redundant notifications).
   */
  private failDagTaskForAgent(leadId: string, agentId: string, reason: string): boolean {
    const dagTask = this.taskDAG.getTaskByAgent(leadId, agentId);
    if (!dagTask || dagTask.dagStatus !== 'running') return false;

    this.taskDAG.failTask(leadId, dagTask.id, reason);
    logger.info({ module: 'agent', msg: 'Failed DAG task for agent', agentId, taskId: dagTask.id, reason });

    const dagParent = this.agents.get(leadId);
    if (dagParent && (dagParent.status === 'running' || dagParent.status === 'idle')) {
      dagParent.sendMessage(`[System] DAG: Task "${dagTask.id}" FAILED (${reason}). Dependents blocked. Use RETRY_TASK or SKIP_TASK.`);
    }
    return true;
  }

  /** Buffer agent output text, flushing after 2s of silence */
  private bufferAgentMessage(agentId: string, data: string): void {
    const existing = this.messageBuffers.get(agentId) || '';
    this.messageBuffers.set(agentId, existing + data);

    // Reset debounce timer
    const prev = this.flushTimers.get(agentId);
    if (prev) clearTimeout(prev);
    this.flushTimers.set(agentId, setTimeout(() => this.flushAgentMessage(agentId), 2000));
  }

  /** Flush buffered agent text to the conversation store */
  private flushAgentMessage(agentId: string): void {
    const timer = this.flushTimers.get(agentId);
    if (timer) { clearTimeout(timer); this.flushTimers.delete(agentId); }

    const text = this.messageBuffers.get(agentId);
    if (!text) return;
    this.messageBuffers.delete(agentId);

    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'agent', text);
    }
  }

  /** Flush all buffered agent messages (e.g. on new client connection) */
  flushAllMessages(): void {
    for (const agentId of this.messageBuffers.keys()) {
      this.flushAgentMessage(agentId);
    }
  }

  /**
   * Extract knowledge from a completed agent session and store it.
   * Gathers conversation history and builds SessionData for the extractor.
   */
  private extractSessionKnowledge(agent: Agent): void {
    if (!this.sessionKnowledgeExtractor || !agent.projectId) return;

    try {
      const messages = this.getMessageHistory(agent.id, 200);
      const sessionMessages: SessionMessage[] = messages.map((m) => ({
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
      }));

      // Skip extraction for sessions with very few messages (likely aborted)
      if (sessionMessages.length < 3) {
        logger.debug({ module: 'knowledge', msg: 'Skipping extraction — too few messages', agentId: agent.id, messageCount: sessionMessages.length });
        return;
      }

      const sessionData: SessionData = {
        sessionId: agent.sessionId || agent.id,
        projectId: agent.projectId,
        task: agent.task,
        role: agent.role.id,
        agentId: agent.id,
        messages: sessionMessages,
        completionSummary: agent.completionSummary,
        startedAt: agent.createdAt.toISOString(),
        endedAt: new Date().toISOString(),
      };

      const result = this.sessionKnowledgeExtractor.extractFromSession(sessionData);
      if (result.entriesStored > 0) {
        this.activityLedger.log(
          agent.id, agent.role.id, 'task_completed',
          `Extracted ${result.entriesStored} knowledge entries (${result.decisions.length} decisions, ${result.patterns.length} patterns, ${result.errors.length} errors)`,
          { entriesStored: result.entriesStored }, agent.projectId,
        );
      }

      // Persist extracted knowledge into collective memory for cross-session recall
      if (this.collectiveMemory) {
        const entries = [...result.decisions, ...result.patterns, ...result.errors];
        for (const entry of entries) {
          const memCat = KNOWLEDGE_TO_MEMORY_CATEGORY[entry.category] ?? 'pattern';
          this.collectiveMemory.remember(memCat, entry.key, entry.content, agent.id, agent.projectId!);
        }
        if (entries.length > 0) {
          logger.info({
            module: 'knowledge',
            msg: 'Stored entries in collective memory',
            agentId: agent.id,
            count: entries.length,
          });
        }
      }
    } catch (err) {
      logger.warn({
        module: 'knowledge',
        msg: 'Session knowledge extraction failed',
        agentId: agent.id,
        err: (err as Error).message,
      });
    }
  }

  /** Keep all agents' budget info in sync with current state */
  private updateLeadBudgets(): void {
    const running = this.getRunningCount();
    const budget = { maxConcurrent: this.maxConcurrent, runningCount: running };
    for (const agent of this.getAll()) {
      agent.budget = { ...budget };
    }
  }

  /** Auto-add a newly spawned agent to groups that have matching role criteria */
  private autoAddToRoleGroups(agent: Agent): void {
    const leadId = agent.parentId;
    if (!leadId) return;
    try {
      const roleGroups = this.chatGroupRegistry.getGroupsWithRoles(leadId);
      for (const group of roleGroups) {
        if (group.roles.some((r) => r.toLowerCase() === agent.role.id.toLowerCase())) {
          const added = this.chatGroupRegistry.addMembers(leadId, group.name, [agent.id]);
          if (added.length > 0) {
            agent.queueMessage(`[System] You've been auto-added to group "${group.name}" (matches your role "${agent.role.id}"). Send messages: ⟦⟦ GROUP_MESSAGE {"group": "${group.name}", "content": "your message"} ⟧⟧`);
            logger.info({ module: 'comms', msg: 'Auto-added agent to group via role criteria', groupName: group.name, role: agent.role.name });
          }
        }
      }
    } catch (err) {
      logger.warn({ module: 'comms', msg: 'Failed to auto-add agent to role groups', err: (err as Error).message });
    }
  }
}
