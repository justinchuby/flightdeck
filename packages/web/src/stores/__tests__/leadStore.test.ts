import { describe, it, expect, beforeEach } from 'vitest';
import { useLeadStore } from '../leadStore';
import type { AcpToolCall, LeadProgress, Decision, DagStatus, ChatGroup, GroupMessage } from '../../types';
import type { ActivityEvent, AgentComm, AgentReport, ProgressSnapshot } from '../leadStore';

const LEAD_ID = 'lead-test-001';

function resetStore() {
  useLeadStore.getState().reset();
  useLeadStore.getState().addProject(LEAD_ID);
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    agentId: 'agent-1',
    agentRole: 'Developer',
    leadId: LEAD_ID,
    projectId: null,
    title: 'Use tabs',
    rationale: 'Consistency',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'style',
    ...overrides,
  };
}

function makeProgress(overrides: Partial<LeadProgress> = {}): LeadProgress {
  return {
    totalDelegations: 3,
    active: 1,
    completed: 1,
    failed: 0,
    completionPct: 33,
    crewSize: 2,
    crewAgents: [],
    delegations: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<AcpToolCall> = {}): AcpToolCall {
  return {
    toolCallId: 'tc-1',
    title: 'bash',
    kind: 'tool',
    status: 'completed',
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'act-1',
    agentId: 'agent-1',
    agentRole: 'Developer',
    type: 'tool_call',
    summary: 'ran bash',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeComm(overrides: Partial<AgentComm> = {}): AgentComm {
  return {
    id: 'comm-1',
    fromId: 'agent-1',
    fromRole: 'Developer',
    toId: 'lead-1',
    toRole: 'Lead',
    content: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  return {
    id: 'rpt-1',
    fromRole: 'Developer',
    fromId: 'agent-1',
    content: 'Done with task',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('leadStore', () => {
  beforeEach(resetStore);

  // ── Core project management ──────────────────────────────

  describe('selectLead', () => {
    it('sets selectedLeadId', () => {
      useLeadStore.getState().selectLead(LEAD_ID);
      expect(useLeadStore.getState().selectedLeadId).toBe(LEAD_ID);
    });

    it('clears selectedLeadId with null', () => {
      useLeadStore.getState().selectLead(LEAD_ID);
      useLeadStore.getState().selectLead(null);
      expect(useLeadStore.getState().selectedLeadId).toBeNull();
    });
  });

  describe('addProject', () => {
    it('creates empty project state', () => {
      const proj = useLeadStore.getState().projects[LEAD_ID];
      expect(proj).toBeDefined();
      expect(proj.messages).toEqual([]);
      expect(proj.decisions).toEqual([]);
      expect(proj.progress).toBeNull();
      expect(proj.dagStatus).toBeNull();
    });

    it('is idempotent — does not overwrite existing project', () => {
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'hi', sender: 'user', timestamp: 1 });
      useLeadStore.getState().addProject(LEAD_ID); // re-add
      expect(useLeadStore.getState().projects[LEAD_ID].messages).toHaveLength(1);
    });
  });

  describe('removeProject', () => {
    it('removes the project and its draft', () => {
      useLeadStore.getState().setDraft(LEAD_ID, 'draft text');
      useLeadStore.getState().removeProject(LEAD_ID);
      expect(useLeadStore.getState().projects[LEAD_ID]).toBeUndefined();
      expect(useLeadStore.getState().drafts[LEAD_ID]).toBeUndefined();
    });

    it('resets selectedLeadId when removed project was selected', () => {
      useLeadStore.getState().selectLead(LEAD_ID);
      useLeadStore.getState().removeProject(LEAD_ID);
      expect(useLeadStore.getState().selectedLeadId).toBeNull();
    });

    it('preserves selectedLeadId when a different project is removed', () => {
      useLeadStore.getState().addProject('other-lead');
      useLeadStore.getState().selectLead(LEAD_ID);
      useLeadStore.getState().removeProject('other-lead');
      expect(useLeadStore.getState().selectedLeadId).toBe(LEAD_ID);
    });
  });

  describe('setDraft', () => {
    it('stores draft text for a lead', () => {
      useLeadStore.getState().setDraft(LEAD_ID, 'hello world');
      expect(useLeadStore.getState().drafts[LEAD_ID]).toBe('hello world');
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      useLeadStore.getState().selectLead(LEAD_ID);
      useLeadStore.getState().setDraft(LEAD_ID, 'draft');
      useLeadStore.getState().reset();
      expect(useLeadStore.getState().projects).toEqual({});
      expect(useLeadStore.getState().selectedLeadId).toBeNull();
    });
  });

  // ── Decisions ────────────────────────────────────────────

  describe('setDecisions', () => {
    it('replaces all decisions for a lead', () => {
      const decs = [makeDecision({ id: 'd1' }), makeDecision({ id: 'd2' })];
      useLeadStore.getState().setDecisions(LEAD_ID, decs);
      expect(useLeadStore.getState().projects[LEAD_ID].decisions).toHaveLength(2);
    });

    it('creates project if it does not exist', () => {
      useLeadStore.getState().setDecisions('new-lead', [makeDecision()]);
      expect(useLeadStore.getState().projects['new-lead'].decisions).toHaveLength(1);
    });
  });

  describe('addDecision', () => {
    it('appends a decision to existing list', () => {
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'd1' }));
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'd2' }));
      expect(useLeadStore.getState().projects[LEAD_ID].decisions).toHaveLength(2);
    });
  });

  describe('updateDecision', () => {
    it('updates a specific decision by id', () => {
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'd1', status: 'recorded' }));
      useLeadStore.getState().updateDecision(LEAD_ID, 'd1', { status: 'confirmed' });
      expect(useLeadStore.getState().projects[LEAD_ID].decisions[0].status).toBe('confirmed');
    });

    it('does not affect other decisions', () => {
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'd1' }));
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'd2', title: 'Use spaces' }));
      useLeadStore.getState().updateDecision(LEAD_ID, 'd1', { status: 'rejected' });
      expect(useLeadStore.getState().projects[LEAD_ID].decisions[1].title).toBe('Use spaces');
      expect(useLeadStore.getState().projects[LEAD_ID].decisions[1].status).toBe('recorded');
    });
  });

  // ── Progress ─────────────────────────────────────────────

  describe('setProgress', () => {
    it('sets progress for a lead', () => {
      useLeadStore.getState().setProgress(LEAD_ID, makeProgress({ completionPct: 50 }));
      expect(useLeadStore.getState().projects[LEAD_ID].progress?.completionPct).toBe(50);
    });

    it('normalizes team→crew properties', () => {
      const oldFormat = { ...makeProgress(), crewAgents: undefined as any, crewSize: undefined as any, teamAgents: [{ id: 'a1' }], teamSize: 3 };
      useLeadStore.getState().setProgress(LEAD_ID, oldFormat as any);
      const progress = useLeadStore.getState().projects[LEAD_ID].progress!;
      expect(progress.crewAgents).toEqual([{ id: 'a1' }]);
      expect(progress.crewSize).toBe(3);
    });
  });

  describe('setProgressSummary', () => {
    it('sets summary text', () => {
      useLeadStore.getState().setProgressSummary(LEAD_ID, 'All tasks done');
      expect(useLeadStore.getState().projects[LEAD_ID].progressSummary).toBe('All tasks done');
    });
  });

  describe('addProgressSnapshot', () => {
    it('appends snapshot to history', () => {
      const snap: ProgressSnapshot = { summary: 'Midpoint', completed: ['a'], inProgress: ['b'], blocked: [], timestamp: Date.now() };
      useLeadStore.getState().addProgressSnapshot(LEAD_ID, snap);
      useLeadStore.getState().addProgressSnapshot(LEAD_ID, { ...snap, summary: 'Later' });
      expect(useLeadStore.getState().projects[LEAD_ID].progressHistory).toHaveLength(2);
    });
  });

  // ── Messages ─────────────────────────────────────────────

  describe('addMessage', () => {
    it('adds a message with timestamp', () => {
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'hello', sender: 'user', timestamp: 12345 });
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].timestamp).toBe(12345);
    });

    it('defaults timestamp to Date.now() if not provided', () => {
      const before = Date.now();
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'hi', sender: 'user' });
      const ts = useLeadStore.getState().projects[LEAD_ID].messages[0].timestamp!;
      expect(ts).toBeGreaterThanOrEqual(before);
    });
  });

  describe('setMessages', () => {
    it('replaces all messages', () => {
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'old', sender: 'user', timestamp: 1 });
      useLeadStore.getState().setMessages(LEAD_ID, [{ type: 'text', text: 'new', sender: 'agent', timestamp: 2 }]);
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].text).toBe('new');
    });
  });

  describe('promoteQueuedMessages', () => {
    it('clears queued flag from all messages', () => {
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'q1', sender: 'user', queued: true, timestamp: 1 });
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'q2', sender: 'user', queued: true, timestamp: 2 });
      useLeadStore.getState().promoteQueuedMessages(LEAD_ID);
      const msgs = useLeadStore.getState().projects[LEAD_ID].messages;
      expect(msgs.every((m) => !m.queued)).toBe(true);
    });

    it('does not affect non-queued messages', () => {
      useLeadStore.getState().addMessage(LEAD_ID, { type: 'text', text: 'normal', sender: 'agent', timestamp: 1 });
      useLeadStore.getState().promoteQueuedMessages(LEAD_ID);
      expect(useLeadStore.getState().projects[LEAD_ID].messages[0].text).toBe('normal');
    });
  });

  // ── Tool calls ───────────────────────────────────────────

  describe('updateToolCall', () => {
    it('adds a new tool call', () => {
      useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall({ toolCallId: 'tc-1' }));
      expect(useLeadStore.getState().projects[LEAD_ID].toolCalls).toHaveLength(1);
    });

    it('updates existing tool call by toolCallId', () => {
      useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall({ toolCallId: 'tc-1', status: 'pending' }));
      useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall({ toolCallId: 'tc-1', status: 'completed' }));
      const calls = useLeadStore.getState().projects[LEAD_ID].toolCalls;
      expect(calls).toHaveLength(1);
      expect(calls[0].status).toBe('completed');
    });

    it('keeps only last 50 tool calls', () => {
      for (let i = 0; i < 55; i++) {
        useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall({ toolCallId: `tc-${i}` }));
      }
      const calls = useLeadStore.getState().projects[LEAD_ID].toolCalls;
      expect(calls).toHaveLength(50);
      expect(calls[0].toolCallId).toBe('tc-5');
    });

    it('sets pendingNewline to true', () => {
      useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall());
      expect(useLeadStore.getState().projects[LEAD_ID].pendingNewline).toBe(true);
    });
  });

  // ── Activity ─────────────────────────────────────────────

  describe('addActivity', () => {
    it('adds an activity event', () => {
      useLeadStore.getState().addActivity(LEAD_ID, makeActivity());
      expect(useLeadStore.getState().projects[LEAD_ID].activity).toHaveLength(1);
    });

    it('keeps only last 100 events', () => {
      for (let i = 0; i < 105; i++) {
        useLeadStore.getState().addActivity(LEAD_ID, makeActivity({ id: `act-${i}` }));
      }
      const activity = useLeadStore.getState().projects[LEAD_ID].activity;
      expect(activity).toHaveLength(100);
      expect(activity[0].id).toBe('act-5');
    });
  });

  // ── Comms ────────────────────────────────────────────────

  describe('addComm', () => {
    it('adds a communication event', () => {
      useLeadStore.getState().addComm(LEAD_ID, makeComm());
      expect(useLeadStore.getState().projects[LEAD_ID].comms).toHaveLength(1);
    });

    it('keeps only last 200 comms', () => {
      for (let i = 0; i < 205; i++) {
        useLeadStore.getState().addComm(LEAD_ID, makeComm({ id: `comm-${i}` }));
      }
      const comms = useLeadStore.getState().projects[LEAD_ID].comms;
      expect(comms).toHaveLength(200);
      expect(comms[0].id).toBe('comm-5');
    });
  });

  // ── Agent reports ────────────────────────────────────────

  describe('addAgentReport', () => {
    it('adds a report', () => {
      useLeadStore.getState().addAgentReport(LEAD_ID, makeReport());
      expect(useLeadStore.getState().projects[LEAD_ID].agentReports).toHaveLength(1);
    });

    it('keeps only last 100 reports', () => {
      for (let i = 0; i < 105; i++) {
        useLeadStore.getState().addAgentReport(LEAD_ID, makeReport({ id: `rpt-${i}` }));
      }
      const reports = useLeadStore.getState().projects[LEAD_ID].agentReports;
      expect(reports).toHaveLength(100);
      expect(reports[0].id).toBe('rpt-5');
    });
  });

  // ── Groups ───────────────────────────────────────────────

  describe('setGroups', () => {
    it('replaces groups for a lead', () => {
      const groups: ChatGroup[] = [{ name: 'design', leadId: LEAD_ID, memberIds: ['a1'], createdAt: new Date().toISOString() }];
      useLeadStore.getState().setGroups(LEAD_ID, groups);
      expect(useLeadStore.getState().projects[LEAD_ID].groups).toHaveLength(1);
    });
  });

  describe('addGroupMessage', () => {
    it('adds a message to a group', () => {
      const msg: GroupMessage = { id: 'gm-1', groupName: 'design', leadId: LEAD_ID, fromAgentId: 'a1', fromRole: 'Dev', content: 'hi', timestamp: new Date().toISOString() };
      useLeadStore.getState().addGroupMessage(LEAD_ID, 'design', msg);
      expect(useLeadStore.getState().projects[LEAD_ID].groupMessages['design']).toHaveLength(1);
    });

    it('deduplicates by message id', () => {
      const msg: GroupMessage = { id: 'gm-1', groupName: 'design', leadId: LEAD_ID, fromAgentId: 'a1', fromRole: 'Dev', content: 'hi', timestamp: new Date().toISOString() };
      useLeadStore.getState().addGroupMessage(LEAD_ID, 'design', msg);
      useLeadStore.getState().addGroupMessage(LEAD_ID, 'design', msg);
      expect(useLeadStore.getState().projects[LEAD_ID].groupMessages['design']).toHaveLength(1);
    });

    it('keeps only last 500 messages per group', () => {
      for (let i = 0; i < 505; i++) {
        useLeadStore.getState().addGroupMessage(LEAD_ID, 'design', {
          id: `gm-${i}`, groupName: 'design', leadId: LEAD_ID, fromAgentId: 'a1', fromRole: 'Dev', content: `msg ${i}`, timestamp: new Date().toISOString(),
        });
      }
      const msgs = useLeadStore.getState().projects[LEAD_ID].groupMessages['design'];
      expect(msgs).toHaveLength(500);
      expect(msgs[0].id).toBe('gm-5');
    });
  });

  // ── DAG status ───────────────────────────────────────────

  describe('setDagStatus', () => {
    it('sets DAG status for a lead', () => {
      const status: DagStatus = { tasks: [], fileLockMap: {}, summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } };
      useLeadStore.getState().setDagStatus(LEAD_ID, status);
      expect(useLeadStore.getState().projects[LEAD_ID].dagStatus).toEqual(status);
    });
  });

  // ── appendToThinkingMessage (existing tests) ─────────────

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

  describe('migrateProject', () => {
    it('migrates messages from project:xxx to agent UUID', () => {
      const store = useLeadStore.getState();
      store.addProject('project:abc');
      store.addMessage('project:abc', { type: 'text', text: 'hello', sender: 'agent', timestamp: 1 });
      store.addMessage('project:abc', { type: 'text', text: 'world', sender: 'user', timestamp: 2 });

      store.addProject('lead-uuid');
      store.migrateProject('project:abc', 'lead-uuid');

      const state = useLeadStore.getState();
      expect(state.projects['lead-uuid'].messages).toHaveLength(2);
      expect(state.projects['lead-uuid'].messages[0].text).toBe('hello');
      expect(state.projects['project:abc']).toBeUndefined();
    });

    it('preserves target messages when non-empty', () => {
      const store = useLeadStore.getState();
      store.addProject('project:abc');
      store.addMessage('project:abc', { type: 'text', text: 'old', sender: 'agent', timestamp: 1 });

      store.addProject('lead-uuid');
      store.addMessage('lead-uuid', { type: 'text', text: 'new', sender: 'agent', timestamp: 2 });

      store.migrateProject('project:abc', 'lead-uuid');

      const state = useLeadStore.getState();
      expect(state.projects['lead-uuid'].messages).toHaveLength(1);
      expect(state.projects['lead-uuid'].messages[0].text).toBe('new');
    });

    it('no-op when source does not exist', () => {
      const store = useLeadStore.getState();
      store.addProject('lead-uuid');
      const before = useLeadStore.getState().projects;
      store.migrateProject('nonexistent', 'lead-uuid');
      const after = useLeadStore.getState().projects;
      expect(after['lead-uuid']).toEqual(before['lead-uuid']);
    });

    it('no-op when fromId equals toId', () => {
      const store = useLeadStore.getState();
      store.addProject('lead-uuid');
      store.addMessage('lead-uuid', { type: 'text', text: 'keep', sender: 'agent', timestamp: 1 });
      store.migrateProject('lead-uuid', 'lead-uuid');
      expect(useLeadStore.getState().projects['lead-uuid'].messages).toHaveLength(1);
    });

    it('creates target if it did not exist', () => {
      const store = useLeadStore.getState();
      store.addProject('project:abc');
      store.addMessage('project:abc', { type: 'text', text: 'data', sender: 'agent', timestamp: 1 });

      store.migrateProject('project:abc', 'brand-new');

      const state = useLeadStore.getState();
      expect(state.projects['brand-new'].messages).toHaveLength(1);
      expect(state.projects['brand-new'].messages[0].text).toBe('data');
      expect(state.projects['project:abc']).toBeUndefined();
    });

    it('migrates activity and decisions', () => {
      const store = useLeadStore.getState();
      store.addProject('project:abc');
      store.addActivity('project:abc', { id: 'a1', type: 'delegated', timestamp: 1 } as any);

      store.migrateProject('project:abc', 'lead-uuid');

      const state = useLeadStore.getState();
      expect(state.projects['lead-uuid'].activity).toHaveLength(1);
    });
  });
});
