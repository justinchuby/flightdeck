import { describe, it, expect, beforeEach } from 'vitest';
import { useLeadStore, resolveProject } from '../leadStore';
import { useMessageStore } from '../messageStore';
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
      expect(proj.decisions).toEqual([]);
      expect(proj.progress).toBeNull();
      expect(proj.dagStatus).toBeNull();
    });

    it('is idempotent — does not overwrite existing project', () => {
      useLeadStore.getState().addProject(LEAD_ID); // re-add
      expect(useLeadStore.getState().projects[LEAD_ID]).toBeDefined();
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

    it('cleans up projectToLead aliases when project is removed', () => {
      useLeadStore.getState().addProject(LEAD_ID, 'project-abc');
      expect(useLeadStore.getState().projectToLead['project-abc']).toBe(LEAD_ID);
      useLeadStore.getState().removeProject(LEAD_ID);
      expect(useLeadStore.getState().projectToLead['project-abc']).toBeUndefined();
    });
  });

  describe('addProject with projectId alias', () => {
    it('registers projectId → leadId alias', () => {
      useLeadStore.getState().addProject('lead-xyz', 'project-xyz');
      expect(useLeadStore.getState().projectToLead['project-xyz']).toBe('lead-xyz');
    });

    it('does not register alias when projectId is undefined', () => {
      useLeadStore.getState().addProject('lead-no-project');
      expect(Object.keys(useLeadStore.getState().projectToLead)).not.toContain('undefined');
    });
  });

  describe('linkProjectId', () => {
    it('creates a projectId → leadId mapping', () => {
      useLeadStore.getState().linkProjectId('project-123', LEAD_ID);
      expect(useLeadStore.getState().projectToLead['project-123']).toBe(LEAD_ID);
    });

    it('is idempotent', () => {
      useLeadStore.getState().linkProjectId('project-123', LEAD_ID);
      const stateBefore = useLeadStore.getState();
      useLeadStore.getState().linkProjectId('project-123', LEAD_ID);
      expect(useLeadStore.getState().projectToLead).toEqual(stateBefore.projectToLead);
    });
  });

  describe('resolveProject', () => {
    it('resolves by leadId directly', () => {
      const state = useLeadStore.getState();
      const proj = resolveProject(state, LEAD_ID);
      expect(proj).toBeDefined();
      expect(proj?.decisions).toEqual([]);
    });

    it('resolves by projectId via alias', () => {
      useLeadStore.getState().linkProjectId('project-abc', LEAD_ID);
      useLeadStore.getState().addDecision(LEAD_ID, makeDecision({ id: 'dec-alias' }));
      const state = useLeadStore.getState();
      const proj = resolveProject(state, 'project-abc');
      expect(proj).toBeDefined();
      expect(proj?.decisions).toHaveLength(1);
      expect(proj?.decisions[0].id).toBe('dec-alias');
    });

    it('returns undefined for unknown key', () => {
      const state = useLeadStore.getState();
      expect(resolveProject(state, 'nonexistent')).toBeUndefined();
    });

    it('returns undefined for null/undefined', () => {
      const state = useLeadStore.getState();
      expect(resolveProject(state, null)).toBeUndefined();
      expect(resolveProject(state, undefined)).toBeUndefined();
    });
  });

  describe('setDraft', () => {
    it('stores draft text for a lead', () => {
      useLeadStore.getState().setDraft(LEAD_ID, 'hello world');
      expect(useLeadStore.getState().drafts[LEAD_ID]).toBe('hello world');
    });
  });

  describe('reset', () => {
    it('clears all state including aliases', () => {
      useLeadStore.getState().selectLead(LEAD_ID);
      useLeadStore.getState().setDraft(LEAD_ID, 'draft');
      useLeadStore.getState().linkProjectId('project-abc', LEAD_ID);
      useLeadStore.getState().reset();
      expect(useLeadStore.getState().projects).toEqual({});
      expect(useLeadStore.getState().projectToLead).toEqual({});
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

  // ── Messages moved to messageStore.test.ts ──────────────

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

    it('sets pendingNewline on messageStore', () => {
      useMessageStore.getState().ensureChannel(LEAD_ID);
      useLeadStore.getState().updateToolCall(LEAD_ID, makeToolCall());
      expect(useMessageStore.getState().channels[LEAD_ID].pendingNewline).toBe(true);
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

  // ── appendToThinkingMessage, unclosed command blocks, interrupts,
  //    DM surfacing — moved to messageStore.test.ts ────────────
});
