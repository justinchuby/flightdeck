# Cross-Project Synthesis Report: Actionable Recommendations for Flightdeck

**Author:** Architect Agent (a77e1782)
**Date:** 2026-03-07
**Source Reports:** Paperclip, Symphony, Squad, Edict, Flightdeck (Flightdeck)
**Revision:** v3 — 8 of 19 recommendations implemented (R1, R2, R3, R4, R5, R9, R12, R15)
**Previous:** v2 (definitive) — incorporated critical review feedback from bb14c13b

---

## Executive Summary

After analyzing 4 external projects against our own codebase, the single most important insight is this: **Flightdeck already has the richest feature set of any project studied, but it pays for that richness with architectural complexity that the other projects avoid.** The highest-leverage improvements aren't new features — they're structural simplifications inspired by patterns that work at scale in the other projects.

Three projects independently converged on the same core patterns. That convergence is the signal we should follow.

This definitive version incorporates critical review feedback that identified 7 missed patterns, 4 prioritization adjustments, 3 missing anti-patterns, and 4 cross-pollination opportunities. Recommendations are now expanded to 19 total, with corrected priority rankings. **8 of 19 recommendations have been implemented** (R1, R2, R3, R4, R5, R9, R12, R15).

---

## 1. Cross-Cutting Themes (Patterns That Appear in 3+ Projects)

### Theme 1: Single-File Workflow Configuration
| Project | Implementation |
|---------|---------------|
| **Symphony** | `WORKFLOW.md` — YAML front matter + Liquid-template prompt body. Hot-reloaded without restart. |
| **Squad** | `charter.md` per agent — YAML frontmatter + markdown body. Git-tracked. |
| **Edict** | `SOUL.md` per agent — markdown system prompts with examples and workflow templates. |
| **Paperclip** | `skills/` directory — injectable markdown documents. |

**Convergence signal:** The field is converging on **markdown-with-frontmatter as the universal configuration format for AI agent systems.** It's human-readable, LLM-readable, version-controllable, and diffable. Flightdeck uses JSON/SQLite for role definitions and a `.github/skills/` directory for skills, but lacks the unified "one file = one agent's entire configuration" pattern.

### Theme 2: Adapter/Behaviour Pattern for External Integrations
| Project | Implementation |
|---------|---------------|
| **Symphony** | `Tracker` behaviour with `Linear.Adapter` + `Tracker.Memory` (test) implementations |
| **Paperclip** | `ServerAdapterModule` interface with 7 adapter packages (Claude, Codex, Cursor, etc.) |
| **Squad** | `CopilotSessionAdapter` wrapping the Copilot SDK |
| **Flightdeck** | `AcpConnection` directly wrapping `@agentclientprotocol/sdk` |

**Convergence signal:** Every project that integrates with external AI runtimes puts an **adapter layer** between its core and the external SDK. This is critical because LLM SDKs are volatile (Copilot SDK is at v0.14.x). Flightdeck's `AcpConnection` partially does this but couples tightly to ACP specifics. A cleaner adapter boundary would pay dividends as the ACP SDK evolves.

### Theme 3: Workspace Isolation per Task
| Project | Implementation |
|---------|---------------|
| **Symphony** | Per-issue workspace directories with symlink-escape prevention, 4-layer safety checks |
| **Paperclip** | Project workspaces with 3-level resolution chain (project → task → agent home) |
| **Edict** | Planned per-task workspace isolation in new architecture |
| **Flightdeck** | File locking (pessimistic locks) but agents share the same working directory |

**Convergence signal:** Three projects implement workspace isolation; Flightdeck uses file locking as a substitute. File locking is a good mitigation but not a substitute for true isolation, especially for `git` operations. This is a deep investment item (see Section 4).

### Theme 4: Hot-Reloadable Configuration
| Project | Implementation |
|---------|---------------|
| **Symphony** | `WorkflowStore` GenServer polls every 1s, triple-stamp change detection `{mtime, size, hash}` |
| **Squad** | Config resolution walks up directory tree, watches for changes |
| **Paperclip** | Agent config revisions with rollback |

**Convergence signal:** The ability to change agent behavior without restarting is a table-stakes feature for long-running orchestrators. Flightdeck requires server restart for most configuration changes.

### Theme 5: Structured Observability with Searchable Context Fields
| Project | Implementation |
|---------|---------------|
| **Symphony** | `issue_id=`, `session_id=` in every log line; `docs/logging.md` convention doc |
| **Edict** | Emoji-encoded pipeline stages, heartbeat detection with 3 levels |
| **Squad** | OpenTelemetry integration with trace/span/metric exports |
| **Flightdeck** | `ActivityLedger` + WebSocket events + timeline UI |

**Convergence signal:** All projects invest heavily in observability. Flightdeck's approach (activity ledger + real-time UI) is actually the richest, but lacks structured searchable log fields and standardized context propagation.

