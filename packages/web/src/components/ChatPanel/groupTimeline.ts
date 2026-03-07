import type { ActivityEvent } from '../../stores/leadStore';
import type { AcpTextChunk } from '../../types';

/** A message item in the merged timeline */
export type MessageItem = { kind: 'message'; msg: AcpTextChunk; index: number };
/** An activity event item in the merged timeline */
export type ActivityItem = { kind: 'activity'; evt: ActivityEvent };
/** Any item in the raw timeline */
export type TimelineItem = MessageItem | ActivityItem;

/** A group of consecutive agent messages with interleaved system events collected */
export type AgentGroup = {
  kind: 'agent-group';
  messages: Array<{ msg: AcpTextChunk; index: number }>;
  systemEvents: TimelineItem[];
};

/** Items in the grouped timeline — either an agent group or a standalone item */
export type GroupedTimelineItem = AgentGroup | TimelineItem;

/**
 * Groups consecutive agent text messages into continuous blocks.
 * System messages and activity events that fall within an agent turn
 * are moved to a collapsed section after the agent text, not interspersed within it.
 *
 * Grouping rules:
 * - Consecutive agent text messages (sender === 'agent' or undefined) → group together
 * - 'thinking' messages during an agent turn → include in the group's messages
 * - 'system' messages during an agent turn → add to group's systemEvents
 *   (except '---' separators which flush the group)
 * - Activity events during an agent turn → add to group's systemEvents
 * - 'user' messages → always flush current group, render standalone
 * - Rich content (contentType !== 'text') → flush current group, render standalone
 * - Single-message groups with no system events → optimize to standalone TimelineItem
 * - Outgoing DM notifications (📤) are silently dropped
 */

export function groupTimeline(timeline: TimelineItem[]): GroupedTimelineItem[] {
  const result: GroupedTimelineItem[] = [];
  let currentGroup: { messages: Array<{ msg: AcpTextChunk; index: number }>; systemEvents: TimelineItem[] } | null = null;

  function flush() {
    if (!currentGroup) return;
    if (currentGroup.messages.length === 1 && currentGroup.systemEvents.length === 0) {
      const m = currentGroup.messages[0];
      result.push({ kind: 'message', msg: m.msg, index: m.index });
    } else {
      result.push({ kind: 'agent-group', messages: currentGroup.messages, systemEvents: currentGroup.systemEvents });
    }
    currentGroup = null;
  }

  for (const item of timeline) {
    if (item.kind === 'activity') {
      if (currentGroup) {
        currentGroup.systemEvents.push(item);
      } else {
        result.push(item);
      }
      continue;
    }

    const msg = item.msg;
    const sender = msg.sender ?? 'agent';

    // User messages always flush and render standalone
    if (sender === 'user') {
      flush();
      result.push(item);
      continue;
    }

    // Rich content always flushes and renders standalone
    if (msg.contentType && msg.contentType !== 'text') {
      flush();
      result.push(item);
      continue;
    }

    // System messages
    if (sender === 'system') {
      const text = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg.text);
      // '---' separators flush the current group
      if (text === '---') {
        flush();
        result.push(item);
        continue;
      }
      // Skip outgoing DM notifications (redundant with command blocks)
      if (text.startsWith('📤')) continue;
      if (currentGroup) {
        currentGroup.systemEvents.push(item);
      } else {
        result.push(item);
      }
      continue;
    }

    // Thinking messages — include in current group or start new one
    if (sender === 'thinking') {
      if (currentGroup) {
        currentGroup.messages.push({ msg: item.msg, index: item.index });
      } else {
        currentGroup = { messages: [{ msg: item.msg, index: item.index }], systemEvents: [] };
      }
      continue;
    }

    // Agent text messages (sender === 'agent' or default)
    if (currentGroup) {
      currentGroup.messages.push({ msg: item.msg, index: item.index });
    } else {
      currentGroup = { messages: [{ msg: item.msg, index: item.index }], systemEvents: [] };
    }
  }

  flush();
  return result;
}
