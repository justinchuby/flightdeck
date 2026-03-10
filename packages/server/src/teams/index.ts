/**
 * Teams module barrel export.
 */
export {
  BUNDLE_FORMAT_VERSION,
  computeChecksum,
  createManifest,
  validateManifest,
  verifyChecksum,
} from './bundle-format.js';
export type {
  BundleManifest,
  BundleStats,
  AgentExport,
  AgentExportStats,
  KnowledgeCategory,
  KnowledgeExport,
  CorrectionExport,
  FeedbackExport,
  TeamBundle,
  ExportOptions,
} from './bundle-format.js';

export { TeamExporter } from './TeamExporter.js';
export type { TeamExporterDeps, ExportResult } from './TeamExporter.js';

export { ImportValidator } from './ImportValidator.js';
export type {
  ValidationResult,
  ValidationIssue,
  ValidationSeverity,
  ConflictInfo,
  ConflictCheckDeps,
  DryRunSummary,
} from './ImportValidator.js';

export { TeamImporter } from './TeamImporter.js';
export type {
  ImportOptions,
  ImportReport,
  ImportAgentResult,
  ImportKnowledgeResult,
  ImportTrainingResult,
  TeamImporterDeps,
  AgentConflictStrategy,
  KnowledgeConflictStrategy,
  TeamConflictStrategy,
} from './TeamImporter.js';
