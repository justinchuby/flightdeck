import { eq, and, sql } from 'drizzle-orm';
import { Database } from '../db/database.js';
import { agentFileHistory, utcNow } from '../db/schema.js';
import type { FileLockRegistry } from './FileLockRegistry.js';

// ── Types ────────────────────────────────────────────────────────────

export interface FileTouchRecord {
  agentId: string;
  agentRole: string;
  leadId: string;
  filePath: string;
  firstTouchedAt: string;
  lastTouchedAt: string;
  touchCount: number;
}

export interface CapabilityQuery {
  file?: string;
  technology?: string;
  keyword?: string;
  domain?: string;
  availableOnly?: boolean;
  excludeAgentId?: string;
}

export interface CapabilityResult {
  agentId: string;
  shortId: string;
  roleName: string;
  status: string;
  task?: string;
  score: number;
  reasons: string[];
}

type AgentLike = {
  id: string;
  role: { id: string; name: string };
  status: string;
  task?: string;
  parentId?: string;
};

// ── Extension → technology map ───────────────────────────────────────

const EXTENSION_TO_TECH: Record<string, string> = {
  ts: 'typescript', tsx: 'react', js: 'javascript', jsx: 'react',
  css: 'css', scss: 'css', html: 'html',
  sql: 'sql', py: 'python', rs: 'rust', go: 'go',
  json: 'config', yaml: 'config', yml: 'config', toml: 'config',
  md: 'documentation', mdx: 'documentation',
  sh: 'shell', bash: 'shell',
};

// ── CapabilityRegistry ───────────────────────────────────────────────

export class CapabilityRegistry {
  constructor(
    private db: Database,
    private lockRegistry: FileLockRegistry,
    private getAgents: () => AgentLike[],
  ) {}

  /** Record that an agent touched a file (called on lock:acquired). */
  recordFileTouch(agentId: string, agentRole: string, leadId: string, filePath: string): void {
    this.db.drizzle
      .insert(agentFileHistory)
      .values({ agentId, agentRole, leadId, filePath })
      .onConflictDoUpdate({
        target: [agentFileHistory.agentId, agentFileHistory.leadId, agentFileHistory.filePath],
        set: {
          lastTouchedAt: utcNow,
          touchCount: sql`${agentFileHistory.touchCount} + 1`,
        },
      })
      .run();
  }

  /** Get all file touch records for a given lead's project. */
  getHistoryForLead(leadId: string): FileTouchRecord[] {
    const rows = this.db.drizzle
      .select()
      .from(agentFileHistory)
      .where(eq(agentFileHistory.leadId, leadId))
      .all();
    return rows.map(toFileTouchRecord);
  }

  /** Get file touch records for a specific agent. */
  getHistoryForAgent(agentId: string, leadId: string): FileTouchRecord[] {
    const rows = this.db.drizzle
      .select()
      .from(agentFileHistory)
      .where(and(
        eq(agentFileHistory.agentId, agentId),
        eq(agentFileHistory.leadId, leadId),
      ))
      .all();
    return rows.map(toFileTouchRecord);
  }

  /** Infer technologies an agent has worked with based on file extensions. */
  inferTechnologies(agentId: string, leadId: string): string[] {
    const techs = new Set<string>();
    const history = this.getHistoryForAgent(agentId, leadId);
    for (const { filePath } of history) {
      const tech = extToTech(filePath);
      if (tech) techs.add(tech);
    }
    // Also check current file locks
    for (const lock of this.lockRegistry.getByAgent(agentId)) {
      const tech = extToTech(lock.filePath);
      if (tech) techs.add(tech);
    }
    return [...techs];
  }

  /** Query agents by capability — ranked by relevance score. */
  query(leadId: string, q: CapabilityQuery): CapabilityResult[] {
    const agents = this.getAgents().filter(a => {
      const isChild = a.parentId === leadId || a.id === leadId;
      if (!isChild) return false;
      if (q.availableOnly && a.status !== 'idle') return false;
      if (q.excludeAgentId && a.id === q.excludeAgentId) return false;
      return true;
    });

    const results: CapabilityResult[] = [];

    for (const agent of agents) {
      let score = 0;
      const reasons: string[] = [];

      // File match — highest signal
      if (q.file) {
        const history = this.getHistoryForAgent(agent.id, leadId);
        const fileMatch = history.find(h => h.filePath === q.file);
        if (fileMatch) {
          score += 0.4;
          reasons.push(`previously edited ${q.file} (${fileMatch.touchCount}x)`);
        }
        // Currently locked file
        const locks = this.lockRegistry.getByAgent(agent.id);
        if (locks.some(l => l.filePath === q.file)) {
          score += 0.3;
          reasons.push(`currently editing ${q.file}`);
        }
      }

      // Technology match
      if (q.technology) {
        const techs = this.inferTechnologies(agent.id, leadId);
        if (techs.includes(q.technology.toLowerCase())) {
          score += 0.2;
          reasons.push(`has ${q.technology} experience`);
        }
      }

      // Keyword match in task
      if (q.keyword && agent.task) {
        if (agent.task.toLowerCase().includes(q.keyword.toLowerCase())) {
          score += 0.2;
          reasons.push(`task mentions "${q.keyword}"`);
        }
      }

      // Domain match in role name
      if (q.domain) {
        const dn = q.domain.toLowerCase();
        if (agent.role.name.toLowerCase().includes(dn) || agent.role.id.toLowerCase().includes(dn)) {
          score += 0.15;
          reasons.push(`role matches "${q.domain}"`);
        }
      }

      // Idle bonus — only applied when there are other matching signals
      if (agent.status === 'idle' && score > 0) {
        score += 0.05;
        reasons.push('currently idle');
      }

      if (score > 0) {
        results.push({
          agentId: agent.id,
          shortId: agent.id.slice(0, 8),
          roleName: agent.role.name,
          status: agent.status,
          task: agent.task,
          score: Math.min(score, 1),
          reasons,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function extToTech(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? EXTENSION_TO_TECH[ext] : undefined;
}

function toFileTouchRecord(row: typeof agentFileHistory.$inferSelect): FileTouchRecord {
  return {
    agentId: row.agentId,
    agentRole: row.agentRole,
    leadId: row.leadId,
    filePath: row.filePath,
    firstTouchedAt: row.firstTouchedAt!,
    lastTouchedAt: row.lastTouchedAt!,
    touchCount: row.touchCount!,
  };
}
