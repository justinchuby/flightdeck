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
});