### Theme 6: Cost Management and Budget Enforcement
| Project | Implementation |
|---------|---------------|
| **Paperclip** | Per-agent monthly budgets in cents, automatic agent pausing when budget exhausted, `cost_events` table with provider/model attribution |
| **Symphony** | Detailed token accounting strategy using only absolute totals (never deltas) to avoid double-counting; `docs/token_accounting.md` with 300-line deep-dive on Codex reporting semantics |
| **Flightdeck** | `cost_records` table exists but no budget enforcement or auto-pause |

**Convergence signal:** Runaway agent spend is one of the top operational risks in multi-agent systems. Two projects treat cost management as a first-class concern with hard enforcement. Flightdeck has the data table but no enforcement — a gap worth closing.

---

## 2. Best-in-Class Patterns by Category

### Orchestration: 🏆 Symphony
**Why:** Symphony's single-writer GenServer state machine is the gold standard for scheduling state management. All state mutations (dispatch, retry, reconciliation, completion) are serialized through one authority. No locks, no races, no distributed state. The continuation-turn model (up to 20 turns per agent session, checking tracker state between turns) is more sophisticated than any other project's execution model.

**Key technique to study:** Defensive re-validation before dispatch — re-fetching issue state RIGHT BEFORE starting a worker to eliminate stale-state races.

### State Management: 🏆 Squad
**Why:** Markdown-as-state is the boldest and most successful architectural choice across all projects. Zero infrastructure, git-native, human-readable, LLM-friendly, portable. The `team.md` + `routing.md` + `decisions.md` + per-agent `charter.md`/`history.md` structure is elegant.

**Key technique to study:** Knowledge compounding — agents write learnings to `history.md` after each session, creating a persistent institutional memory that travels with the code.

### Testing: 🏆 Squad + Flightdeck (tie)
**Why:** Squad: 130 test files, 3,446 tests, custom Gherkin BDD, journey tests, performance benchmarks. Flightdeck: 125 server test files, 67 frontend tests, 7 E2E specs, cross-platform CI. Both projects have exceptional test coverage for their respective architectures.

**Key technique to study:** Squad's factory functions over fixtures (`makeContext()`, `makeConfig()`) — lightweight, customizable test data without heavy fixture files.

### Security: 🏆 Symphony (workspace safety) + Paperclip (secret management)
**Why:**
- Symphony's 4-layer workspace safety (path prefix check → symlink walk → root exclusion → name sanitization) is the most thorough workspace isolation model.
- Paperclip's pattern-based secret redaction (regex auto-detection of API keys/tokens in logs) is a defense-in-depth approach that catches human error.

**Key technique to study:** Paperclip's `redaction.ts` — auto-detects sensitive keys by pattern (`/api[-_]?key|access[-_]?token|.../`) and JWTs by structure, even when developers forget to mark fields as sensitive.

### Agent Communication: 🏆 Flightdeck
**Why:** Flightdeck's communication model (direct messages, broadcasts, group chats, @mentions, in-band Unicode-bracket commands from LLM text streams) is by far the richest. No other project has inter-agent messaging.

**No improvement needed — this is already best-in-class.**

### Configuration: 🏆 Symphony
**Why:** Single `WORKFLOW.md` with YAML front matter for typed config + Liquid-template body for agent prompts + hot-reload without restart + dispatch preflight validation + graceful degradation to last-known-good config. This is a complete configuration system.

**Key technique to study:** `WorkflowStore` cache pattern using `{mtime, size, :erlang.phash2(content)}` triple stamp for change detection.

### Observability: 🏆 Flightdeck (UI) + Symphony (logs)
**Why:**
- Flightdeck's real-time web dashboard with timeline, canvas, mission control, and analytics panels is the richest observability UI.
- Symphony's structured log fields (`issue_id=`, `session_id=`) and documented logging conventions make logs searchable and debuggable.

**Key technique to study:** Combine both — Flightdeck's rich UI with Symphony's structured logging discipline.

### Governance: 🏆 Edict (architectural) + Squad (programmatic)
**Why:**
- Edict's mandatory review gate (门下省) is architecturally enforced — every plan MUST pass through review. Not optional, not prompt-based, structurally guaranteed.
- Squad's hook pipeline (`PreToolUseContext → HookAction: allow|block|modify`) is programmatic governance — testable, composable, deterministic.

**Key technique to study:** Squad's hook pipeline pattern for enforcing file-level protections, command blocking, and rate limiting.

### Cost Management: 🏆 Paperclip (enforcement) + Symphony (accounting)
**Why:**
- Paperclip's budget hard-stop (`spentMonthlyCents >= budgetMonthlyCents` → auto-pause agent) is enforced atomically in `costService.createEvent()`. Not a soft limit — a hard stop.
- Symphony's `docs/token_accounting.md` is a masterclass in getting token accounting right: only use absolute totals from `thread/tokenUsage/updated.tokenUsage.total`, never deltas, never generic `usage` payloads.

**Key technique to study:** Paperclip's atomic enforcement in the cost event write path — budget check happens in the same transaction that records the cost.

### Resilience: 🏆 Symphony
**Why:** Symphony degrades gracefully at every integration point: config reload failure → keep last-known-good config; terminal fetch failure → log warning and continue; state refresh failure → keep workers running and retry next tick; non-critical hook failure → log and ignore. This is a design principle, not a collection of ad-hoc try/catches.

