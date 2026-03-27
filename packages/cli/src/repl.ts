/**
 * Interactive REPL for Flightdeck CLI.
 */

import * as readline from 'node:readline';
import * as api from './client.js';
import {
  colors, table, output,
  formatProjectSummary, formatAgentSummary,
  formatTaskSummary, formatDecisionSummary, computeTaskStats,
} from './format.js';

const VERSION = '0.4.3';

function banner(): void {
  const line = colors.dim('─'.repeat(50));
  console.log();
  console.log(`  ${colors.cyanBold('◆')}  ${colors.cyanBold('Flightdeck CLI')}  ${colors.dim('v' + VERSION)}`);
  console.log(`  ${line}`);
  console.log(`  ${colors.dim('Type help for commands, quit to exit')}`);
  console.log();
}

function printHelp(): void {
  const cmds: [string, string][] = [
    ['project list', 'List all projects'],
    ['project start <task>', 'Start a new project with a lead agent'],
    ['project info [id]', 'Show project details'],
    ['project use <id>', 'Set active project'],
    ['agent list', 'List all agents'],
    ['agent spawn <role>', 'Spawn a new agent'],
    ['agent terminate <id>', 'Terminate an agent'],
    ['agent message <id> <text>', 'Send a message to an agent'],
    ['agent messages <id>', 'View agent conversation history'],
    ['task list', 'List all DAG tasks'],
    ['task stats', 'Show task statistics'],
    ['task attention', 'Show items needing attention'],
    ['decision list', 'List pending decisions'],
    ['decision approve <id> [reason]', 'Approve a decision'],
    ['decision reject <id> [reason]', 'Reject a decision'],
    ['status', 'Show coordination status'],
    ['activity', 'Show recent activity log'],
    ['providers', 'Show provider status'],
    ['roles', 'Show available agent roles'],
    ['config url <url>', 'Set server URL'],
    ['config token <token>', 'Set auth token'],
    ['help', 'Show this help'],
    ['quit', 'Exit the REPL'],
  ];
  console.log();
  const maxCmd = Math.max(...cmds.map(([c]) => c.length));
  for (const [cmd, desc] of cmds) {
    console.log(`  ${colors.cyan(cmd.padEnd(maxCmd + 2))} ${colors.gray(desc)}`);
  }
  console.log();
}

function success(msg: string) { console.log(`  ${colors.green('✓')} ${colors.green(msg)}`); }
function error(msg: string) { console.error(`  ${colors.red('✗')} ${colors.red(msg)}`); }
function info(msg: string) { console.log(`  ${colors.gray('●')} ${msg}`); }

