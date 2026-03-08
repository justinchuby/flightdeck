# Gastown Research Report

**Author:** Architect Agent (a77e1782)
**Date:** 2026-03-07
**Repository:** /Users/justinc/Documents/GitHub/gastown

---

## 1. What Is Gastown?

Gastown is a **production-grade multi-agent orchestration system for Claude Code** (and 9 other AI runtimes) written in Go. It solves the core problem of coordinating 20-50+ AI agents working simultaneously on shared codebases without losing context on restart.

**Key insight — "The Propulsion Principle":** Work state is stored in git worktrees ("hooks") and a git-tracked issue ledger ("Beads"), not in memory. Agents are ephemeral; their work persists. An agent can crash, restart, and resume exactly where it left off because the work state lives in git, not in the agent's session.

**Scale:** 469K lines of Go across 932 files, 65+ internal packages, 899 test files. This is a mature, battle-tested system — significantly larger than Flightdeck's ~80K LoC.

**Metaphor:** Gastown uses a frontier-town metaphor — a "Town" is a workspace, "Rigs" are projects, "Polecats" are worker agents, "Convoys" are work bundles, "Beads" are issues. The "Mayor" is the AI coordinator. This is not just naming — it's a coherent conceptual model that makes the system navigable.

### Agent Hierarchy

| Role | Function | Persistence |
|------|----------|-------------|
| **Mayor** | AI coordinator — analyzes work, creates convoys, spawns agents, monitors progress | Session-scoped, full workspace context |
| **Polecats** | Worker agents — execute assigned issues | Persistent identity, ephemeral sessions |
| **Deacon** | Patrol agent — monitors all agents, detects failures | Daemon-managed |
| **Witness** | Merge verification — validates PRs, enforces quality gates | Per-rig |
| **Refinery** | Test gate — runs tests, decides retry vs escalation | Per-rig |
| **Dogs** | Specialized patrol workers (compactor, health, archive, stuck-detection, etc.) | Plugin-managed, pool of 4 |
| **Crew** | Human operators — personal workspace within a rig | Persistent |

---

## 2. Architecture and Key Design Patterns

### 2.1 Core Architecture

```
Town (~/.gt/)
├── Mayor (AI coordinator, 1 per town)
├── Daemon (background service, manages patrol agents)
│   ├── Deacon (monitors all agents)
│   ├── Witness (merge gate per rig)
│   ├── Refinery (test gate per rig)
│   └── Dogs[4] (pluggable patrol workers)
├── Rigs (projects)
│   ├── Polecats (worker agents, persistent identity)
│   ├── Hooks (git worktrees for agent work)
│   └── Crew (human workspaces)
├── Beads (.beads/ — git-tracked issue ledger)
├── Dolt (git-like SQL database)
├── Mail (inter-agent messaging)
└── Feed (activity stream)
```

### 2.2 Multi-Runtime Support (10 AI runtimes)

Gastown abstracts over 10 different AI CLI tools through a unified agent preset system:

| Runtime | Hook Support | Session Resume | Notes |
|---------|-------------|----------------|-------|
| Claude Code | ✅ Native | `--resume` | Primary runtime |
| Gemini | ❌ | `--resume` | Google |
| Codex | ❌ | env-based | OpenAI |
| Cursor | ❌ | ❌ | IDE-based |
| Auggie | ❌ | `--resume` | |
| Amp | ❌ | `--resume` | |
| OpenCode | ✅ Plugins | env-based | |
| Copilot | ❌ | ❌ | GitHub |
| Pi | ❌ | ❌ | |
| OMP | ❌ | ❌ | |

Each preset defines: `command`, `process_names`, `session_id_env`, `resume_flag`, `continue_flag`, `supports_hooks`, `hooks_dir`, `config_dir`, `ready_prompt_prefix`.

