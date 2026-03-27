import type { Database } from '../../db/database.js';
import { ConversationStore, type ThreadMessage } from '../../db/ConversationStore.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages conversation persistence and message buffering for agents.
 *
 * Responsibilities:
 * - Creates conversation threads per agent
 * - Buffers streaming text/thinking output with 2s debounce
 * - Persists human, system, external, agent, and thinking messages
 * - Maintains chronological ordering via cross-flush guards
 */
export class AgentMessageService {
  private conversationStore?: ConversationStore;
  private agentThreads: Map<string, string> = new Map();
  private messageBuffers: Map<string, string> = new Map();
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private thinkingBuffers: Map<string, string> = new Map();
  private thinkingFlushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(db?: Database) {
    if (db) this.conversationStore = new ConversationStore(db);
  }

  /** Create a conversation thread for an agent */
  createThread(agentId: string, task?: string): void {
    if (!this.conversationStore) return;
    const thread = this.conversationStore.createThread(agentId, task);
    this.agentThreads.set(agentId, thread.id);
  }

  /** Persist a human message to the agent's conversation history */
  persistHumanMessage(agentId: string, text: string): void {
    this.flushThinkingMessage(agentId);
    this.flushAgentMessage(agentId);
    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'user', text);
    }
  }

  /** Persist a system message to the agent's conversation history */
  persistSystemMessage(agentId: string, text: string): void {
    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'system', text);
    }
  }

  /** Persist an external (inter-agent DM) message to the target's conversation history */
  persistExternalMessage(agentId: string, content: string, fromRole: string): void {
    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'external', content, fromRole);
    }
  }

  /** Get recent messages from an agent's conversation history */
  getMessageHistory(agentId: string, limit = 200): ThreadMessage[] {
    if (!this.conversationStore) return [];
    this.flushThinkingMessage(agentId);
    this.flushAgentMessage(agentId);
    return this.conversationStore.getRecentMessages(agentId, limit).reverse();
  }

  /** Buffer agent output text, flushing after 2s of silence */
  bufferAgentMessage(agentId: string, data: string): void {
    // Flush any pending thinking text first so messages stay chronological
    this.flushThinkingMessage(agentId);

    const existing = this.messageBuffers.get(agentId) || '';
    this.messageBuffers.set(agentId, existing + data);

    const prev = this.flushTimers.get(agentId);
    if (prev) clearTimeout(prev);
    this.flushTimers.set(agentId, setTimeout(() => this.flushAgentMessage(agentId), 2000));
  }

  /** Buffer thinking text, flushing after 2s of silence */
  bufferThinkingMessage(agentId: string, data: string): void {
    // Flush any pending agent text first so thinking and agent messages
    // are stored in chronological order
    this.flushAgentMessage(agentId);

    const existing = this.thinkingBuffers.get(agentId) || '';
    this.thinkingBuffers.set(agentId, existing + data);

    const prev = this.thinkingFlushTimers.get(agentId);
    if (prev) clearTimeout(prev);
    this.thinkingFlushTimers.set(agentId, setTimeout(() => this.flushThinkingMessage(agentId), 2000));
  }

  /** Flush buffered agent text to the conversation store */
  flushAgentMessage(agentId: string): void {
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

  /** Flush buffered thinking text to the conversation store */
  flushThinkingMessage(agentId: string): void {
    const timer = this.thinkingFlushTimers.get(agentId);
    if (timer) { clearTimeout(timer); this.thinkingFlushTimers.delete(agentId); }

    const text = this.thinkingBuffers.get(agentId);
    if (!text) return;
    this.thinkingBuffers.delete(agentId);

    const threadId = this.agentThreads.get(agentId);
    if (threadId && this.conversationStore) {
      this.conversationStore.addMessage(threadId, 'thinking', text);
    }
  }

  /** Clear all conversation history for an agent and start a fresh thread */
  clearHistory(agentId: string, task?: string): void {
    // Flush pending buffers first so nothing is lost mid-flight
    this.flushThinkingMessage(agentId);
    this.flushAgentMessage(agentId);

    if (!this.conversationStore) return;
    this.conversationStore.clearByAgent(agentId);
    // Create a fresh thread so new messages are still persisted
    const thread = this.conversationStore.createThread(agentId, task);
    this.agentThreads.set(agentId, thread.id);
  }

  /** Flush all buffered agent messages (e.g. on new client connection) */
  flushAllMessages(): void {
    for (const agentId of this.messageBuffers.keys()) {
      this.flushAgentMessage(agentId);
    }
    for (const agentId of this.thinkingBuffers.keys()) {
      this.flushThinkingMessage(agentId);
    }
  }
}