**Key technique to study:** Explicit fallback at every boundary — not "catch all errors" but "for each specific failure mode, define the degraded behavior."

---

## 3. Concrete Recommendations for Flightdeck (Prioritized)

### Priority 1 — High Impact, Addresses Known Weaknesses

#### R1. Dependency Injection Container for Server Bootstrap ✅ DONE
**Inspired by:** Paperclip's factory-function services pattern
**Problem:** Flightdeck's `index.ts` manually wires ~35 services with a function that takes 35+ positional parameters. This is the #1 maintainability risk identified in the self-analysis report.
**Recommendation:** Create a `createContainer(config)` factory that builds all services in dependency order and returns an `AppContext` object. Paperclip's pattern: `goalService(db)` returns `{ list, getById, create, update, remove }` — each service is a pure function of its dependencies.
**Impact:** Eliminates the 35-parameter god function. Makes testing trivial (inject mock services). Makes adding new services a 2-line change instead of threading through 3+ files.
**Effort:** Medium (refactor, not rewrite — services already exist, just need a container).

#### R2. Shared Types Package (`packages/shared`) ✅ DONE
**Inspired by:** Paperclip's `@paperclipai/shared` package, Squad's granular SDK exports
**Problem:** The Flightdeck self-analysis identified type drift between server and client as a risk. WebSocket messages are string unions on the client but ad-hoc strings on the server.
**Recommendation:** Extract a `packages/shared` with: (a) WebSocket protocol schema as Zod discriminated unions, (b) shared domain types (Agent, Role, Task, Decision), (c) API request/response types. Both server and client import from the same source of truth.
**Impact:** Catches protocol drift at compile time. Eliminates duplicate type definitions. Makes adding new WS events type-safe by construction.
**Effort:** Medium (extract existing types, add Zod schemas for WS protocol).

#### R3. Reorganize `coordination/` Directory (47 Files → Domain Clusters) ✅ DONE
**Inspired by:** All projects using clear module boundaries
**Problem:** The `coordination/` directory is a catch-all with 47 files covering ~15 distinct concerns. The self-analysis report specifically calls this out.
**Recommendation:** Sub-organize as the self-analysis suggests:
```
coordination/
├── activity/       # ActivityLedger, SmartActivityFilter
├── alerts/         # AlertEngine, EscalationManager, NotificationManager
├── code-quality/   # CoverageTracker, ComplexityMonitor, ConflictDetection
├── decisions/      # DecisionLog, DecisionRecords, DebateDetector
├── events/         # EventPipeline, WebhookManager
├── files/          # FileLockRegistry, FileDependencyGraph, DiffService
├── knowledge/      # KnowledgeTransfer, CollectiveMemory, SearchEngine
├── scheduling/     # TimerRegistry
└── reporting/      # ReportGenerator, AnalyticsService
```
**Impact:** Makes the codebase navigable by both humans and AI agents. Reduces cognitive load when working on related features.
**Effort:** Medium — file moves + import updates + 1-day follow-up to update `.github/skills/` and documentation. **⚠ Disruption note:** This changes every import path in the 125 server test files and invalidates agent skills that reference file locations. Schedule during a natural pause in feature work, not as a parallel task.

#### R11. Defensive Re-Validation Before Agent Dispatch *(promoted from Priority 3)*
**Inspired by:** Symphony's `revalidate_issue_for_dispatch/3`
**Problem:** Between when a task enters the DAG queue and when an agent is spawned, conditions may have changed (task canceled, dependencies failed, file locks released). Flightdeck's `EagerScheduler` doesn't re-check.
**Recommendation:** Before dispatching a task to an agent, re-validate: (a) task still exists and is in ready state, (b) all dependencies still satisfied, (c) required file locks are still available, (d) concurrency limits not exceeded.
**Why Priority 1:** This is the highest reliability-ROI recommendation in the report — low effort AND prevents an entire class of wasted-compute bugs. Symphony calls this pattern the foundation of dispatch correctness.
**Impact:** Prevents wasted agent runs on stale/invalid tasks. Small code change, significant reliability improvement.
**Effort:** Low (add validation checks to dispatch path).

### Priority 2 — Significant Improvements, Moderate Effort

#### R4. Hook-Based Governance Pipeline *(moved from Priority 1)* ✅ DONE
**Inspired by:** Squad's `PreToolUseContext → HookAction` pipeline
**Problem:** Flightdeck enforces constraints through system prompts (fragile, bypassable) and file locking (reactive, not preventive). There's no way to programmatically block an agent from running dangerous commands, writing to protected files beyond locked ones, or exceeding rate limits.
**Recommendation:** Implement a hook pipeline that intercepts agent actions:
```typescript
type HookAction = 'allow' | 'block' | 'modify';
interface PreActionHook {
  name: string;
  match: (action: AgentAction) => boolean;
  evaluate: (action: AgentAction, context: HookContext) => HookAction;
}
```
Built-in hooks: file write guard (glob patterns), shell command blocklist, commit message validation, rate limiting per agent.
**Why Priority 2 (not 1):** While architecturally important, this is a ~1 week investment that addresses theoretical risk. R11 (dispatch validation) addresses real bugs with lower effort. Implement governance hooks after the structural foundation (R1-R3, R11) is solid.
**Impact:** Programmatic, testable, composable governance. Catches violations that prompt-based rules miss.
**Effort:** Medium (new subsystem, but well-scoped).