**Flightdeck relevance:** Gastown's per-runtime preset registry is more mature than Flightdeck's single-runtime ACP adapter. The R9 ACP Adapter spec already moves in this direction, but Gastown shows the full design for 10 runtimes.

### 2.3 Git-Backed Persistence ("Hooks")

The single most important architectural decision: **agent work persists in git worktrees, not in memory**.

- Each polecat gets a dedicated git worktree (branch-per-polecat)
- Work survives agent crashes, restarts, and context exhaustion
- Full audit trail via git history
- Rollback capability built in
- Merge queue (Bors-style) with binary bisect on test failure

**Flightdeck relevance:** Flightdeck's WorktreeManager is "in development" per the self-analysis. Gastown demonstrates this pattern at production scale — and shows that worktrees are foundational, not optional.

### 2.4 Beads Issue Tracking

Gastown ships with its own issue tracking system (Beads v0.59.0) — a git-tracked JSONL ledger:

- Issues stored in `.beads/issues.jsonl` (committed to git)
- Two CLIs: `bd` (CRUD) and `bv` (graph analysis, read-only)
- Bead IDs have rig-origin prefixes: `gt-abc12`, `hq-x7k2m`
- Agents sync beads changes with `bd sync` at session end
- Dependency tracking between beads
- Convoy bundling (group related beads for parallel work)

**Flightdeck relevance:** Beads is a standalone issue tracker that persists in git. Flightdeck's DAG tasks live in SQLite. There's an interesting design question: should task state be git-tracked (survives DB loss, human-readable, auditable) or database-tracked (queryable, transactional, faster)?

### 2.5 Formula System (42 Workflow Templates)

Gastown has a TOML-based workflow engine with 42 built-in formulas:

**Formula types:**
- **Convoy** — Parallel legs + synthesis step (e.g., 10-reviewer code review)
- **Workflow** — Sequential steps with dependencies and human gates
- **Expansion** — Template-based step generation from parameters
- **Aspect** — Multi-aspect parallel analysis

**Example: Code Review Convoy** (10 parallel reviewers):
```toml
[[legs]]
id = "correctness"
focus = "Logic correctness"

[[legs]]
id = "security"
focus = "Security vulnerabilities"

# ... 8 more specialized reviewers

[synthesis]
title = "Review Summary"
depends_on = ["correctness", "security", ...]
```

**Example: Idea-to-Plan Workflow** (7 sequential steps with human gates):
1. Intake → 2. PRD Review (6 parallel polecats) → 3. Human Clarification → 4. Implementation Design (6 parallel polecats) → 5. Plan Review (5 parallel polecats) → 6. Human Approval → 7. Create Beads

**Flightdeck relevance:** Flightdeck has no workflow/formula system. The DAG is task-level, not workflow-level. Gastown's formulas show how to compose multi-step, multi-agent workflows with human gates — a significant capability gap.

### 2.6 Mail System (Inter-Agent Messaging)

Gastown has a full messaging system stored as beads:

**Routing models:**
- **Direct** — Named recipient (`To: "gastown/Toast"`)
- **Queue** — First available agent claims (`Queue: "review-queue"`)
- **Broadcast** — Channel-based (`Channel: "updates"`)

**Delivery modes:**
- **Queue** — Agent checks with `gt mail check` (pull)
- **Interrupt** — Injected directly into agent session (push, for urgent/lifecycle)

**Features:** Priority levels (urgent/high/normal/low), threading, two-phase delivery tracking, CC recipients, pinning, wisp (transient) messages.

**Flightdeck comparison:** Flightdeck has `AGENT_MESSAGE`, `BROADCAST`, `GROUP_MESSAGE`, and `DIRECT_MESSAGE`. Gastown's mail system is richer in routing models (queue-based work distribution is notable) but less real-time (file-based vs. WebSocket). Flightdeck's real-time communication is a strength; Gastown's queue model is an interesting addition.

---

## 3. Notable Techniques and Innovations

