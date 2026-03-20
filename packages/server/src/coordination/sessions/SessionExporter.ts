import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { AgentManager } from '../../agents/AgentManager.js';
import type { ActivityLedger, ActivityEntry } from '../activity/ActivityLedger.js';
import type { DecisionLog, Decision } from '../decisions/DecisionLog.js';
import type { TaskDAG, DagTask } from '../../tasks/TaskDAG.js';
import type { ChatGroupRegistry } from '../../comms/ChatGroupRegistry.js';
import { logger } from '../../utils/logger.js';
import { asAgentId } from '../../types/brandedIds.js';
import { getCrewAgents } from '../../agents/crewUtils.js';

// Safe min/max for large arrays (avoids stack overflow from spread operator)
function safeMin(arr: number[]): number { return arr.reduce((a, b) => Math.min(a, b), Infinity); }
function safeMax(arr: number[]): number { return arr.reduce((a, b) => Math.max(a, b), -Infinity); }

// ── Types ─────────────────────────────────────────────────────────

interface ExportResult {
  outputDir: string;
  files: string[];
  agentCount: number;
  eventCount: number;
}

interface ExportMetadata {
  leadId: string;
  startTime: string;
  exportTime: string;
  durationMs: number;
  agentCount: number;
  commitCount: number;
  eventCount: number;
  decisionCount: number;
  groupCount: number;
  dagTaskCount: number;
}

// ── SessionExporter ───────────────────────────────────────────────

export class SessionExporter {
  constructor(
    private agentManager: AgentManager,
    private activityLedger: ActivityLedger,
    private decisionLog: DecisionLog,
    private taskDAG: TaskDAG,
    private chatGroupRegistry: ChatGroupRegistry,
  ) {}