#### R5. Structured Logging with Contextual Correlation *(enhanced)* ✅ DONE (Phases 1-2; Phases 3-4 in progress)
**Inspired by:** Symphony's `:logger` metadata, Squad's OpenTelemetry-compatible traces
**Problem:** Flightdeck's server uses `console.log` with ad-hoc formatting. When debugging agent behavior across concurrent sessions, there's no way to filter logs by session, agent, or task. The `ActivityLedger` captures structured events, but server-side operational logs are unstructured.
**Recommendation:** Use **pino** with child loggers per request/agent/session context. Thread context via `AsyncLocalStorage`:
```typescript
import pino from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

const als = new AsyncLocalStorage<{ sessionId: string; agentId?: string; taskId?: string }>();
const logger = pino({ /* base config */ });

// Per-agent child logger created at spawn time:
const agentLogger = logger.child({ sessionId, agentId, taskId, role: agent.role });
```
Standard fields: `sessionId`, `agentId`, `taskId`, `role`, `action`, `durationMs`, `tokenCount`. Output as JSON in production, pretty-printed in development.
**Impact:** Enables `jq` queries like `jq 'select(.agentId=="abc" and .action=="dispatch")'` across multi-agent sessions. Essential for debugging production issues.
**Effort:** Medium (replace console.log calls, add pino dependency, wire AsyncLocalStorage).

#### R10. Tiered Agent Response System *(promoted from Priority 3)*
**Inspired by:** Squad's 4-tier response system (`direct` → `lightweight` → `standard` → `full`)
**Problem:** Every agent interaction in Flightdeck goes through the same full LLM call path, regardless of complexity. "What's 2+2?" costs the same as "Redesign the database schema." This wastes tokens and increases latency for simple operations.
**Recommendation:** Implement at least 3 tiers:
1. **Direct** — Pattern match for simple queries (status checks, file listings). No LLM call.
2. **Lightweight** — Use fast model (GPT-4.1-mini / Haiku) for routine tasks. Flightdeck's `ModelSelector.ts` already has model selection logic — extend it with cost-aware routing.
3. **Full** — Current behavior for complex reasoning tasks.
**Why Priority 2 (not 3):** This delivers significant cost savings AND UX improvement (faster responses). The infrastructure already exists in `ModelSelector.ts` — this is enhancement, not greenfield.
**Impact:** Potential 40-60% reduction in token costs for routine operations. Faster perceived performance.
**Effort:** Medium (extend existing model selection, add response tier classification).

#### R13. Multi-Turn Agent Sessions with Inter-Turn Validation (NEW)
**Inspired by:** Symphony's continuation turns (up to 20 per session)
**Problem:** Flightdeck currently runs agents in single-shot mode. If an agent needs more context or its initial attempt fails, the system starts a brand new session, losing all accumulated context.
**Recommendation:** Allow agents to request continuation turns within a session. Between turns, re-validate the task state (similar to R11) — check that the task is still assigned, dependencies still met, and the agent hasn't exceeded its turn budget. Symphony's pattern: `max_continuation_turns: 20` in workflow config, with `continuation_eligible?/1` checks between turns.
**Impact:** Dramatically improves agent effectiveness on complex tasks. Eliminates the "start over from scratch" problem.
**Effort:** Medium-High (requires changes to agent lifecycle, session management, and turn budgeting).

#### R14. Mandatory Review Gates Wired into DAG (NEW)
**Inspired by:** Edict's 门下省 (Ménxià Shěng) mandatory review gate
**Problem:** Flightdeck has reviewer agents (code-reviewer, critical-reviewer, readability-reviewer) but they're optional and manually triggered. Nothing structurally prevents a developer agent from completing a task without review.
**Recommendation:** Wire review as a structural DAG requirement. When a developer task completes, auto-create a review sub-task as a blocking dependency before the parent task can close. The reviewer agent is automatically assigned. This uses Flightdeck's existing agent roles — no new agents needed, just a DAG rule.
```
developer-task → [auto] review-task (blocking) → parent-task-close
```
**Impact:** Ensures all code changes are reviewed. Uses existing infrastructure (DAG + reviewer roles).
**Effort:** Medium (DAG automation rule, review task template, auto-assignment logic).

#### R15. Hot-Reloadable Configuration (NEW) ✅ DONE
**Inspired by:** Symphony's WorkflowStore (mtime+size+phash2 change detection), Squad's charter hot-reload
**Problem:** Changing Flightdeck configuration (role definitions, model settings, governance rules) requires a server restart. In a long-running multi-agent session, this means losing all active agent state.
**Recommendation:** Implement a config watcher using Symphony's triple-check pattern: watch file mtime, compare size, then hash content only if mtime+size changed. Reload config in-place without restarting agents. Start with role definitions and model configuration — these are the most frequently changed during development.
**Impact:** Faster iteration during development. No lost agent state when tweaking configuration.
**Effort:** Medium (file watcher + config diffing + selective reload).

