/**
 * Flightdeck MCP Server
 *
 * Registers MCP tools that proxy to a running Flightdeck instance.
 * Designed for stdio transport — run via `flightdeck-mcp`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FlightdeckClient } from './client.js';

// Use zod from the MCP SDK re-export or standard zod — the SDK requires zod-compatible schemas.

export interface FlightdeckMcpOptions {
  /** Flightdeck base URL (default: http://127.0.0.1:3001) */
  baseUrl?: string;
}

export function createServer(opts?: FlightdeckMcpOptions) {
  const baseUrl = opts?.baseUrl ?? process.env.FLIGHTDECK_URL ?? 'http://127.0.0.1:3001';
  const client = new FlightdeckClient({ baseUrl });

  const server = new McpServer({
    name: 'flightdeck-mcp',
    version: '0.1.0',
  });

  // ── Helper ────────────────────────────────────────────────────

  function jsonResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  }

  function errorResult(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
  }

  async function safe<T>(fn: () => Promise<T>) {
    try {
      return jsonResult(await fn());
    } catch (err) {
      return errorResult(err);
    }
  }

  // ── System Tools ──────────────────────────────────────────────

  server.tool(
    'flightdeck_status',
    'Get the current Flightdeck system status including active agents, paused state, and uptime',
    {},
    async () => safe(() => client.getSystemStatus()),
  );

  server.tool(
    'flightdeck_config',
    'Get the current Flightdeck configuration',
    {},
    async () => safe(() => client.getConfig()),
  );

  server.tool(
    'flightdeck_pause',
    'Pause the Flightdeck system — all agents stop accepting new prompts',
    {},
    async () => safe(() => client.pauseSystem()),
  );

  server.tool(
    'flightdeck_resume',
    'Resume the Flightdeck system after a pause',
    {},
    async () => safe(() => client.resumeSystem()),
  );

  // ── Lead Tools ────────────────────────────────────────────────

  server.tool(
    'flightdeck_lead_list',
    'List all lead sessions. A lead is the top-level orchestration session that coordinates agents.',
    {},
    async () => safe(() => client.listLeads()),
  );

  server.tool(
    'flightdeck_lead_get',
    'Get details about a specific lead session',
    { id: z.string().describe('Lead session ID') },
    async ({ id }) => safe(() => client.getLead(id)),
  );

  server.tool(
    'flightdeck_lead_start',
    'Start a new lead session with a task description. The lead will decompose the task and delegate to agents.',
    {
      message: z.string().describe('Task description for the lead'),
      provider: z.string().optional().describe('Agent provider (e.g., "claude-code", "codex")'),
      model: z.string().optional().describe('Model name or tier'),
      cwd: z.string().optional().describe('Working directory for the session'),
    },
    async (args) => safe(() => client.startLead(args)),
  );

  server.tool(
    'flightdeck_lead_message',
    'Send a message to a running lead session',
    {
      id: z.string().describe('Lead session ID'),
      message: z.string().describe('Message to send'),
    },
    async ({ id, message }) => safe(() => client.sendLeadMessage(id, message)),
  );

  server.tool(
    'flightdeck_lead_decisions',
    'Get decisions made by a lead session (task decomposition, delegations, etc.)',
    { id: z.string().describe('Lead session ID') },
    async ({ id }) => safe(() => client.getLeadDecisions(id)),
  );

  server.tool(
    'flightdeck_lead_dag',
    'Get the task DAG (directed acyclic graph) for a lead session showing task dependencies',
    { id: z.string().describe('Lead session ID') },
    async ({ id }) => safe(() => client.getLeadDag(id)),
  );

  // ── Agent Tools ───────────────────────────────────────────────

  server.tool(
    'flightdeck_agent_list',
    'List all agents (running and stopped). Shows agent ID, role, status, and current task.',
    {},
    async () => safe(() => client.listAgents()),
  );

  server.tool(
    'flightdeck_agent_spawn',
    'Spawn a new agent with a specific role and task',
    {
      role: z.string().describe('Agent role (e.g., "coder", "reviewer", "tester", "writer")'),
      task: z.string().describe('Task description for the agent'),
      provider: z.string().optional().describe('Agent provider'),
      model: z.string().optional().describe('Model name or tier'),
      cwd: z.string().optional().describe('Working directory'),
      leadId: z.string().optional().describe('Lead session ID to attach this agent to'),
    },
    async (args) => safe(() => client.spawnAgent(args)),
  );

  server.tool(
    'flightdeck_agent_message',
    'Send a message to a running agent',
    {
      id: z.string().describe('Agent ID'),
      message: z.string().describe('Message to send'),
    },
    async ({ id, message }) => safe(() => client.sendAgentMessage(id, message)),
  );

  server.tool(
    'flightdeck_agent_messages',
    'Get the message history for an agent',
    {
      id: z.string().describe('Agent ID'),
      limit: z.number().optional().describe('Max messages to return'),
      offset: z.number().optional().describe('Offset for pagination'),
    },
    async ({ id, limit, offset }) => safe(() => client.getAgentMessages(id, { limit, offset })),
  );

  server.tool(
    'flightdeck_agent_plan',
    'Get the current plan for an agent (if the provider supports plans)',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.getAgentPlan(id)),
  );

  server.tool(
    'flightdeck_agent_tasks',
    'Get the tasks assigned to an agent',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.getAgentTasks(id)),
  );

  server.tool(
    'flightdeck_agent_focus',
    'Get the current focus/activity of an agent (what files it is working on, etc.)',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.getAgentFocus(id)),
  );

  server.tool(
    'flightdeck_agent_terminate',
    'Terminate a running agent',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.terminateAgent(id)),
  );

  server.tool(
    'flightdeck_agent_interrupt',
    'Interrupt a running agent (cancel current prompt)',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.interruptAgent(id)),
  );

  server.tool(
    'flightdeck_agent_delete',
    'Delete a stopped agent from the roster',
    { id: z.string().describe('Agent ID') },
    async ({ id }) => safe(() => client.deleteAgent(id)),
  );

  // ── Crew Tools ────────────────────────────────────────────────

  server.tool(
    'flightdeck_crew_list',
    'List all crews. A crew is a group of agents working under a lead on a task.',
    {},
    async () => safe(() => client.listCrews()),
  );

  server.tool(
    'flightdeck_crew_get',
    'Get details about a specific crew',
    { crewId: z.string().describe('Crew ID (usually same as lead ID)') },
    async ({ crewId }) => safe(() => client.getCrew(crewId)),
  );

  server.tool(
    'flightdeck_crew_summary',
    'Get a summary of all crews with agent counts and status',
    {},
    async () => safe(() => client.getCrewSummary()),
  );

  server.tool(
    'flightdeck_crew_agents',
    'List all agents in a specific crew',
    { crewId: z.string().describe('Crew ID') },
    async ({ crewId }) => safe(() => client.getCrewAgents(crewId)),
  );

  server.tool(
    'flightdeck_crew_health',
    'Get health status for a crew (stalled agents, errors, etc.)',
    { crewId: z.string().describe('Crew ID') },
    async ({ crewId }) => safe(() => client.getCrewHealth(crewId)),
  );

  server.tool(
    'flightdeck_crew_delete',
    'Delete a crew and terminate all its agents',
    { leadId: z.string().describe('Lead session ID for the crew') },
    async ({ leadId }) => safe(() => client.deleteCrew(leadId)),
  );

  // ── Task Tools ────────────────────────────────────────────────

  server.tool(
    'flightdeck_task_list',
    'List tasks across all leads. Can filter by lead ID or status.',
    {
      leadId: z.string().optional().describe('Filter tasks by lead session ID'),
      status: z.string().optional().describe('Filter by status (e.g., "pending", "in_progress", "done")'),
    },
    async (args) => safe(() => client.listTasks(args)),
  );

  server.tool(
    'flightdeck_attention',
    'Get items that need human attention (pending decisions, errors, stalled agents)',
    {},
    async () => safe(() => client.getAttentionItems()),
  );

  // ── Coordination Tools ────────────────────────────────────────

  server.tool(
    'flightdeck_coordination_status',
    'Get coordination status — file locks, conflicts, and agent collaboration state',
    {},
    async () => safe(() => client.getCoordinationStatus()),
  );

  server.tool(
    'flightdeck_coordination_locks',
    'List all active file locks held by agents',
    {},
    async () => safe(() => client.getCoordinationLocks()),
  );

  server.tool(
    'flightdeck_coordination_activity',
    'Get recent agent activity (file edits, commands, etc.)',
    {},
    async () => safe(() => client.getCoordinationActivity()),
  );

  server.tool(
    'flightdeck_coordination_summary',
    'Get a coordination summary with potential conflicts and overlap',
    {},
    async () => safe(() => client.getCoordinationSummary()),
  );

  // ── Cost Tools ────────────────────────────────────────────────

  server.tool(
    'flightdeck_costs_by_agent',
    'Get token usage and cost breakdown by agent',
    {},
    async () => safe(() => client.getCostsByAgent()),
  );

  server.tool(
    'flightdeck_costs_by_task',
    'Get token usage and cost breakdown by task',
    {},
    async () => safe(() => client.getCostsByTask()),
  );

  server.tool(
    'flightdeck_costs_by_session',
    'Get token usage and cost breakdown by session',
    { leadId: z.string().optional().describe('Filter by lead session ID') },
    async ({ leadId }) => safe(() => client.getCostsBySession(leadId)),
  );

  // ── Search ────────────────────────────────────────────────────

  server.tool(
    'flightdeck_search',
    'Search across agent messages, tasks, and decisions',
    { query: z.string().describe('Search query') },
    async ({ query }) => safe(() => client.search(query)),
  );

  // ── Analytics & Notifications ─────────────────────────────────

  server.tool(
    'flightdeck_analytics',
    'Get analytics data — agent performance, task completion rates, etc.',
    {},
    async () => safe(() => client.getAnalytics()),
  );

  server.tool(
    'flightdeck_notifications',
    'List recent notifications',
    {},
    async () => safe(() => client.listNotifications()),
  );

  // ── Natural Language ──────────────────────────────────────────

  server.tool(
    'flightdeck_nl_execute',
    'Execute a natural language command against Flightdeck (e.g., "spawn a coder to fix the login bug")',
    { text: z.string().describe('Natural language command') },
    async ({ text }) => safe(() => client.nlExecute(text)),
  );

  server.tool(
    'flightdeck_nl_preview',
    'Preview what a natural language command would do without executing it',
    { text: z.string().describe('Natural language command') },
    async ({ text }) => safe(() => client.nlPreview(text)),
  );

  // ── Projects ──────────────────────────────────────────────────

  server.tool(
    'flightdeck_project_list',
    'List known projects',
    {},
    async () => safe(() => client.listProjects()),
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
export async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
