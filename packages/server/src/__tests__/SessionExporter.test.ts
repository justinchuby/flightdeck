import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from '../db/database.js';
import { ActivityLedger } from '../coordination/activity/ActivityLedger.js';
import { DecisionLog } from '../coordination/decisions/DecisionLog.js';
import { TaskDAG } from '../tasks/TaskDAG.js';
import { ChatGroupRegistry } from '../comms/ChatGroupRegistry.js';
import { SessionExporter } from '../coordination/sessions/SessionExporter.js';

// Minimal mock for AgentManager
function createMockAgentManager(agents: any[] = [], messageHistory: any[] = []) {
  return {
    getAll: () => agents,
    get: (id: string) => agents.find((a: any) => a.id === id),
    getMessageHistory: () => messageHistory,
  } as any;
}

function createAgent(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? 'agent-001',
    role: { name: overrides.roleName ?? 'developer', id: overrides.roleId ?? 'developer' },
    status: overrides.status ?? 'running',
    model: overrides.model ?? 'gpt-4',
    task: overrides.task ?? 'Build feature X',
    parentId: overrides.parentId ?? null,
    childIds: overrides.childIds ?? [],
    inputTokens: overrides.inputTokens ?? 1000,
    outputTokens: overrides.outputTokens ?? 2000,
    contextWindowSize: overrides.contextWindowSize ?? 128000,
    contextWindowUsed: overrides.contextWindowUsed ?? 50000,
    messages: overrides.messages ?? ['Hello', 'Working on it'],
    createdAt: overrides.createdAt ?? new Date(),
    ...overrides,
  };
}

