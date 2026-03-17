import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore, messageId } from '../messageStore';
import type { AcpTextChunk } from '../../types';

const CH = 'lead-test-001';

function resetStore() {
  useMessageStore.getState().reset();
  useMessageStore.getState().ensureChannel(CH);
}

beforeEach(resetStore);

describe('messageStore', () => {
  describe('ensureChannel', () => {
    it('creates empty channel', () => {
      const ch = useMessageStore.getState().channels[CH];
      expect(ch).toBeDefined();
      expect(ch.messages).toEqual([]);
      expect(ch.pendingNewline).toBe(false);
      expect(ch.lastTextAt).toBe(0);
    });

    it('is idempotent', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'hi', sender: 'user', timestamp: 1 });
      useMessageStore.getState().ensureChannel(CH);
      expect(useMessageStore.getState().channels[CH].messages).toHaveLength(1);
    });
  });

  describe('addMessage', () => {
    it('adds a message with timestamp', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'hello', sender: 'user', timestamp: 12345 });
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].timestamp).toBe(12345);
    });

    it('defaults timestamp to Date.now() if not provided', () => {
      const before = Date.now();
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'hi', sender: 'user' });
      const ts = useMessageStore.getState().channels[CH].messages[0].timestamp!;
      expect(ts).toBeGreaterThanOrEqual(before);
    });

    it('deduplicates messages with same ID', () => {
      const msg: AcpTextChunk = { type: 'text', text: 'dup', sender: 'user', timestamp: 1000 };
      useMessageStore.getState().addMessage(CH, msg);
      useMessageStore.getState().addMessage(CH, msg);
      expect(useMessageStore.getState().channels[CH].messages).toHaveLength(1);
    });
  });

  describe('setMessages', () => {
    it('replaces all messages', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'old', sender: 'user', timestamp: 1 });
      useMessageStore.getState().setMessages(CH, [{ type: 'text', text: 'new', sender: 'agent', timestamp: 2 }]);
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('new');
    });
  });

  describe('promoteQueuedMessages', () => {
    it('clears queued flag from all messages', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'q1', sender: 'user', queued: true, timestamp: 1 });
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'q2', sender: 'user', queued: true, timestamp: 2 });
      useMessageStore.getState().promoteQueuedMessages(CH);
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs.every((m) => !m.queued)).toBe(true);
    });

    it('does not affect non-queued messages', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'normal', sender: 'agent', timestamp: 1 });
      useMessageStore.getState().promoteQueuedMessages(CH);
      expect(useMessageStore.getState().channels[CH].messages[0].text).toBe('normal');
    });
  });

  describe('appendToThinkingMessage', () => {
    it('creates a new thinking message when no thinking message exists', () => {
      useMessageStore.getState().appendToThinkingMessage(CH, 'reasoning...');
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('thinking');
      expect(msgs[0].text).toBe('reasoning...');
    });

    it('appends to the last thinking message when one exists', () => {
      useMessageStore.getState().appendToThinkingMessage(CH, 'chunk1');
      useMessageStore.getState().appendToThinkingMessage(CH, ' chunk2');
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('chunk1 chunk2');
    });

    it('creates a new thinking message after an agent message', () => {
      useMessageStore.getState().appendToLastAgentMessage(CH, 'agent text');
      useMessageStore.getState().appendToThinkingMessage(CH, 'new reasoning');
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[1].sender).toBe('thinking');
    });

    it('sets pendingNewline so next agent text starts a new message', () => {
      useMessageStore.getState().appendToThinkingMessage(CH, 'thinking...');
      const ch = useMessageStore.getState().channels[CH];
      expect(ch.pendingNewline).toBe(true);
    });

    it('paragraph break: agent text after thinking creates a new message', () => {
      useMessageStore.getState().appendToLastAgentMessage(CH, 'old response');
      useMessageStore.getState().appendToThinkingMessage(CH, 'reasoning...');
      useMessageStore.getState().appendToLastAgentMessage(CH, 'new response');

      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(3);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[0].text).toBe('old response');
      expect(msgs[1].sender).toBe('thinking');
      expect(msgs[1].text).toBe('reasoning...');
      expect(msgs[2].sender).toBe('agent');
      expect(msgs[2].text).toBe('new response');
    });
  });

  describe('@user detection isolation', () => {
    it('thinking messages with @user do not contaminate agent messages', () => {
      useMessageStore.getState().appendToThinkingMessage(CH, 'I should tell\n@user\nabout the results');
      useMessageStore.getState().appendToLastAgentMessage(CH, 'Here are the results.');

      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(2);
      const agentMsg = msgs.find((m) => m.sender === 'agent')!;
      expect(/(?:^|\n)@user\s*\n/m.test(agentMsg.text)).toBe(false);
      const thinkingMsg = msgs.find((m) => m.sender === 'thinking')!;
      expect(/(?:^|\n)@user\s*\n/m.test(thinkingMsg.text)).toBe(true);
    });
  });

  describe('unclosed command block detection', () => {
    it('appends to agent message when command has nested \u27E6\u27E6 \u27E7\u27E7 inside JSON', () => {
      useMessageStore.getState().appendToLastAgentMessage(
        CH,
        '\u27E6\u27E6 DELEGATE {"task": "Fix bug.\\nUse \u27E6\u27E6 COMPLETE_TASK {} \u27E7\u27E7'
      );
      useMessageStore.getState().appendToThinkingMessage(CH, 'reasoning about task...');
      useMessageStore.getState().appendToLastAgentMessage(
        CH,
        ' when done."} \u27E7\u27E7'
      );

      const msgs = useMessageStore.getState().channels[CH].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      expect(agentMsgs).toHaveLength(1);
      expect(agentMsgs[0].text).toContain('\u27E6\u27E6 DELEGATE');
      expect(agentMsgs[0].text).toContain('\u27E7\u27E7');
    });

    it('old heuristic would fail: nested \u27E7\u27E7 fools lastIndexOf check', () => {
      const partialCommand = '\u27E6\u27E6 DELEGATE {"task": "Use \u27E6\u27E6 COMMIT {} \u27E7\u27E7 when done';
      expect(partialCommand.lastIndexOf('\u27E6\u27E6') < partialCommand.lastIndexOf('\u27E7\u27E7')).toBe(true);

      useMessageStore.getState().appendToLastAgentMessage(CH, partialCommand);
      useMessageStore.getState().appendToThinkingMessage(CH, 'reasoning...');
      useMessageStore.getState().appendToLastAgentMessage(CH, '"} \u27E7\u27E7');

      const msgs = useMessageStore.getState().channels[CH].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      expect(agentMsgs).toHaveLength(1);
      expect(agentMsgs[0].text).toBe(partialCommand + '"} \u27E7\u27E7');
    });

    it('still creates new message after thinking when command IS closed', () => {
      useMessageStore.getState().appendToLastAgentMessage(CH, '\u27E6\u27E6 CMD {} \u27E7\u27E7 done');
      useMessageStore.getState().appendToThinkingMessage(CH, 'reasoning...');
      useMessageStore.getState().appendToLastAgentMessage(CH, 'new response');

      const msgs = useMessageStore.getState().channels[CH].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      expect(agentMsgs).toHaveLength(2);
      expect(agentMsgs[0].text).toBe('\u27E6\u27E6 CMD {} \u27E7\u27E7 done');
      expect(agentMsgs[1].text).toBe('new response');
    });
  });

  describe('interrupt separator', () => {
    it('addMessage inserts a system separator correctly', () => {
      useMessageStore.getState().appendToLastAgentMessage(CH, 'agent response');
      useMessageStore.getState().addMessage(CH, { type: 'text', text: '---', sender: 'system', timestamp: Date.now() });
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'interrupt message', sender: 'user', timestamp: Date.now() });

      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(3);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[0].text).toBe('agent response');
      expect(msgs[1].sender).toBe('system');
      expect(msgs[1].text).toBe('---');
      expect(msgs[2].sender).toBe('user');
    });
  });

  describe('DM and group message surfacing', () => {
    it('addMessage stores system messages (DMs/group) in channel', () => {
      useMessageStore.getState().addMessage(CH, {
        type: 'text',
        text: '📨 [From Developer abc12345] Hello lead',
        sender: 'system',
        timestamp: Date.now(),
      });
      useMessageStore.getState().addMessage(CH, {
        type: 'text',
        text: '🗣️ [design-chat: Architect def67890] Let us discuss',
        sender: 'system',
        timestamp: Date.now() + 1,
      });

      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].text).toContain('📨');
      expect(msgs[0].sender).toBe('system');
      expect(msgs[1].text).toContain('🗣️');
      expect(msgs[1].sender).toBe('system');
    });
  });

  describe('mergeHistory', () => {
    it('uses history directly when no live messages', () => {
      const history: AcpTextChunk[] = [
        { type: 'text', text: 'hist-1', sender: 'agent', timestamp: 100 },
        { type: 'text', text: 'hist-2', sender: 'user', timestamp: 200 },
      ];
      useMessageStore.getState().mergeHistory(CH, history);
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toEqual(history);
    });

    it('interleaves history + live messages when both exist', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'live', sender: 'agent', timestamp: 500 });
      const history: AcpTextChunk[] = [
        { type: 'text', text: 'hist', sender: 'user', timestamp: 100 },
      ];
      useMessageStore.getState().mergeHistory(CH, history);
      const msgs = useMessageStore.getState().channels[CH].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].text).toBe('hist');
      expect(msgs[1].text).toBe('live');
    });
  });

  describe('O(1) incremental dedup', () => {
    it('does not rebuild knownIds on streaming append', () => {
      // Add some initial messages to establish a baseline
      for (let i = 0; i < 100; i++) {
        useMessageStore.getState().addMessage(CH, { type: 'text', text: `msg-${i}`, sender: 'user', timestamp: i });
      }
      const sizeBefore = useMessageStore.getState().channels[CH].knownIds.size;
      expect(sizeBefore).toBe(100);

      // Streaming append to existing agent message should NOT grow knownIds
      useMessageStore.getState().appendToLastAgentMessage(CH, 'start');
      const sizeAfterNew = useMessageStore.getState().channels[CH].knownIds.size;
      expect(sizeAfterNew).toBe(101); // +1 for the new agent message

      useMessageStore.getState().appendToLastAgentMessage(CH, ' more text');
      const sizeAfterAppend = useMessageStore.getState().channels[CH].knownIds.size;
      expect(sizeAfterAppend).toBe(101); // Same — no rebuild
    });

    it('does not rebuild knownIds on thinking append', () => {
      useMessageStore.getState().appendToThinkingMessage(CH, 'thought-1');
      const size1 = useMessageStore.getState().channels[CH].knownIds.size;
      useMessageStore.getState().appendToThinkingMessage(CH, ' thought-2');
      const size2 = useMessageStore.getState().channels[CH].knownIds.size;
      expect(size2).toBe(size1); // No new ID added for append to existing
    });

    it('does not rebuild knownIds on promoteQueuedMessages', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'q1', sender: 'user', queued: true, timestamp: 1 });
      const sizeBefore = useMessageStore.getState().channels[CH].knownIds.size;
      useMessageStore.getState().promoteQueuedMessages(CH);
      const sizeAfter = useMessageStore.getState().channels[CH].knownIds.size;
      expect(sizeAfter).toBe(sizeBefore);
    });
  });

  describe('messageId', () => {
    it('generates deterministic IDs', () => {
      const msg: AcpTextChunk = { type: 'text', text: 'hello', sender: 'user', timestamp: 12345 };
      expect(messageId(msg)).toBe(messageId(msg));
    });

    it('generates different IDs for different messages', () => {
      const a: AcpTextChunk = { type: 'text', text: 'hello', sender: 'user', timestamp: 1 };
      const b: AcpTextChunk = { type: 'text', text: 'world', sender: 'user', timestamp: 1 };
      expect(messageId(a)).not.toBe(messageId(b));
    });
  });

  describe('reset', () => {
    it('clears all channels', () => {
      useMessageStore.getState().addMessage(CH, { type: 'text', text: 'hi', sender: 'user', timestamp: 1 });
      useMessageStore.getState().reset();
      expect(useMessageStore.getState().channels).toEqual({});
    });
  });
});
