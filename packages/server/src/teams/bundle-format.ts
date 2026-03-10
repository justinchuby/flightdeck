/**
 * Team export bundle format — versioned structure for portable teams.
 *
 * A bundle is a directory (`.flightdeck-team/`) containing:
 *   manifest.json   — version, metadata, checksum
 *   agents/         — one JSON per agent (identity, role, model, config)
 *   knowledge/      — entries by category (core.json, procedural.json, etc.)
 *   training/       — corrections.json, feedback.json
 *
 * Design: docs/design/agent-server-architecture.md (Portable Teams)
 */
import { createHash } from 'node:crypto';

// ── Bundle Format Version ───────────────────────────────────────────

export const BUNDLE_FORMAT_VERSION = '1.0';

// ── Manifest ────────────────────────────────────────────────────────

export interface BundleManifest {
  bundleFormat: string;
  exportedAt: string;
  sourceProjectId?: string;
  sourceTeamId?: string;
  checksum: string;
  stats: BundleStats;
}

export interface BundleStats {
  agentCount: number;
  knowledgeCount: number;
  correctionCount: number;
  feedbackCount: number;
}

// ── Agent Export ─────────────────────────────────────────────────────

export interface AgentExport {
  name: string;
  role: string;
  model: string;
  status: string;
  sessionId?: string;
  specialization?: string[];
  autopilot?: boolean;
  config: Record<string, unknown>;
  stats?: AgentExportStats;
}

export interface AgentExportStats {
  createdAt: string;
  lastTaskSummary?: string;
}

// ── Knowledge Export ────────────────────────────────────────────────

export type KnowledgeCategory = 'core' | 'episodic' | 'procedural' | 'semantic';

export interface KnowledgeExport {
  key: string;
  content: string;
  category: KnowledgeCategory;
  confidence?: number;
  tags?: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Training Export ─────────────────────────────────────────────────

export interface CorrectionExport {
  id: string;
  agentId: string;
  originalAction: string;
  correctedAction: string;
  context?: string;
  tags: string[];
  timestamp: string;
}

export interface FeedbackExport {
  id: string;
  agentId: string;
  action: string;
  rating: 'positive' | 'negative';
  comment?: string;
  tags: string[];
  timestamp: string;
}

// ── Full Bundle ─────────────────────────────────────────────────────

export interface TeamBundle {
  manifest: BundleManifest;
  agents: AgentExport[];
  knowledge: Record<KnowledgeCategory, KnowledgeExport[]>;
  training: {
    corrections: CorrectionExport[];
    feedback: FeedbackExport[];
  };
}

// ── Export Options ───────────────────────────────────────────────────

export interface ExportOptions {
  agentIds?: string[];
  categories?: KnowledgeCategory[];
  includeKnowledge?: boolean;
  includeTraining?: boolean;
  excludeEpisodic?: boolean;
}

// ── Utility Functions ───────────────────────────────────────────────

/**
 * Compute SHA-256 checksum of bundle content (agents + knowledge + training).
 * The manifest itself is excluded from the checksum.
 */
export function computeChecksum(bundle: Omit<TeamBundle, 'manifest'>): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(bundle.agents));
  hash.update(JSON.stringify(bundle.knowledge));
  hash.update(JSON.stringify(bundle.training));
  return hash.digest('hex');
}

/** Create a manifest from bundle content. */
export function createManifest(
  bundle: Omit<TeamBundle, 'manifest'>,
  opts?: { projectId?: string; teamId?: string },
): BundleManifest {
  return {
    bundleFormat: BUNDLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProjectId: opts?.projectId,
    sourceTeamId: opts?.teamId,
    checksum: computeChecksum(bundle),
    stats: {
      agentCount: bundle.agents.length,
      knowledgeCount: Object.values(bundle.knowledge).reduce((sum, arr) => sum + arr.length, 0),
      correctionCount: bundle.training.corrections.length,
      feedbackCount: bundle.training.feedback.length,
    },
  };
}

/** Validate a manifest object has required fields and correct format version. */
export function validateManifest(manifest: unknown): manifest is BundleManifest {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  return (
    typeof m.bundleFormat === 'string' &&
    m.bundleFormat === BUNDLE_FORMAT_VERSION &&
    typeof m.exportedAt === 'string' &&
    typeof m.checksum === 'string' &&
    m.checksum.length === 64 &&
    typeof m.stats === 'object' &&
    m.stats !== null &&
    typeof (m.stats as any).agentCount === 'number'
  );
}

/** Verify bundle integrity by recomputing checksum. */
export function verifyChecksum(bundle: TeamBundle): boolean {
  const expected = bundle.manifest.checksum;
  const actual = computeChecksum({
    agents: bundle.agents,
    knowledge: bundle.knowledge,
    training: bundle.training,
  });
  return expected === actual;
}
