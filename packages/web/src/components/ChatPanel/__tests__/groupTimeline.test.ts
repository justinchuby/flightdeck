import { describe, it, expect } from 'vitest';
import { groupTimeline, type TimelineItem } from '../groupTimeline';
import type { AcpTextChunk } from '../../../types';
import type { ActivityEvent } from '../../../stores/leadStore';

function msg(text: string, sender: AcpTextChunk['sender'], ts: number, index: number, opts?: Partial<AcpTextChunk>): TimelineItem {
  return {
    kind: 'message',
    msg: { type: 'text', text, sender, timestamp: ts, ...opts },
    index,
  };
}

function activity(id: string, summary: string, ts: number, type: ActivityEvent['type'] = 'tool_call'): TimelineItem {
  return {
    kind: 'activity',
    evt: { id, agentId: 'a1', agentRole: 'dev', type, summary, timestamp: ts },
  };
}

describe('groupTimeline', () => {
  it('returns empty array for empty input', () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it('keeps a single agent message as standalone (no grouping overhead)', () => {
    const items: TimelineItem[] = [msg('hello', 'agent', 1000, 0)];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('message');
  });

  it('groups consecutive agent messages into an agent-group', () => {
    const items: TimelineItem[] = [
      msg('part 1', 'agent', 1000, 0),
      msg('part 2', 'agent', 2000, 1),
      msg('part 3', 'agent', 3000, 2),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(3);
      expect(result[0].systemEvents).toHaveLength(0);
    }
  });

  it('collects system events during agent turn into group systemEvents', () => {
    const items: TimelineItem[] = [
      msg('agent text 1', 'agent', 1000, 0),
      msg('DELEGATE something', 'system', 1500, 1),
      msg('agent text 2', 'agent', 2000, 2),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0].msg.text).toBe('agent text 1');
      expect(result[0].messages[1].msg.text).toBe('agent text 2');
      expect(result[0].systemEvents).toHaveLength(1);
      expect(result[0].systemEvents[0].kind).toBe('message');
    }
  });

  it('collects activity events during agent turn into group systemEvents', () => {
    const items: TimelineItem[] = [
      msg('agent text', 'agent', 1000, 0),
      activity('evt1', 'ran tool', 1500),
      msg('more text', 'agent', 2000, 1),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].systemEvents).toHaveLength(1);
      expect(result[0].systemEvents[0].kind).toBe('activity');
    }
  });

  it('includes thinking messages in agent group', () => {
    const items: TimelineItem[] = [
      msg('thinking...', 'thinking', 1000, 0),
      msg('agent response', 'agent', 2000, 1),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0].msg.sender).toBe('thinking');
      expect(result[0].messages[1].msg.sender).toBe('agent');
    }
  });

  it('user messages flush agent group and render standalone', () => {
    const items: TimelineItem[] = [
      msg('agent part 1', 'agent', 1000, 0),
      msg('agent part 2', 'agent', 2000, 1),
      msg('user question', 'user', 3000, 2),
      msg('agent reply', 'agent', 4000, 3),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(3);
    // First: agent group
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
    }
    // Second: user message standalone
    expect(result[1].kind).toBe('message');
    if (result[1].kind === 'message') {
      expect(result[1].msg.sender).toBe('user');
    }
    // Third: single agent message (optimized to standalone)
    expect(result[2].kind).toBe('message');
    if (result[2].kind === 'message') {
      expect(result[2].msg.text).toBe('agent reply');
    }
  });

  it('--- separators flush the current group', () => {
    const items: TimelineItem[] = [
      msg('agent text 1', 'agent', 1000, 0),
      msg('---', 'system', 1500, 1),
      msg('agent text 2', 'agent', 2000, 2),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(3);
    // First: standalone agent msg (single, no system events → optimized)
    expect(result[0].kind).toBe('message');
    // Second: separator
    expect(result[1].kind).toBe('message');
    if (result[1].kind === 'message') {
      expect(result[1].msg.text).toBe('---');
    }
    // Third: standalone agent msg
    expect(result[2].kind).toBe('message');
  });

  it('drops outgoing DM notifications (📤)', () => {
    const items: TimelineItem[] = [
      msg('agent text', 'agent', 1000, 0),
      msg('📤 Sent DM to dev-2', 'system', 1500, 1),
      msg('more agent text', 'agent', 2000, 2),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
      // The 📤 message should NOT be in system events
      expect(result[0].systemEvents).toHaveLength(0);
    }
  });

  it('drops 📤 messages even when no current group exists', () => {
    const items: TimelineItem[] = [
      msg('📤 Sent DM to dev-2', 'system', 1500, 0),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(0);
  });

  it('rich content (image) flushes group and renders standalone', () => {
    const items: TimelineItem[] = [
      msg('agent text', 'agent', 1000, 0),
      msg('', 'agent', 1500, 1, { contentType: 'image', data: 'abc', mimeType: 'image/png' }),
      msg('more agent text', 'agent', 2000, 2),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(3);
    // First: standalone agent (single, optimized)
    expect(result[0].kind).toBe('message');
    // Second: rich content standalone
    expect(result[1].kind).toBe('message');
    if (result[1].kind === 'message') {
      expect(result[1].msg.contentType).toBe('image');
    }
    // Third: standalone agent
    expect(result[2].kind).toBe('message');
  });

  it('standalone activity events (outside agent turn) pass through', () => {
    const items: TimelineItem[] = [
      activity('evt1', 'initial event', 500),
      msg('agent text', 'agent', 1000, 0),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('activity');
    expect(result[1].kind).toBe('message');
  });

  it('standalone system messages (outside agent turn) pass through', () => {
    const items: TimelineItem[] = [
      msg('Agent started', 'system', 500, 0),
      msg('agent text', 'agent', 1000, 1),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('message');
    if (result[0].kind === 'message') {
      expect(result[0].msg.sender).toBe('system');
    }
    expect(result[1].kind).toBe('message');
  });

  it('complex scenario: agent → system → activity → agent → user → agent', () => {
    const items: TimelineItem[] = [
      msg('part 1', 'agent', 1000, 0),
      msg('CREATE_AGENT dev-2', 'system', 1200, 1),
      activity('evt1', 'delegated task', 1300, 'delegation'),
      msg('part 2', 'agent', 1500, 2),
      msg('what should I do?', 'user', 2000, 3),
      msg('response', 'agent', 3000, 4),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(3);
    // First: agent group with 2 agent messages + 2 system events
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].systemEvents).toHaveLength(2);
    }
    // Second: user message
    expect(result[1].kind).toBe('message');
    if (result[1].kind === 'message') {
      expect(result[1].msg.sender).toBe('user');
    }
    // Third: standalone agent message
    expect(result[2].kind).toBe('message');
    if (result[2].kind === 'message') {
      expect(result[2].msg.text).toBe('response');
    }
  });

  it('single agent message with system events creates a group', () => {
    const items: TimelineItem[] = [
      msg('agent text', 'agent', 1000, 0),
      msg('system notification', 'system', 1500, 1),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    // Single message but has system events → still a group
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(1);
      expect(result[0].systemEvents).toHaveLength(1);
    }
  });

  it('messages with no sender default to agent and get grouped', () => {
    const items: TimelineItem[] = [
      msg('text 1', undefined, 1000, 0),
      msg('text 2', undefined, 2000, 1),
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
    }
  });

  it('groups all consecutive agent messages regardless of time gap', () => {
    const items: TimelineItem[] = [
      msg('response 1', 'agent', 1000, 0),
      msg('response 2', 'agent', 5000, 1), // 4s gap — still same group (no time heuristic)
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
    }
  });

  it('keeps agent messages grouped when gap is under 2s', () => {
    const items: TimelineItem[] = [
      msg('streaming chunk 1', 'agent', 1000, 0),
      msg('streaming chunk 2', 'agent', 1100, 1), // 100ms gap → same group
      msg('streaming chunk 3', 'agent', 1200, 2), // 100ms gap → same group
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(3);
    }
  });

  it('thinking followed by agent message stays in same group regardless of gap', () => {
    const items: TimelineItem[] = [
      msg('thinking...', 'thinking', 1000, 0),
      msg('agent response', 'agent', 5000, 1), // 4s after thinking → same group
    ];
    const result = groupTimeline(items);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') {
      expect(result[0].messages).toHaveLength(2);
    }
  });

  it('multiple turns without separator stay in same group', () => {
    const items: TimelineItem[] = [
      msg('turn 1 text', 'agent', 1000, 0),
      msg('turn 1 more', 'agent', 1500, 1),
      msg('turn 2 text', 'agent', 10000, 2),      // 8.5s gap
      msg('turn 2 more', 'agent', 10500, 3),
    ];
    const result = groupTimeline(items);
    // Without time-gap heuristic, all consecutive agent messages group together.
    // Turn boundaries are handled by agent:response_start creating separate message entries.
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');
    if (result[0].kind === 'agent-group') expect(result[0].messages).toHaveLength(4);
  });
});
