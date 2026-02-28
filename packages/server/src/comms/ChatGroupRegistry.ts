import { EventEmitter } from 'events';
import { eq, and, asc, desc } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { chatGroups, chatGroupMembers, chatGroupMessages } from '../db/schema.js';

export interface ChatGroup {
  name: string;
  leadId: string;
  projectId?: string;
  memberIds: string[];
  createdAt: string;
}

export interface GroupMessage {
  id: string;
  groupName: string;
  leadId: string;
  fromAgentId: string;
  fromRole: string;
  content: string;
  timestamp: string;
}

export class ChatGroupRegistry extends EventEmitter {
  private db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  create(leadId: string, name: string, memberIds: string[], projectId?: string): ChatGroup {
    // Ensure lead is always a member
    const allMembers = new Set([leadId, ...memberIds]);

    this.db.drizzle
      .insert(chatGroups)
      .values({ name, leadId, projectId: projectId || null })
      .onConflictDoNothing()
      .run();

    for (const memberId of allMembers) {
      this.db.drizzle
        .insert(chatGroupMembers)
        .values({ groupName: name, leadId, agentId: memberId })
        .onConflictDoNothing()
        .run();
    }

    const group: ChatGroup = {
      name,
      leadId,
      projectId: projectId || undefined,
      memberIds: Array.from(allMembers),
      createdAt: new Date().toISOString(),
    };
    this.emit('group:created', group);
    return group;
  }

  addMembers(leadId: string, name: string, memberIds: string[]): string[] {
    const added: string[] = [];
    for (const memberId of memberIds) {
      const existing = this.db.drizzle
        .select()
        .from(chatGroupMembers)
        .where(and(
          eq(chatGroupMembers.groupName, name),
          eq(chatGroupMembers.leadId, leadId),
          eq(chatGroupMembers.agentId, memberId),
        ))
        .get();
      if (!existing) {
        this.db.drizzle
          .insert(chatGroupMembers)
          .values({ groupName: name, leadId, agentId: memberId })
          .run();
        added.push(memberId);
        this.emit('group:member_added', { group: name, leadId, agentId: memberId });
      }
    }
    return added;
  }

  removeMembers(leadId: string, name: string, memberIds: string[]): string[] {
    const removed: string[] = [];
    for (const memberId of memberIds) {
      // Don't allow removing the lead
      if (memberId === leadId) continue;
      const result = this.db.drizzle
        .delete(chatGroupMembers)
        .where(and(
          eq(chatGroupMembers.groupName, name),
          eq(chatGroupMembers.leadId, leadId),
          eq(chatGroupMembers.agentId, memberId),
        ))
        .run();
      if (result.changes > 0) {
        removed.push(memberId);
        this.emit('group:member_removed', { group: name, leadId, agentId: memberId });
      }
    }
    return removed;
  }

  sendMessage(groupName: string, leadId: string, fromId: string, fromRole: string, content: string): GroupMessage | null {
    // Check membership
    const isMember = this.db.drizzle
      .select()
      .from(chatGroupMembers)
      .where(and(
        eq(chatGroupMembers.groupName, groupName),
        eq(chatGroupMembers.leadId, leadId),
        eq(chatGroupMembers.agentId, fromId),
      ))
      .get();
    if (!isMember) return null;

    const id = `gmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    this.db.drizzle
      .insert(chatGroupMessages)
      .values({ id, groupName, leadId, fromAgentId: fromId, fromRole, content, timestamp })
      .run();

    const message: GroupMessage = { id, groupName, leadId, fromAgentId: fromId, fromRole, content, timestamp };

    // Get recipient IDs (all members except sender)
    const recipients = this.getMembers(groupName, leadId).filter((m) => m !== fromId);
    this.emit('group:message', { message, recipientIds: recipients });
    return message;
  }

  getGroups(leadId: string): ChatGroup[] {
    const rows = this.db.drizzle
      .select()
      .from(chatGroups)
      .where(eq(chatGroups.leadId, leadId))
      .orderBy(asc(chatGroups.createdAt))
      .all();
    return rows.map((row) => ({
      name: row.name,
      leadId: row.leadId,
      projectId: row.projectId || undefined,
      memberIds: this.getMembers(row.name, row.leadId),
      createdAt: row.createdAt!,
    }));
  }

  getGroupsForAgent(agentId: string): ChatGroup[] {
    const rows = this.db.drizzle
      .select({
        name: chatGroups.name,
        leadId: chatGroups.leadId,
        projectId: chatGroups.projectId,
        createdAt: chatGroups.createdAt,
      })
      .from(chatGroups)
      .innerJoin(chatGroupMembers, and(
        eq(chatGroups.name, chatGroupMembers.groupName),
        eq(chatGroups.leadId, chatGroupMembers.leadId),
      ))
      .where(eq(chatGroupMembers.agentId, agentId))
      .orderBy(asc(chatGroups.createdAt))
      .all();
    return rows.map((row) => ({
      name: row.name,
      leadId: row.leadId,
      projectId: row.projectId || undefined,
      memberIds: this.getMembers(row.name, row.leadId),
      createdAt: row.createdAt!,
    }));
  }

  getMembers(groupName: string, leadId: string): string[] {
    const rows = this.db.drizzle
      .select({ agentId: chatGroupMembers.agentId })
      .from(chatGroupMembers)
      .where(and(eq(chatGroupMembers.groupName, groupName), eq(chatGroupMembers.leadId, leadId)))
      .orderBy(asc(chatGroupMembers.addedAt))
      .all();
    return rows.map((r) => r.agentId);
  }

  getMessages(groupName: string, leadId: string, limit = 50): GroupMessage[] {
    const rows = this.db.drizzle
      .select()
      .from(chatGroupMessages)
      .where(and(eq(chatGroupMessages.groupName, groupName), eq(chatGroupMessages.leadId, leadId)))
      .orderBy(desc(chatGroupMessages.timestamp))
      .limit(limit)
      .all();
    return rows.reverse().map((r) => ({
      id: r.id,
      groupName: r.groupName,
      leadId: r.leadId,
      fromAgentId: r.fromAgentId,
      fromRole: r.fromRole,
      content: r.content,
      timestamp: r.timestamp!,
    }));
  }

  isMember(groupName: string, leadId: string, agentId: string): boolean {
    return !!this.db.drizzle
      .select()
      .from(chatGroupMembers)
      .where(and(
        eq(chatGroupMembers.groupName, groupName),
        eq(chatGroupMembers.leadId, leadId),
        eq(chatGroupMembers.agentId, agentId),
      ))
      .get();
  }

  /** Find a group by name across all leads that a given agent belongs to */
  findGroupForAgent(groupName: string, agentId: string): ChatGroup | undefined {
    const groups = this.getGroupsForAgent(agentId);
    return groups.find((g) => g.name === groupName);
  }

  exists(name: string, leadId: string): boolean {
    return !!this.db.drizzle
      .select()
      .from(chatGroups)
      .where(and(eq(chatGroups.name, name), eq(chatGroups.leadId, leadId)))
      .get();
  }
}