  /**
   * Export full session history for a lead to disk.
   * Creates a timestamped folder with markdown + JSON artifacts.
   */
  export(leadId: string, outputDir: string): ExportResult {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = join(outputDir, `session-${leadId.slice(0, 8)}-${timestamp}`);
    const files: string[] = [];

    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(join(sessionDir, 'agents'), { recursive: true });
    mkdirSync(join(sessionDir, 'groups'), { recursive: true });

    // Collect crew agents (lead + direct children)
    const allAgents = this.agentManager.getAll();
    const crewAgents = getCrewAgents(allAgents, leadId);

    // Collect all events for crew
    const crewIds = new Set(crewAgents.map(a => a.id));
    const allEvents = this.activityLedger.getRecent(100_000);
    const crewEvents = allEvents.filter(e => crewIds.has(asAgentId(e.agentId)));

    // Collect decisions
    const decisions = this.decisionLog.getByLeadId(leadId);

    // Collect DAG tasks
    const dagTasks = this.taskDAG.getTasks(leadId);

    // Collect groups
    const groups = this.chatGroupRegistry.getGroups(leadId);

    // Collect git commits
    const commits = this.getGitCommits();

    // ── Write files ─────────────────────────────────────────────

    // 1. summary.md
    const summaryPath = join(sessionDir, 'summary.md');
    writeFileSync(summaryPath, this.buildSummaryMd(leadId, crewAgents, crewEvents, decisions, dagTasks, commits));
    files.push('summary.md');

    // 2. Per-agent conversation logs
    for (const agent of crewAgents) {
      const filename = `${agent.id.slice(0, 8)}-${agent.role?.name ?? 'unknown'}.md`;
      const filepath = join(sessionDir, 'agents', filename);
      writeFileSync(filepath, this.buildAgentMd(agent));
      files.push(`agents/${filename}`);
    }

    // 3. timeline.json
    const timelinePath = join(sessionDir, 'timeline.json');
    const sortedEvents = [...crewEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    writeFileSync(timelinePath, JSON.stringify(sortedEvents, null, 2));
    files.push('timeline.json');

    // 4. decisions.json
    const decisionsPath = join(sessionDir, 'decisions.json');
    writeFileSync(decisionsPath, JSON.stringify(decisions, null, 2));
    files.push('decisions.json');

    // 5. dag.json
    if (dagTasks.length > 0) {
      const dagPath = join(sessionDir, 'dag.json');
      const dagStatus = this.taskDAG.getStatus(leadId);
      writeFileSync(dagPath, JSON.stringify(dagStatus, null, 2));
      files.push('dag.json');
    }

    // 6. commits.json
    const commitsPath = join(sessionDir, 'commits.json');
    writeFileSync(commitsPath, JSON.stringify(commits, null, 2));
    files.push('commits.json');

    // 7. Per-group chat transcripts
    for (const group of groups) {
      const safeName = group.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeName}.md`;
      const filepath = join(sessionDir, 'groups', filename);
      writeFileSync(filepath, this.buildGroupMd(group, leadId));
      files.push(`groups/${filename}`);
    }

    // 8. metadata.json
    const timestamps = crewEvents.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t));
    const startTime = timestamps.length > 0 ? new Date(safeMin(timestamps)).toISOString() : new Date().toISOString();

    const metadata: ExportMetadata = {
      leadId,
      startTime,
      exportTime: new Date().toISOString(),
      durationMs: timestamps.length > 1
        ? safeMax(timestamps) - safeMin(timestamps)
        : 0,
      agentCount: crewAgents.length,
      commitCount: commits.length,
      eventCount: crewEvents.length,
      decisionCount: decisions.length,
      groupCount: groups.length,
      dagTaskCount: dagTasks.length,
    };
    const metadataPath = join(sessionDir, 'metadata.json');
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    files.push('metadata.json');

    logger.info('export', `Session exported: ${sessionDir} (${files.length} files, ${crewAgents.length} agents, ${crewEvents.length} events)`);

    return {
      outputDir: sessionDir,
      files,
      agentCount: crewAgents.length,
      eventCount: crewEvents.length,
    };
  }

  // ── Markdown builders ───────────────────────────────────────────

  private buildSummaryMd(
    leadId: string,
    agents: any[],
    events: ActivityEntry[],
    decisions: Decision[],
    dagTasks: DagTask[],
    commits: GitCommit[],
  ): string {
    const lead = agents.find(a => a.id === leadId);
    const timestamps = events.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t));
    const startTime = timestamps.length > 0 ? new Date(safeMin(timestamps)).toISOString() : 'N/A';
    const duration = timestamps.length > 1
      ? formatDuration(safeMax(timestamps) - safeMin(timestamps))
      : 'N/A';

    const lines: string[] = [
      `# Session Export — ${leadId.slice(0, 8)}`,
      '',
      '## Overview',
      '',
      `- **Lead**: ${lead?.role?.name ?? 'unknown'} (${leadId.slice(0, 8)})`,
      `- **Start**: ${startTime}`,
      `- **Duration**: ${duration}`,
      `- **Agents**: ${agents.length}`,
      `- **Events**: ${events.length}`,
      `- **Decisions**: ${decisions.length}`,
      `- **DAG tasks**: ${dagTasks.length}`,
      `- **Commits**: ${commits.length}`,
      '',
      '## Agent Roster',
      '',
      '| Agent | Role | Model | Status | Tasks Done | Tokens |',
      '|-------|------|-------|--------|------------|--------|',
    ];

    for (const agent of agents) {
      const agentEvents = events.filter(e => e.agentId === agent.id);
      const tasksDone = agentEvents.filter(e => e.actionType === 'task_completed').length;
      const tokens = (agent.inputTokens ?? 0) + (agent.outputTokens ?? 0);
      lines.push(
        `| ${agent.id.slice(0, 8)} | ${agent.role?.name ?? '?'} | ${agent.model ?? '?'} | ${agent.status} | ${tasksDone} | ${tokens.toLocaleString()} |`,
      );
    }

    // Key decisions
    const confirmedDecisions = decisions.filter(d => d.status === 'confirmed' || d.autoApproved);
    if (confirmedDecisions.length > 0) {
      lines.push('', '## Key Decisions', '');
      for (const d of confirmedDecisions.slice(0, 20)) {
        lines.push(`- **${d.title}** — ${d.rationale.slice(0, 120)}`);
      }
    }

    // Commits
    if (commits.length > 0) {
      lines.push('', '## Commits', '');
      for (const c of commits) {
        lines.push(`- \`${c.hash}\` ${c.subject} (${c.author})`);
      }
    }

    // DAG status
    if (dagTasks.length > 0) {
      const done = dagTasks.filter(t => t.dagStatus === 'done').length;
      const failed = dagTasks.filter(t => t.dagStatus === 'failed').length;
      const running = dagTasks.filter(t => t.dagStatus === 'running').length;
      lines.push('', '## DAG Progress', '');
      lines.push(`- Done: ${done} / ${dagTasks.length}`);
      lines.push(`- Running: ${running}`);
      lines.push(`- Failed: ${failed}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  private buildAgentMd(agent: any): string {
    const lines: string[] = [
      `# Agent: ${agent.role?.name ?? 'unknown'} (${agent.id.slice(0, 8)})`,
      '',
      `- **Status**: ${agent.status}`,
      `- **Model**: ${agent.model ?? 'unknown'}`,
      `- **Task**: ${agent.task ?? 'N/A'}`,
      `- **Parent**: ${agent.parentId?.slice(0, 8) ?? 'none'}`,
      `- **Input tokens**: ${agent.inputTokens ?? 0}`,
      `- **Output tokens**: ${agent.outputTokens ?? 0}`,
      '',
      '## Conversation',
      '',
    ];

    // Try persisted message history first, fall back to in-memory
    const history = this.agentManager.getMessageHistory(agent.id, 10_000);
    if (history.length > 0) {
      for (const msg of history) {
        lines.push(`### [${msg.timestamp}] ${msg.sender}`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      }
    } else if (agent.messages?.length > 0) {
      // In-memory messages (plain strings)
      for (const msg of agent.messages) {
        lines.push(msg);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    } else {
      lines.push('*No messages recorded*');
    }

    return lines.join('\n');
  }

  private buildGroupMd(group: any, leadId: string): string {
    const messages = this.chatGroupRegistry.getMessages(group.name, leadId, 10_000);
    const lines: string[] = [
      `# Group: ${group.name}`,
      '',
      `- **Members**: ${group.memberIds?.join(', ') ?? 'N/A'}`,
      `- **Created**: ${group.createdAt ?? 'N/A'}`,
      '',
      '## Messages',
      '',
    ];

    if (messages.length === 0) {
      lines.push('*No messages*');
    } else {
      for (const msg of messages) {
        lines.push(`**[${msg.timestamp}] ${msg.fromRole}** (${msg.fromAgentId.slice(0, 8)}):`);
        lines.push('');
        lines.push(msg.content);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  // ── Git ─────────────────────────────────────────────────────────

  private getGitCommits(): GitCommit[] {
    try {
      const raw = execSync(
        'git log --format="%H|%h|%an|%aI|%s" -100',
        { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      if (!raw) return [];
      return raw.split('\n').map(line => {
        const [sha, hash, author, date, ...rest] = line.split('|');
        return { sha, hash, author, date, subject: rest.join('|') };
      });
    } catch {
      return [];
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────

interface GitCommit {
  sha: string;
  hash: string;
  author: string;
  date: string;
  subject: string;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