export async function startRepl(): Promise<void> {
  banner();

  // Check connectivity
  try {
    const h = await api.health() as Record<string, unknown>;
    success(`Connected to Flightdeck (${h.agents || 0} agents active)`);
  } catch (e) {
    error(`Cannot reach server: ${e instanceof Error ? e.message : e}`);
    info('Set FLIGHTDECK_URL or use --url to specify the server address');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.cyan('◆')} ${colors.bold('flightdeck')} ${colors.dim('❯')} `,
    historySize: 200,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    try {
      if (cmd === 'quit' || cmd === 'exit' || cmd === 'q') {
        console.log(`\n  ${colors.dim('Goodbye!')}\n`);
        rl.close();
        return;
      }

      if (cmd === 'help') { printHelp(); }
      else if (cmd === 'status') { await replStatus(); }
      else if (cmd === 'activity') { await replActivity(); }
      else if (cmd === 'providers') { await replProviders(); }
      else if (cmd === 'roles') { await replRoles(); }
      else if (cmd === 'project') { await replProject(parts.slice(1)); }
      else if (cmd === 'agent') { await replAgent(parts.slice(1)); }
      else if (cmd === 'task') { await replTask(parts.slice(1)); }
      else if (cmd === 'decision') { await replDecision(parts.slice(1)); }
      else if (cmd === 'config') { replConfig(parts.slice(1)); }
      else { console.log(`  ${colors.yellow('Unknown command:')} ${cmd}. Type 'help' for commands.`); }
    } catch (err) {
      if (err instanceof api.FlightdeckError) {
        error(`Server error (${err.status}): ${err.message}`);
      } else {
        error(String(err instanceof Error ? err.message : err));
      }
    }

    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

// ── REPL command handlers ────────────────────────────────────────

async function replStatus(): Promise<void> {
  const pid = api.loadSession().projectId;
  const data = await api.getStatus(pid) as Record<string, unknown>;
  const agents = (data.agents || []) as Record<string, unknown>[];
  const locks = (data.locks || []) as unknown[];
  const activity = (data.recentActivity || []) as unknown[];
  info(`Agents: ${agents.length} active`);
  info(`Locks: ${locks.length} held`);
  info(`Activity: ${activity.length} recent events`);
  if (agents.length) {
    table(
      ['ID', 'Role', 'Status', 'Model'],
      agents.map(a => {
        const role = a.role;
        const roleName = (role && typeof role === 'object')
          ? String((role as Record<string, unknown>).name || '?')
          : String(role || '?');
        return [String(a.id || '').slice(0, 8), roleName, String(a.status || '?'), String(a.model || '?').slice(0, 20)];
      }),
    );
  }
}

async function replActivity(): Promise<void> {
  const pid = api.loadSession().projectId;
  const entries = await api.getActivity(20, pid) as Record<string, unknown>[];
  if (!entries.length) { info('No recent activity'); return; }
  for (const e of entries.slice(0, 10)) {
    const ts = String(e.timestamp || '').slice(0, 19);
    const agent = String(e.agentId || '').slice(0, 8);
    const action = String(e.action || '');
    const detail = String(e.detail || '').slice(0, 60);
    info(`[${ts}] ${agent} ${action}: ${detail}`);
  }
}

async function replProviders(): Promise<void> {
  const statuses = await api.getProviderStatus() as Record<string, unknown>[];
  if (!statuses.length) { info('No providers configured'); return; }
  table(
    ['Provider', 'Installed', 'Auth', 'Version'],
    statuses.map(s => [
      String(s.id || ''),
      s.installed ? '✓' : '✗',
      s.authenticated ? '✓' : '✗',
      String(s.version || '?'),
    ]),
  );
}

async function replRoles(): Promise<void> {
  const roles = await api.getRoles() as Record<string, unknown>[];
  if (!roles.length) { info('No roles available'); return; }
  table(
    ['ID', 'Name', 'Model'],
    roles.map(r => [String(r.id || ''), String(r.name || ''), String(r.model || '').slice(0, 25)]),
  );
}

async function replProject(args: string[]): Promise<void> {
  if (!args.length) { console.log('  Usage: project <list|start|info|use|delete>'); return; }
  const sub = args[0].toLowerCase();
  const pid = api.loadSession().projectId;

  if (sub === 'list') {
    const projects = await api.listProjects() as Record<string, unknown>[];
    if (!projects.length) { info('No projects found'); return; }
    const data = projects.map(formatProjectSummary);
    table(
      ['ID', 'Name', 'Status', 'Agents'],
      data.map(p => [p.id.slice(0, 12), p.name.slice(0, 30), p.status, `R:${p.running} I:${p.idle} F:${p.failed}`]),
    );
  } else if (sub === 'start') {
    const task = args.slice(1).join(' ');
    if (!task) { console.log('  Usage: project start <task description>'); return; }
    const result = await api.startProject(task) as Record<string, unknown>;
    const newId = String(result.projectId || result.id || '');
    if (newId) api.saveSession({ projectId: newId });
    success(`Project started: ${newId}`);
    if (newId) info(`Active project set to: ${newId}`);
  } else if (sub === 'info') {
    const id = args[1] || pid;
    if (!id) { console.log('  Usage: project info <id> (or set active project first)'); return; }
    output(await api.getProject(id), false);
  } else if (sub === 'use') {
    if (!args[1]) { console.log('  Usage: project use <id>'); return; }
    api.saveSession({ projectId: args[1] });
    success(`Active project: ${args[1]}`);
  } else if (sub === 'delete') {
    if (!args[1]) { console.log('  Usage: project delete <id>'); return; }
    await api.deleteProject(args[1]);
    success(`Project deleted: ${args[1]}`);
  } else {
    console.log(`  Unknown project command: ${sub}`);
  }
}

async function replAgent(args: string[]): Promise<void> {
  if (!args.length) { console.log('  Usage: agent <list|spawn|terminate|message|messages|interrupt|restart>'); return; }
  const sub = args[0].toLowerCase();
  const pid = api.loadSession().projectId;

  if (sub === 'list') {
    const agents = await api.listAgents(pid) as Record<string, unknown>[];
    if (!agents.length) { info('No agents found'); return; }
    const data = agents.map(formatAgentSummary);
    table(
      ['ID', 'Role', 'Status', 'Model', 'Provider'],
      data.map(a => [a.id.slice(0, 8), a.role, a.status, a.model.slice(0, 20), a.provider.slice(0, 10)]),
    );
  } else if (sub === 'spawn') {
    if (!args[1]) { console.log('  Usage: agent spawn <role> [--model <m>] [--task <t>]'); return; }
    const result = await api.spawnAgent(args[1]) as Record<string, unknown>;
    success(`Agent spawned: ${String(result.id || '').slice(0, 8)} (${args[1]})`);
  } else if (sub === 'terminate') {
    if (!args[1]) { console.log('  Usage: agent terminate <id>'); return; }
    await api.terminateAgent(args[1]);
    success(`Agent terminated: ${args[1].slice(0, 8)}`);
  } else if (sub === 'message') {
    if (args.length < 3) { console.log('  Usage: agent message <id> <text>'); return; }
    await api.sendMessage(args[1], args.slice(2).join(' '));
    success(`Message sent to ${args[1].slice(0, 8)}`);
  } else if (sub === 'messages') {
    if (!args[1]) { console.log('  Usage: agent messages <id>'); return; }
    const result = await api.getAgentMessages(args[1]) as Record<string, unknown>;
    const msgs = (result.messages || []) as Record<string, unknown>[];
    if (!msgs.length) { info('No messages found'); return; }
    for (const m of msgs.slice(-20)) {
      const sender = String(m.sender || '?');
      const text = String(m.text || '').slice(0, 100);
      const ts = String(m.timestamp || '').slice(0, 19);
      info(`[${ts}] ${sender}: ${text}`);
    }
  } else if (sub === 'interrupt') {
    if (!args[1]) { console.log('  Usage: agent interrupt <id>'); return; }
    await api.interruptAgent(args[1]);
    success(`Agent interrupted: ${args[1].slice(0, 8)}`);
  } else if (sub === 'restart') {
    if (!args[1]) { console.log('  Usage: agent restart <id>'); return; }
    await api.restartAgent(args[1]);
    success(`Agent restarted: ${args[1].slice(0, 8)}`);
  } else {
    console.log(`  Unknown agent command: ${sub}`);
  }
}

async function replTask(args: string[]): Promise<void> {
  if (!args.length) { console.log('  Usage: task <list|stats|attention>'); return; }
  const sub = args[0].toLowerCase();
  const pid = api.loadSession().projectId;

  if (sub === 'list') {
    const result = await api.listTasks({ projectId: pid }) as Record<string, unknown>;
    const tasks = (Array.isArray(result) ? result : (result.tasks as unknown[]) || []) as Record<string, unknown>[];
    if (!tasks.length) { info('No tasks found'); return; }
    const data = tasks.map(formatTaskSummary);
    table(
      ['ID', 'Description', 'Status', 'Role', 'Agent'],
      data.map(t => [t.id.slice(0, 12), t.description.slice(0, 40), t.status, t.role.slice(0, 12), t.agent.slice(0, 8)]),
    );
  } else if (sub === 'stats') {
    const result = await api.listTasks({ projectId: pid }) as Record<string, unknown>;
    const tasks = (Array.isArray(result) ? result : (result.tasks as unknown[]) || []) as Record<string, unknown>[];
    const stats = computeTaskStats(tasks);
    info(`Total: ${stats.total}`);
    for (const [status, count] of Object.entries(stats.by_status)) {
      info(`  ${status}: ${count}`);
    }
  } else if (sub === 'attention') {
    output(await api.getAttention(pid), false);
  } else {
    console.log(`  Unknown task command: ${sub}`);
  }
}

async function replDecision(args: string[]): Promise<void> {
  if (!args.length) { console.log('  Usage: decision <list|approve|reject>'); return; }
  const sub = args[0].toLowerCase();

  if (sub === 'list') {
    const decisions = await api.listDecisions({ pendingOnly: true }) as Record<string, unknown>[];
    if (!decisions.length) { info('No pending decisions'); return; }
    const data = decisions.map(formatDecisionSummary);
    table(
      ['ID', 'Title', 'Role', 'Status'],
      data.map(d => [d.id.slice(0, 12), d.title.slice(0, 40), d.role, d.status]),
    );
  } else if (sub === 'approve') {
    if (!args[1]) { console.log('  Usage: decision approve <id> [reason]'); return; }
    const reason = args.length > 2 ? args.slice(2).join(' ') : undefined;
    await api.approveDecision(args[1], reason);
    success(`Decision approved: ${args[1].slice(0, 12)}`);
  } else if (sub === 'reject') {
    if (!args[1]) { console.log('  Usage: decision reject <id> [reason]'); return; }
    const reason = args.length > 2 ? args.slice(2).join(' ') : undefined;
    await api.rejectDecision(args[1], reason);
    success(`Decision rejected: ${args[1].slice(0, 12)}`);
  } else {
    console.log(`  Unknown decision command: ${sub}`);
  }
}

function replConfig(args: string[]): void {
  if (!args.length) { console.log('  Usage: config <url|token>'); return; }
  const sub = args[0].toLowerCase();

  if (sub === 'url') {
    if (!args[1]) { console.log('  Usage: config url <server-url>'); return; }
    api.saveSession({ serverUrl: args[1] });
    process.env.FLIGHTDECK_URL = args[1];
    success(`Server URL set to: ${args[1]}`);
  } else if (sub === 'token') {
    if (!args[1]) { console.log('  Usage: config token <auth-token>'); return; }
    api.saveSession({ token: args[1] });
    process.env.FLIGHTDECK_TOKEN = args[1];
    success('Auth token saved');
  } else {
    console.log(`  Unknown config command: ${sub}`);
  }
}
