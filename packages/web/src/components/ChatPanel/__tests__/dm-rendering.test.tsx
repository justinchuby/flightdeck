/**
 * @vitest-environment jsdom
 *
 * Regression test: 📨 DM notifications inside agent-groups must render
 * with the amber CollapsibleIncomingMessage component, NOT as plain
 * system event text. See commit fc8812e for context.
 */
import { describe, it, expect } from 'vitest';
import { groupTimeline, type TimelineItem } from '../groupTimeline';
import type { AcpTextChunk } from '../../../types';

function msg(text: string, sender: AcpTextChunk['sender'], ts: number, index: number, fromRole?: string): TimelineItem {
  return { kind: 'message', msg: { type: 'text', text, sender, fromRole, timestamp: ts }, index };
}

describe('DM notification rendering in agent groups', () => {
  it('external messages in systemEvents are separated from agent messages', () => {
    const items: TimelineItem[] = [
      msg('Working on feature...', 'agent', 1000, 0),
      msg('Hey, the auth module is ready', 'external', 1200, 1, 'Developer'),
      msg('Continuing the implementation', 'agent', 1500, 2),
    ];
    const result = groupTimeline(items);

    // Should produce one agent-group with the DM in systemEvents
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');

    if (result[0].kind === 'agent-group') {
      // External DM is in systemEvents, not in messages
      expect(result[0].systemEvents).toHaveLength(1);
      const dmEvent = result[0].systemEvents[0];
      expect(dmEvent.kind).toBe('message');

      if (dmEvent.kind === 'message') {
        // External messages use sender:'external' with fromRole for amber card rendering
        expect(dmEvent.msg.sender).toBe('external');
        expect(dmEvent.msg.fromRole).toBe('Developer');
        expect(dmEvent.msg.text).toContain('auth module is ready');
      }

      // Agent messages stay grouped for command block merging
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0].msg.text).toContain('Working on feature');
      expect(result[0].messages[1].msg.text).toContain('Continuing');
    }
  });

  it('standalone external messages (no active agent group) remain as standalone items', () => {
    const items: TimelineItem[] = [
      msg('Design review complete', 'external', 1000, 0, 'Architect'),
    ];
    const result = groupTimeline(items);

    // No agent group open — DM is a standalone message item
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('message');
    if (result[0].kind === 'message') {
      expect(result[0].msg.sender).toBe('external');
      expect(result[0].msg.fromRole).toBe('Architect');
    }
  });

  it('multiple external messages interleaved with agent output stay in group systemEvents', () => {
    const items: TimelineItem[] = [
      msg('Starting build...', 'agent', 1000, 0),
      msg('Auth module done', 'external', 1200, 1, 'Developer'),
      msg('Tests passing', 'external', 1300, 2, 'Tester'),
      msg('Build complete.', 'agent', 1500, 3),
    ];
    const result = groupTimeline(items);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');

    if (result[0].kind === 'agent-group') {
      // Both DMs should be in systemEvents
      expect(result[0].systemEvents).toHaveLength(2);
      expect(result[0].systemEvents.every(
        (e) => e.kind === 'message' && e.msg.sender === 'external',
      )).toBe(true);

      // Agent messages merged
      expect(result[0].messages).toHaveLength(2);
    }
  });
});