---

### Priority 3 — Polish and Future-Proofing

#### R6. Feature Flag System
**Inspired by:** Self-analysis observation + all projects' clean module boundaries
**Problem:** Several features are in various development states (WorktreeManager, PredictionService, CommunityPlaybooks) but code is always initialized and running.
**Recommendation:** Simple feature flags:
```typescript
const features = {
  worktrees: false,
  predictions: false,
  communityPlaybooks: false,
  collectiveMemory: true,
};
```
Services check flags before initialization. Lazy-init services on first use when flag is enabled.
**Impact:** Cleaner startup, reduced memory footprint, ability to ship experimental features safely.
**Effort:** Low (data structure + conditional initialization).

#### R7. Persistent Knowledge / Agent Memory Across Sessions *(enhanced)*
**Inspired by:** Squad's knowledge compounding (`history.md`), Paperclip's `agentRuntimeState`
**Problem:** Flightdeck has `CollectiveMemory` service but the self-analysis notes it's unclear how well it works. Squad's approach is more proven: each agent writes learnings to a persistent file that's loaded into context on the next session.
**Recommendation:** Formalize the agent memory system:
1. At session end, **prompt the agent to self-summarize**: "List the 3 most important decisions, patterns, or gotchas you discovered." This is Squad's approach — the agent extracts its own learnings, which produces higher-quality memories than automated extraction.
2. Store summaries in SQLite (already there as `agent_memory` table) with structured metadata: `{role, project, topic_tags, confidence_score}`
3. On session start, inject top-k relevant memories ranked by recency + relevance
4. Add human curation: flag memories as "verified" / "deprecated" / "wrong"
**Impact:** Agents stop re-discovering the same things. Multi-session work compounds rather than restarts.
**Effort:** Medium (prompt engineering + retrieval logic + curation UI).

#### R8. Config Revision Tracking with Rollback
**Inspired by:** Paperclip's `agent_config_revisions` table
**Problem:** Flightdeck stores role/config changes in SQLite but doesn't track revision history. A bad configuration change requires manual investigation and reversal.
**Recommendation:** Add a `config_revisions` table that stores `{entity_type, entity_id, before_snapshot, after_snapshot, changed_keys, changed_by, timestamp}`. Add a rollback API endpoint.
**Impact:** Safety net for configuration experimentation. Full audit trail. One-click rollback of bad changes.
**Effort:** Low-medium (new table + service + API endpoint).

#### R9. ACP Adapter Abstraction Layer ✅ DONE
**Inspired by:** Squad's `CopilotSessionAdapter`, Paperclip's adapter plugin system
**Problem:** `AcpConnection.ts` (397 LoC) directly uses `@agentclientprotocol/sdk` types throughout. The ACP SDK is at v0.14.x and changing rapidly.
**Recommendation:** Create an `LLMAdapter` interface that `AcpConnection` implements. Define stable internal event types (`message_delta`, `tool_call`, `session_idle`, etc.) that don't change when the ACP SDK changes.
**Impact:** When ACP SDK v1.0 ships with breaking changes, only the adapter needs updating. Also enables future support for non-ACP runtimes (direct API, local models).
**Effort:** Medium (interface extraction, event normalization).

### Quick Wins (Can Ship Independently, < 1 Day Each)

#### R16. Cost/Budget Enforcement with Auto-Pause (NEW)
**Inspired by:** Paperclip's `costService.createEvent()` with atomic budget check
**Problem:** Flightdeck has a `cost_records` table but no enforcement. A runaway agent can burn unlimited tokens.
**Recommendation:** Add per-agent and per-session budget limits. Check budget atomically in the cost recording path (same transaction). When budget exceeded: pause agent, notify lead via AGENT_MESSAGE, surface alert in UI. Paperclip's exact pattern: `if (spentMonthlyCents >= budgetMonthlyCents) { await agentService.pause(agentId); }`
**Impact:** Prevents runaway spend — the #1 operational risk in multi-agent systems.
**Effort:** Low (budget column + check in existing cost write path).

#### R17. LLM Output Sanitization for Stored Data (NEW)
**Inspired by:** Edict's 门下省 output sanitization pipeline
**Problem:** When agents generate task titles, decision summaries, or activity descriptions, the raw LLM output goes directly to the database and UI. Malformed output (markdown injection, excessive length, hallucinated metadata) degrades data quality.
**Recommendation:** Add a thin sanitization layer for any LLM output that gets persisted: strip control characters, enforce max lengths, validate structure (e.g., task titles must be single-line, < 200 chars). Apply at the storage boundary, not in the LLM client.
**Impact:** Cleaner data in the activity ledger, decision log, and UI. Low effort, high data quality improvement.
**Effort:** Low (validation functions at storage entry points).

