# R3: Reorganize `coordination/` Directory — Implementation Spec

**Status:** ✅ **Implemented** (2026-03-07)
**Estimated effort:** 1–2 days + 1 day follow-up for skill/doc updates
**Risk:** Medium (many import paths change; must be atomic to avoid broken builds)

---

## 1. Current State Analysis

### Overview

The `packages/server/src/coordination/` directory contains **46 files** totaling **11,599 lines** of TypeScript. It's a flat catch-all covering ~12 distinct domains. Every file is a top-level peer, making it hard to understand which services are related.

### Files Categorized by Domain

#### Activity (2 files, 404 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| ActivityLedger.ts | 273 | `ActivityLedger` | Event-sourced activity log with DB persistence and buffering |
| SmartActivityFilter.ts | 131 | `SmartActivityFilter` | Prioritizes/deduplicates activity entries to reduce noise |

**Internal deps:** SmartActivityFilter imports `ActivityEntry`/`ActionType` from ActivityLedger

#### Alerts (5 files, 1,089 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| AlertEngine.ts | 300 | `AlertEngine` | Monitors agent health, context utilization, stale decisions |
| EscalationManager.ts | 173 | `EscalationManager` | Routes stale decisions and blocked tasks to escalation targets |
| NotificationManager.ts | 126 | `NotificationManager` | Priority/category notification routing with user preferences |
| NotificationService.ts | 366 | `NotificationService` | Multi-channel delivery (Slack, Discord, email, webhooks) with retries |
| WebhookManager.ts | 124 | `WebhookManager` | Webhook registration and event delivery with retry tracking |

**Internal deps:** AlertEngine → FileLockRegistry, DecisionLog, ActivityLedger; EscalationManager → DecisionLog

#### Code Quality (2 files, 287 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| ComplexityMonitor.ts | 195 | `ComplexityMonitor` | Analyzes file metrics (LOC, imports, functions) against thresholds |
| CoverageTracker.ts | 92 | `CoverageTracker` | Tracks test coverage snapshots and alerts on regressions |

**Internal deps:** None (standalone)

#### Commands (1 file, 923 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| NLCommandService.ts | 923 | `NLCommandService` | Natural language command parsing with undo/redo support |

**Internal deps:** Imports from AgentManager (external), DecisionLog, ActivityLedger

#### Decisions (4 files, 1,712 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| DecisionLog.ts | 673 | `DecisionLog` | Persistent decision log with status tracking, intent rules, confirmation workflows |
| DecisionRecords.ts | 148 | `DecisionRecordStore` | ADR-style decision records from raw DECISION commands |
| ConflictDetectionEngine.ts | 743 | `ConflictDetectionEngine` | Detects file/import conflicts between concurrent agents |
| DebateDetector.ts | 212 | `DebateDetector` | Identifies disagreements between agents using linguistic patterns |

**Note:** ConflictDetectionEngine is borderline files/decisions. Placed here because its output is conflict *decisions* and it doesn't depend on file-lock internals — it works on abstract file path sets. DebateDetector monitors group chats for contested decisions.

**Internal deps:** DecisionRecords → DecisionLog; ConflictDetectionEngine → none (standalone); DebateDetector → none (imports from comms/)

#### Events (4 files, 540 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| EventPipeline.ts | 152 | `EventPipeline` | Async event queue with registered handlers, dedup, overflow management |
| CommEventExtractor.ts | 45 | `extractCommFromActivity()` | Extracts communication events from activity log entries |
| ProjectionUtils.ts | 165 | Utility functions | Cycle detection and orphan handling for causal event graphs |
| SynthesisEngine.ts | 178 | `SynthesisEngine` | Classifies activity by severity/impact for CREW_UPDATE synthesis |

**Internal deps:** EventPipeline → ActivityEntry type; CommEventExtractor → ActivityEntry type; SynthesisEngine → ActivityLedger

#### Files (5 files, 1,058 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| FileLockRegistry.ts | 249 | `FileLockRegistry` | Exclusive file locks with expiry, conflict detection, cleanup |
| FileDependencyGraph.ts | 202 | `FileDependencyGraph` | Import statement analysis for transitive dependency graphs |
| DiffService.ts | 236 | `DiffService` | Git diff execution with caching, bridges to lock registry |
| DependencyScanner.ts | 115 | `DependencyScanner` | Scans package.json for dependency metadata |
| WorktreeManager.ts | 256 | `WorktreeManager` | Git worktree isolation per agent with merge tracking |

**Internal deps:** DiffService → FileLockRegistry; CapabilityRegistry → FileLockRegistry (but CapabilityRegistry is in agents/ cluster)

#### Knowledge (3 files, 468 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| CollectiveMemory.ts | 174 | `CollectiveMemory` | Cross-project reusable knowledge patterns storage |
| KnowledgeTransfer.ts | 107 | `KnowledgeTransfer` | In-memory searchable knowledge base for patterns/pitfalls |
| SearchEngine.ts | 187 | `SearchEngine` | Full-text search across activity logs, decisions, messages |

**Internal deps:** SearchEngine → ActivityLedger, DecisionLog

#### Playbooks (3 files, 725 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| PlaybookService.ts | 127 | `PlaybookService` | Local playbook storage with CRUD and settings |
| CommunityPlaybookService.ts | 431 | `CommunityPlaybookService` | Community-sourced playbooks with ratings and publication |
| ProjectTemplates.ts | 167 | `ProjectTemplateRegistry` | Built-in/custom project templates with predefined roles |

**Internal deps:** None (standalone cluster)