### 3.1 Persistent Agent Identity

Polecats have persistent identity but ephemeral sessions. The name, profile, and accumulated context survive across sessions. This is different from Flightdeck where agents are fully ephemeral — a new session starts fresh.

### 3.2 `gt prime` — Context Injection via Hooks

When a Claude Code session starts, the `SessionStart` hook runs `gt prime --hook`, which:
1. Detects the agent's role from the current directory path
2. Reads the session ID from stdin JSON
3. Injects role-appropriate context, state information, and recovery context
4. Handles post-crash and post-compaction states differently

This is automatic context injection at session start — the agent doesn't need to "remember" anything because `gt prime` tells it everything it needs to know.

**Flightdeck relevance:** Flightdeck injects context via system prompts at spawn time, but doesn't have a hook-based re-injection mechanism for resumed or compacted sessions.

### 3.3 Daemon Patrol System

The daemon runs a heartbeat loop that automatically detects and recovers from failures:

- **Stuck detection**: Agents with `state=working` but no activity for >2h → kill session
- **Idle cleanup**: Dogs idle >1h → kill tmux session; idle >4h → remove from pool
- **Mass death detection**: 3+ deaths within 30s → alert (indicates systemic issue)
- **Claim-then-execute**: Delete mail message before processing (prevents reprocessing on crash)
- **Two-phase delivery**: pending → acked (reliable exactly-once delivery)

### 3.4 Feed Curator (Event Deduplication)

Raw events go through a curator that deduplicates and aggregates:
- 5 molecule updates → single "agent active" event
- 3 issue closures → single "batch complete" event
- Configurable windows (dedup: 10s, aggregate: 30s)
- Visibility filtering (audit-only events dropped from user feed)

**Flightdeck relevance:** Flightdeck's `SmartActivityFilter` does similar work, but Gastown's file-based approach with flock coordination is interesting for multi-process scenarios.

### 3.5 Model Evaluation Suite (`gt-model-eval/`)

Gastown includes a **promptfoo-based model comparison framework** with 94 test cases across 12 YAML files:

- **Class B tests** (82): Directive following — explicit instructions, measures compliance
- **Class A tests** (12): Evidence-based reasoning — no hints, just shell output

Tests cover: zombie detection, plugin cooldown evaluation, stuck polecat assessment, test failure triage, merge conflict handling, orphan database triage.

**Key insight:** Class A results directly inform whether Sonnet/Haiku can replace Opus for patrol roles. This is systematic model cost optimization — not guessing, but measuring.

**Flightdeck relevance:** Flightdeck has no model evaluation framework. Adding one (even simple) would inform R10 (response tiers) and R19 (model fallback chains) with data rather than intuition.

### 3.6 Configuration Layering (6 Tiers)

Gastown has 6-tier configuration precedence:
1. Built-in defaults (hardcoded)
2. Town-level settings (`settings/config.json`)
3. Mayor config (`mayor/config.json`)
4. Rig config (per-rig: `rigs/<rig>/rig.json`)
5. Wisp config (local-only, never synced to git)
6. Environment variables (highest precedence)

**Notable: Wisp (tier 5)** — ephemeral, local-only config that is explicitly NOT synced to git. Used for per-rig flags, user overrides, cached state. This separation of "persistent config" vs "transient preferences" is a clean pattern.

### 3.7 Web Dashboard Safety

The web dashboard has exemplary security:
- **Command whitelist**: Only approved `gt` commands can execute
- **Confirmation gate**: Dangerous commands require explicit `confirmed: true`
- **CSRF token**: All POST requests validated
- **Concurrency limiter**: Max 12 concurrent subprocesses
- **Timeout enforcement**: Per-command defaults and max limits
- **Argument sanitization**: Prevents shell injection
- **Parallel fetching**: 14 data sources fetched concurrently with 8s total timeout

---

## 4. Tech Stack and Dependencies

