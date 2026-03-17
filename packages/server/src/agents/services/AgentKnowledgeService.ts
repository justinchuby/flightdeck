import type { Role } from '../RoleRegistry.js';
import type { Agent } from '../Agent.js';
import type { KnowledgeInjector, InjectionContext } from '../../knowledge/KnowledgeInjector.js';
import type { SkillsLoader } from '../../knowledge/SkillsLoader.js';
import type { CollectiveMemory, MemoryCategory } from '../../coordination/knowledge/CollectiveMemory.js';
import type { SessionKnowledgeExtractor } from '../../knowledge/SessionKnowledgeExtractor.js';
import type { SessionData, SessionMessage } from '../../knowledge/types.js';
import type { ActivityLedger } from '../../coordination/activity/ActivityLedger.js';
import { KNOWLEDGE_TO_MEMORY_CATEGORY } from '../../coordination/knowledge/CollectiveMemory.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages knowledge injection into agent prompts and extraction from completed sessions.
 *
 * Responsibilities:
 * - Injects project knowledge, skills, and collective memory into system prompts
 * - Extracts decisions, patterns, and errors from completed sessions
 * - Stores extracted knowledge in collective memory for cross-session recall
 */
export class AgentKnowledgeService {
  private knowledgeInjector?: KnowledgeInjector;
  private skillsLoader?: SkillsLoader;
  private collectiveMemory?: CollectiveMemory;
  private sessionKnowledgeExtractor?: SessionKnowledgeExtractor;

  setKnowledgeInjector(injector: KnowledgeInjector): void {
    this.knowledgeInjector = injector;
  }

  setSkillsLoader(loader: SkillsLoader): void {
    this.skillsLoader = loader;
  }

  setCollectiveMemory(memory: CollectiveMemory): void {
    this.collectiveMemory = memory;
  }

  setSessionKnowledgeExtractor(extractor: SessionKnowledgeExtractor): void {
    this.sessionKnowledgeExtractor = extractor;
  }

  /**
   * Enrich an agent's role system prompt with project knowledge, skills, and memories.
   * Returns a new Role object with the enriched prompt (does not mutate the input).
   */
  enrichPrompt(role: Role, projectId: string | undefined, task: string | undefined): Role {
    let effectiveRole = role;

    // Inject project knowledge
    if (this.knowledgeInjector && projectId) {
      const injectionCtx: InjectionContext = { task: task || undefined, role: role.id };
      const injection = this.knowledgeInjector.injectKnowledge(projectId, injectionCtx);
      if (injection.text) {
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n${injection.text}`,
        };
        logger.info({
          module: 'knowledge',
          msg: 'Injected project knowledge into agent prompt',
          projectId,
          role: role.id,
          entriesIncluded: injection.entriesIncluded,
          totalTokens: injection.totalTokens,
        });
      }
    }

    // Inject .github/skills/ content
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
    if (this.collectiveMemory && projectId) {
      const categories: MemoryCategory[] = ['pattern', 'decision', 'gotcha'];
      const memories = categories.flatMap((cat) =>
        this.collectiveMemory!.recall(cat, undefined, projectId),
      );
      if (memories.length > 0) {
        const memoriesBlock = memories
          .slice(0, 20)
          .map((m) => `- [${m.category}] ${m.key}: ${m.value}`)
          .join('\n');
        effectiveRole = {
          ...effectiveRole,
          systemPrompt: `${effectiveRole.systemPrompt}\n\n<collective_memory>\n${memoriesBlock}\n</collective_memory>`,
        };
        logger.info({
          module: 'knowledge',
          msg: 'Injected collective memories into agent prompt',
          projectId,
          role: role.id,
          memoriesIncluded: Math.min(memories.length, 20),
        });
      }
    }

    return effectiveRole;
  }

  /**
   * Extract knowledge from a completed agent session and store it.
   * Gathers conversation history and builds SessionData for the extractor.
   */
  extractSessionKnowledge(
    agent: Agent,
    messageHistory: Array<{ sender: string; content: string; timestamp: string }>,
    activityLedger: ActivityLedger,
  ): void {
    if (!this.sessionKnowledgeExtractor || !agent.projectId) return;

    try {
      const sessionMessages: SessionMessage[] = messageHistory.map((m) => ({
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
        activityLedger.log(
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
}