#### Recovery (2 files, 691 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| RecoveryService.ts | 393 | `RecoveryService` | Agent crash detection, briefing generation, restart with metrics |
| HandoffService.ts | 298 | `HandoffService` | Agent state snapshot capture for handoffs with quality scoring |

**Internal deps:** Both → FileLockRegistry, DecisionLog; HandoffService → RecoveryService (HandoffBriefing type)

#### Reporting (3 files, 664 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| AnalyticsService.ts | 253 | `AnalyticsService` | Session metrics, token usage, role contribution aggregation |
| PerformanceScorecard.ts | 217 | `PerformanceTracker` | Agent performance metrics (speed, quality, efficiency) |
| ReportGenerator.ts | 194 | `ReportGenerator` | HTML and Markdown session summary report generation |

**Internal deps:** PerformanceScorecard → ActivityLedger

#### Scheduling (2 files, 398 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| TimerRegistry.ts | 234 | `TimerRegistry` | Persisted agent timers with DB backing and periodic ticks |
| BudgetEnforcer.ts | 164 | `BudgetEnforcer` | Token spending tracking against budget limits |

**Internal deps:** None (standalone)

#### Sessions (4 files, 1,011 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| CatchUpSummary.ts | 117 | `CatchUpService` | Time-windowed summaries of completed tasks/decisions for briefing |
| SessionExporter.ts | 343 | `SessionExporter` | Exports complete session history to timestamped disk artifacts |
| SessionReplay.ts | 277 | `SessionReplay` | Reconstructs world state snapshots for timeline visualization |
| SessionRetro.ts | 274 | `SessionRetro` | Post-session analysis with scorecards and bottleneck identification |

**Internal deps:** All → ActivityLedger, DecisionLog; SessionReplay/SessionRetro → FileLockRegistry

#### Sharing (1 file, 98 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| ShareLinkService.ts | 98 | `ShareLinkService` | Time-expiring shareable links for session access |

**Internal deps:** None

#### Agents (4 files, 963 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| AgentMatcher.ts | 138 | `AgentMatcher` | Scores/ranks agents for tasks based on capabilities and availability |
| CapabilityRegistry.ts | 217 | `CapabilityRegistry` | Indexes agent capabilities from file history and domain knowledge |
| ContextRefresher.ts | 332 | `ContextRefresher` | Periodically updates agent context windows with fresh state |
| CrewFormatter.ts | 246 | `CrewFormatter` | Formats agent crew state into tabular layout for CREW_UPDATE |

**Internal deps:** AgentMatcher → CapabilityRegistry, ActivityLedger; ContextRefresher → FileLockRegistry, ActivityLedger, SynthesisEngine, SmartActivityFilter

#### Predictions (1 file, 534 lines)
| File | Lines | Primary Export | Description |
|------|-------|----------------|-------------|
| PredictionService.ts | 534 | `PredictionService` | Predicts risks (context exhaustion, cost overrun, stalls) |

**Internal deps:** None (standalone)

---

## 2. Proposed Directory Structure

```
coordination/
├── activity/
│   ├── ActivityLedger.ts
│   ├── SmartActivityFilter.ts
│   └── index.ts
├── alerts/
│   ├── AlertEngine.ts
│   ├── EscalationManager.ts
│   ├── NotificationManager.ts
│   ├── NotificationService.ts
│   ├── WebhookManager.ts
│   └── index.ts
├── code-quality/
│   ├── ComplexityMonitor.ts
│   ├── CoverageTracker.ts
│   └── index.ts
├── commands/
│   ├── NLCommandService.ts
│   └── index.ts
├── decisions/
│   ├── ConflictDetectionEngine.ts
│   ├── DebateDetector.ts
│   ├── DecisionLog.ts
│   ├── DecisionRecords.ts
│   └── index.ts
├── events/
│   ├── CommEventExtractor.ts
│   ├── EventPipeline.ts
│   ├── ProjectionUtils.ts
│   ├── SynthesisEngine.ts
│   └── index.ts
├── files/
│   ├── DependencyScanner.ts
│   ├── DiffService.ts
│   ├── FileDependencyGraph.ts
│   ├── FileLockRegistry.ts
│   ├── WorktreeManager.ts
│   └── index.ts
├── knowledge/
│   ├── CollectiveMemory.ts
│   ├── KnowledgeTransfer.ts
│   ├── SearchEngine.ts
│   └── index.ts
├── playbooks/
│   ├── CommunityPlaybookService.ts
│   ├── PlaybookService.ts
│   ├── ProjectTemplates.ts
│   └── index.ts
├── predictions/
│   ├── PredictionService.ts
│   └── index.ts
├── recovery/
│   ├── HandoffService.ts
│   ├── RecoveryService.ts
│   └── index.ts
├── reporting/
│   ├── AnalyticsService.ts
│   ├── PerformanceScorecard.ts
│   ├── ReportGenerator.ts
│   └── index.ts
├── scheduling/
│   ├── BudgetEnforcer.ts
│   ├── TimerRegistry.ts
│   └── index.ts
├── sessions/
│   ├── CatchUpSummary.ts
│   ├── SessionExporter.ts
│   ├── SessionReplay.ts
│   ├── SessionRetro.ts
│   └── index.ts
├── sharing/
│   ├── ShareLinkService.ts
│   └── index.ts
├── agents/
│   ├── AgentMatcher.ts
│   ├── CapabilityRegistry.ts
│   ├── ContextRefresher.ts
│   ├── CrewFormatter.ts
│   └── index.ts
└── index.ts              ← root barrel that re-exports all subdirectory barrels
```

**16 subdirectories** with **46 source files** + **17 barrel index files** (16 subdirectory + 1 root).

### Design Rationale

