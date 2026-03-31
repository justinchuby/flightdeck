#!/usr/bin/env node
/**
 * Flightdeck CLI — control your AI agent crew from the terminal.
 *
 * Usage:
 *   flightdeckcli [options] <command>
 *   flightdeckcli                              # Enter REPL mode
 *   flightdeckcli --json project list           # JSON output
 */

import { Command, Option } from 'commander';
import * as api from './client.js';
import {
  output, table, colors,
  formatProjectSummary, formatAgentSummary,
  formatTaskSummary, formatDecisionSummary, computeTaskStats,
} from './format.js';
import { startRepl } from './repl.js';

const VERSION = '0.4.3';

// ── Globals ──────────────────────────────────────────────────────

let jsonMode = false;
let globalProjectId: string | undefined;

function resolveProject(): string | undefined {
  return globalProjectId || api.loadSession().projectId;
}

function handleError(err: unknown): never {
  if (err instanceof api.FlightdeckError) {
    console.error(`${colors.red('Error')} (${err.status}): ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`${colors.red('Error')}: ${err.message}`);
  } else {
    console.error(`${colors.red('Error')}: ${err}`);
  }
  process.exit(1);
}

// ── Program ──────────────────────────────────────────────────────

const program = new Command()
  .name('flightdeckcli')
  .description('Flightdeck CLI — control your AI agent crew from the terminal')
  .version(VERSION, '-v, --version')
  .addOption(new Option('--json', 'Output as JSON for machine parsing').default(false))
  .option('--project <id>', 'Scope commands to a project ID')
  .option('--url <url>', 'Flightdeck server URL (default: http://localhost:3001)')
  .option('--token <token>', 'Auth token for the Flightdeck server')
  .hook('preAction', (_thisCmd, actionCmd) => {
    const opts = program.opts();
    jsonMode = opts.json;
    globalProjectId = opts.project;
    if (opts.url) process.env.FLIGHTDECK_URL = opts.url;
    if (opts.token) process.env.FLIGHTDECK_TOKEN = opts.token;
  });

// ── Project commands ─────────────────────────────────────────────

const projectCmd = program.command('project').description('Project management commands');

projectCmd.command('list')
  .description('List all projects')
  .option('--status <status>', 'Filter by status (active/stopped)')
  .action(async (opts) => {
    try {
      const projects = await api.listProjects(opts.status) as Record<string, unknown>[];
      const data = projects.map(formatProjectSummary);
      if (jsonMode) { output(data, true); return; }
      if (!data.length) { console.log('  No projects found'); return; }
      table(
        ['ID', 'Name', 'Status', 'Agents'],
        data.map(p => [p.id.slice(0, 12), p.name.slice(0, 30), p.status,
          `R:${p.running} I:${p.idle} F:${p.failed}`]),
      );
    } catch (e) { handleError(e); }
  });

projectCmd.command('start')
  .description('Start a new project with a lead agent')
  .argument('<task>', 'Task description for the project')
  .option('--name <name>', 'Project name')
  .option('--model <model>', 'Model for the lead agent')
  .option('--cwd <dir>', 'Working directory')
  .action(async (task, opts) => {
    try {
      const result = await api.startProject(task, opts) as Record<string, unknown>;
      const pid = String(result.projectId || result.id || '');
      if (pid) api.saveSession({ projectId: pid });
      output(result, jsonMode);
    } catch (e) { handleError(e); }
  });

projectCmd.command('info')
  .description('Show project details')
  .argument('[id]', 'Project ID (uses active project if omitted)')
  .action(async (id) => {
    try {
      const pid = id || resolveProject();
      if (!pid) { console.error('Error: No project ID. Use --project or "project use <id>"'); process.exit(1); }
      output(await api.getProject(pid), jsonMode);
    } catch (e) { handleError(e); }
  });

projectCmd.command('use')
  .description('Set the active project for subsequent commands')
  .argument('<id>', 'Project ID')
  .action((id) => {
    api.saveSession({ projectId: id });
    console.log(`Active project: ${id}`);
  });

projectCmd.command('delete')
  .description('Delete a project')
  .argument('<id>', 'Project ID')
  .action(async (id) => {
    try { output(await api.deleteProject(id), jsonMode); }
    catch (e) { handleError(e); }
  });

// ── Agent commands ───────────────────────────────────────────────

const agentCmd = program.command('agent').description('Agent management commands');

agentCmd.command('list')
  .description('List all agents')
  .action(async () => {
    try {
      const agents = await api.listAgents(resolveProject()) as Record<string, unknown>[];
      const data = agents.map(formatAgentSummary);
      if (jsonMode) { output(data, true); return; }
      if (!data.length) { console.log('  No agents found'); return; }
      table(
        ['ID', 'Role', 'Status', 'Model', 'Provider'],
        data.map(a => [a.id.slice(0, 8), a.role, a.status, a.model.slice(0, 20), a.provider.slice(0, 10)]),
      );
    } catch (e) { handleError(e); }
  });

agentCmd.command('spawn')
  .description('Spawn a new agent with the given role')
  .argument('<role>', 'Agent role (e.g. developer, architect)')
  .option('--model <model>', 'Model override')
  .option('--provider <provider>', 'Provider override')
  .option('--task <task>', 'Initial task description')
  .action(async (role, opts) => {
    try { output(await api.spawnAgent(role, opts), jsonMode); }
    catch (e) { handleError(e); }
  });

agentCmd.command('terminate')
  .description('Terminate an agent')
  .argument('<id>', 'Agent ID')
  .action(async (id) => {
    try { output(await api.terminateAgent(id), jsonMode); }
    catch (e) { handleError(e); }
  });

agentCmd.command('message')
  .description('Send a message to an agent')
  .argument('<id>', 'Agent ID')
  .argument('<text>', 'Message text')
  .option('--mode <mode>', 'Delivery mode (queue|interrupt)', 'queue')
  .action(async (id, text, opts) => {
    try { output(await api.sendMessage(id, text, opts.mode), jsonMode); }
    catch (e) { handleError(e); }
  });

agentCmd.command('messages')
  .description('View conversation history for an agent')
  .argument('<id>', 'Agent ID')
  .option('--limit <n>', 'Max messages to return', '50')
  .action(async (id, opts) => {
    try {
      const result = await api.getAgentMessages(id, Number(opts.limit)) as Record<string, unknown>;
      output((result.messages as unknown[]) || result, jsonMode);
    } catch (e) { handleError(e); }
  });

agentCmd.command('interrupt')
  .description("Interrupt an agent's current work")
  .argument('<id>', 'Agent ID')
  .action(async (id) => {
    try { output(await api.interruptAgent(id), jsonMode); }
    catch (e) { handleError(e); }
  });

agentCmd.command('restart')
  .description('Restart an agent (context compaction)')
  .argument('<id>', 'Agent ID')
  .action(async (id) => {
    try { output(await api.restartAgent(id), jsonMode); }
    catch (e) { handleError(e); }
  });

// ── Task commands ────────────────────────────────────────────────

const taskCmd = program.command('task').description('Task DAG management commands');

taskCmd.command('list')
  .description('List tasks from the DAG')
  .option('--status <status>', 'Filter by status (running,done,failed,pending)')
  .option('--scope <scope>', 'Scope (global|project|lead)', 'global')
  .action(async (opts) => {
    try {
      const result = await api.listTasks({ projectId: resolveProject(), ...opts }) as Record<string, unknown>;
      const tasks = (Array.isArray(result) ? result : (result.tasks as unknown[]) || []) as Record<string, unknown>[];
      const data = tasks.map(formatTaskSummary);
      if (jsonMode) { output(data, true); return; }
      if (!data.length) { console.log('  No tasks found'); return; }
      table(
        ['ID', 'Description', 'Status', 'Role', 'Agent'],
        data.map(t => [t.id.slice(0, 12), t.description.slice(0, 40), t.status, t.role.slice(0, 12), t.agent.slice(0, 8)]),
      );
    } catch (e) { handleError(e); }
  });

taskCmd.command('attention')
  .description('Show items needing human attention')
  .action(async () => {
    try { output(await api.getAttention(resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

taskCmd.command('stats')
  .description('Show task DAG statistics')
  .action(async () => {
    try {
      const result = await api.listTasks({ projectId: resolveProject() }) as Record<string, unknown>;
      const tasks = (Array.isArray(result) ? result : (result.tasks as unknown[]) || []) as Record<string, unknown>[];
      output(computeTaskStats(tasks), jsonMode);
    } catch (e) { handleError(e); }
  });

// ── Decision commands ────────────────────────────────────────────

const decisionCmd = program.command('decision').description('Decision management commands');

decisionCmd.command('list')
  .description('List decisions (pending by default)')
  .option('--all', 'Show all decisions, not just pending')
  .action(async (opts) => {
    try {
      const decisions = await api.listDecisions({
        pendingOnly: !opts.all,
        projectId: resolveProject(),
      }) as Record<string, unknown>[];
      const data = decisions.map(formatDecisionSummary);
      if (jsonMode) { output(data, true); return; }
      if (!data.length) { console.log('  No pending decisions'); return; }
      table(
        ['ID', 'Title', 'Role', 'Status'],
        data.map(d => [d.id.slice(0, 12), d.title.slice(0, 40), d.role, d.status]),
      );
    } catch (e) { handleError(e); }
  });

decisionCmd.command('approve')
  .description('Approve a decision')
  .argument('<id>', 'Decision ID')
  .option('--reason <reason>', 'Approval reason')
  .action(async (id, opts) => {
    try { output(await api.approveDecision(id, opts.reason), jsonMode); }
    catch (e) { handleError(e); }
  });

decisionCmd.command('reject')
  .description('Reject a decision')
  .argument('<id>', 'Decision ID')
  .option('--reason <reason>', 'Rejection reason')
  .action(async (id, opts) => {
    try { output(await api.rejectDecision(id, opts.reason), jsonMode); }
    catch (e) { handleError(e); }
  });

// ── Top-level convenience commands ───────────────────────────────

program.command('health')
  .description('Check server health')
  .action(async () => {
    try { output(await api.health(), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('status')
  .description('Show coordination status overview')
  .action(async () => {
    try { output(await api.getStatus(resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('activity')
  .description('Show recent activity log')
  .option('--limit <n>', 'Number of entries', '20')
  .action(async (opts) => {
    try { output(await api.getActivity(Number(opts.limit), resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('providers')
  .description('Show provider status (installed, authenticated, version)')
  .action(async () => {
    try { output(await api.getProviderStatus(), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('roles')
  .description('Show available agent roles')
  .action(async () => {
    try { output(await api.getRoles(), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('analytics')
  .description('Show analytics overview')
  .action(async () => {
    try { output(await api.getAnalytics(resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('summary')
  .description('Show coordination summary')
  .action(async () => {
    try { output(await api.getSummary(resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

program.command('locks')
  .description('Show file locks')
  .action(async () => {
    try { output(await api.getLocks(resolveProject()), jsonMode); }
    catch (e) { handleError(e); }
  });

// ── Entry point ──────────────────────────────────────────────────

async function main() {
  // No args → enter REPL
  if (process.argv.length <= 2) {
    const opts = program.opts();
    if (opts.url) process.env.FLIGHTDECK_URL = opts.url;
    if (opts.token) process.env.FLIGHTDECK_TOKEN = opts.token;
    await startRepl();
    return;
  }
  await program.parseAsync();
}

main().catch(handleError);
