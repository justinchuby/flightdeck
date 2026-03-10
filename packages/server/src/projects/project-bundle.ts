/**
 * Project export bundle format — versioned structure for portable projects.
 *
 * A project bundle captures everything needed to reproduce a project:
 *   manifest         — version, metadata, checksum, stats
 *   project          — name, description, cwd, status
 *   agents           — all agents with roles, models, metadata
 *   knowledge        — entries by category (core, episodic, procedural, semantic)
 *   collectiveMemory — shared project-level memories
 *   agentMemory      — per-agent key/value memories
 *   sessions         — session history for each agent
 *   training         — corrections and feedback
 */
import { createHash } from 'node:crypto';
import type { KnowledgeCategory, KnowledgeExport, CorrectionExport, FeedbackExport } from '../teams/bundle-format.js';

export { type KnowledgeCategory, type KnowledgeExport, type CorrectionExport, type FeedbackExport };

// ── Bundle Format Version ───────────────────────────────────────────

export const PROJECT_BUNDLE_VERSION = '1.0';
export const MAX_BUNDLE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// ── Manifest ────────────────────────────────────────────────────────

export interface ProjectBundleManifest {
  bundleFormat: string;
  bundleType: 'project';
  exportedAt: string;
  sourceProjectId: string;
  sourceProjectName: string;
  checksum: string;
  stats: ProjectBundleStats;
}

export interface ProjectBundleStats {
  agentCount: number;
  knowledgeCount: number;
  memoryCount: number;
  agentMemoryCount: number;
  sessionCount: number;
  correctionCount: number;
  feedbackCount: number;
}

// ── Project Metadata Export ─────────────────────────────────────────

export interface ProjectMetadataExport {
  name: string;
  description: string;
  cwd: string | null;
  status: string;
}

// ── Agent Export ─────────────────────────────────────────────────────

export interface ProjectAgentExport {
  agentId: string;
  role: string;
  model: string;
  status: string;
  sessionId?: string;
  teamId: string;
  lastTaskSummary?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ── Memory Exports ──────────────────────────────────────────────────

export interface CollectiveMemoryExport {
  category: string;
  key: string;
  value: string;
  source: string;
  useCount: number;
}

export interface AgentMemoryExport {
  leadId: string;
  agentId: string;
  key: string;
  value: string;
}

// ── Session Export ───────────────────────────────────────────────────

export interface SessionExport {
  leadId: string;
  sessionId?: string;
  role?: string;
  task?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
}

// ── Full Bundle ─────────────────────────────────────────────────────

export interface ProjectBundle {
  manifest: ProjectBundleManifest;
  project: ProjectMetadataExport;
  agents: ProjectAgentExport[];
  knowledge: Record<KnowledgeCategory, KnowledgeExport[]>;
  collectiveMemory: CollectiveMemoryExport[];
  agentMemory: AgentMemoryExport[];
  sessions: SessionExport[];
  training: {
    corrections: CorrectionExport[];
    feedback: FeedbackExport[];
  };
}

// ── Utility Functions ───────────────────────────────────────────────

/** Compute SHA-256 of bundle content (everything except manifest). */
export function computeProjectChecksum(bundle: Omit<ProjectBundle, 'manifest'>): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(bundle.project));
  hash.update(JSON.stringify(bundle.agents));
  hash.update(JSON.stringify(bundle.knowledge));
  hash.update(JSON.stringify(bundle.collectiveMemory));
  hash.update(JSON.stringify(bundle.agentMemory));
  hash.update(JSON.stringify(bundle.sessions));
  hash.update(JSON.stringify(bundle.training));
  return hash.digest('hex');
}

/** Create a manifest for a project bundle. */
export function createProjectManifest(
  bundle: Omit<ProjectBundle, 'manifest'>,
  sourceProjectId: string,
): ProjectBundleManifest {
  const knowledgeCount = Object.values(bundle.knowledge).reduce((s, a) => s + a.length, 0);
  return {
    bundleFormat: PROJECT_BUNDLE_VERSION,
    bundleType: 'project',
    exportedAt: new Date().toISOString(),
    sourceProjectId,
    sourceProjectName: bundle.project.name,
    checksum: computeProjectChecksum(bundle),
    stats: {
      agentCount: bundle.agents.length,
      knowledgeCount,
      memoryCount: bundle.collectiveMemory.length,
      agentMemoryCount: bundle.agentMemory.length,
      sessionCount: bundle.sessions.length,
      correctionCount: bundle.training.corrections.length,
      feedbackCount: bundle.training.feedback.length,
    },
  };
}

/** Validate a manifest object has required fields. */
export function validateProjectManifest(manifest: unknown): manifest is ProjectBundleManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  return (
    m.bundleFormat === PROJECT_BUNDLE_VERSION &&
    m.bundleType === 'project' &&
    typeof m.exportedAt === 'string' &&
    typeof m.checksum === 'string' &&
    (m.checksum as string).length === 64 &&
    typeof m.sourceProjectId === 'string' &&
    typeof m.stats === 'object' && m.stats !== null
  );
}

/** Verify bundle integrity. */
export function verifyProjectChecksum(bundle: ProjectBundle): boolean {
  return bundle.manifest.checksum === computeProjectChecksum({
    project: bundle.project,
    agents: bundle.agents,
    knowledge: bundle.knowledge,
    collectiveMemory: bundle.collectiveMemory,
    agentMemory: bundle.agentMemory,
    sessions: bundle.sessions,
    training: bundle.training,
  });
}