1. **No files merge or split** — every file moves intact. This is a pure organizational refactor with zero behavioral change.
2. **Domain clusters of 1–5 files** — small enough to scan, large enough to be worth a directory.
3. **Barrel exports at each level** — enables consumers to import from `coordination/files/index.js` or from the root `coordination/index.js`.
4. **Alphabetical ordering** within directories for predictability.

---

## 3. Exact File Moves

Every file moves from `coordination/{File}.ts` to `coordination/{domain}/{File}.ts`:

| # | Old Path | New Path |
|---|----------|----------|
| 1 | `coordination/ActivityLedger.ts` | `coordination/activity/ActivityLedger.ts` |
| 2 | `coordination/SmartActivityFilter.ts` | `coordination/activity/SmartActivityFilter.ts` |
| 3 | `coordination/AlertEngine.ts` | `coordination/alerts/AlertEngine.ts` |
| 4 | `coordination/EscalationManager.ts` | `coordination/alerts/EscalationManager.ts` |
| 5 | `coordination/NotificationManager.ts` | `coordination/alerts/NotificationManager.ts` |
| 6 | `coordination/NotificationService.ts` | `coordination/alerts/NotificationService.ts` |
| 7 | `coordination/WebhookManager.ts` | `coordination/alerts/WebhookManager.ts` |
| 8 | `coordination/ComplexityMonitor.ts` | `coordination/code-quality/ComplexityMonitor.ts` |
| 9 | `coordination/CoverageTracker.ts` | `coordination/code-quality/CoverageTracker.ts` |
| 10 | `coordination/NLCommandService.ts` | `coordination/commands/NLCommandService.ts` |
| 11 | `coordination/ConflictDetectionEngine.ts` | `coordination/decisions/ConflictDetectionEngine.ts` |
| 12 | `coordination/DebateDetector.ts` | `coordination/decisions/DebateDetector.ts` |
| 13 | `coordination/DecisionLog.ts` | `coordination/decisions/DecisionLog.ts` |
| 14 | `coordination/DecisionRecords.ts` | `coordination/decisions/DecisionRecords.ts` |
| 15 | `coordination/CommEventExtractor.ts` | `coordination/events/CommEventExtractor.ts` |
| 16 | `coordination/EventPipeline.ts` | `coordination/events/EventPipeline.ts` |
| 17 | `coordination/ProjectionUtils.ts` | `coordination/events/ProjectionUtils.ts` |
| 18 | `coordination/SynthesisEngine.ts` | `coordination/events/SynthesisEngine.ts` |
| 19 | `coordination/DependencyScanner.ts` | `coordination/files/DependencyScanner.ts` |
| 20 | `coordination/DiffService.ts` | `coordination/files/DiffService.ts` |
| 21 | `coordination/FileDependencyGraph.ts` | `coordination/files/FileDependencyGraph.ts` |
| 22 | `coordination/FileLockRegistry.ts` | `coordination/files/FileLockRegistry.ts` |
| 23 | `coordination/WorktreeManager.ts` | `coordination/files/WorktreeManager.ts` |
| 24 | `coordination/CollectiveMemory.ts` | `coordination/knowledge/CollectiveMemory.ts` |
| 25 | `coordination/KnowledgeTransfer.ts` | `coordination/knowledge/KnowledgeTransfer.ts` |
| 26 | `coordination/SearchEngine.ts` | `coordination/knowledge/SearchEngine.ts` |
| 27 | `coordination/CommunityPlaybookService.ts` | `coordination/playbooks/CommunityPlaybookService.ts` |
| 28 | `coordination/PlaybookService.ts` | `coordination/playbooks/PlaybookService.ts` |
| 29 | `coordination/ProjectTemplates.ts` | `coordination/playbooks/ProjectTemplates.ts` |
| 30 | `coordination/PredictionService.ts` | `coordination/predictions/PredictionService.ts` |
| 31 | `coordination/HandoffService.ts` | `coordination/recovery/HandoffService.ts` |
| 32 | `coordination/RecoveryService.ts` | `coordination/recovery/RecoveryService.ts` |
| 33 | `coordination/AnalyticsService.ts` | `coordination/reporting/AnalyticsService.ts` |
| 34 | `coordination/PerformanceScorecard.ts` | `coordination/reporting/PerformanceScorecard.ts` |
| 35 | `coordination/ReportGenerator.ts` | `coordination/reporting/ReportGenerator.ts` |
| 36 | `coordination/BudgetEnforcer.ts` | `coordination/scheduling/BudgetEnforcer.ts` |
| 37 | `coordination/TimerRegistry.ts` | `coordination/scheduling/TimerRegistry.ts` |
| 38 | `coordination/CatchUpSummary.ts` | `coordination/sessions/CatchUpSummary.ts` |
| 39 | `coordination/SessionExporter.ts` | `coordination/sessions/SessionExporter.ts` |
| 40 | `coordination/SessionReplay.ts` | `coordination/sessions/SessionReplay.ts` |
| 41 | `coordination/SessionRetro.ts` | `coordination/sessions/SessionRetro.ts` |
| 42 | `coordination/ShareLinkService.ts` | `coordination/sharing/ShareLinkService.ts` |
| 43 | `coordination/AgentMatcher.ts` | `coordination/agents/AgentMatcher.ts` |
| 44 | `coordination/CapabilityRegistry.ts` | `coordination/agents/CapabilityRegistry.ts` |
| 45 | `coordination/ContextRefresher.ts` | `coordination/agents/ContextRefresher.ts` |
| 46 | `coordination/CrewFormatter.ts` | `coordination/agents/CrewFormatter.ts` |

---

## 4. Import Update Strategy

