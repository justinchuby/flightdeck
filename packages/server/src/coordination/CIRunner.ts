/**
 * CIRunner — Lightweight CI integration hook.
 *
 * Subscribes to the EventPipeline. When a commit is detected (via ActivityLedger),
 * runs build + test, reports results to the committing agent and the lead,
 * and optionally creates a 'fix-build' DAG task on failure.
 *
 * Design: At most one CI run at a time (queue serialized). Each run executes:
 *   1. npm run build --workspace=packages/server
 *   2. npm run build --workspace=packages/web
 *   3. npm test --workspace=packages/server
 * Results are sent as system messages to the committing agent + lead.
 */
import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import type { EventHandler, PipelineEvent } from './EventPipeline.js';
import type { ActivityLedger } from './ActivityLedger.js';
import type { TaskDAG } from '../tasks/TaskDAG.js';

// ── Types ─────────────────────────────────────────────────────────

export interface CIResult {
  success: boolean;
  commitAgent: string;
  commitSummary: string;
  steps: CIStepResult[];
  durationMs: number;
  timestamp: number;
}

interface CIStepResult {
  name: string;
  success: boolean;
  durationMs: number;
  /** Last N lines of output (truncated for context economy) */
  output: string;
}

interface CIRunRequest {
  agentId: string;
  agentRole: string;
  summary: string;
}

interface CIRunnerDeps {
  /** Project root directory (for running npm commands) */
  cwd: string;
  /** To send results to agents */
  getAgent: (id: string) => { sendMessage(msg: string): void; role: { id: string } } | undefined;
  /** To find lead agent for result notifications */
  getAllAgents: () => Array<{ id: string; role: { id: string }; status: string; sendMessage(msg: string): void }>;
  /** To log CI activity */
  activityLedger: ActivityLedger;
  /** To create fix-build tasks on failure */
  taskDAG?: TaskDAG;
}

// ── CIRunner ──────────────────────────────────────────────────────

const MAX_STEP_OUTPUT = 2000; // chars of output to keep per step
const STEP_TIMEOUT_MS = 120_000; // 2 minutes per step
const DEBOUNCE_MS = 5_000; // wait 5s after last commit before running

