import { describe, it, expect } from 'vitest';
import { extractCommFromActivity } from '../coordination/events/CommEventExtractor.js';
import type { ActivityEntry } from '../coordination/activity/ActivityLedger.js';

const BASE_TIMESTAMP = '2026-03-01T12:00:00.000Z';

function makeEntry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 1,
    agentId: 'agent-1',
    agentRole: 'developer',
    actionType: 'file_edit',
    summary: 'Test summary',
    details: {},
    timestamp: BASE_TIMESTAMP,
    projectId: '',
    ...overrides,
  };
}

describe('extractCommFromActivity', () => {
  it('returns null for non-communication events', () => {
    expect(extractCommFromActivity(makeEntry({ actionType: 'file_edit' }))).toBeNull();
    expect(extractCommFromActivity(makeEntry({ actionType: 'status_change' }))).toBeNull();
    expect(extractCommFromActivity(makeEntry({ actionType: 'task_started' }))).toBeNull();
    expect(extractCommFromActivity(makeEntry({ actionType: 'lock_acquired' }))).toBeNull();
  });

  it('extracts delegation events', () => {
    const entry = makeEntry({
      actionType: 'delegated',
      agentId: 'lead-1',
      summary: 'Delegated task to developer',
      details: { childId: 'dev-1', toRole: 'developer' },
    });

    const result = extractCommFromActivity(entry);
    expect(result).toEqual({
      type: 'delegation',
      fromAgentId: 'lead-1',
      toAgentId: 'dev-1',
      summary: 'Delegated task to developer',
      timestamp: BASE_TIMESTAMP,
    });
  });

  it('returns null for delegated event without childId', () => {
    const entry = makeEntry({
      actionType: 'delegated',
      details: {},
    });
    expect(extractCommFromActivity(entry)).toBeNull();
  });

  it('extracts direct message events', () => {
    const entry = makeEntry({
      actionType: 'message_sent',
      agentId: 'dev-1',
      summary: 'Hello from developer',
      details: { toAgentId: 'dev-2', toRole: 'developer' },
    });

    const result = extractCommFromActivity(entry);
    expect(result).toEqual({
      type: 'message',
      fromAgentId: 'dev-1',
      toAgentId: 'dev-2',
      summary: 'Hello from developer',
      timestamp: BASE_TIMESTAMP,
    });
  });

  it('extracts broadcast events (toAgentId="all")', () => {
    const entry = makeEntry({
      actionType: 'message_sent',
      agentId: 'lead-1',
      summary: 'Broadcast to all',
      details: { toAgentId: 'all', toRole: 'broadcast' },
    });

    const result = extractCommFromActivity(entry);
    expect(result).toEqual({
      type: 'broadcast',
      fromAgentId: 'lead-1',
      toAgentId: 'all',
      summary: 'Broadcast to all',
      timestamp: BASE_TIMESTAMP,
    });
  });

  it('extracts broadcast events (toRole="broadcast")', () => {
    const entry = makeEntry({
      actionType: 'message_sent',
      agentId: 'lead-1',
      summary: 'Broadcast message',
      details: { toAgentId: 'agent-2', toRole: 'broadcast' },
    });

    const result = extractCommFromActivity(entry);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('broadcast');
  });

  it('returns null for message_sent without toAgentId', () => {
    const entry = makeEntry({
      actionType: 'message_sent',
      details: {},
    });
    expect(extractCommFromActivity(entry)).toBeNull();
  });

  it('extracts group message events', () => {
    const entry = makeEntry({
      actionType: 'group_message',
      agentId: 'dev-1',
      summary: 'Group discussion',
      details: { groupName: 'design-team' },
    });

    const result = extractCommFromActivity(entry);
    expect(result).toEqual({
      type: 'group_message',
      fromAgentId: 'dev-1',
      toAgentId: null,
      groupName: 'design-team',
      summary: 'Group discussion',
      timestamp: BASE_TIMESTAMP,
    });
  });

  it('returns null for group_message without groupName', () => {
    const entry = makeEntry({
      actionType: 'group_message',
      details: {},
    });
    expect(extractCommFromActivity(entry)).toBeNull();
  });

  it('truncates summary to 120 characters', () => {
    const longSummary = 'A'.repeat(200);
    const entry = makeEntry({
      actionType: 'delegated',
      details: { childId: 'dev-1' },
      summary: longSummary,
    });

    const result = extractCommFromActivity(entry);
    expect(result!.summary).toHaveLength(120);
  });
});