### 4.1 Approach: Root Barrel Re-Export (Zero External Breakage)

**The root `coordination/index.ts` re-exports everything from all subdirectories.** This means external consumers can either:

- **Use the old-style path** (via barrel): `from '../coordination/index.js'` → works
- **Use the new domain path**: `from '../coordination/files/FileLockRegistry.js'` → explicit

**Phase 1 (this PR):** Move files, create barrels, update intra-coordination imports. Leave external imports pointing to the root barrel or direct file paths — **both work** thanks to the barrel.

**Phase 2 (follow-up PR, optional):** Migrate external imports to use domain-specific paths for clarity. This is optional because the barrel provides backward compatibility.

### 4.2 Intra-Coordination Import Updates

Files within `coordination/` that import from sibling files need path updates. Here is the complete list:

| File (new location) | Old Import | New Import |
|---------------------|-----------|------------|
| `agents/AgentMatcher.ts` | `'./CapabilityRegistry.js'` | `'./CapabilityRegistry.js'` (same dir — no change) |
| `agents/AgentMatcher.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `agents/ContextRefresher.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `agents/ContextRefresher.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `agents/ContextRefresher.ts` | `'./SynthesisEngine.js'` | `'../events/SynthesisEngine.js'` |
| `agents/ContextRefresher.ts` | `'./SmartActivityFilter.js'` | `'../activity/SmartActivityFilter.js'` |
| `agents/CapabilityRegistry.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `alerts/AlertEngine.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `alerts/AlertEngine.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `alerts/AlertEngine.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `alerts/EscalationManager.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `activity/SmartActivityFilter.ts` | `'./ActivityLedger.js'` | `'./ActivityLedger.js'` (same dir — no change) |
| `decisions/DecisionRecords.ts` | `'./DecisionLog.js'` | `'./DecisionLog.js'` (same dir — no change) |
| `events/CommEventExtractor.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `events/EventPipeline.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `events/SynthesisEngine.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `files/DiffService.ts` | `'./FileLockRegistry.js'` | `'./FileLockRegistry.js'` (same dir — no change) |
| `knowledge/SearchEngine.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `knowledge/SearchEngine.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `recovery/HandoffService.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `recovery/HandoffService.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `recovery/HandoffService.ts` | `'./RecoveryService.js'` | `'./RecoveryService.js'` (same dir — no change) |
| `recovery/RecoveryService.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `recovery/RecoveryService.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `recovery/RecoveryService.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `reporting/PerformanceScorecard.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `sessions/CatchUpSummary.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `sessions/CatchUpSummary.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `sessions/SessionExporter.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `sessions/SessionExporter.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `sessions/SessionReplay.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `sessions/SessionReplay.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `sessions/SessionReplay.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |
| `sessions/SessionRetro.ts` | `'./ActivityLedger.js'` | `'../activity/ActivityLedger.js'` |
| `sessions/SessionRetro.ts` | `'./DecisionLog.js'` | `'../decisions/DecisionLog.js'` |
| `sessions/SessionRetro.ts` | `'./FileLockRegistry.js'` | `'../files/FileLockRegistry.js'` |

### 4.3 External Import Handling

**30 source files** and **57 test files** import from `coordination/`. Thanks to the root barrel, no external imports **must** change in Phase 1. But if the developer prefers to update them now:

**Pattern for external imports (mechanical find-replace):**

| Old Pattern | New Pattern |
|-------------|-------------|
| `../coordination/ActivityLedger.js` | `../coordination/activity/ActivityLedger.js` |
| `../coordination/FileLockRegistry.js` | `../coordination/files/FileLockRegistry.js` |
| `../coordination/DecisionLog.js` | `../coordination/decisions/DecisionLog.js` |
| `../coordination/TimerRegistry.js` | `../coordination/scheduling/TimerRegistry.js` |
| `../coordination/CrewFormatter.js` | `../coordination/agents/CrewFormatter.js` |
| `../coordination/WorktreeManager.js` | `../coordination/files/WorktreeManager.js` |
| `../coordination/ContextRefresher.js` | `../coordination/agents/ContextRefresher.js` |
| `../coordination/AlertEngine.js` | `../coordination/alerts/AlertEngine.js` |
| `../coordination/CapabilityRegistry.js` | `../coordination/agents/CapabilityRegistry.js` |
| `../coordination/AgentMatcher.js` | `../coordination/agents/AgentMatcher.js` |
| `../coordination/WebhookManager.js` | `../coordination/alerts/WebhookManager.js` |
| `../coordination/SearchEngine.js` | `../coordination/knowledge/SearchEngine.js` |
| `../coordination/DecisionRecords.js` | `../coordination/decisions/DecisionRecords.js` |
| `../coordination/ReportGenerator.js` | `../coordination/reporting/ReportGenerator.js` |
| `../coordination/SessionRetro.js` | `../coordination/sessions/SessionRetro.js` |
| `../coordination/SessionExporter.js` | `../coordination/sessions/SessionExporter.js` |
| `../coordination/PerformanceScorecard.js` | `../coordination/reporting/PerformanceScorecard.js` |
| `../coordination/CoverageTracker.js` | `../coordination/code-quality/CoverageTracker.js` |
| `../coordination/ComplexityMonitor.js` | `../coordination/code-quality/ComplexityMonitor.js` |
| `../coordination/DependencyScanner.js` | `../coordination/files/DependencyScanner.js` |
| `../coordination/NotificationManager.js` | `../coordination/alerts/NotificationManager.js` |
| `../coordination/EscalationManager.js` | `../coordination/alerts/EscalationManager.js` |
| `../coordination/ProjectTemplates.js` | `../coordination/playbooks/ProjectTemplates.js` |
| `../coordination/KnowledgeTransfer.js` | `../coordination/knowledge/KnowledgeTransfer.js` |
| `../coordination/EventPipeline.js` | `../coordination/events/EventPipeline.js` |
| `../coordination/FileDependencyGraph.js` | `../coordination/files/FileDependencyGraph.js` |
| `../coordination/BudgetEnforcer.js` | `../coordination/scheduling/BudgetEnforcer.js` |
| `../coordination/AnalyticsService.js` | `../coordination/reporting/AnalyticsService.js` |
| `../coordination/NotificationService.js` | `../coordination/alerts/NotificationService.js` |
| `../coordination/DiffService.js` | `../coordination/files/DiffService.js` |
| `../coordination/CommunityPlaybookService.js` | `../coordination/playbooks/CommunityPlaybookService.js` |
| `../coordination/ConflictDetectionEngine.js` | `../coordination/decisions/ConflictDetectionEngine.js` |
| `../coordination/HandoffService.js` | `../coordination/recovery/HandoffService.js` |
| `../coordination/SessionReplay.js` | `../coordination/sessions/SessionReplay.js` |
| `../coordination/ShareLinkService.js` | `../coordination/sharing/ShareLinkService.js` |
| `../coordination/CatchUpSummary.js` | `../coordination/sessions/CatchUpSummary.js` |
| `../coordination/NLCommandService.js` | `../coordination/commands/NLCommandService.js` |
| `../coordination/DebateDetector.js` | `../coordination/decisions/DebateDetector.js` |
| `../coordination/CommEventExtractor.js` | `../coordination/events/CommEventExtractor.js` |
| `../coordination/RecoveryService.js` | `../coordination/recovery/RecoveryService.js` |
| `../coordination/PlaybookService.js` | `../coordination/playbooks/PlaybookService.js` |
| `../coordination/CollectiveMemory.js` | `../coordination/knowledge/CollectiveMemory.js` |
| `../coordination/SynthesisEngine.js` | `../coordination/events/SynthesisEngine.js` |
| `../coordination/SmartActivityFilter.js` | `../coordination/activity/SmartActivityFilter.js` |
| `../coordination/PredictionService.js` | `../coordination/predictions/PredictionService.js` |
| `../coordination/ProjectionUtils.js` | `../coordination/events/ProjectionUtils.js` |