| Component | Technology |
|-----------|-----------|
| Language | Go 1.25.6 |
| CLI framework | spf13/cobra |
| TUI framework | charmbracelet/bubbletea + glamour |
| Database | Dolt (git-like SQL) |
| Issue tracking | Beads v0.59.0 (JSONL, git-tracked) |
| Terminal multiplexer | tmux (session management) |
| Observability | OpenTelemetry → VictoriaMetrics + VictoriaLogs |
| Browser automation | go-rod (headless Chrome) |
| Testing | testcontainers-go, stretchr/testify |
| Distribution | Homebrew, npm, Docker, manual |
| CI/CD | 10 GitHub Actions workflows |
| Config format | JSON (settings), TOML (formulas) |
| Build | Makefile with ldflags version embedding |

---

## 5. Testing Approach

- **899 Go test files** distributed across all 65+ packages
- **Unit tests**: Package-specific `*_test.go` files
- **Integration tests**: Dolt database, Beads CLI, formula parsing
- **E2E tests**: Docker container (`Dockerfile.e2e`)
- **Model evaluation**: 94 promptfoo test cases for AI decision quality
- **Test utilities**: `internal/testutil/` for fixtures and mocks
- **Libraries**: testcontainers-go (Docker), stretchr/testify (assertions)

**Notable:** The model evaluation suite (gt-model-eval/) is a testing category Flightdeck doesn't have — testing AI agent decision quality, not just code correctness.

---

## 6. Storage and Persistence

Gastown uses **5 storage layers** — more than any project in the earlier research:

| Layer | Technology | Purpose | Persistence |
|-------|-----------|---------|-------------|
| Git worktrees | Git | Agent work, code changes | Permanent (git history) |
| Beads | JSONL (git-tracked) | Issue/task tracking | Permanent (committed) |
| Dolt | Git-like SQL DB | Structured data, queries | Permanent (server-managed) |
| Wisp | JSON files | Transient config, preferences | Local only (never synced) |
| Feed/Events | JSONL files | Activity stream, event log | Ephemeral (auto-truncated at 10MB) |

**Design philosophy:** Different durability requirements → different storage tiers. Contrast with Flightdeck (SQLite for everything) and Squad (markdown for everything).

---

## 7. What Can Flightdeck Learn From Gastown?

### 7.1 HIGH IMPACT: Formula/Workflow System

**Gap:** Flightdeck has DAG-level task orchestration but no reusable workflow templates.

**Gastown's approach:** 42 TOML-based formulas that compose multi-step, multi-agent workflows with parallel execution, synthesis steps, and human gates. A "code review" formula spawns 10 specialized reviewers in parallel, then synthesizes findings.

**Recommendation:** Add a lightweight workflow/formula system to Flightdeck. Start with 3-5 built-in workflows (code review convoy, feature implementation, bug triage). Store as YAML/TOML in `.github/workflows/` or `flightdeck.workflows/`. The DAG engine already handles dependencies — formulas would be a higher-level abstraction that generates DAG tasks.

### 7.2 HIGH IMPACT: Queue-Based Work Distribution

**Gap:** Flightdeck assigns tasks to specific agents. There's no "put this in a queue and let the next available agent claim it" model.

**Gastown's approach:** Mail queue routing — `Queue: "review-queue"` → first available agent claims the work.

**Recommendation:** Add a work queue model alongside direct assignment. Some tasks (reviews, bug triage, refactoring) are fungible — any agent with the right role can do them. Queue-based distribution improves throughput when some agents are idle and others are overloaded.

### 7.3 HIGH IMPACT: Persistent Agent Identity

**Gap:** Flightdeck agents are fully ephemeral. Each session starts fresh. There's no concept of an agent accumulating expertise over time (beyond the `CollectiveMemory` service, which the self-analysis notes is unclear).

**Gastown's approach:** Polecats have persistent names and profiles. Session history accumulates. `gt prime` re-injects context on restart.