describe('SessionExporter', () => {
  let db: Database;
  let activityLedger: ActivityLedger;
  let decisionLog: DecisionLog;
  let taskDAG: TaskDAG;
  let chatGroupRegistry: ChatGroupRegistry;
  let outputDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    activityLedger = new ActivityLedger(db);
    decisionLog = new DecisionLog(db);
    taskDAG = new TaskDAG(db);
    chatGroupRegistry = new ChatGroupRegistry(db);
    outputDir = join(tmpdir(), `session-exporter-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    activityLedger.stop();
    db.close();
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('creates session directory with expected structure', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const dev = createAgent({ id: 'dev-001', parentId: 'lead-001' });
    const mgr = createMockAgentManager([lead, dev]);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    expect(result.outputDir).toContain('session-lead-001');
    expect(result.agentCount).toBe(2);
    expect(existsSync(result.outputDir)).toBe(true);
    expect(result.files).toContain('summary.md');
    expect(result.files).toContain('timeline.json');
    expect(result.files).toContain('decisions.json');
    expect(result.files).toContain('commits.json');
    expect(result.files).toContain('metadata.json');
  });

  it('generates summary.md with agent roster', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const dev = createAgent({ id: 'dev-001', parentId: 'lead-001', roleName: 'developer' });
    const mgr = createMockAgentManager([lead, dev]);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const summary = readFileSync(join(result.outputDir, 'summary.md'), 'utf-8');
    expect(summary).toContain('# Session Export');
    expect(summary).toContain('Agent Roster');
    expect(summary).toContain('lead');
    expect(summary).toContain('developer');
    expect(summary).toContain('gpt-4');
  });

  it('exports per-agent conversation logs', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const dev = createAgent({ id: 'dev-001', parentId: 'lead-001', roleName: 'developer', messages: ['Working on task'] });
    const history = [
      { id: 1, conversationId: 'c1', sender: 'user', content: 'Build the feature', timestamp: '2026-01-01T00:00:00Z' },
      { id: 2, conversationId: 'c1', sender: 'assistant', content: 'On it!', timestamp: '2026-01-01T00:01:00Z' },
    ];
    const mgr = createMockAgentManager([lead, dev], history);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    // Should have agent files
    const agentFiles = result.files.filter(f => f.startsWith('agents/'));
    expect(agentFiles.length).toBe(2);

    // Check dev agent file has conversation
    const devFile = agentFiles.find(f => f.includes('dev-001'));
    expect(devFile).toBeDefined();
    const devContent = readFileSync(join(result.outputDir, devFile!), 'utf-8');
    expect(devContent).toContain('developer');
    expect(devContent).toContain('Build the feature');
  });

  it('exports activity timeline as sorted JSON', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    activityLedger.log('lead-001', 'lead', 'task_started', 'Started task A');
    activityLedger.log('lead-001', 'lead', 'task_completed', 'Completed task A');

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const timeline = JSON.parse(readFileSync(join(result.outputDir, 'timeline.json'), 'utf-8'));
    expect(timeline.length).toBe(2);
    // Should be sorted chronologically
    const t0 = new Date(timeline[0].timestamp).getTime();
    const t1 = new Date(timeline[1].timestamp).getTime();
    expect(t0).toBeLessThanOrEqual(t1);
  });

  it('exports decisions as JSON', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    decisionLog.add('lead-001', 'lead', 'Use React', 'Better ecosystem', false, 'lead-001');

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const decisions = JSON.parse(readFileSync(join(result.outputDir, 'decisions.json'), 'utf-8'));
    expect(decisions.length).toBe(1);
    expect(decisions[0].title).toBe('Use React');
    expect(decisions[0].rationale).toBe('Better ecosystem');
  });

  it('exports DAG state when tasks exist', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    taskDAG.declareTaskBatch('lead-001', [
      { taskId: 'task-1', role: 'developer', description: 'Build API', files: ['api.ts'], dependsOn: [] },
      { taskId: 'task-2', role: 'developer', description: 'Build UI', files: ['ui.ts'], dependsOn: ['task-1'] },
    ]);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    expect(result.files).toContain('dag.json');
    const dag = JSON.parse(readFileSync(join(result.outputDir, 'dag.json'), 'utf-8'));
    expect(dag.tasks.length).toBe(2);
    expect(dag.summary).toBeDefined();
  });

  it('skips dag.json when no tasks', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    expect(result.files).not.toContain('dag.json');
  });

  it('exports group chat transcripts', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const dev = createAgent({ id: 'dev-001', parentId: 'lead-001' });
    const mgr = createMockAgentManager([lead, dev]);

    chatGroupRegistry.create('lead-001', 'design-review', ['lead-001', 'dev-001']);
    chatGroupRegistry.sendMessage('design-review', 'lead-001', 'lead-001', 'lead', 'Review this PR');
    chatGroupRegistry.sendMessage('design-review', 'lead-001', 'dev-001', 'developer', 'LGTM!');

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const groupFiles = result.files.filter(f => f.startsWith('groups/'));
    expect(groupFiles.length).toBe(1);

    const content = readFileSync(join(result.outputDir, groupFiles[0]), 'utf-8');
    expect(content).toContain('design-review');
    expect(content).toContain('Review this PR');
    expect(content).toContain('LGTM!');
  });

  it('exports metadata.json with correct counts', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const dev = createAgent({ id: 'dev-001', parentId: 'lead-001' });
    const mgr = createMockAgentManager([lead, dev]);

    activityLedger.log('lead-001', 'lead', 'task_started', 'Start');
    activityLedger.log('dev-001', 'developer', 'file_edit', 'Edit');

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const metadata = JSON.parse(readFileSync(join(result.outputDir, 'metadata.json'), 'utf-8'));
    expect(metadata.leadId).toBe('lead-001');
    expect(metadata.agentCount).toBe(2);
    expect(metadata.eventCount).toBe(2);
    expect(metadata.exportTime).toBeDefined();
  });

  it('handles empty session gracefully', () => {
    const mgr = createMockAgentManager([]);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('nonexistent-lead', outputDir);

    expect(result.agentCount).toBe(0);
    expect(result.eventCount).toBe(0);
    expect(result.files).toContain('summary.md');
    expect(result.files).toContain('metadata.json');
  });

  it('falls back to in-memory messages when no persisted history', () => {
    const lead = createAgent({
      id: 'lead-001',
      roleName: 'lead',
      parentId: null,
      messages: ['System starting...', 'Ready to work'],
    });
    const mgr = createMockAgentManager([lead], []); // empty persisted history

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const agentFile = result.files.find(f => f.includes('lead-001'));
    expect(agentFile).toBeDefined();
    const content = readFileSync(join(result.outputDir, agentFile!), 'utf-8');
    expect(content).toContain('System starting...');
    expect(content).toContain('Ready to work');
  });

  it('sanitizes group names for filenames', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    chatGroupRegistry.create('lead-001', 'review/design (v2)', ['lead-001']);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const groupFiles = result.files.filter(f => f.startsWith('groups/'));
    expect(groupFiles.length).toBe(1);
    // Should not contain special chars
    expect(groupFiles[0]).not.toContain('/design');
    expect(groupFiles[0]).not.toContain('(');
  });

  it('summary includes DAG progress when tasks exist', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    taskDAG.declareTaskBatch('lead-001', [
      { taskId: 'task-1', role: 'dev', description: 'Build API', files: ['api.ts'], dependsOn: [] },
    ]);
    taskDAG.startTask('lead-001', 'task-1', 'lead-001');
    taskDAG.completeTask('lead-001', 'task-1');

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const summary = readFileSync(join(result.outputDir, 'summary.md'), 'utf-8');
    expect(summary).toContain('DAG Progress');
    expect(summary).toContain('Done: 1');
  });

  it('summary includes confirmed decisions', () => {
    const lead = createAgent({ id: 'lead-001', roleName: 'lead', parentId: null });
    const mgr = createMockAgentManager([lead]);

    const decision = decisionLog.add('lead-001', 'lead', 'Deploy to prod', 'All tests pass', true, 'lead-001');
    decisionLog.confirm(decision.id);

    const exporter = new SessionExporter(mgr, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
    const result = exporter.export('lead-001', outputDir);

    const summary = readFileSync(join(result.outputDir, 'summary.md'), 'utf-8');
    expect(summary).toContain('Key Decisions');
    expect(summary).toContain('Deploy to prod');
  });
});
