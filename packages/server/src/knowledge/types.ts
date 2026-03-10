/** The 4-tier knowledge categories. */
export type KnowledgeCategory = 'core' | 'episodic' | 'procedural' | 'semantic';

/** All valid category values. */
export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  'core',
  'episodic',
  'procedural',
  'semantic',
] as const;

/** Optional metadata attached to a knowledge entry. */
export interface KnowledgeMetadata {
  /** Where this knowledge came from (e.g., 'user', 'agent', 'auto') */
  source?: string;
  /** Confidence score 0–1 */
  confidence?: number;
  /** Freeform tags for filtering */
  tags?: string[];
  /** Extensible — callers can add domain-specific fields */
  [key: string]: unknown;
}

/** A single knowledge entry as returned by KnowledgeStore. */
export interface KnowledgeEntry {
  id: number;
  projectId: string;
  category: KnowledgeCategory;
  key: string;
  content: string;
  metadata: KnowledgeMetadata | null;
  createdAt: string;
  updatedAt: string;
}

/** Options for full-text search queries. */
export interface SearchOptions {
  /** Restrict search to a specific category */
  category?: KnowledgeCategory;
  /** Maximum number of results (default: 20) */
  limit?: number;
}

/** A knowledge entry with an associated relevance score. */
export interface ScoredKnowledgeEntry extends KnowledgeEntry {
  /** Relevance score (lower BM25 = more relevant; normalized in hybrid search) */
  score: number;
}

/** Options for hybrid search. */
export interface HybridSearchOptions {
  /** Restrict to specific categories */
  categories?: KnowledgeCategory[];
  /** Maximum number of results (default: 10) */
  limit?: number;
  /** Maximum token budget for returned results (default: 1200) */
  tokenBudget?: number;
  /** RRF constant k (default: 60) */
  rrfK?: number;
  /** Weight for FTS5 results in fusion (default: 1.0) */
  fts5Weight?: number;
  /** Weight for vector results in fusion (default: 1.0) */
  vectorWeight?: number;
}

/** A fused search result with combined score. */
export interface FusedSearchResult {
  entry: KnowledgeEntry;
  /** Combined RRF score (higher = more relevant) */
  fusedScore: number;
  /** Estimated token count for this entry's content */
  estimatedTokens: number;
}

/**
 * Interface for pluggable vector search providers.
 * Implementations must return entries ranked by semantic similarity.
 */
export interface VectorSearchProvider {
  /** Search for semantically similar entries. Returns entries with similarity scores (0–1). */
  search(projectId: string, query: string, limit: number): ScoredKnowledgeEntry[];
}

// ---------------------------------------------------------------------------
// Training / Correction capture types
// ---------------------------------------------------------------------------

/** A user correction of an agent's behavior. */
export interface Correction {
  /** Which agent was corrected */
  agentId: string;
  /** What the agent did wrong */
  originalAction: string;
  /** What the user wanted instead */
  correctedAction: string;
  /** Surrounding context for the correction */
  context?: string;
  /** Freeform tags, e.g. 'git', 'testing', 'code-style' */
  tags?: string[];
}

/** A stored correction entry with persistence metadata. */
export interface CorrectionEntry extends Required<Pick<Correction, 'agentId' | 'originalAction' | 'correctedAction' | 'tags'>> {
  id: string;
  projectId: string;
  timestamp: string;
  context?: string;
}

/** User feedback (positive or negative) about an agent action. */
export interface Feedback {
  /** Which agent the feedback is about */
  agentId: string;
  /** The action being rated */
  action: string;
  /** Whether the action was good or bad */
  rating: 'positive' | 'negative';
  /** Optional user comment */
  comment?: string;
  /** Freeform tags */
  tags?: string[];
}

/** A stored feedback entry with persistence metadata. */
export interface FeedbackEntry extends Required<Pick<Feedback, 'agentId' | 'action' | 'rating' | 'tags'>> {
  id: string;
  projectId: string;
  timestamp: string;
  comment?: string;
}

/** Options for retrieving corrections or feedback. */
export interface TrainingRetrievalOptions {
  /** Filter to entries containing at least one of these tags */
  tags?: string[];
  /** Filter to a specific agent */
  agentId?: string;
  /** Maximum number of results */
  limit?: number;
}

/** A tag with its occurrence count. */
export interface TagCount {
  tag: string;
  count: number;
}

/** Per-agent training statistics. */
export interface AgentTrainingStats {
  agentId: string;
  corrections: number;
  positive: number;
  negative: number;
}

/** Aggregated training summary for a project. */
export interface TrainingSummary {
  totalCorrections: number;
  totalFeedback: number;
  positiveFeedback: number;
  negativeFeedback: number;
  topCorrectionTags: TagCount[];
  topFeedbackTags: TagCount[];
  agentStats: AgentTrainingStats[];
}

// ── Session Knowledge Extraction ────────────────────────────────────

/** A message from a completed session, used for knowledge extraction. */
export interface SessionMessage {
  sender: string;
  content: string;
  timestamp?: string;
}

/** Data about a completed session to extract knowledge from. */
export interface SessionData {
  sessionId: string;
  projectId: string;
  task?: string;
  role?: string;
  agentId?: string;
  messages: SessionMessage[];
  /** Summary provided by the agent on task completion */
  completionSummary?: string;
  startedAt?: string;
  endedAt?: string;
}

/** A piece of extracted knowledge before storage. */
export interface ExtractedKnowledge {
  category: KnowledgeCategory;
  key: string;
  content: string;
  metadata: KnowledgeMetadata;
}

/** Result of session knowledge extraction. */
export interface ExtractionResult {
  /** Number of knowledge entries stored */
  entriesStored: number;
  /** Extracted entries by category */
  decisions: ExtractedKnowledge[];
  patterns: ExtractedKnowledge[];
  errors: ExtractedKnowledge[];
  summary: ExtractedKnowledge | null;
}


