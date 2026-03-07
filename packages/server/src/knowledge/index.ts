export { KnowledgeStore } from './KnowledgeStore.js';
export { HybridSearchEngine, fuseResults, fitToBudget, estimateTokens } from './HybridSearchEngine.js';
export { TrainingCapture } from './TrainingCapture.js';
export { KnowledgeInjector } from './KnowledgeInjector.js';
export type { InjectionContext, InjectionResult } from './KnowledgeInjector.js';
export {
  MemoryCategoryManager,
  DEFAULT_CATEGORY_LIMITS,
} from './MemoryCategoryManager.js';
export type {
  CategoryLimits,
  CategoryStats,
  PruneResult,
} from './MemoryCategoryManager.js';
export type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeMetadata,
  SearchOptions,
  ScoredKnowledgeEntry,
  HybridSearchOptions,
  FusedSearchResult,
  VectorSearchProvider,
  Correction,
  CorrectionEntry,
  Feedback,
  FeedbackEntry,
  TrainingRetrievalOptions,
  TrainingSummary,
  TagCount,
  AgentTrainingStats,
} from './types.js';
export { KNOWLEDGE_CATEGORIES } from './types.js';
