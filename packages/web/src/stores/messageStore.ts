import { create } from 'zustand';
import type { AcpTextChunk } from '../types';
import { hasUnclosedCommandBlock } from '../utils/commandParser';

/** Generate a deterministic message ID for dedup */
export function messageId(msg: AcpTextChunk): string {
  const ts = msg.timestamp ?? 0;
  const sender = msg.sender ?? 'unknown';
  // Use first 64 chars of text for the hash component — enough to disambiguate
  // messages with the same timestamp and sender
  const textSlice = (msg.text ?? '').slice(0, 64);
  return `${ts}-${sender}-${simpleHash(textSlice)}`;
}

/** Fast non-cryptographic hash for dedup (djb2) */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // unsigned
}

interface ChannelState {
  messages: AcpTextChunk[];
  /** Known message IDs for dedup */
  knownIds: Set<string>;
  /** When true, next appended agent text starts a new bubble */
  pendingNewline: boolean;
  /** Timestamp of last text received — used for "working" indicator */
  lastTextAt: number;
}

function emptyChannel(): ChannelState {
  return { messages: [], knownIds: new Set(), pendingNewline: false, lastTextAt: 0 };
}

interface MessageStoreState {
  /** Message channels keyed by agent/lead ID */
  channels: Record<string, ChannelState>;

  // ── Core message operations ─────────────────────────────────────

  /** Add a complete message (with dedup) */
  addMessage: (channelId: string, msg: AcpTextChunk) => void;

  /** Replace all messages (history load), merging with any newer live messages */
  setMessages: (channelId: string, messages: AcpTextChunk[]) => void;

  /** Stream text: append to the last agent message or start a new bubble */
  appendToLastAgentMessage: (channelId: string, text: string) => void;

  /** Stream thinking/reasoning text */
  appendToThinkingMessage: (channelId: string, text: string) => void;

  /** Mark queued (user) messages as sent */
  promoteQueuedMessages: (channelId: string) => void;

  /** Merge history messages, deduplicating against existing */
  mergeHistory: (channelId: string, history: AcpTextChunk[]) => void;

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Initialize a channel (no-op if exists) */
  ensureChannel: (channelId: string) => void;

  /** Remove a channel entirely */
  removeChannel: (channelId: string) => void;

  /** Reset pendingNewline (e.g., after tool call display) */
  setPendingNewline: (channelId: string, value: boolean) => void;

  /** Get last text timestamp for a channel */
  getLastTextAt: (channelId: string) => number;

  /** Reset all state */
  reset: () => void;
}

/** Rebuild the knownIds set from a message array */
function buildIdSet(messages: AcpTextChunk[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) ids.add(messageId(m));
  return ids;
}

export const useMessageStore = create<MessageStoreState>((set, get) => ({
  channels: {},

  ensureChannel: (channelId) =>
    set((s) => {
      if (s.channels[channelId]) return s;
      return { channels: { ...s.channels, [channelId]: emptyChannel() } };
    }),

  removeChannel: (channelId) =>
    set((s) => {
      const { [channelId]: _, ...rest } = s.channels;
      return { channels: rest };
    }),

  addMessage: (channelId, msg) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      const withTs = { ...msg, timestamp: msg.timestamp ?? Date.now() };
      const id = messageId(withTs);
      if (ch.knownIds.has(id)) return s; // dedup
      const newIds = new Set(ch.knownIds);
      newIds.add(id);
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages: [...ch.messages, withTs], knownIds: newIds },
        },
      };
    }),

  setMessages: (channelId, messages) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages, knownIds: buildIdSet(messages) },
        },
      };
    }),

  mergeHistory: (channelId, history) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      if (ch.messages.length === 0) {
        // No live messages — just use history directly
        return {
          channels: {
            ...s.channels,
            [channelId]: { ...ch, messages: history, knownIds: buildIdSet(history) },
          },
        };
      }
      // Merge: history first, then any live messages newer than the latest historical
      const latestHistTs = history.length > 0
        ? Math.max(...history.map((m) => m.timestamp ?? 0))
        : 0;
      const histIds = buildIdSet(history);
      const liveOnly = ch.messages.filter((m) => {
        const ts = m.timestamp ?? 0;
        // Keep messages strictly newer, or same-timestamp if not already in history
        return ts > latestHistTs || (ts >= latestHistTs && !histIds.has(messageId(m)));
      });
      const merged = [...history, ...liveOnly];
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages: merged, knownIds: buildIdSet(merged) },
        },
      };
    }),

  appendToLastAgentMessage: (channelId, text) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      const msgs = [...ch.messages];
      // Find the last agent message (may not be the very last if thinking interleaved)
      let agentIdx = -1;
      for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].sender === 'agent') { agentIdx = k; break; }
        // Look past thinking messages and system notification messages (📨/📤/⚙️)
        if (msgs[k].sender === 'thinking') continue;
        const t = msgs[k].text || '';
        if (msgs[k].sender === 'system' && (t.startsWith('📨') || t.startsWith('📤') || t.startsWith('⚙️'))) continue;
        break; // stop at user/other boundaries
      }
      const agentText = agentIdx >= 0 ? msgs[agentIdx].text : '';
      const unclosedCommand = hasUnclosedCommandBlock(agentText);
      let knownIds = ch.knownIds;
      if (agentIdx >= 0 && (!ch.pendingNewline || unclosedCommand)) {
        msgs[agentIdx] = { ...msgs[agentIdx], text: agentText + text, timestamp: msgs[agentIdx].timestamp || Date.now() };
        // Existing message modified in-place — knownIds unchanged (O(1))
      } else {
        const newMsg: AcpTextChunk = { type: 'text', text, sender: 'agent', timestamp: Date.now() };
        msgs.push(newMsg);
        // Incrementally add new ID — O(1) instead of O(n) rebuild
        knownIds = new Set(knownIds);
        knownIds.add(messageId(newMsg));
      }
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages: msgs, knownIds, lastTextAt: Date.now(), pendingNewline: false },
        },
      };
    }),

  appendToThinkingMessage: (channelId, text) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      const msgs = [...ch.messages];
      const lastIdx = msgs.length - 1;
      let knownIds = ch.knownIds;
      if (lastIdx >= 0 && msgs[lastIdx].sender === 'thinking') {
        msgs[lastIdx] = { ...msgs[lastIdx], text: (msgs[lastIdx].text || '') + text };
        // Existing message modified in-place — knownIds unchanged (O(1))
      } else {
        const newMsg: AcpTextChunk = { type: 'text', text, sender: 'thinking', timestamp: Date.now() };
        msgs.push(newMsg);
        // Incrementally add new ID — O(1) instead of O(n) rebuild
        knownIds = new Set(knownIds);
        knownIds.add(messageId(newMsg));
      }
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages: msgs, knownIds, pendingNewline: true },
        },
      };
    }),

  promoteQueuedMessages: (channelId) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      const updated = ch.messages.map((m) => m.queued ? { ...m, queued: false } : m);
      // knownIds unchanged — queued flag doesn't affect message identity
      return {
        channels: {
          ...s.channels,
          [channelId]: { ...ch, messages: updated },
        },
      };
    }),

  setPendingNewline: (channelId, value) =>
    set((s) => {
      const ch = s.channels[channelId] || emptyChannel();
      return { channels: { ...s.channels, [channelId]: { ...ch, pendingNewline: value } } };
    }),

  getLastTextAt: (channelId) => {
    return get().channels[channelId]?.lastTextAt ?? 0;
  },

  reset: () => set({ channels: {} }),
}));