**Affected external source files (31):**
- `packages/server/src/container.ts` (**NEW from R1** — ~22 coordination imports; heaviest single file post-R1)
- `packages/server/src/index.ts` (post-R1: reduced from ~30 to ~5 coordination imports)
- `packages/server/src/api.ts` (~20 coordination imports)
- `packages/server/src/routes/context.ts` (~20 coordination imports)
- `packages/server/src/routes/agents.ts`
- `packages/server/src/routes/analytics.ts`
- `packages/server/src/routes/comms.ts`
- `packages/server/src/routes/community.ts`
- `packages/server/src/routes/config.ts`
- `packages/server/src/routes/conflicts.ts`
- `packages/server/src/routes/coordination.ts`
- `packages/server/src/routes/debates.ts`
- `packages/server/src/routes/decisions.ts`
- `packages/server/src/routes/diff.ts`
- `packages/server/src/routes/handoffs.ts`
- `packages/server/src/routes/nl.ts`
- `packages/server/src/routes/notifications.ts`
- `packages/server/src/routes/playbooks.ts`
- `packages/server/src/routes/predictions.ts`
- `packages/server/src/routes/recovery.ts`
- `packages/server/src/routes/replay.ts`
- `packages/server/src/routes/services.ts`
- `packages/server/src/routes/shared.ts`
- `packages/server/src/routes/summary.ts`
- `packages/server/src/agents/Agent.ts`
- `packages/server/src/agents/AgentManager.ts`
- `packages/server/src/agents/capabilities/CapabilityInjector.ts`
- `packages/server/src/agents/commands/SystemCommands.ts`
- `packages/server/src/agents/commands/types.ts`
- `packages/server/src/comms/WebSocketServer.ts`
- `packages/server/src/validation/schemas.ts` (comment only — no code change needed)