export class CIRunner extends EventEmitter {
  private deps: CIRunnerDeps;
  private running = false;
  private queue: CIRunRequest[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResult: CIResult | null = null;

  constructor(deps: CIRunnerDeps) {
    super();
    this.deps = deps;
  }

  /** Enqueue a CI run. Debounces rapid commits. */
  enqueue(request: CIRunRequest): void {
    this.queue.push(request);
    // Debounce: wait for commits to settle before running
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processQueue();
    }, DEBOUNCE_MS);
  }

  getLastResult(): CIResult | null {
    return this.lastResult;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** EventPipeline handler — detects commits from activity events */
  createHandler(): EventHandler {
    return {
      eventTypes: ['file_edit'],
      name: 'ci-runner',
      handle: (event: PipelineEvent) => {
        const { entry, meta } = event;
        // Detect commit events: either flagged by commitQualityGateHandler
        // or matching commit patterns in the summary/details
        const isCommit = meta.shouldRunTests === true
          || entry.details?.type === 'commit'
          || /\bgit\s+(commit|push)\b/i.test(entry.summary);

        if (isCommit) {
          logger.info('ci', `Commit detected from ${entry.agentRole} (${entry.agentId.slice(0, 8)}) — queueing CI run`);
          this.enqueue({
            agentId: entry.agentId,
            agentRole: entry.agentRole,
            summary: entry.summary.slice(0, 200),
          });
        }
      },
    };
  }

  // ── Internal ────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running = true;

    // Collapse multiple queued commits into one run, track all committers
    const batch = [...this.queue];
    this.queue = [];
    const committerIds = [...new Set(batch.map(r => r.agentId))];
    const summaries = batch.map(r => r.summary).join('; ');

    logger.info('ci', `Starting CI run for ${batch.length} commit(s) from ${committerIds.length} agent(s)`);

    const startTime = Date.now();
    const steps: CIStepResult[] = [];

    // Step 1: Build server
    steps.push(await this.runStep('build:server', 'npm run build --workspace=packages/server'));

    // Step 2: Build web (only if server build passed)
    if (steps[0].success) {
      steps.push(await this.runStep('build:web', 'npm run build --workspace=packages/web'));
    }

    // Step 3: Test server (only if builds passed)
    if (steps.every(s => s.success)) {
      steps.push(await this.runStep('test:server', 'npm test --workspace=packages/server'));
    }

    const result: CIResult = {
      success: steps.every(s => s.success),
      commitAgent: committerIds.join(', '),
      commitSummary: summaries.slice(0, 300),
      steps,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };

    this.lastResult = result;
    this.emit('ci:complete', result);

    // Report results
    this.reportResults(result, committerIds);

    // On failure: create fix-build DAG task
    if (!result.success) {
      this.createFixBuildTask(result, committerIds);
    }

    // Log to activity ledger
    this.deps.activityLedger.log(
      committerIds[0],
      batch[0].agentRole,
      result.success ? 'task_completed' : 'error',
      `CI ${result.success ? '✅ passed' : '❌ failed'} (${Math.round(result.durationMs / 1000)}s): ${result.steps.map(s => `${s.name}:${s.success ? '✅' : '❌'}`).join(' ')}`,
      { type: 'ci_run', success: result.success, steps: result.steps.map(s => ({ name: s.name, success: s.success, durationMs: s.durationMs })) },
    );

    this.running = false;

    // Process any commits that arrived while we were running
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  private runStep(name: string, command: string): Promise<CIStepResult> {
    const start = Date.now();
    return new Promise<CIStepResult>((resolve) => {
      const proc = exec(command, {
        cwd: this.deps.cwd,
        timeout: STEP_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024, // 5MB
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      }, (error, stdout, stderr) => {
        const output = (stdout + '\n' + stderr).trim();
        const truncated = output.length > MAX_STEP_OUTPUT
          ? '...(truncated)\n' + output.slice(-MAX_STEP_OUTPUT)
          : output;
        resolve({
          name,
          success: !error,
          durationMs: Date.now() - start,
          output: truncated,
        });
      });

      // Safety: kill if timeout fires before exec callback
      proc.on('error', () => {
        resolve({
          name,
          success: false,
          durationMs: Date.now() - start,
          output: `Process error: failed to start "${command}"`,
        });
      });
    });
  }

  private reportResults(result: CIResult, committerIds: string[]): void {
    const statusEmoji = result.success ? '✅' : '❌';
    const duration = Math.round(result.durationMs / 1000);
    const stepSummary = result.steps
      .map(s => `  ${s.success ? '✅' : '❌'} ${s.name} (${Math.round(s.durationMs / 1000)}s)`)
      .join('\n');

    const shortMsg = `[CI ${statusEmoji}] Build ${result.success ? 'passed' : 'FAILED'} (${duration}s)\n${stepSummary}`;

    // Full message with failure output for committing agents
    let fullMsg = shortMsg;
    if (!result.success) {
      const failedStep = result.steps.find(s => !s.success);
      if (failedStep) {
        fullMsg += `\n\nFailed step: ${failedStep.name}\n\`\`\`\n${failedStep.output.slice(-1000)}\n\`\`\``;
      }
    }

    // Notify committing agents
    for (const id of committerIds) {
      const agent = this.deps.getAgent(id);
      if (agent) {
        agent.sendMessage(fullMsg);
      }
    }

    // Notify lead (if not already a committer)
    const leads = this.deps.getAllAgents().filter(
      a => a.role.id === 'lead' && a.status === 'running' && !committerIds.includes(a.id),
    );
    for (const lead of leads) {
      lead.sendMessage(shortMsg);
    }

    logger.info('ci', `CI ${statusEmoji} — ${duration}s — ${result.steps.length} steps — ${committerIds.length} notified`);
  }

  private createFixBuildTask(result: CIResult, committerIds: string[]): void {
    if (!this.deps.taskDAG) return;

    const failedStep = result.steps.find(s => !s.success);
    if (!failedStep) return;

    // Find the lead agent to scope the DAG task
    const lead = this.deps.getAllAgents().find(a => a.role.id === 'lead' && a.status === 'running');
    if (!lead) return;

    try {
      // Check if a fix-build task already exists and is not completed
      const existing = this.deps.taskDAG.getTasks(lead.id);
      const hasOpenFixTask = existing.some(
        t => t.id.startsWith('fix-build') && t.dagStatus !== 'done' && t.dagStatus !== 'skipped',
      );
      if (hasOpenFixTask) {
        logger.info('ci', 'fix-build task already exists in DAG — skipping duplicate');
        return;
      }

      const taskLabel = `fix-build-${Date.now()}`;
      this.deps.taskDAG.declareTaskBatch(lead.id, [{
        id: taskLabel,
        role: 'developer',
        description: `CI failure in ${failedStep.name}: fix the build/test error. Committer: ${committerIds.map(id => id.slice(0, 8)).join(', ')}. Error: ${failedStep.output.slice(-200)}`,
      }]);

      logger.info('ci', `Created DAG task "${taskLabel}" for CI failure in ${failedStep.name}`);
    } catch (err) {
      logger.warn('ci', `Failed to create fix-build DAG task: ${(err as Error).message}`);
    }
  }
}
