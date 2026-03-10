import { EventEmitter } from 'events';
import { eq, and, asc, desc, count } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { chatGroups, chatGroupMembers, chatGroupMessages } from '../db/schema.js';

import type { ChatGroup, GroupMessage } from '@flightdeck/shared';
export type { ChatGroup, GroupMessage } from '@flightdeck/shared';

export class ChatGroupRegistry extends EventEmitter {
  private db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  create(leadId: string, name: string, memberIds: string[], projectId?: string, roles?: string[]): ChatGroup {
    // Ensure lead is always a member
    const allMembers = new Set([leadId, ...memberIds]);

    this.db.drizzle
      .insert(chatGroups)
      .values({ name, leadId, projectId: projectId || null, roles: roles?.length ? JSON.stringify(roles) : null })
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

    const message: GroupMessage = { id, groupName, leadId, fromAgentId: fromId, fromRole, content, reactions: {}, timestamp };

    // Get recipient IDs (all members except sender)
    const recipients = this.getMembers(groupName, leadId).filter((m) => m !== fromId);
    this.emit('group:message', { message, recipientIds: recipients });
    return message;
  }

  getGroups(leadId: string): ChatGroup[] {
    const rows = this.db.drizzle
      .select()
      .from(chatGroups)
      .where(and(eq(chatGroups.leadId, leadId), eq(chatGroups.archived, 0)))
      .orderBy(asc(chatGroups.createdAt))
      .all();
    return rows.map((row) => ({
      name: row.name,
      leadId: row.leadId,
      projectId: row.projectId || undefined,
      archived: !!row.archived,
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
        archived: chatGroups.archived,
        createdAt: chatGroups.createdAt,
      })
      .from(chatGroups)
      .innerJoin(chatGroupMembers, and(
        eq(chatGroups.name, chatGroupMembers.groupName),
        eq(chatGroups.leadId, chatGroupMembers.leadId),
      ))
      .where(and(eq(chatGroupMembers.agentId, agentId), eq(chatGroups.archived, 0)))
      .orderBy(asc(chatGroups.createdAt))
      .all();
    return rows.map((row) => ({
      name: row.name,
      leadId: row.leadId,
      projectId: row.projectId || undefined,
      archived: !!row.archived,
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
      reactions: JSON.parse(r.reactions || '{}') as Record<string, string[]>,
      timestamp: r.timestamp!,
    }));
  }

  /** Get all recent messages across all groups for a lead (single query) */
  getMessagesByLead(leadId: string, limit = 2000): GroupMessage[] {
    const rows = this.db.drizzle
      .select()
      .from(chatGroupMessages)
      .where(eq(chatGroupMessages.leadId, leadId))
      .orderBy(asc(chatGroupMessages.timestamp))
      .limit(limit)
      .all();
    return rows.map((r) => ({
      id: r.id,
      groupName: r.groupName,
      leadId: r.leadId,
      fromAgentId: r.fromAgentId,
      fromRole: r.fromRole,
      content: r.content,
      reactions: JSON.parse(r.reactions || '{}') as Record<string, string[]>,
      timestamp: r.timestamp!,
    }));
  }

  // ── Reactions ──────────────────────────────────────────────────────

  addReaction(messageId: string, agentId: string, emoji: string): boolean {
    let emitPayload: { messageId: string; groupName: string; leadId: string; agentId: string; emoji: string; action: 'add' } | null = null;

    this.db.drizzle.transaction((tx) => {
      const row = tx
        .select()
        .from(chatGroupMessages)
        .where(eq(chatGroupMessages.id, messageId))
        .get();
      if (!row) return;

      const reactions: Record<string, string[]> = JSON.parse(row.reactions || '{}');
      if (!reactions[emoji]) reactions[emoji] = [];
      if (reactions[emoji].includes(agentId)) return; // already reacted

      reactions[emoji].push(agentId);
      tx.update(chatGroupMessages)
        .set({ reactions: JSON.stringify(reactions) })
        .where(eq(chatGroupMessages.id, messageId))
        .run();

      emitPayload = { messageId, groupName: row.groupName, leadId: row.leadId, agentId, emoji, action: 'add' as const };
    });

    if (emitPayload) {
      this.emit('group:reaction', emitPayload);
      return true;
    }
    return false;
  }

  removeReaction(messageId: string, agentId: string, emoji: string): boolean {
    let emitPayload: { messageId: string; groupName: string; leadId: string; agentId: string; emoji: string; action: 'remove' } | null = null;

    this.db.drizzle.transaction((tx) => {
      const row = tx
        .select()
        .from(chatGroupMessages)
        .where(eq(chatGroupMessages.id, messageId))
        .get();
      if (!row) return;

      const reactions: Record<string, string[]> = JSON.parse(row.reactions || '{}');
      if (!reactions[emoji] || !reactions[emoji].includes(agentId)) return;

      reactions[emoji] = reactions[emoji].filter((id) => id !== agentId);
      if (reactions[emoji].length === 0) delete reactions[emoji];

      tx.update(chatGroupMessages)
        .set({ reactions: JSON.stringify(reactions) })
        .where(eq(chatGroupMessages.id, messageId))
        .run();

      emitPayload = { messageId, groupName: row.groupName, leadId: row.leadId, agentId, emoji, action: 'remove' as const };
    });

    if (emitPayload) {
      this.emit('group:reaction', emitPayload);
      return true;
    }
    return false;
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

  /** Get message count and last message preview for a group */
  getGroupSummary(groupName: string, leadId: string): { messageCount: number; lastMessage: string | null } {
    const countRow = this.db.drizzle
      .select({ cnt: count() })
      .from(chatGroupMessages)
      .where(and(eq(chatGroupMessages.groupName, groupName), eq(chatGroupMessages.leadId, leadId)))
      .get();
    const messageCount = countRow?.cnt ?? 0;

    const lastRow = this.db.drizzle
      .select({ content: chatGroupMessages.content, fromRole: chatGroupMessages.fromRole })
      .from(chatGroupMessages)
      .where(and(eq(chatGroupMessages.groupName, groupName), eq(chatGroupMessages.leadId, leadId)))
      .orderBy(desc(chatGroupMessages.timestamp))
      .limit(1)
      .get();
    const lastMessage = lastRow ? `${lastRow.fromRole}: ${lastRow.content.slice(0, 100)}` : null;

    return { messageCount, lastMessage };
  }

  /** Archive a group (hides from queries but preserves messages) */
  archiveGroup(name: string, leadId: string): boolean {
    const result = this.db.drizzle
      .update(chatGroups)
      .set({ archived: 1 })
      .where(and(eq(chatGroups.name, name), eq(chatGroups.leadId, leadId)))
      .run();
    if (result.changes > 0) {
      this.emit('group:archived', { name, leadId });
      return true;
    }
    return false;
  }

  exists(name: string, leadId: string): boolean {
    return !!this.db.drizzle
      .select()
      .from(chatGroups)
      .where(and(eq(chatGroups.name, name), eq(chatGroups.leadId, leadId)))
      .get();
  }

  /** Get active groups that have role-based membership criteria. */
  getGroupsWithRoles(leadId: string): Array<{ name: string; leadId: string; roles: string[] }> {
    const rows = this.db.drizzle
      .select({ name: chatGroups.name, leadId: chatGroups.leadId, roles: chatGroups.roles })
      .from(chatGroups)
      .where(and(eq(chatGroups.leadId, leadId), eq(chatGroups.archived, 0)))
      .all();
    return rows
      .filter((r) => r.roles)
      .map((r) => ({ name: r.name, leadId: r.leadId, roles: JSON.parse(r.roles!) as string[] }));
  }
}
