import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { AgentMessageService } from '../agents/services/AgentMessageService.js';
import { AgentMonitorService } from '../agents/services/AgentMonitorService.js';
import { AgentKnowledgeService } from '../agents/services/AgentKnowledgeService.js';

// ---------------------------------------------------------------------------
// AgentMessageService
// ---------------------------------------------------------------------------
describe('AgentMessageService', () => {
  let db: Database;
  let svc: AgentMessageService;

  beforeEach(() => {
    vi.useFakeTimers();
    db = new Database(':memory:');
    svc = new AgentMessageService(db);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  // -- createThread --------------------------------------------------------
  describe('createThread', () => {
    it('creates a thread for an agent', () => {
      // Should not throw; creates internal mapping
      svc.createThread('agent-1', 'Fix the bug');
      // Verify the thread exists by persisting + retrieving a message
      svc.persistSystemMessage('agent-1', 'hello');
      const msgs = svc.getMessageHistory('agent-1');
      expect(msgs.length).toBe(1);
      expect(msgs[0].content).toBe('hello');
    });

    it('no-ops when constructed without a database', () => {
      const noDb = new AgentMessageService(undefined);
      noDb.createThread('agent-1');
      // Should not throw, and getMessageHistory returns []
      expect(noDb.getMessageHistory('agent-1')).toEqual([]);
    });
  });

  // -- persistHumanMessage -------------------------------------------------
  describe('persistHumanMessage', () => {
    it('persists a user message to the thread', () => {
      svc.createThread('a1');
      svc.persistHumanMessage('a1', 'Please fix tests');
      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('user');
      expect(msgs[0].content).toBe('Please fix tests');
    });

    it('flushes pending agent + thinking buffers before persisting', () => {
      svc.createThread('a1');
      svc.bufferAgentMessage('a1', 'partial agent output');
      svc.bufferThinkingMessage('a1', 'thinking...');
      svc.persistHumanMessage('a1', 'user msg');
      const msgs = svc.getMessageHistory('a1');
      // getMessageHistory returns newest-first; agent was flushed first, user last
      expect(msgs).toHaveLength(3);
      expect(msgs[0].sender).toBe('user');
      expect(msgs[1].sender).toBe('thinking');
      expect(msgs[2].sender).toBe('agent');
    });

    it('ignores messages for unknown threads', () => {
      svc.persistHumanMessage('nonexistent', 'hi');
      expect(svc.getMessageHistory('nonexistent')).toEqual([]);
    });
  });

  // -- persistSystemMessage ------------------------------------------------
  describe('persistSystemMessage', () => {
    it('persists a system message', () => {
      svc.createThread('a1');
      svc.persistSystemMessage('a1', 'System info');
      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('system');
    });
  });

  // -- persistExternalMessage ----------------------------------------------
  describe('persistExternalMessage', () => {
    it('persists an external DM with fromRole', () => {
      svc.createThread('a1');
      svc.persistExternalMessage('a1', 'DM content', 'developer');
      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('external');
      expect(msgs[0].content).toBe('DM content');
    });
  });

  // -- bufferAgentMessage / flushAgentMessage ------------------------------
  describe('bufferAgentMessage', () => {
    it('accumulates text and flushes after 2s debounce', () => {
      svc.createThread('a1');
      svc.bufferAgentMessage('a1', 'Hello ');
      svc.bufferAgentMessage('a1', 'World');

      // Let the 2s debounce fire
      vi.advanceTimersByTime(2000);

      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[0].content).toBe('Hello World');
    });

    it('resets the debounce timer on each new chunk', () => {
      svc.createThread('a1');
      svc.bufferAgentMessage('a1', 'A');
      vi.advanceTimersByTime(1500);
      svc.bufferAgentMessage('a1', 'B');
      // Timer was reset at 1.5s — needs another 2s from here
      vi.advanceTimersByTime(2000);

      const msgs = svc.getMessageHistory('a1');
      // Should be a single concatenated message
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('AB');
    });
  });

  // -- flushAgentMessage ---------------------------------------------------
  describe('flushAgentMessage', () => {
    it('immediately writes buffered text to the store', () => {
      svc.createThread('a1');
      svc.bufferAgentMessage('a1', 'some output');
      svc.flushAgentMessage('a1');

      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('agent');
      expect(msgs[0].content).toBe('some output');
    });

    it('is a no-op when no buffered text exists', () => {
      svc.createThread('a1');
      svc.flushAgentMessage('a1'); // should not throw
      expect(svc.getMessageHistory('a1')).toHaveLength(0);
    });
  });

  // -- bufferThinkingMessage / flushThinkingMessage ------------------------
  describe('bufferThinkingMessage', () => {
    it('accumulates thinking text and flushes after 2s', () => {
      svc.createThread('a1');
      svc.bufferThinkingMessage('a1', 'hmm...');
      vi.advanceTimersByTime(2000);

      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].sender).toBe('thinking');
      expect(msgs[0].content).toBe('hmm...');
    });

    it('flushes pending agent text before buffering thinking', () => {
      svc.createThread('a1');
      svc.bufferAgentMessage('a1', 'agent text');
      svc.bufferThinkingMessage('a1', 'thinking text');
      // Agent text was flushed by bufferThinkingMessage; let thinking flush via timer
      vi.advanceTimersByTime(2000);

      const msgs = svc.getMessageHistory('a1');
      expect(msgs).toHaveLength(2);
      // newest-first: thinking was stored after agent
      expect(msgs[0].sender).toBe('thinking');
      expect(msgs[1].sender).toBe('agent');
    });
  });

  // -- flushAllMessages ----------------------------------------------------
  describe('flushAllMessages', () => {
    it('flushes buffered agent and thinking messages for all agents', () => {
      svc.createThread('a1');
      svc.createThread('a2');
      svc.bufferAgentMessage('a1', 'agent-1 output');
      svc.bufferAgentMessage('a2', 'agent-2 output');
      svc.bufferThinkingMessage('a1', 'a1 thinking');

      svc.flushAllMessages();

      const m1 = svc.getMessageHistory('a1');
      const m2 = svc.getMessageHistory('a2');
      expect(m1.filter((m) => m.sender === 'agent')).toHaveLength(1);
      expect(m1.filter((m) => m.sender === 'thinking')).toHaveLength(1);
      expect(m2.filter((m) => m.sender === 'agent')).toHaveLength(1);
    });
  });

  // -- getMessageHistory ---------------------------------------------------
  describe('getMessageHistory', () => {
    it('returns messages newest-first', () => {
      svc.createThread('a1');
      svc.persistSystemMessage('a1', 'first');
      svc.persistSystemMessage('a1', 'second');
      svc.persistSystemMessage('a1', 'third');

      const msgs = svc.getMessageHistory('a1');
      expect(msgs.map((m) => m.content)).toEqual(['third', 'second', 'first']);
    });

    it('returns empty array without a database', () => {
      const noDb = new AgentMessageService(undefined);
      expect(noDb.getMessageHistory('any')).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// AgentMonitorService
// ---------------------------------------------------------------------------
describe('AgentMonitorService', () => {
  const makeHeartbeatCtx = () => ({
    getAllAgents: vi.fn().mockReturnValue([]),
    getDelegationsMap: vi.fn().mockReturnValue(new Map()),
    getDagSummary: vi.fn().mockReturnValue(null),
    getRemainingTasks: vi.fn().mockReturnValue([]),
    getTaskByAgent: vi.fn().mockReturnValue(null),
    emit: vi.fn() as any,
  });

  const makeAgent = (overrides: Record<string, any> = {}) => ({
    id: 'child-1',
    status: 'idle' as string,
    parentId: 'lead-1',
    sendMessage: vi.fn(),
    ...overrides,
  });

  const makeTaskDAG = (overrides: Record<string, any> = {}) => ({
    getTaskByAgent: vi.fn().mockReturnValue(null),
    ...overrides,
  });

  let svc: AgentMonitorService;
  let heartbeatCtx: ReturnType<typeof makeHeartbeatCtx>;

  beforeEach(() => {
    vi.useFakeTimers();
    heartbeatCtx = makeHeartbeatCtx();
    svc = new AgentMonitorService(heartbeatCtx as any);
  });

  afterEach(() => {
    svc.clearAllTimers();
    svc.stop();
    vi.useRealTimers();
  });

  // -- startIdleNudge ------------------------------------------------------
  describe('startIdleNudge', () => {
    it('sets a 30s timer', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG();
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);

      // Timer should not fire before 30s
      vi.advanceTimersByTime(29_999);
      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('fires nudge after 30s when agent is idle with a running task', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Implement feature',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).toHaveBeenCalledTimes(1);
      expect(agent.sendMessage.mock.calls[0][0]).toContain('uncompleted task');
      expect(agent.sendMessage.mock.calls[0][0]).toContain('Implement feature');
    });

    it('does not nudge if agent transitions to running before timeout', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      // Agent starts working before 30s
      agent.status = 'running';
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('does not nudge if agent is removed from the map', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      agents.delete('child-1');
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('does not nudge if agent has no parentId', () => {
      const agent = makeAgent({ parentId: undefined });
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('does not nudge if task dagStatus is not running', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'done',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('does not start a duplicate timer for the same agent', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      svc.startIdleNudge(agent as any, taskDAG as any, agents as any); // duplicate

      vi.advanceTimersByTime(30_000);
      expect(agent.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // -- clearIdleNudgeTimer -------------------------------------------------
  describe('clearIdleNudgeTimer', () => {
    it('cancels the pending nudge timer', () => {
      const agent = makeAgent();
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([['child-1', agent as any]]);

      svc.startIdleNudge(agent as any, taskDAG as any, agents as any);
      svc.clearIdleNudgeTimer('child-1');
      vi.advanceTimersByTime(30_000);

      expect(agent.sendMessage).not.toHaveBeenCalled();
    });

    it('is a no-op when no timer exists for that agent', () => {
      expect(() => svc.clearIdleNudgeTimer('unknown-agent')).not.toThrow();
    });
  });

  // -- clearAllTimers ------------------------------------------------------
  describe('clearAllTimers', () => {
    it('clears timers for all agents', () => {
      const a1 = makeAgent({ id: 'c1' });
      const a2 = makeAgent({ id: 'c2' });
      const taskDAG = makeTaskDAG({
        getTaskByAgent: vi.fn().mockReturnValue({
          id: 'task-1',
          title: 'Task',
          dagStatus: 'running',
        }),
      });
      const agents = new Map([
        ['c1', a1 as any],
        ['c2', a2 as any],
      ]);

      svc.startIdleNudge(a1 as any, taskDAG as any, agents as any);
      svc.startIdleNudge(a2 as any, taskDAG as any, agents as any);
      svc.clearAllTimers();
      vi.advanceTimersByTime(30_000);

      expect(a1.sendMessage).not.toHaveBeenCalled();
      expect(a2.sendMessage).not.toHaveBeenCalled();
    });
  });

  // -- updateLeadBudgets ---------------------------------------------------
  describe('updateLeadBudgets', () => {
    it('updates budget on all provided agents', () => {
      const agents = [
        { budget: undefined as any },
        { budget: undefined as any },
      ];
      svc.updateLeadBudgets(agents as any, 5, 2);

      for (const agent of agents) {
        expect(agent.budget).toEqual({ maxConcurrent: 5, runningCount: 2 });
      }
    });

    it('each agent gets an independent budget object', () => {
      const agents = [{ budget: undefined as any }, { budget: undefined as any }];
      svc.updateLeadBudgets(agents as any, 3, 1);
      // Mutating one should not affect the other
      agents[0].budget.runningCount = 99;
      expect(agents[1].budget.runningCount).toBe(1);
    });
  });

  // -- heartbeat delegation ------------------------------------------------
  describe('heartbeat delegation', () => {
    it('delegates trackIdle / trackActive / trackRemoved to HeartbeatMonitor', () => {
      // These are pass-through calls — verify no errors
      expect(() => svc.trackIdle('agent-1')).not.toThrow();
      expect(() => svc.trackActive('agent-1')).not.toThrow();
      expect(() => svc.trackRemoved('agent-1')).not.toThrow();
      expect(() => svc.trackHumanInterrupt('agent-1')).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// AgentKnowledgeService
// ---------------------------------------------------------------------------
describe('AgentKnowledgeService', () => {
  let svc: AgentKnowledgeService;

  const baseRole = () => ({
    id: 'developer',
    name: 'Developer',
    description: 'A developer role',
    systemPrompt: 'You are a developer.',
    color: '#000',
    icon: '🔧',
    builtIn: true,
  });

  beforeEach(() => {
    svc = new AgentKnowledgeService();
  });

  // -- enrichPrompt --------------------------------------------------------
  describe('enrichPrompt', () => {
    it('returns the original role when no injectors are set', () => {
      const role = baseRole();
      const result = svc.enrichPrompt(role, 'proj-1', 'do a thing');
      expect(result.systemPrompt).toBe(role.systemPrompt);
    });

    it('injects project knowledge into the system prompt', () => {
      const injector = {
        injectKnowledge: vi.fn().mockReturnValue({
          text: '<knowledge>important info</knowledge>',
          totalTokens: 50,
          entriesIncluded: 2,
          breakdown: {},
        }),
      };
      svc.setKnowledgeInjector(injector as any);

      const result = svc.enrichPrompt(baseRole(), 'proj-1', 'fix bug');
      expect(result.systemPrompt).toContain('important info');
      expect(injector.injectKnowledge).toHaveBeenCalledWith('proj-1', {
        task: 'fix bug',
        role: 'developer',
      });
    });

    it('skips knowledge injection when projectId is undefined', () => {
      const injector = { injectKnowledge: vi.fn() };
      svc.setKnowledgeInjector(injector as any);

      svc.enrichPrompt(baseRole(), undefined, 'task');
      expect(injector.injectKnowledge).not.toHaveBeenCalled();
    });

    it('skips knowledge injection when injection text is empty', () => {
      const injector = {
        injectKnowledge: vi.fn().mockReturnValue({
          text: '',
          totalTokens: 0,
          entriesIncluded: 0,
          breakdown: {},
        }),
      };
      svc.setKnowledgeInjector(injector as any);

      const role = baseRole();
      const result = svc.enrichPrompt(role, 'proj-1', undefined);
      expect(result.systemPrompt).toBe(role.systemPrompt);
    });

    it('injects skills into the system prompt', () => {
      const loader = {
        formatForInjection: vi.fn().mockReturnValue('<skills>skill1</skills>'),
        count: 1,
      };
      svc.setSkillsLoader(loader as any);

      const result = svc.enrichPrompt(baseRole(), 'proj-1', 'task');
      expect(result.systemPrompt).toContain('skill1');
    });

    it('skips skills injection when formatForInjection returns empty', () => {
      const loader = {
        formatForInjection: vi.fn().mockReturnValue(''),
        count: 0,
      };
      svc.setSkillsLoader(loader as any);

      const role = baseRole();
      const result = svc.enrichPrompt(role, 'proj-1', 'task');
      expect(result.systemPrompt).toBe(role.systemPrompt);
    });

    it('injects collective memories into the system prompt', () => {
      const memory = {
        recall: vi.fn().mockReturnValue([
          { category: 'decision', key: 'use-vitest', value: 'We chose vitest for tests' },
          { category: 'pattern', key: 'di-pattern', value: 'Constructor injection' },
        ]),
      };
      svc.setCollectiveMemory(memory as any);

      const result = svc.enrichPrompt(baseRole(), 'proj-1', 'task');
      expect(result.systemPrompt).toContain('<collective_memory>');
      expect(result.systemPrompt).toContain('use-vitest');
      expect(result.systemPrompt).toContain('Constructor injection');
      // recall is called once per category: pattern, decision, gotcha
      expect(memory.recall).toHaveBeenCalledTimes(3);
    });

    it('skips collective memory when projectId is undefined', () => {
      const memory = { recall: vi.fn().mockReturnValue([]) };
      svc.setCollectiveMemory(memory as any);

      svc.enrichPrompt(baseRole(), undefined, 'task');
      expect(memory.recall).not.toHaveBeenCalled();
    });

    it('skips collective memory when recall returns empty', () => {
      const memory = { recall: vi.fn().mockReturnValue([]) };
      svc.setCollectiveMemory(memory as any);

      const role = baseRole();
      const result = svc.enrichPrompt(role, 'proj-1', 'task');
      expect(result.systemPrompt).not.toContain('<collective_memory>');
    });

    it('does not mutate the original role object', () => {
      const injector = {
        injectKnowledge: vi.fn().mockReturnValue({
          text: 'extra knowledge',
          totalTokens: 10,
          entriesIncluded: 1,
          breakdown: {},
        }),
      };
      svc.setKnowledgeInjector(injector as any);

      const role = baseRole();
      const original = role.systemPrompt;
      svc.enrichPrompt(role, 'proj-1', 'task');
      expect(role.systemPrompt).toBe(original);
    });

    it('combines knowledge, skills, and memories in order', () => {
      svc.setKnowledgeInjector({
        injectKnowledge: vi.fn().mockReturnValue({
          text: '[KNOWLEDGE]',
          totalTokens: 10,
          entriesIncluded: 1,
          breakdown: {},
        }),
      } as any);
      svc.setSkillsLoader({
        formatForInjection: vi.fn().mockReturnValue('[SKILLS]'),
        count: 1,
      } as any);
      svc.setCollectiveMemory({
        recall: vi.fn().mockReturnValue([
          { category: 'decision', key: 'k', value: 'v' },
        ]),
      } as any);

      const result = svc.enrichPrompt(baseRole(), 'proj-1', 'task');
      const prompt = result.systemPrompt;
      const knowledgeIdx = prompt.indexOf('[KNOWLEDGE]');
      const skillsIdx = prompt.indexOf('[SKILLS]');
      const memoryIdx = prompt.indexOf('<collective_memory>');

      expect(knowledgeIdx).toBeGreaterThan(-1);
      expect(skillsIdx).toBeGreaterThan(knowledgeIdx);
      expect(memoryIdx).toBeGreaterThan(skillsIdx);
    });
  });

  // -- extractSessionKnowledge ---------------------------------------------
  describe('extractSessionKnowledge', () => {
    const makeAgent = (overrides: Record<string, any> = {}) => ({
      id: 'agent-1',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      task: 'Implement feature',
      role: { id: 'developer' },
      completionSummary: 'Done',
      createdAt: new Date('2024-01-01'),
      ...overrides,
    });

    const makeMessages = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        sender: i % 2 === 0 ? 'user' : 'agent',
        content: `Message ${i}`,
        timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
      }));

    const makeLedger = () => ({
      log: vi.fn(),
    });

    it('extracts knowledge and logs to activity ledger', () => {
      const extractor = {
        extractFromSession: vi.fn().mockReturnValue({
          entriesStored: 2,
          decisions: [{ category: 'semantic', key: 'd1', content: 'Decision 1' }],
          patterns: [{ category: 'procedural', key: 'p1', content: 'Pattern 1' }],
          errors: [],
          summary: null,
        }),
      };
      svc.setSessionKnowledgeExtractor(extractor as any);

      const ledger = makeLedger();
      svc.extractSessionKnowledge(makeAgent() as any, makeMessages(5), ledger as any);

      expect(extractor.extractFromSession).toHaveBeenCalledTimes(1);
      const sessionData = extractor.extractFromSession.mock.calls[0][0];
      expect(sessionData.projectId).toBe('proj-1');
      expect(sessionData.messages).toHaveLength(5);
      expect(ledger.log).toHaveBeenCalledTimes(1);
      expect(ledger.log.mock.calls[0][3]).toContain('2 knowledge entries');
    });

    it('skips extraction when session has fewer than 3 messages', () => {
      const extractor = { extractFromSession: vi.fn() };
      svc.setSessionKnowledgeExtractor(extractor as any);

      svc.extractSessionKnowledge(makeAgent() as any, makeMessages(2), makeLedger() as any);
      expect(extractor.extractFromSession).not.toHaveBeenCalled();
    });

    it('skips extraction when no extractor is set', () => {
      // Should not throw
      expect(() =>
        svc.extractSessionKnowledge(makeAgent() as any, makeMessages(5), makeLedger() as any),
      ).not.toThrow();
    });

    it('skips extraction when agent has no projectId', () => {
      const extractor = { extractFromSession: vi.fn() };
      svc.setSessionKnowledgeExtractor(extractor as any);

      svc.extractSessionKnowledge(
        makeAgent({ projectId: undefined }) as any,
        makeMessages(5),
        makeLedger() as any,
      );
      expect(extractor.extractFromSession).not.toHaveBeenCalled();
    });

    it('does not log to ledger when no entries are stored', () => {
      const extractor = {
        extractFromSession: vi.fn().mockReturnValue({
          entriesStored: 0,
          decisions: [],
          patterns: [],
          errors: [],
          summary: null,
        }),
      };
      svc.setSessionKnowledgeExtractor(extractor as any);

      const ledger = makeLedger();
      svc.extractSessionKnowledge(makeAgent() as any, makeMessages(5), ledger as any);
      expect(ledger.log).not.toHaveBeenCalled();
    });

    it('stores extracted entries in collective memory', () => {
      const extractor = {
        extractFromSession: vi.fn().mockReturnValue({
          entriesStored: 2,
          decisions: [{ category: 'semantic', key: 'd1', content: 'Decision 1' }],
          patterns: [{ category: 'procedural', key: 'p1', content: 'Pattern 1' }],
          errors: [],
          summary: null,
        }),
      };
      svc.setSessionKnowledgeExtractor(extractor as any);

      const memory = { remember: vi.fn() };
      svc.setCollectiveMemory(memory as any);

      svc.extractSessionKnowledge(makeAgent() as any, makeMessages(5), makeLedger() as any);
      expect(memory.remember).toHaveBeenCalledTimes(2);
      // Check the first call has the mapped memory category
      expect(memory.remember).toHaveBeenCalledWith(
        'decision', // 'semantic' maps to 'decision' via KNOWLEDGE_TO_MEMORY_CATEGORY
        'd1',
        'Decision 1',
        'agent-1',
        'proj-1',
      );
    });

    it('handles extraction errors gracefully', () => {
      const extractor = {
        extractFromSession: vi.fn().mockImplementation(() => {
          throw new Error('Extraction failed');
        }),
      };
      svc.setSessionKnowledgeExtractor(extractor as any);

      // Should not throw
      expect(() =>
        svc.extractSessionKnowledge(makeAgent() as any, makeMessages(5), makeLedger() as any),
      ).not.toThrow();
    });

    it('uses agent.id as sessionId fallback when sessionId is null', () => {
      const extractor = {
        extractFromSession: vi.fn().mockReturnValue({
          entriesStored: 0,
          decisions: [],
          patterns: [],
          errors: [],
          summary: null,
        }),
      };
      svc.setSessionKnowledgeExtractor(extractor as any);

      svc.extractSessionKnowledge(
        makeAgent({ sessionId: null }) as any,
        makeMessages(5),
        makeLedger() as any,
      );

      const sessionData = extractor.extractFromSession.mock.calls[0][0];
      expect(sessionData.sessionId).toBe('agent-1');
    });
  });
});
