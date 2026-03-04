/**
 * Template command handlers for ACP.
 *
 * Commands:
 *   LIST_TEMPLATES                  — list all available workflow templates
 *   APPLY_TEMPLATE {"template":"feature","overrides":{...}}
 *                                   — instantiate a template into the current DAG
 *   DECOMPOSE_TASK {"task":"..."}   — decompose a description into suggested sub-tasks
 */
import type { Agent } from '../Agent.js';
import type { CommandEntry, CommandHandlerContext } from './types.js';
import type { TaskTemplateRegistry } from '../../tasks/TaskTemplates.js';
import type { TaskDecomposer } from '../../tasks/TaskDecomposer.js';
import {
  parseCommandPayload,
  applyTemplateSchema,
  decomposeTaskSchema,
} from './commandSchemas.js';
import { deriveArgs } from './CommandHelp.js';

// ── Regex patterns ────────────────────────────────────────────────────

const LIST_TEMPLATES_REGEX    = /⟦⟦\s*LIST_TEMPLATES\s*⟧⟧/s;
const APPLY_TEMPLATE_REGEX    = /⟦⟦\s*APPLY_TEMPLATE\s*(\{.*?\})\s*⟧⟧/s;
const DECOMPOSE_TASK_REGEX    = /⟦⟦\s*DECOMPOSE_TASK\s*(\{.*?\})\s*⟧⟧/s;

// ── Handlers ──────────────────────────────────────────────────────────

function handleListTemplates(
  _ctx: CommandHandlerContext,
  registry: TaskTemplateRegistry,
  agent: Agent,
): void {
  const templates = registry.getAll();
  if (templates.length === 0) {
    agent.sendMessage('[System] No task templates registered.');
    return;
  }
  let msg = '== AVAILABLE TASK TEMPLATES ==\n';
  for (const t of templates) {
    msg += `\n  📋 ${t.id} — ${t.name}\n     ${t.description}\n     Tasks: ${t.tasks.map(tk => tk.ref).join(' → ')}`;
  }
  msg += '\n\nUse APPLY_TEMPLATE {"template": "<id>"} to instantiate one.';
  agent.sendMessage(msg);
}

function handleApplyTemplate(
  ctx: CommandHandlerContext,
  registry: TaskTemplateRegistry,
  agent: Agent,
  data: string,
): void {
  if (agent.role.id !== 'lead') {
    agent.sendMessage('[System] Only the Project Lead can apply task templates.');
    return;
  }
  const match = data.match(APPLY_TEMPLATE_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], applyTemplateSchema, 'APPLY_TEMPLATE');
    if (!req) return;

    const template = registry.get(req.template);
    if (!template) {
      const available = registry.getAll().map(t => t.id).join(', ');
      agent.sendMessage(`[System] Unknown template "${req.template}". Available: ${available}`);
      return;
    }

    const refToId = registry.instantiate(req.template, agent.id, ctx.taskDAG, req.overrides);
    if (!refToId) {
      agent.sendMessage(`[System] Failed to instantiate template "${req.template}".`);
      return;
    }

    let msg = `[System] Template "${template.name}" applied — ${template.tasks.length} tasks created:`;
    for (const task of template.tasks) {
      const taskId = refToId[task.ref];
      msg += `\n  • ${taskId} (${task.role}) — ${task.ref}`;
    }
    msg += '\nUse TASK_STATUS to view the DAG, then DELEGATE or CREATE_AGENT to assign ready tasks.';
    agent.sendMessage(msg);
    ctx.emit('dag:updated', { leadId: agent.id });
  } catch (err: any) {
    agent.sendMessage(`[System] APPLY_TEMPLATE error: ${err.message}`);
  }
}

function handleDecomposeTask(
  _ctx: CommandHandlerContext,
  decomposer: TaskDecomposer,
  agent: Agent,
  data: string,
): void {
  const match = data.match(DECOMPOSE_TASK_REGEX);
  if (!match) return;

  try {
    const req = parseCommandPayload(agent, match[1], decomposeTaskSchema, 'DECOMPOSE_TASK');
    if (!req) return;

    const result = decomposer.decompose(req.task);
    const confidence = Math.round(result.confidence * 100);
    let msg = `== TASK DECOMPOSITION (confidence: ${confidence}%) ==`;
    if (result.template) msg += `\nTemplate: ${result.template}`;
    msg += '\nSuggested sub-tasks:';
    result.tasks.forEach((t, i) => {
      const deps = t.dependsOn.length ? ` [after: ${t.dependsOn.join(', ')}]` : '';
      msg += `\n  ${i}. [${t.role}] ${t.title}${deps}`;
    });
    msg += '\n\nUse DECLARE_TASKS or APPLY_TEMPLATE to create the DAG.';
    agent.sendMessage(msg);
  } catch (err: any) {
    agent.sendMessage(`[System] DECOMPOSE_TASK error: ${err.message}`);
  }
}

// ── Module export ─────────────────────────────────────────────────────

export function getTemplateCommands(
  ctx: CommandHandlerContext,
  registry: TaskTemplateRegistry,
  decomposer: TaskDecomposer,
): CommandEntry[] {
  return [
    {
      regex:   LIST_TEMPLATES_REGEX,
      name:    'LIST_TEMPLATES',
      handler: (a, _d) => handleListTemplates(ctx, registry, a),
      help: { description: 'List all available workflow templates', example: 'LIST_TEMPLATES', category: 'Templates' },
    },
    {
      regex:   APPLY_TEMPLATE_REGEX,
      name:    'APPLY_TEMPLATE',
      handler: (a, d) => handleApplyTemplate(ctx, registry, a, d),
      help: {
        description: 'Instantiate a workflow template to create tasks',
        example: 'APPLY_TEMPLATE {"template": "feature"}',
        category: 'Templates',
        args: deriveArgs(applyTemplateSchema),
      },
    },
    {
      regex:   DECOMPOSE_TASK_REGEX,
      name:    'DECOMPOSE_TASK',
      handler: (a, d) => handleDecomposeTask(ctx, decomposer, a, d),
      help: {
        description: 'Decompose a task description into suggested sub-tasks',
        example: 'DECOMPOSE_TASK {"task": "implement user auth"}',
        category: 'Templates',
        args: deriveArgs(decomposeTaskSchema),
      },
    },
  ];
}