**Affected test files (57):**
- `packages/server/src/__tests__/ActivityLedger.test.ts`
- `packages/server/src/__tests__/AgentMatcher.test.ts`
- `packages/server/src/__tests__/AlertActions.test.ts`
- `packages/server/src/__tests__/AlertEngine.test.ts`
- `packages/server/src/__tests__/Analytics.test.ts`
- `packages/server/src/__tests__/api.integration.test.ts`
- `packages/server/src/__tests__/ApiRouteIsolation.test.ts`
- `packages/server/src/__tests__/BudgetEnforcer.test.ts`
- `packages/server/src/__tests__/CapabilityInjector.test.ts`
- `packages/server/src/__tests__/CapabilityRegistry.test.ts`
- `packages/server/src/__tests__/CatchUpSummary.test.ts`
- `packages/server/src/__tests__/CollectiveMemory.test.ts`
- `packages/server/src/__tests__/CommEventExtractor.test.ts`
- `packages/server/src/__tests__/CommunityPlaybookService.test.ts`
- `packages/server/src/__tests__/ComplexityMonitor.test.ts`
- `packages/server/src/__tests__/ConflictDetectionEngine.test.ts`
- `packages/server/src/__tests__/ContextRefresher.test.ts`
- `packages/server/src/__tests__/CoverageTracker.test.ts`
- `packages/server/src/__tests__/CrewFormatter.test.ts`
- `packages/server/src/__tests__/DebateDetector.test.ts`
- `packages/server/src/__tests__/DecisionLog.batch.test.ts`
- `packages/server/src/__tests__/DecisionLog.test.ts`
- `packages/server/src/__tests__/DecisionRecords.test.ts`
- `packages/server/src/__tests__/DependencyScanner.test.ts`
- `packages/server/src/__tests__/DiffService.test.ts`
- `packages/server/src/__tests__/EscalationManager.test.ts`
- `packages/server/src/__tests__/EventPipeline.test.ts`
- `packages/server/src/__tests__/FileDependencyGraph.test.ts`
- `packages/server/src/__tests__/FileLockRegistry.test.ts`
- `packages/server/src/__tests__/HandoffService.test.ts`
- `packages/server/src/__tests__/IntentRules.test.ts`
- `packages/server/src/__tests__/KnowledgeTransfer.test.ts`
- `packages/server/src/__tests__/NLCommandService.test.ts`
- `packages/server/src/__tests__/NotificationManager.test.ts`
- `packages/server/src/__tests__/NotificationService.test.ts`
- `packages/server/src/__tests__/PerformanceScorecard.test.ts`
- `packages/server/src/__tests__/PlaybookService.test.ts`
- `packages/server/src/__tests__/PredictionService.test.ts`
- `packages/server/src/__tests__/ProjectionUtils.test.ts`
- `packages/server/src/__tests__/ProjectTemplates.test.ts`
- `packages/server/src/__tests__/RecoveryService.test.ts`
- `packages/server/src/__tests__/ReportGenerator.test.ts`
- `packages/server/src/__tests__/SearchEngine.test.ts`
- `packages/server/src/__tests__/SessionExporter.test.ts`
- `packages/server/src/__tests__/SessionReplay.test.ts`
- `packages/server/src/__tests__/SessionRetro.test.ts`
- `packages/server/src/__tests__/ShareLink.test.ts`
- `packages/server/src/__tests__/SmartActivityFilter.test.ts`
- `packages/server/src/__tests__/SupportingSystemsProjectScoping.test.ts`
- `packages/server/src/__tests__/SynthesisEngine.test.ts`
- `packages/server/src/__tests__/TimerApi.test.ts`
- `packages/server/src/__tests__/TimerEdgeCases.test.ts`
- `packages/server/src/__tests__/TimerRegistry.test.ts`
- `packages/server/src/__tests__/WebhookManager.test.ts`
- `packages/server/src/__tests__/WebSocketProjectScoping.test.ts`
- `packages/server/src/__tests__/WorktreeIsolation.test.ts`
- `packages/server/src/__tests__/WorktreeManager.test.ts`

---

## 5. Barrel Export Design

### 5.1 Root Barrel: `coordination/index.ts`

```typescript
// coordination/index.ts
// Root barrel — re-exports all domain clusters for backward compatibility.
// Consumers can import from here or directly from subdirectories.

export * from './activity/index.js';
export * from './alerts/index.js';
export * from './agents/index.js';
export * from './code-quality/index.js';
export * from './commands/index.js';
export * from './decisions/index.js';
export * from './events/index.js';
export * from './files/index.js';
export * from './knowledge/index.js';
export * from './playbooks/index.js';
export * from './predictions/index.js';
export * from './recovery/index.js';
export * from './reporting/index.js';
export * from './scheduling/index.js';
export * from './sessions/index.js';
export * from './sharing/index.js';
```

### 5.2 Subdirectory Barrels

Each subdirectory gets an `index.ts` that re-exports all public symbols from its files. Examples:

**`coordination/activity/index.ts`:**
```typescript
export { ActivityLedger } from './ActivityLedger.js';
export type { ActivityEntry, ActionType } from './ActivityLedger.js';
export { SmartActivityFilter } from './SmartActivityFilter.js';
```

**`coordination/files/index.ts`:**
```typescript
export { FileLockRegistry } from './FileLockRegistry.js';
export type { FileLock } from './FileLockRegistry.js';
export { FileDependencyGraph } from './FileDependencyGraph.js';
export { DiffService, parseDiffOutput } from './DiffService.js';
export { DependencyScanner } from './DependencyScanner.js';
export { WorktreeManager } from './WorktreeManager.js';
```

**`coordination/decisions/index.ts`:**
```typescript
export { DecisionLog, classifyDecision, DECISION_CATEGORIES, TRUST_PRESETS, MIN_MATCHES_FOR_SCORE } from './DecisionLog.js';
export type { Decision, DecisionCategory, TrustPreset, IntentRule, IntentCondition, IntentAction } from './DecisionLog.js';
export { DecisionRecordStore } from './DecisionRecords.js';
export { ConflictDetectionEngine } from './ConflictDetectionEngine.js';
export { DebateDetector } from './DebateDetector.js';
```

**`coordination/events/index.ts`:**
```typescript
export { EventPipeline, taskCompletedHandler, commitQualityGateHandler, delegationTracker } from './EventPipeline.js';
export type { PipelineEvent } from './EventPipeline.js';
export { extractCommFromActivity } from './CommEventExtractor.js';
export { SynthesisEngine, classifyEvent } from './SynthesisEngine.js';
export type { EventTier } from './SynthesisEngine.js';
export * from './ProjectionUtils.js';
```

**`coordination/alerts/index.ts`:**
```typescript
export { AlertEngine } from './AlertEngine.js';
export type { Alert, AlertAction } from './AlertEngine.js';
export { EscalationManager } from './EscalationManager.js';
export { NotificationManager } from './NotificationManager.js';
export type { NotificationCategory, NotificationPreference } from './NotificationManager.js';
export { NotificationService } from './NotificationService.js';
export type { NotificationChannel } from './NotificationService.js';
export { WebhookManager } from './WebhookManager.js';
```

