import { describe, it, expect, beforeEach } from 'vitest';
import { useLeadStore } from '../leadStore';

const LEAD_ID = 'lead-test-001';

function resetStore() {
  useLeadStore.getState().reset();
  useLeadStore.getState().addProject(LEAD_ID);
}

describe('leadStore', () => {
  beforeEach(resetStore);

  describe('appendToThinkingMessage', () => {
    it('creates a new thinking message when no thinking message exists', () => {
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'reasoning...');
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('thinking');
      expect(msgs[0].text).toBe('reasoning...');
    });

    it('appends to the last thinking message when one exists', () => {
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'chunk1');
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, ' chunk2');
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('chunk1 chunk2');
    });

    it('creates a new thinking message after an agent message', () => {
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'agent text');
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'new reasoning');
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[1].sender).toBe('thinking');
    });

    it('sets pendingNewline so next agent text starts a new message', () => {
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'thinking...');
      const proj = useLeadStore.getState().projects[LEAD_ID];
      expect(proj.pendingNewline).toBe(true);
    });

    it('paragraph break: agent text after thinking creates a new message', () => {
      // Simulate: existing agent message → thinking → new agent text
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'old response');
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'reasoning...');
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'new response');

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
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
      // Thinking message contains @user (internal reasoning about the user)
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'I should tell\n@user\nabout the results');
      // Agent message without @user
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'Here are the results.');

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(2);
      // The @user regex should NOT match in the agent message
      const agentMsg = msgs.find((m) => m.sender === 'agent')!;
      expect(/(?:^|\n)@user\s*\n/m.test(agentMsg.text)).toBe(false);
      // But it WOULD match in the thinking message (which the UI skips for highlighting)
      const thinkingMsg = msgs.find((m) => m.sender === 'thinking')!;
      expect(/(?:^|\n)@user\s*\n/m.test(thinkingMsg.text)).toBe(true);
    });
  });

  describe('unclosed command block detection', () => {
    it('appends to agent message when command has nested ⟦⟦ ⟧⟧ inside JSON', () => {
      // Start streaming a DELEGATE command with nested bracket examples
      useLeadStore.getState().appendToLastAgentMessage(
        LEAD_ID,
        '⟦⟦ DELEGATE {"task": "Fix bug.\\nUse ⟦⟦ COMPLETE_TASK {} ⟧⟧'
      );
      // Thinking interleaves (sets pendingNewline=true)
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'reasoning about task...');
      // Rest of the DELEGATE command arrives — should NOT create a new message
      useLeadStore.getState().appendToLastAgentMessage(
        LEAD_ID,
        ' when done."} ⟧⟧'
      );

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      // Should be ONE agent message, not two
      expect(agentMsgs).toHaveLength(1);
      expect(agentMsgs[0].text).toContain('⟦⟦ DELEGATE');
      expect(agentMsgs[0].text).toContain('⟧⟧');
    });

    it('old heuristic would fail: nested ⟧⟧ fools lastIndexOf check', () => {
      // This is the exact scenario that was broken:
      // The inner ⟧⟧ makes lastIndexOf('⟧⟧') > lastIndexOf('⟦⟦') even though the outer command is unclosed
      const partialCommand = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ COMMIT {} ⟧⟧ when done';
      // Verify the old heuristic would say "closed" (wrong)
      expect(partialCommand.lastIndexOf('⟦⟦') < partialCommand.lastIndexOf('⟧⟧')).toBe(true);

      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, partialCommand);
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'reasoning...');
      // Continuation should append, not create new message
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, '"} ⟧⟧');

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      expect(agentMsgs).toHaveLength(1);
      expect(agentMsgs[0].text).toBe(partialCommand + '"} ⟧⟧');
    });

    it('still creates new message after thinking when command IS closed', () => {
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, '⟦⟦ CMD {} ⟧⟧ done');
      useLeadStore.getState().appendToThinkingMessage(LEAD_ID, 'reasoning...');
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'new response');

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      const agentMsgs = msgs.filter((m) => m.sender === 'agent');
      // Should be TWO agent messages — the command was closed so pendingNewline takes effect
      expect(agentMsgs).toHaveLength(2);
      expect(agentMsgs[0].text).toBe('⟦⟦ CMD {} ⟧⟧ done');
      expect(agentMsgs[1].text).toBe('new response');
    });
  });

  describe('interrupt separator', () => {
    it('addMessage inserts a system separator correctly', () => {
      // Simulate: agent sends a response, then interrupt adds separator + user message
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'agent response');
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: '---', sender: 'system', timestamp: Date.now() });
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'interrupt message', sender: 'user', timestamp: Date.now() });

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(3);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[0].text).toBe('agent response');
      expect(msgs[1].sender).toBe('system');
      expect(msgs[1].text).toBe('---');
      expect(msgs[2].sender).toBe('user');
    });

    it('separator causes next appendToLastAgentMessage to start a new bubble', () => {
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'old text');
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: '---', sender: 'system', timestamp: Date.now() });
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'interrupt msg', sender: 'user', timestamp: Date.now() });
      // New agent response after interrupt
      useLeadStore.getState().appendToLastAgentMessage(LEAD_ID, 'new response');

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(4);
      expect(msgs[0].text).toBe('old text');
      expect(msgs[1].text).toBe('---');
      expect(msgs[2].text).toBe('interrupt msg');
      expect(msgs[3].sender).toBe('agent');
      expect(msgs[3].text).toBe('new response');
    });
  });

  describe('DM and group message surfacing', () => {
    it('addMessage stores system messages (DMs/group) in lead chat', () => {
      useLeadStore.getState().addMessage(LEAD_ID, {
        type: 'text',
        text: '📨 [From Developer abc12345] Hello lead',
        sender: 'system',
        timestamp: Date.now(),
      });
      useLeadStore.getState().addMessage(LEAD_ID, {
        type: 'text',
        text: '🗣️ [design-chat: Architect def67890] Let us discuss',
        sender: 'system',
        timestamp: Date.now(),
      });

      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].text).toContain('📨');
      expect(msgs[0].sender).toBe('system');
      expect(msgs[1].text).toContain('🗣️');
      expect(msgs[1].sender).toBe('system');
    });
  });
});