**Recommendation:** This aligns with synthesis R7 (Persistent Knowledge). Gastown proves the pattern works at scale. The specific mechanism — `gt prime` injecting context from persistent storage on session start — is a concrete implementation approach for R7.

### 7.4 MEDIUM IMPACT: Model Evaluation Framework

**Gap:** Flightdeck has no systematic way to evaluate which models work best for which roles/tasks.

**Gastown's approach:** 94 promptfoo test cases across 2 difficulty classes, directly informing model selection decisions (can Sonnet replace Opus for patrol roles?).

**Recommendation:** Build a model evaluation suite for Flightdeck's key agent roles. Even 20-30 test cases would provide data for R10 (response tiers) and R19 (model fallback chains). Use promptfoo or a similar framework.

### 7.5 MEDIUM IMPACT: Tiered Storage

**Gap:** Flightdeck uses SQLite for everything.

**Gastown's approach:** 5 storage tiers with different durability characteristics. Notably: **Wisp** for transient, local-only preferences (never synced to git).

**Recommendation:** Flightdeck doesn't need 5 tiers, but the Wisp concept (local-only, never-committed preferences) is valuable. User preferences, UI state, recent selections — these shouldn't be in SQLite alongside production data. A separate `~/.flightdeck/preferences.json` file would be cleaner.

### 7.6 MEDIUM IMPACT: Daemon with Mass-Death Detection

**Gap:** Flightdeck detects individual agent failures but doesn't detect systemic issues (e.g., all agents crashing because the LLM provider is down).

**Gastown's approach:** Mass-death detection — 3+ agent deaths within 30s triggers a system-wide alert and pauses further spawning.

**Recommendation:** Add mass-failure detection to Flightdeck's agent lifecycle. If multiple agents crash in quick succession, it's likely a systemic issue (provider outage, bad config, disk full). Pausing and alerting is better than spawning more agents into a broken environment.

### 7.7 LOW IMPACT (but interesting): Event Deduplication

**Gap:** Flightdeck's `SmartActivityFilter` does some filtering, but the curator pattern is more explicit.

**Gastown's approach:** Configurable dedup windows (10s), aggregate windows (30s), minimum counts for aggregation (3), visibility tagging.

**Recommendation:** If Flightdeck's activity feed becomes noisy at scale, adopt Gastown's curator pattern with configurable windows.

---

## 8. Overlap and Integration Opportunities

### 8.1 Multi-CLI Support

Gastown supports 10 AI runtimes. Flightdeck's recent multi-CLI ACP research found that Gemini CLI, OpenCode, Cursor CLI, Codex, and Claude agent-sdk are all compatible via the existing AgentAdapter. Gastown's per-runtime preset registry (`internal/config/agents.go`) is a production reference for how to structure multi-runtime support.

**Integration opportunity:** Flightdeck could adopt Gastown's preset registry pattern for its multi-CLI support, with each runtime defined as a preset with hook support, session resume, and process detection settings.

### 8.2 Beads as Task Backend

Gastown's Beads issue tracker is a standalone tool. In theory, Flightdeck could use Beads for git-tracked task persistence alongside or instead of SQLite DAG tasks. This would give:
- Git-tracked task history (human-readable, auditable)
- Cross-tool compatibility (other Beads-aware tools could read Flightdeck tasks)
- Offline task management via `bd` CLI

**Caveat:** This is a significant architectural change. SQLite is better for Flightdeck's query-heavy patterns (DAG resolution, dependency checking). Beads is better for persistence durability and human readability.

### 8.3 Formula Import

If Flightdeck adds a workflow system (7.1), it could import/adapt Gastown's formula format. The TOML-based convoy/workflow/expansion model is well-tested. Starting from Gastown's 42 formulas and adapting for Flightdeck's agent model would be faster than designing from scratch.