#### R18. Ghost Response Retry with Exponential Backoff (NEW)
**Inspired by:** Squad's ghost response detection and retry mechanism
**Problem:** Sometimes LLM responses are empty or malformed ("ghost responses"). Flightdeck currently treats these as agent failures. Squad detects them and retries with exponential backoff — a simple pattern that converts intermittent failures into transparent recoveries.
**Recommendation:** In the ACP response handler, detect empty/malformed responses and retry up to 3 times with exponential backoff (1s, 2s, 4s). Log each retry. Only surface to the user if all retries fail.
**Impact:** Significant reduction in spurious agent failures. Better perceived reliability.
**Effort:** Low (retry wrapper around response handling).

#### R19. Model Fallback Chains with Tier Ceilings (NEW)
**Inspired by:** Squad's model fallback configuration
**Problem:** When a preferred model is unavailable (rate limit, outage), Flightdeck fails the request. There's no fallback.
**Recommendation:** Define model fallback chains per tier:
```typescript
const modelChains = {
  premium: ['claude-opus-4', 'gpt-4o', 'claude-sonnet-4'],
  standard: ['claude-sonnet-4', 'gpt-4o-mini', 'claude-haiku'],
  fast: ['claude-haiku', 'gpt-4o-mini'],
};
```
Integrate with `ModelSelector.ts`. On model failure, try next in chain. Enforce tier ceilings so a "fast" task never escalates to a premium model.
**Impact:** Better availability during model outages. Cost predictability via tier ceilings.
**Effort:** Low (enhance existing ModelSelector with chain + ceiling logic).

#### R12. Secret/Sensitive Data Redaction in Logs *(enhanced)* ✅ DONE
**Inspired by:** Paperclip's `redaction.ts` pattern-based detection
**Problem:** Agent conversations and activity logs may contain API keys, tokens, or credentials that agents encounter during their work. No automatic redaction exists.
**Recommendation:** Add a redaction layer that scans outgoing WebSocket messages and log entries for sensitive patterns. Specific patterns from Paperclip:
```typescript
const SENSITIVE_PATTERNS = [
  /api[-_]?key\s*[:=]\s*\S+/gi,        // API keys
  /access[-_]?token\s*[:=]\s*\S+/gi,    // Access tokens
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,  // JWT detection
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,  // GitHub tokens
  /sk-[A-Za-z0-9]{20,}/g,               // OpenAI keys
  /\b[A-Z_]+(?:SECRET|TOKEN|KEY|PASSWORD)\s*[:=]\s*\S+/gi,   // Generic secrets
];
```
Apply to WS broadcast and log write paths. Replace matched values with `[REDACTED]`.
**Impact:** Defense-in-depth against credential leakage through the UI or logs.
**Effort:** Low (regex-based scanner at output boundaries).

---

## 4. Quick Wins vs. Deep Investments

### Quick Wins (< 1 day each)

| # | Recommendation | Effort | Impact | Status |
|---|---------------|--------|--------|--------|
| R11 | Defensive re-validation before dispatch | Hours | Prevents wasted agent runs — highest reliability ROI | |
| R16 | Cost/budget enforcement with auto-pause | Hours | Prevents runaway spend | |
| R17 | LLM output sanitization | Hours | Cleaner data quality | |
| R18 | Ghost response retry | Hours | Fewer spurious failures | |
| R19 | Model fallback chains | Hours | Better availability | |
| R6 | Feature flag system | Hours | Cleaner startup, safer experiments | |
| R12 | Secret/sensitive data redaction | Half-day | Security defense-in-depth | ✅ Done |

### Medium Investments (1-3 days each)

| # | Recommendation | Effort | Impact | Status |
|---|---------------|--------|--------|--------|
| R2 | Shared types package | 2-3 days | Eliminates type drift permanently | ✅ Done |
| R1 | Dependency injection container | 2-3 days | Eliminates the #1 maintainability risk | ✅ Done |
| R3 | Reorganize `coordination/` directory | 1-2 days + followup | Major navigability improvement | ✅ Done |
| R5 | Structured logging (pino + AsyncLocalStorage) | 2 days | Transforms debugging experience | ✅ Phases 1-2 done |
| R8 | Config revision tracking | 1-2 days | Safety net + audit trail | |
| R10 | Tiered response system | 2-3 days | Cost savings + faster responses | |

### Deep Investments (1+ weeks)

| # | Recommendation | Effort | Impact | Status |
|---|---------------|--------|--------|--------|
| R4 | Hook-based governance pipeline | 1 week | Programmatic, testable enforcement | ✅ Done |
| R13 | Multi-turn agent sessions | 1-2 weeks | Step-change in agent effectiveness | |
| R14 | Mandatory review gates in DAG | 1 week | Structural quality assurance | |
| R15 | Hot-reloadable configuration | 1 week | Faster development iteration | ✅ Done |
| R7 | Persistent knowledge / agent memory | 1 week | Multi-session knowledge compounding | |
| R9 | ACP adapter abstraction layer | 1 week | SDK-change resilience | ✅ Done |

### Not Recommended Now (Deep Investment, Lower ROI)

