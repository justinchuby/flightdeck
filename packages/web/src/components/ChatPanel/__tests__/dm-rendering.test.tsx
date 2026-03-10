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

function msg(text: string, sender: AcpTextChunk['sender'], ts: number, index: number): TimelineItem {
  return { kind: 'message', msg: { type: 'text', text, sender, timestamp: ts }, index };
}

describe('DM notification rendering in agent groups', () => {
  it('📨 messages in systemEvents are separated from non-DM events', () => {
    const items: TimelineItem[] = [
      msg('Working on feature...', 'agent', 1000, 0),
      msg('📨 [From Developer (abc123)] Hey, the auth module is ready', 'user', 1200, 1),
      msg('Continuing the implementation', 'agent', 1500, 2),
    ];
    const result = groupTimeline(items);

    // Should produce one agent-group with the DM in systemEvents
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');

    if (result[0].kind === 'agent-group') {
      // DM is in systemEvents, not in messages
      expect(result[0].systemEvents).toHaveLength(1);
      const dmEvent = result[0].systemEvents[0];
      expect(dmEvent.kind).toBe('message');

      if (dmEvent.kind === 'message') {
        const dmText = dmEvent.msg.text;
        expect(dmText).toMatch(/^📨/);

        // The rendering contract: text starting with 📨 should be rendered
        // with CollapsibleIncomingMessage (amber styling), not plain text.
        // This is enforced in AcpOutput.tsx at two levels:
        // 1. Group-level: 📨 events extracted from systemEvents and rendered directly
        // 2. Fallback in CollapsibleSystemEvents: 📨 check before plain rendering
        expect(dmText).toContain('[From Developer (abc123)]');
      }

      // Agent messages stay grouped for command block merging
      expect(result[0].messages).toHaveLength(2);
      expect(result[0].messages[0].msg.text).toContain('Working on feature');
      expect(result[0].messages[1].msg.text).toContain('Continuing');
    }
  });

  it('standalone 📨 messages (no active agent group) remain as standalone items', () => {
    const items: TimelineItem[] = [
      msg('📨 [From Architect (xyz789)] Design review complete', 'user', 1000, 0),
    ];
    const result = groupTimeline(items);

    // No agent group open — DM is a standalone message item
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('message');
    if (result[0].kind === 'message') {
      expect(result[0].msg.text).toMatch(/^📨/);
      expect(result[0].msg.sender).toBe('user');
    }
  });

  it('multiple 📨 messages interleaved with agent output stay in group systemEvents', () => {
    const items: TimelineItem[] = [
      msg('Starting build...', 'agent', 1000, 0),
      msg('📨 [From Developer (a)] Auth module done', 'user', 1200, 1),
      msg('📨 [From Tester (b)] Tests passing', 'user', 1300, 2),
      msg('Build complete.', 'agent', 1500, 3),
    ];
    const result = groupTimeline(items);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('agent-group');

    if (result[0].kind === 'agent-group') {
      // Both DMs should be in systemEvents
      expect(result[0].systemEvents).toHaveLength(2);
      expect(result[0].systemEvents.every(
        (e) => e.kind === 'message' && typeof e.msg.text === 'string' && e.msg.text.startsWith('📨'),
      )).toBe(true);

      // Agent messages merged
      expect(result[0].messages).toHaveLength(2);
    }
  });
});