**`coordination/sessions/index.ts`:**
```typescript
export { CatchUpService } from './CatchUpSummary.js';
export type { CatchUpSummary } from './CatchUpSummary.js';
export { SessionExporter } from './SessionExporter.js';
export { SessionReplay } from './SessionReplay.js';
export type { WorldState, Keyframe, ReplayAgentSource } from './SessionReplay.js';
export { SessionRetro } from './SessionRetro.js';
export type { SessionRetroData, AgentScorecard, BottleneckEntry } from './SessionRetro.js';
```

**`coordination/recovery/index.ts`:**
```typescript
export { RecoveryService } from './RecoveryService.js';
export { HandoffService } from './HandoffService.js';
export type { HandoffRecord, HandoffBriefing } from './HandoffService.js';
```

**`coordination/reporting/index.ts`:**
```typescript
export { AnalyticsService } from './AnalyticsService.js';
export { PerformanceTracker } from './PerformanceScorecard.js';
export type { AgentScorecard as PerformanceAgentScorecard } from './PerformanceScorecard.js';
export { ReportGenerator, escapeHtml } from './ReportGenerator.js';
export type { ReportData } from './ReportGenerator.js';
```

**`coordination/scheduling/index.ts`:**
```typescript
export { TimerRegistry } from './TimerRegistry.js';
export type { Timer, TimerInput } from './TimerRegistry.js';
export { BudgetEnforcer } from './BudgetEnforcer.js';
export type { BudgetConfig } from './BudgetEnforcer.js';
```

**`coordination/knowledge/index.ts`:**
```typescript
export { CollectiveMemory } from './CollectiveMemory.js';
export type { MemoryCategory } from './CollectiveMemory.js';
export { KnowledgeTransfer } from './KnowledgeTransfer.js';
export type { KnowledgeCategory } from './KnowledgeTransfer.js';
export { SearchEngine } from './SearchEngine.js';
export type { SearchQuery } from './SearchEngine.js';
```

**`coordination/agents/index.ts`:**
```typescript
export { AgentMatcher } from './AgentMatcher.js';
export type { MatchQuery } from './AgentMatcher.js';
export { CapabilityRegistry } from './CapabilityRegistry.js';
export { ContextRefresher } from './ContextRefresher.js';
export { CrewFormatter, formatCrewUpdate, formatQueryCrew } from './CrewFormatter.js';
export type { CrewMember } from './CrewFormatter.js';
```

**`coordination/code-quality/index.ts`:**
```typescript
export { ComplexityMonitor } from './ComplexityMonitor.js';
export { CoverageTracker } from './CoverageTracker.js';
export type { CoverageSnapshot } from './CoverageTracker.js';
```

**`coordination/commands/index.ts`:**
```typescript
export { NLCommandService } from './NLCommandService.js';
```

**`coordination/playbooks/index.ts`:**
```typescript
export { PlaybookService } from './PlaybookService.js';
export { CommunityPlaybookService } from './CommunityPlaybookService.js';
export type { PlaybookCategory } from './CommunityPlaybookService.js';
export { ProjectTemplateRegistry } from './ProjectTemplates.js';
export type { ProjectTemplate } from './ProjectTemplates.js';
```

**`coordination/predictions/index.ts`:**
```typescript
export { PredictionService } from './PredictionService.js';
```

**`coordination/sharing/index.ts`:**
```typescript
export { ShareLinkService } from './ShareLinkService.js';
```

### 5.3 Export Name Collision Check

Two files export `AgentScorecard` as a type name: `SessionRetro.ts` and `PerformanceScorecard.ts`. Since they're now in different barrels (`sessions/` vs `reporting/`), this only collides at the root barrel level. **Solution:** The `reporting/index.ts` re-exports it aliased as `PerformanceAgentScorecard`. The `sessions/index.ts` keeps it as `AgentScorecard`.

---

## 6. Implementation Plan (Step-by-Step)

### Step 1: Create subdirectories
```bash
cd packages/server/src/coordination
for dir in activity alerts agents code-quality commands decisions events files knowledge playbooks predictions recovery reporting scheduling sessions sharing; do
  mkdir -p "$dir"
done
```

### Step 2: Move files using `git mv`

```bash
cd packages/server/src/coordination

# activity
git mv ActivityLedger.ts activity/
git mv SmartActivityFilter.ts activity/

# alerts
git mv AlertEngine.ts alerts/
git mv EscalationManager.ts alerts/
git mv NotificationManager.ts alerts/
git mv NotificationService.ts alerts/
git mv WebhookManager.ts alerts/

# agents
git mv AgentMatcher.ts agents/
git mv CapabilityRegistry.ts agents/
git mv ContextRefresher.ts agents/
git mv CrewFormatter.ts agents/

# code-quality
git mv ComplexityMonitor.ts code-quality/
git mv CoverageTracker.ts code-quality/

# commands
git mv NLCommandService.ts commands/

# decisions
git mv ConflictDetectionEngine.ts decisions/
git mv DebateDetector.ts decisions/
git mv DecisionLog.ts decisions/
git mv DecisionRecords.ts decisions/

# events
git mv CommEventExtractor.ts events/
git mv EventPipeline.ts events/
git mv ProjectionUtils.ts events/
git mv SynthesisEngine.ts events/

# files
git mv DependencyScanner.ts files/
git mv DiffService.ts files/
git mv FileDependencyGraph.ts files/
git mv FileLockRegistry.ts files/
git mv WorktreeManager.ts files/

# knowledge
git mv CollectiveMemory.ts knowledge/
git mv KnowledgeTransfer.ts knowledge/
git mv SearchEngine.ts knowledge/

# playbooks
git mv CommunityPlaybookService.ts playbooks/
git mv PlaybookService.ts playbooks/
git mv ProjectTemplates.ts playbooks/

# predictions
git mv PredictionService.ts predictions/

# recovery
git mv HandoffService.ts recovery/
git mv RecoveryService.ts recovery/

# reporting
git mv AnalyticsService.ts reporting/
git mv PerformanceScorecard.ts reporting/
git mv ReportGenerator.ts reporting/

# scheduling
git mv BudgetEnforcer.ts scheduling/
git mv TimerRegistry.ts scheduling/

# sessions
git mv CatchUpSummary.ts sessions/
git mv SessionExporter.ts sessions/
git mv SessionReplay.ts sessions/
git mv SessionRetro.ts sessions/

# sharing
git mv ShareLinkService.ts sharing/
```

