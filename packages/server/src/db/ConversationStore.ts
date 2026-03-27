import { v4 as uuid } from 'uuid';
import { eq, desc, asc } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { conversations, messages } from '../db/schema.js';
import { redact } from '../utils/redaction.js';

export interface ConversationThread {
  id: string;
  agentId: string;
  taskId?: string;
  createdAt: string;
}

export interface ThreadMessage {
  id: number;
  conversationId: string;
  sender: string;
  content: string;
  fromRole?: string;
  timestamp: string;
}

export class ConversationStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  createThread(agentId: string, taskId?: string): ConversationThread {
    const id = uuid();
    this.db.drizzle.insert(conversations).values({ id, agentId, taskId: taskId || null }).run();
    return { id, agentId, taskId, createdAt: new Date().toISOString() };
  }

  addMessage(conversationId: string, sender: string, content: string, fromRole?: string): ThreadMessage {
    const result = this.db.drizzle
      .insert(messages)
      .values({ conversationId, sender, content: redact(content).text, fromRole: fromRole ?? null })
      .run();
    return {
      id: Number(result.lastInsertRowid),
      conversationId,
      sender,
      content,
      fromRole,
      timestamp: new Date().toISOString(),
    };
  }

  getThreadsByAgent(agentId: string): ConversationThread[] {
    const rows = this.db.drizzle
      .select()
      .from(conversations)
      .where(eq(conversations.agentId, agentId))
      .orderBy(desc(conversations.createdAt))
      .all();
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      taskId: r.taskId ?? undefined,
      createdAt: r.createdAt!,
    }));
  }

  getMessages(conversationId: string, limit = 100): ThreadMessage[] {
    const rows = this.db.drizzle
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.timestamp))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      sender: r.sender,
      content: r.content,
      fromRole: r.fromRole ?? undefined,
      timestamp: r.timestamp!,
    }));
  }

  clearByAgent(agentId: string): number {
    const threads = this.getThreadsByAgent(agentId);
    let deleted = 0;
    for (const thread of threads) {
      const result = this.db.drizzle.delete(messages).where(eq(messages.conversationId, thread.id)).run();
      deleted += result.changes;
      this.db.drizzle.delete(conversations).where(eq(conversations.id, thread.id)).run();
    }
    return deleted;
  }

  getRecentMessages(agentId: string, limit = 50): ThreadMessage[] {
    const rows = this.db.drizzle
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        sender: messages.sender,
        content: messages.content,
        fromRole: messages.fromRole,
        timestamp: messages.timestamp,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.agentId, agentId))
      .orderBy(desc(messages.timestamp))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      sender: r.sender,
      content: r.content,
      fromRole: r.fromRole ?? undefined,
      timestamp: r.timestamp!,
    }));
  }
}