| Pattern | Source | Why Not Now |
|---------|--------|-------------|
| Per-task workspace isolation | Symphony | Would require fundamental architecture change (worktree per agent). File locking is a reasonable substitute for now. The self-analysis already identified WorktreeManager as "in development." |
| Embedded database for dev | Paperclip | Flightdeck already uses SQLite which is zero-config. PGlite is only relevant if migrating to Postgres. |
| Event sourcing / Redis Streams | Edict | Over-engineering for a single-process local application. Flightdeck's `TypedEmitter` + `ActivityLedger` is appropriate. |

---

## 5. Anti-Patterns to Avoid

### Anti-Pattern 1: Dual Architecture Migration (from Edict)
**What happened:** Edict maintains two parallel architectures (legacy file-based + new event-driven) simultaneously. This creates confusion, duplicated code paths, and potential state drift.
**Lesson for Flightdeck:** When Flightdeck evolves its architecture (e.g., the WorktreeManager work), do NOT maintain two parallel systems. Either ship the new system behind a feature flag and cut over cleanly, or evolve incrementally without forking the architecture.

### Anti-Pattern 2: Markdown-Only Persistence at Scale (from Squad)
**What happened:** Squad stores ALL state as markdown files. This works beautifully for small teams but would break down at Flightdeck's scale (14+ tables, activity ledger with batched writes, concurrent agent sessions). Markdown has no query capability, no transactions, no indexing.
**Lesson for Flightdeck:** Flightdeck's SQLite choice is correct for its complexity level. Don't be tempted to simplify to file-based persistence — the query and transaction capabilities are load-bearing.

### Anti-Pattern 3: Hardcoded Paths in Agent Configuration (from Edict)
**What happened:** Edict's SOUL.md files reference absolute paths (`/Users/bingsen/clawd/...`), breaking portability.
**Lesson for Flightdeck:** Flightdeck's system prompt templates use relative references, which is correct. Maintain this discipline — never let absolute paths into agent role definitions or skill documents.

### Anti-Pattern 4: Zero Auth as Default (from Edict)
**What happened:** Edict's API has no authentication. CORS is `*`.
**Lesson for Flightdeck:** Flightdeck already has auth middleware, origin validation, and rate limiting. Keep these. The "make it work locally without auth" temptation leads to production security holes. Paperclip's dual-mode approach (`local_trusted` / `authenticated`) is the right pattern if Flightdeck ever needs both modes.

### Anti-Pattern 5: God Object GenServer (from Symphony)
**What happened:** Symphony's Orchestrator GenServer is 1,457 lines handling dispatch, retry, reconciliation, token accounting, stall detection, and dashboard notifications. While it works (serialized state eliminates races), it's hard to test individual behaviors.
**Lesson for Flightdeck:** Flightdeck already has the opposite problem — too many small services in the `coordination/` catch-all. The right middle ground is R3 (reorganize into domain clusters) without collapsing into a single orchestrator object.

### Anti-Pattern 6: Over-Investing in Agent Personas (from Squad)
**What happened:** Squad's casting system (movie universe personas) is delightful UX, but the 1,000+ lines of casting code, registry management, and rollback support is a significant investment for what is essentially a cosmetic feature.
**Lesson for Flightdeck:** Flightdeck's role-based naming (Architect, Developer, Reviewer) is clearer and more professional. Don't add persona theming — it's fun but maintenance-heavy and can confuse new users who don't recognize the movie references.

### Anti-Pattern 7: Relying on Prompts for Safety Constraints (from all projects)
**What happened:** Multiple projects enforce critical constraints (file access limits, cost caps, command restrictions) through system prompt instructions. LLMs routinely ignore instructions under context pressure, adversarial inputs, or simple stochastic variation.
**Lesson for Flightdeck:** Any constraint that MUST be enforced MUST be enforced programmatically, not via prompt. Flightdeck's file locking (programmatic) is correct; any future governance rules (R4) must follow the same principle. The prompt can explain WHY a constraint exists (to help the LLM cooperate), but the server must ENFORCE it. Edict's finding: their mandatory review gate only works because it's a code path, not a prompt instruction.

### Anti-Pattern 8: Eager Initialization of Unused Services (from Flightdeck self-analysis)
**What happened:** Flightdeck's bootstrap initializes ALL services at startup, including experimental ones (WorktreeManager, PredictionService, CommunityPlaybooks) that may not be used. This wastes memory, increases startup time, and makes debugging harder (more things to fail during init).
**Lesson for Flightdeck:** Adopt lazy initialization behind feature flags (R6). Only instantiate a service when it's first needed AND its feature flag is enabled. Symphony does this well — services are started only when their configuration is present.

### Anti-Pattern 9: Polling When Push Is Available (general)
**What happened:** Several projects (including Flightdeck) poll for state changes on intervals when the data source supports push/event notifications. For example, polling for file changes when `fs.watch` exists, polling for task status when the DAG already emits events.
**Lesson for Flightdeck:** Establish a "push first" principle: before implementing any polling loop, verify whether the data source supports push/event notification. Flightdeck's `TypedEmitter` event bus is already a push mechanism — ensure it's used consistently rather than polling patterns creeping in alongside it.

---

## 6. The Big Picture: Where Flightdeck Stands