### Step 3: Update intra-coordination imports
Apply the import updates from Section 4.2 to the moved files.

### Step 4: Create barrel index files
Create the 16 subdirectory `index.ts` files + 1 root `index.ts` as specified in Section 5.

### Step 5: Update external imports
Update all 30 source files and 57 test files listed in Section 4.3.

**Automation strategy:** Use `sed` or a script for mechanical replacements:
```bash
# Example for the most common patterns:
find packages/server/src -name '*.ts' -not -path '*/coordination/*' \
  -exec sed -i '' \
    -e "s|coordination/ActivityLedger\.js|coordination/activity/ActivityLedger.js|g" \
    -e "s|coordination/FileLockRegistry\.js|coordination/files/FileLockRegistry.js|g" \
    -e "s|coordination/DecisionLog\.js|coordination/decisions/DecisionLog.js|g" \
    # ... (one -e per file mapping from Section 4.3)
    {} +
```

### Step 6: Verify

```bash
# 1. TypeScript compiles
npm run lint

# 2. All tests pass
npm test

# 3. No stale imports referencing old flat paths (should be zero results)
grep -rn "from.*coordination/[A-Z]" packages/server/src/ --include="*.ts" | grep -v node_modules | grep -v "coordination/index"
```

---

## 7. Testing That Nothing Breaks

### 7.1 Pre-Flight

Before starting, establish the baseline:

```bash
cd /Users/justinc/Documents/GitHub/flightdeck
npm run lint   # Capture: passes / N errors
npm test       # Capture: N tests passed, N failed
```

### 7.2 Post-Move Verification

After all changes:

1. **`npm run lint`** — TypeScript must compile cleanly. Any broken import will surface as a `Cannot find module` error pointing to the exact file and line.

2. **`npm test`** — All 57 affected test files (plus any others) must pass. Since this is a pure file-move refactor with no behavioral changes, the test count and pass/fail results must be identical to baseline.

3. **Import path audit** — Run:
   ```bash
   # Should return ZERO results (no direct imports of old flat paths)
   grep -rn "from ['\"].*coordination/[A-Z]" packages/server/src/ --include="*.ts" | grep -v node_modules
   ```
   Every import should either go through a barrel (`coordination/index.js`, `coordination/files/index.js`) or use the new nested path (`coordination/files/FileLockRegistry.js`).

4. **No orphaned files** — Verify the flat `coordination/` directory contains only subdirectories and `index.ts`:
   ```bash
   ls packages/server/src/coordination/
   # Expected: activity/ alerts/ agents/ code-quality/ commands/ decisions/ events/
   #           files/ knowledge/ playbooks/ predictions/ recovery/ reporting/
   #           scheduling/ sessions/ sharing/ index.ts
   ```

5. **Git status** — Verify git tracks the moves correctly:
   ```bash
   git status --short | head -20
   # Should show R (renamed) for each moved file, not D+A
   ```

### 7.3 Rollback Plan

If anything breaks unexpectedly:
```bash
git checkout -- packages/server/src/coordination/
```
This restores the entire directory to the pre-move state. Because we use `git mv`, the moves are tracked and fully reversible.

---

## 8. Disruption Notes

### What Else Needs Updating After This PR

1. **`.github/skills/` files** — Any skills that reference `coordination/FileName.ts` paths need updates to use the new `coordination/domain/FileName.ts` paths. This is a documentation change, not a code change.

2. **Agent knowledge / system prompts** — If any agent instructions reference file paths in `coordination/`, they'll point to stale locations. Update after merge.

3. **IDE import autocompletion** — TypeScript's module resolution will pick up the new paths immediately. No IDE config changes needed.

4. **This should NOT be done in parallel with other coordination/ changes.** It touches every file in the directory. Schedule during a natural pause in feature work, merge quickly, and have other developers rebase after.

---

## 9. Decision Log

| Decision | Rationale |
|----------|-----------|
| 16 subdirectories (not 9) | The synthesis report suggested 9, but several categories (sessions, agents, predictions, sharing, commands) have clear distinct responsibilities. More granular = more navigable. |
| Barrel re-exports at root | Backward compatibility for existing imports. Allows gradual migration. |
| No file merges or splits | Pure organizational refactor. Behavioral changes are a separate concern. |
| `agents/` cluster inside `coordination/` | These are coordination-related agent services (matching, formatting, context refresh), not the core Agent class. Naming could confuse — but moving them elsewhere would break the domain boundary. The full path `coordination/agents/` makes the scope clear. |
| Update all external imports (not just use barrel) | Direct file imports are more explicit, enable better tree-shaking, and prevent the barrel from becoming a God module. The barrel exists for backward compatibility during transition. |
| `code-quality/` not `quality/` | Explicit naming prevents confusion with other quality concepts (decision quality, handoff quality). |