### 8.4 `gt prime` Pattern for Session Recovery

Gastown's `gt prime` hook-based context injection on session start is directly applicable to Flightdeck. When a Flightdeck agent session restarts (after crash, context exhaustion, or manual restart), a `prime`-equivalent could:
1. Detect the agent's role and task assignment
2. Load relevant context from SQLite (recent decisions, file locks, DAG state)
3. Inject a recovery prompt that tells the agent where it left off

This is complementary to synthesis R13 (continuation turns) and R7 (persistent knowledge).

---

## 9. Anything Particularly Clever

### 9.1 The Propulsion Principle
The idea that work should persist independent of the agent executing it — via git worktrees — is the single cleverest architectural decision. It eliminates the entire category of "lost work on crash" problems.

### 9.2 Branch-Per-Polecat
Each worker agent gets its own git branch. This eliminates file conflicts between agents at the git level, not just at the file-lock level. Flightdeck uses file locking; Gastown uses branch isolation.

### 9.3 Claim-Then-Execute
For mail processing: delete the message first, then execute the action. If the action fails, the message is already gone — preventing infinite retry loops. This is a deliberate trade-off (possible missed messages > infinite retry storm).

### 9.4 Zero Fixed Constants (ZFC)
All operational thresholds (staleness timeouts, pool sizes, dedup windows, death detection) are configurable, not hardcoded. This enables tuning for different scales without code changes.

### 9.5 Model Eval as First-Class Testing
Including AI decision quality testing alongside unit/integration/E2E tests — not as an afterthought but as a structured evaluation framework — is a practice the industry should adopt more broadly.

---

## 10. Summary Comparison: Gastown vs Flightdeck

| Dimension | Gastown | Flightdeck | Notes |
|-----------|---------|------------|-------|
| **Scale** | 469K LoC, 65+ packages | ~80K LoC, 3 packages | Gastown is 5-6× larger |
| **Language** | Go | TypeScript/Node.js | Different ecosystems |
| **Agent persistence** | Persistent identity + ephemeral sessions | Fully ephemeral | Gastown agents accumulate context |
| **Work persistence** | Git worktrees (crash-proof) | SQLite (lost on DB corruption) | Gastown's is more durable |
| **Task tracking** | Beads (git-tracked JSONL) | SQLite DAG | Different trade-offs |
| **Runtimes** | 10 (Claude, Gemini, Codex, etc.) | 1 (ACP via Copilot CLI) | Gastown is more flexible |
| **Workflow engine** | 42 TOML formulas | None (DAG only) | Significant gap |
| **Communication** | File-based mail + tmux | Real-time WebSocket | Flightdeck is faster |
| **Observability UI** | TUI (bubbletea) + web dashboard | Full React web UI | Flightdeck UI is richer |
| **Monitoring** | Hierarchical patrol (daemon→deacon→witness→dogs) | Agent status + alerts | Gastown is more autonomous |
| **Testing** | 899 files + model eval (94 cases) | 125+ server + web tests | Gastown has model eval |
| **Config** | 6-tier layering + wisp (transient) | YAML + SQLite | Gastown is more flexible |
| **Security** | Command whitelist, CSRF, sanitization, fail-closed | Auth middleware, rate limiting, file locks | Both strong, different focus |

**Bottom line:** Gastown is a more mature, larger system that solves a broader problem (multi-runtime, multi-project orchestration at 20-50+ agent scale). Flightdeck excels in real-time communication, web UI richness, and developer experience. The two systems have complementary strengths — Gastown's persistence model, workflow engine, and patrol system are the highest-value patterns to study.

---

*Key takeaways for Flightdeck: (1) Formula/workflow system is the biggest capability gap, (2) persistent agent identity via session-start context injection is achievable with moderate effort, (3) queue-based work distribution would improve throughput, (4) model evaluation testing is a missing testing category, (5) mass-death detection is a quick reliability win.*