| Dimension | Flightdeck | Best External | Gap |
|-----------|---------|---------------|-----|
| **Feature richness** | ⭐⭐⭐⭐⭐ | — | No gap — Flightdeck has the most features |
| **Agent communication** | ⭐⭐⭐⭐⭐ | — | No gap — uniquely rich messaging model |
| **Observability UI** | ⭐⭐⭐⭐⭐ | — | No gap — best dashboard of all 5 projects |
| **Testing** | ⭐⭐⭐⭐ | Squad ⭐⭐⭐⭐⭐ | Small gap — add performance benchmarks, BDD |
| **Code organization** | ⭐⭐⭐ | All others ⭐⭐⭐⭐ | **Moderate gap** — `coordination/` catch-all, god `index.ts` |
| **Configuration** | ⭐⭐⭐ | Symphony ⭐⭐⭐⭐⭐ | **Moderate gap** — no hot-reload, no revision tracking |
| **Governance/Safety** | ⭐⭐⭐ | Squad ⭐⭐⭐⭐⭐ | **Moderate gap** — file locks but no programmatic hooks |
| **Cost management** | ⭐⭐ | Paperclip ⭐⭐⭐⭐⭐ | **Significant gap** — data exists but no enforcement |
| **Resilience** | ⭐⭐ | Symphony ⭐⭐⭐⭐⭐ | **Significant gap** — no retry, no fallback chains, no graceful degradation |
| **Structured logging** | ⭐⭐ | Symphony ⭐⭐⭐⭐⭐ | **Significant gap** — no standardized log context fields |
| **SDK insulation** | ⭐⭐ | Squad ⭐⭐⭐⭐⭐ | **Significant gap** — ACP SDK coupled throughout |
| **Type safety (WS)** | ⭐⭐ | Paperclip ⭐⭐⭐⭐ | **Moderate gap** — no shared WS protocol schema |

**Bottom line:** Flightdeck's competitive advantage is its unmatched feature set and communication model. Its weakness is internal code organization and the absence of patterns (DI container, shared types, structured logs, governance hooks, budget enforcement, resilience) that the other projects demonstrate. The 19 recommendations above prioritize closing those organizational gaps without adding features.

---

## 7. Emerging Patterns Worth Watching

### Spec-First Design (Symphony)
Symphony's `SPEC.md` (2,100 lines) is a complete behavioral specification written before implementation. Every module has a corresponding section in the spec. This enables: (a) AI agents can read the spec to understand intent without reading all code, (b) the spec serves as a test oracle — if behavior diverges from spec, it's a bug, (c) new contributors can onboard by reading one document. Flightdeck could benefit from a lighter version: a `DESIGN.md` that covers the major subsystems, their contracts, and their invariants.

### Dynamic Tool Injection (Symphony)
Symphony injects the `linear_graphql` tool into agent sessions dynamically based on workflow configuration. Flightdeck currently has a fixed toolset per agent. The ability to inject/remove tools based on task context (e.g., give a code reviewer read-only tools, give a developer write tools) would improve both safety and cost efficiency.

### OpenTelemetry Integration (Squad)
Squad's OTLP-compatible tracing pipeline provides standardized observability that plugs into any monitoring stack (Jaeger, Grafana, Datadog). If Flightdeck ever needs production observability beyond the built-in UI, OTel is the standard to adopt. Not recommended now (the built-in UI is superior for the current use case), but worth keeping on the radar.

### Graceful Degradation Audit
Symphony's systematic approach to failure modes (explicit fallback at every integration boundary) suggests Flightdeck should conduct a resilience audit: for each external dependency (ACP SDK, GitHub API, model providers, file system), define the degraded behavior when it's unavailable. Document these in a `docs/resilience.md`.

---

## 8. Cross-Pollination Opportunities

These are specific ways to combine strengths from multiple projects:

1. **Edict's mandatory review gate → Flightdeck's DAG + reviewer agents (R14):** Flightdeck already has 3 reviewer roles. Wiring them as structural DAG dependencies (not optional) would give Edict's quality guarantee with Flightdeck's richer review capabilities.

2. **Paperclip's export/import → Flightdeck's SessionExporter:** Enhance the existing SessionExporter with Paperclip's patterns: secret scrubbing before export, collision detection on import, and portable session format that works across environments.

3. **Symphony's graceful degradation → Flightdeck's failure modes:** Systematically add explicit fallback behavior at every integration boundary. Start with: model provider failure → fallback chain (R19), file system error → retry with backoff, WebSocket disconnect → queue messages for reconnection.

4. **Squad's model fallback chains → Flightdeck's ModelSelector (R19):** The ModelSelector infrastructure already exists. Adding fallback chains and tier ceilings is a natural extension.

---

*The highest-leverage sequence: Start with quick wins (R11, R16, R18, R19 — each takes hours). Then tackle the structural trio: ~~R1 (DI container) + R2 (shared types) + R3 (directory reorg)~~ ✅ all done. The remaining 11 recommendations build on this foundation.*

*Report reviewed and improved per critical feedback from @bb14c13b. Total: 19 recommendations (8 implemented, 11 remaining), 9 anti-patterns, 8 cross-cutting themes and emerging patterns.*
