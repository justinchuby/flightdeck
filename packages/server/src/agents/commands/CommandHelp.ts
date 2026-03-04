/**
 * Command reference for the ACP system.
 *
 * Provides formatted help text when agents use unrecognized commands
 * or when a command handler fails. Single source of truth for command
 * examples — avoids duplicating syntax across error messages.
 */

export interface CommandRef {
  name: string;
  description: string;
  example: string;
}

/**
 * All available ACP commands grouped by category.
 * The example strings use placeholder values — agents see these when
 * they send an unrecognized command.
 */
export const COMMAND_REFERENCE: Record<string, CommandRef[]> = {
  'Agent Lifecycle': [
    { name: 'CREATE_AGENT', description: 'Spawn a new agent with a role and task', example: 'CREATE_AGENT {"role": "developer", "task": "implement feature X"}' },
    { name: 'DELEGATE', description: 'Delegate a task to an existing agent', example: 'DELEGATE {"to": "agent-id", "task": "do something"}' },
    { name: 'TERMINATE_AGENT', description: 'Stop an agent', example: 'TERMINATE_AGENT {"id": "agent-id"}' },
    { name: 'CANCEL_DELEGATION', description: 'Cancel an active delegation', example: 'CANCEL_DELEGATION {"delegationId": "del-id"}' },
  ],
  'Communication': [
    { name: 'AGENT_MESSAGE', description: 'Send a message to an agent', example: 'AGENT_MESSAGE {"to": "agent-id-or-role", "content": "your message"}' },
    { name: 'DIRECT_MESSAGE', description: 'Queue a message for an agent (non-interrupting)', example: 'DIRECT_MESSAGE {"to": "agent-id", "content": "your message"}' },
    { name: 'BROADCAST', description: 'Send a message to all agents', example: 'BROADCAST {"content": "attention everyone..."}' },
    { name: 'INTERRUPT', description: 'Interrupt an agent with an urgent message', example: 'INTERRUPT {"to": "agent-id", "content": "urgent: stop current work"}' },
  ],
  'Groups': [
    { name: 'CREATE_GROUP', description: 'Create a chat group', example: 'CREATE_GROUP {"name": "backend-team", "members": ["id1", "id2"]}' },
    { name: 'GROUP_MESSAGE', description: 'Send a message to a group', example: 'GROUP_MESSAGE {"group": "backend-team", "content": "sync up"}' },
    { name: 'ADD_TO_GROUP', description: 'Add members to a group', example: 'ADD_TO_GROUP {"group": "backend-team", "members": ["id3"]}' },
    { name: 'REMOVE_FROM_GROUP', description: 'Remove members from a group', example: 'REMOVE_FROM_GROUP {"group": "backend-team", "members": ["id2"]}' },
    { name: 'QUERY_GROUPS', description: 'List all groups you belong to', example: 'QUERY_GROUPS {}' },
  ],
  'Task DAG': [
    { name: 'DECLARE_TASKS', description: 'Declare a set of tasks with dependencies', example: 'DECLARE_TASKS {"tasks": [{"id": "task-1", "role": "developer", "description": "..."}]}' },
    { name: 'COMPLETE_TASK', description: 'Mark a task as done', example: 'COMPLETE_TASK {"summary": "what was accomplished"}' },
    { name: 'TASK_STATUS', description: 'View the task DAG status', example: 'TASK_STATUS {}' },
    { name: 'ADD_TASK', description: 'Add a single task to the DAG', example: 'ADD_TASK {"id": "task-2", "role": "developer", "description": "..."}' },
    { name: 'ASSIGN_TASK', description: 'Assign a task to a specific agent', example: 'ASSIGN_TASK {"id": "task-2", "agentId": "agent-id"}' },
    { name: 'PAUSE_TASK', description: 'Pause a task', example: 'PAUSE_TASK {"id": "task-1"}' },
    { name: 'SKIP_TASK', description: 'Skip a task', example: 'SKIP_TASK {"id": "task-1"}' },
    { name: 'ADD_DEPENDENCY', description: 'Add a dependency between tasks', example: 'ADD_DEPENDENCY {"taskId": "task-2", "depends_on": ["task-1"]}' },
  ],
  'Coordination': [
    { name: 'LOCK_FILE', description: 'Acquire a file lock', example: 'LOCK_FILE {"filePath": "src/index.ts"}' },
    { name: 'UNLOCK_FILE', description: 'Release a file lock', example: 'UNLOCK_FILE {"filePath": "src/index.ts"}' },
    { name: 'COMMIT', description: 'Commit locked files', example: 'COMMIT {"message": "feat: add new feature"}' },
    { name: 'DECISION', description: 'Record an architectural decision', example: 'DECISION {"title": "Use React", "rationale": "team expertise"}' },
    { name: 'ACTIVITY', description: 'Log an activity entry', example: 'ACTIVITY {"type": "milestone", "summary": "phase 1 complete"}' },
  ],
  'System': [
    { name: 'QUERY_CREW', description: 'Get current crew status', example: 'QUERY_CREW {}' },
    { name: 'QUERY_PEERS', description: 'List peer agents for direct messaging', example: 'QUERY_PEERS {}' },
    { name: 'REQUEST_LIMIT_CHANGE', description: 'Request a change to concurrency limits', example: 'REQUEST_LIMIT_CHANGE {"newLimit": 10, "reason": "need more agents"}' },
  ],
  'Timers': [
    { name: 'SET_TIMER', description: 'Set a reminder timer', example: 'SET_TIMER {"label": "check-build", "delay": 300, "message": "Check build status"}' },
    { name: 'CANCEL_TIMER', description: 'Cancel a timer', example: 'CANCEL_TIMER {"name": "check-build"}' },
    { name: 'LIST_TIMERS', description: 'List active timers', example: 'LIST_TIMERS {}' },
  ],
  'Capabilities': [
    { name: 'ACQUIRE_CAPABILITY', description: 'Acquire a capability beyond your role', example: 'ACQUIRE_CAPABILITY {"capability": "code-review", "reason": "found bug"}' },
    { name: 'RELEASE_CAPABILITY', description: 'Release an acquired capability', example: 'RELEASE_CAPABILITY {"capability": "code-review"}' },
    { name: 'LIST_CAPABILITIES', description: 'List your current capabilities', example: 'LIST_CAPABILITIES {}' },
  ],
  'Deferred Issues': [
    { name: 'DEFER_ISSUE', description: 'Defer an issue for later', example: 'DEFER_ISSUE {"title": "Tech debt", "description": "refactor later"}' },
    { name: 'QUERY_DEFERRED', description: 'List deferred issues', example: 'QUERY_DEFERRED {}' },
    { name: 'RESOLVE_DEFERRED', description: 'Resolve a deferred issue', example: 'RESOLVE_DEFERRED {"id": "issue-id"}' },
  ],
};

/** Build a formatted help text listing all available commands. */
export function buildCommandHelp(): string {
  const lines: string[] = ['[System] Available commands:\n'];

  for (const [category, commands] of Object.entries(COMMAND_REFERENCE)) {
    lines.push(`== ${category} ==`);
    for (const cmd of commands) {
      lines.push(`  ${cmd.name} — ${cmd.description}`);
      lines.push(`    ${cmd.example}`);
    }
    lines.push('');
  }

  lines.push('All commands use the format: COMMAND_NAME {json_payload}');
  lines.push('');
  lines.push('== Escaping ==');
  lines.push('Do NOT include literal command brackets in messages or task descriptions.');
  lines.push('Refer to commands by name: "use COMMIT when done" or "run QUERY_CREW".');
  return lines.join('\n');
}

/** Get the example for a specific command. Returns undefined if not found. */
export function getCommandExample(commandName: string): string | undefined {
  const upper = commandName.toUpperCase();
  for (const commands of Object.values(COMMAND_REFERENCE)) {
    const found = commands.find(c => c.name === upper);
    if (found) return found.example;
  }
  return undefined;
}
