# Symphony — Research Report

**Repository:** `openai/symphony`
**License:** Apache 2.0 (Copyright 2025 OpenAI)
**Language:** Elixir/OTP (reference implementation); spec is language-agnostic
**Status:** Engineering preview / prototype

---

## 1. What the Project Does

Symphony is an **autonomous coding agent orchestrator** — it turns issue tracker work (Linear tickets) into isolated, unattended agent execution runs. The core value proposition: engineers manage *work*, not *coding agents*.

### The Problem It Solves

Instead of manually invoking coding agents per task and supervising each one, Symphony:

1. **Polls Linear** for candidate work on a configurable cadence
2. **Creates an isolated workspace** per issue (git clone per workspace)
3. **Launches OpenAI Codex** in [App Server mode](https://developers.openai.com/codex/app-server/) inside each workspace
4. **Sends a workflow-defined prompt** (rendered with issue context via Liquid templates)
5. **Manages the full lifecycle**: retries, continuation turns, stall detection, reconciliation against tracker state changes, and terminal cleanup

The key mental model: Symphony is a **daemon scheduler for coding agents**, not a one-shot script. It continuously watches for work, manages concurrency, handles failures with exponential backoff, and reconciles when humans change issue states in Linear.

### Workflow

The entire runtime policy lives in a single file: `WORKFLOW.md` — a Markdown file with YAML front matter for configuration and a Liquid-template body for the agent prompt. This file is version-controlled with the repository, giving teams control over agent behavior without modifying Symphony itself.

---

## 2. Architecture and Key Design Patterns

### 2.1 High-Level Architecture (6-Layer Stack)

Symphony is organized into clear abstraction layers (explicitly documented in SPEC.md §3.2):

| Layer | Responsibility | Key Modules |
|-------|---------------|-------------|
| **Policy** | Repo-defined workflow prompt + team rules | `WORKFLOW.md` |
| **Configuration** | Typed getters, defaults, env resolution, validation | `Config`, `Workflow`, `WorkflowStore` |
| **Coordination** | Poll loop, eligibility, concurrency, retries, reconciliation | `Orchestrator` (GenServer) |
| **Execution** | Workspace lifecycle, agent subprocess management | `AgentRunner`, `Workspace` |
| **Integration** | Tracker API (Linear adapter) | `Tracker` (behaviour), `Linear.Adapter`, `Linear.Client` |
| **Observability** | Logs, terminal dashboard, optional web dashboard + JSON API | `StatusDashboard`, `HttpServer`, Phoenix LiveView |

### 2.2 Core Design Patterns

#### OTP Supervision Tree
```
SymphonyElixir.Supervisor (one_for_one)
├── Phoenix.PubSub
├── Task.Supervisor (for agent worker tasks)
├── WorkflowStore (GenServer — caches/reloads WORKFLOW.md)
├── Orchestrator (GenServer — single authority for scheduling state)
├── HttpServer (optional Phoenix endpoint)
└── StatusDashboard (GenServer — terminal UI rendering)
```

The architecture is a textbook OTP application. The Orchestrator is a single GenServer that serializes all scheduling state mutations — preventing duplicate dispatch, race conditions, and split-brain problems.

#### Adapter/Behaviour Pattern for Tracker Integration
`SymphonyElixir.Tracker` defines a behaviour (interface) with callbacks:
- `fetch_candidate_issues/0`
- `fetch_issues_by_states/1`
- `fetch_issue_states_by_ids/1`
- `create_comment/2`
- `update_issue_state/2`

Two implementations exist:
- `SymphonyElixir.Linear.Adapter` — production Linear GraphQL client
- `SymphonyElixir.Tracker.Memory` — in-memory test double

The adapter is selected by `tracker.kind` config, making it trivial to add new tracker backends (Jira, GitHub Issues, etc.) without touching orchestration code.

#### Erlang Port for Subprocess Management
The Codex app-server is launched as an Erlang Port (`Port.open/2`) — giving full control over the subprocess lifecycle:
- Line-delimited JSON-RPC protocol over stdio
- Automatic cleanup on BEAM process exit
- OS PID tracking for observability
- Proper signal handling for termination

This is significantly more robust than shelling out with `System.cmd/3` because it gives bidirectional communication and crash isolation.

#### Single-Writer State Machine
The Orchestrator owns ALL scheduling state in a single `%State{}` struct:
- `running` (map of issue_id → running entry with PID, monitor ref, session metadata)
- `claimed` (MapSet of reserved issue IDs)
- `retry_attempts` (map of issue_id → retry entry with backoff state)
- `completed` (MapSet for bookkeeping)
- `codex_totals` (aggregate token usage)

All mutations go through `handle_info/2` callbacks, ensuring serialized access. This eliminates entire categories of concurrency bugs.

#### Dynamic Tool Injection
Symphony injects a `linear_graphql` tool into Codex app-server sessions via the `dynamicTools` protocol mechanism. This lets the coding agent make raw Linear GraphQL calls (comment editing, upload flows, state transitions) using Symphony's configured auth — without the agent needing its own Linear credentials.

### 2.3 Orchestration State Machine

Issues transition through internal orchestration states (distinct from Linear states):

```
Unclaimed → Claimed → Running → (normal exit) → Continuation Retry → Running/Released
                                → (abnormal exit) → Exponential Backoff Retry → Running/Released
                                → (stall timeout) → Retry → Running/Released
                                → (terminal state) → Released + Workspace Cleanup
```

Key behaviors:
- **Continuation retries**: After a normal worker exit, a 1-second retry checks if the issue is still active (it might need another agent session)
- **Failure retries**: `delay = min(10000 * 2^(attempt-1), max_retry_backoff_ms)` — exponential backoff capped at 5 minutes
- **Stall detection**: If no Codex activity for `stall_timeout_ms`, the worker is killed and retried
- **Reconciliation**: Every poll tick, running issues are checked against the tracker — terminal issues get their agents killed and workspaces cleaned

### 2.4 Multi-Turn Agent Sessions

Within a single worker run, Codex can execute up to `max_turns` (default 20) continuation turns:
1. First turn: full rendered prompt with issue context
2. Subsequent turns: lightweight continuation guidance ("resume from current state")
3. Between turns: check tracker to see if issue is still active
4. All turns share the same Codex thread (preserving conversation context)

This is a key insight: a single "agent run" isn't a single LLM call — it's a multi-turn session where the agent works iteratively until the work is done or it runs out of turns.

---

## 3. Notable Techniques and Innovations

### 3.1 WORKFLOW.md as Universal Configuration
The entire runtime behavior (tracker config, workspace setup, agent parameters, sandbox policies, AND the agent prompt) lives in a single Markdown file with YAML front matter. This is brilliant because:
- It's version-controlled alongside the code
- It's human-readable as documentation
- It supports Liquid template variables (`{{ issue.identifier }}`, `{{ issue.description }}`)
- Changes are hot-reloaded without restart (WorkflowStore polls for file changes every 1 second)

### 3.2 Spec-First Design
The 2,100-line `SPEC.md` is an exceptionally detailed, language-agnostic specification. The README literally says "tell your favorite coding agent to implement Symphony from this spec." This is a new pattern: designing software specifically to be reimplemented by AI agents in any language.

### 3.3 Workspace Safety Invariants
Security-critical workspace isolation rules:
- **Path traversal prevention**: Workspace path must be a child of workspace root (no symlink escape)
- **Symlink checking**: `ensure_no_symlink_components/2` walks each path segment with `lstat` to detect symlink escape
- **Codex CWD validation**: Agent subprocess always starts inside the per-issue workspace, never the source repo
- **Sanitized identifiers**: Only `[A-Za-Z0-9._-]` in workspace directory names

### 3.4 Dynamic Config Reload
`WorkflowStore` is a GenServer that:
- Polls the workflow file every 1 second
- Compares `{mtime, size, :erlang.phash2(content)}` stamps
- Reloads on change while keeping the last-known-good config if the new one fails
- This means you can change polling interval, concurrency limits, prompt template, etc. without restarting

### 3.5 Token Accounting Strategy
The `docs/token_accounting.md` document is a masterclass in understanding upstream telemetry semantics. Key insight: Codex reports both absolute totals and deltas — Symphony uses only the absolute totals (high-water marks) to avoid double-counting, with detailed reasoning about why other approaches fail.

### 3.6 Codex Skills System
Six reusable skills are provided as `.codex/skills/<name>/SKILL.md` files:
- **commit**: Clean git commit from session changes
- **push**: Push and create/update PR
- **pull**: Sync feature branch with origin/main
- **land**: Monitor CI, resolve conflicts, squash-merge
- **linear**: Raw Linear GraphQL via injected tool
- **debug**: Trace stuck runs using Symphony logs

These skills are instructions that Codex loads contextually — they encode operational knowledge that would otherwise need to be in the main prompt.

### 3.7 Revalidation Before Dispatch
Before dispatching an issue, the orchestrator re-fetches its current state from the tracker. This prevents dispatching stale issues that were resolved between poll ticks — a subtle but important race condition prevention.

### 3.8 Per-State Concurrency Limits
`max_concurrent_agents_by_state` allows limiting how many agents work on issues in a specific state (e.g., limit "Merging" to 1 to prevent merge conflicts). This is a nuanced concurrency control that most job schedulers don't offer.

### 3.9 Guardrails Acknowledgement Banner
The CLI requires `--i-understand-that-this-will-be-running-without-the-usual-guardrails` to start. This is a safety-conscious design — making operators explicitly acknowledge the trust model before running autonomous agents.

---

## 4. Tech Stack and Dependencies

### Runtime
| Dependency | Version | Purpose |
|-----------|---------|---------|
| **Elixir** | ~> 1.19 (OTP 28) | Core language |
| **Phoenix** | ~> 1.8.0 | Web framework (LiveView dashboard) |
| **Phoenix LiveView** | ~> 1.1.0 | Real-time dashboard UI |
| **Bandit** | ~> 1.8 | HTTP server (replaces Cowboy) |
| **Req** | ~> 0.5 | HTTP client (for Linear API) |
| **Jason** | ~> 1.4 | JSON encoding/decoding |
| **YamlElixir** | ~> 2.12 | YAML parsing (WORKFLOW.md front matter) |
| **Solid** | ~> 1.2 | Liquid template engine (prompt rendering) |
| **NimbleOptions** | ~> 1.1 | Option validation |

### Dev/Test
| Dependency | Purpose |
|-----------|---------|
| **Credo** | Elixir linter |
| **Dialyxir** | Static type analysis |
| **Floki/LazyHTML** | HTML parsing in tests (dashboard snapshot tests) |

### External Dependencies
- **Linear API** (GraphQL) — issue tracker
- **OpenAI Codex app-server** — coding agent (JSON-RPC over stdio)
- **Git CLI** — workspace population via hooks
- **mise** — Elixir/Erlang version management

### Codebase Size
- **Source**: ~8,900 lines of Elixir across ~30 modules
- **Tests**: ~7,950 lines of ExUnit tests
- **Spec**: ~2,100 lines (language-agnostic specification)
- **WORKFLOW.md**: ~330 lines (prompt + config for self-hosting)

---

## 5. Testing Approach

### Strategy
- **100% coverage threshold** configured in mix.exs (with a generous ignore list for modules requiring external dependencies)
- **Full quality gate**: `make all` runs format check → lint → coverage → dialyzer
- **CI**: GitHub Actions workflow runs `make all` on PRs and pushes to main

### Test Patterns
1. **Config-driven test doubles**: Tests override module behavior through Application config (`Application.put_env`) rather than mocking frameworks. The `SymphonyElixir.Tracker.Memory` adapter is the canonical example.

2. **Write-workflow-file helper**: Tests create temporary WORKFLOW.md files with specific config overrides, enabling isolated config testing without global state pollution.

3. **Snapshot testing**: Dashboard rendering is tested via snapshot comparison (`status_dashboard_snapshot_test.exs`), ensuring terminal UI output matches expected strings.

4. **Test-exposed functions**: Many modules expose `*_for_test` functions (`@doc false`) that allow testing internal logic without making private functions public. Examples:
   - `Orchestrator.reconcile_issue_states_for_test/2`
   - `Orchestrator.should_dispatch_issue_for_test/2`
   - `Client.normalize_issue_for_test/2`

5. **Temp directory isolation**: Workspace tests create unique temporary directories using `System.unique_integer([:positive])`, ensuring parallel test safety.

### Test Coverage Areas
- Core config parsing, defaults, validation
- Workflow file loading, front matter parsing, template rendering
- Issue normalization, pagination, blocker extraction
- Dispatch eligibility, priority sorting, concurrency control
- Retry backoff calculation, continuation scheduling
- Reconciliation state transitions
- Workspace creation, reuse, safety validation, hook execution
- App-server protocol handshake, turn streaming, approval handling
- Dynamic tool execution (linear_graphql)
- Dashboard rendering and observability API payloads
- CLI argument parsing, guardrails banner

### What's NOT Tested (by design)
The `ignore_modules` list in mix.exs excludes modules that require external services:
- `Orchestrator`, `AgentRunner` (need running Codex)
- `Linear.Client` (needs Linear API)
- `Codex.AppServer` (needs Codex binary)
- Web modules (tested via snapshot/integration)

### Code Quality
- `@spec` required on all public functions (enforced by `mix specs.check`)
- Credo with `--strict` mode
- Dialyzer for static type analysis
- PR body must follow template (enforced by `mix pr_body.check`)

---

## 6. Particularly Clever / Well-Done Aspects

### 6.1 The "Spec as Implementation Prompt" Pattern
SPEC.md is written to be consumed by coding agents as an implementation guide. This is a fundamentally new approach to software specification — designing specs that are both human-readable documentation AND machine-implementable instructions. The README literally says "tell your coding agent to build this from the spec."

### 6.2 Why Elixir/OTP is the Perfect Fit
The choice of Elixir is not accidental:
- **Supervision trees** = natural fault isolation between agent runs
- **GenServer** = serialized state machine for scheduling (no locks, no races)
- **Task.Supervisor** = managed agent worker processes with monitoring
- **Erlang Ports** = robust subprocess management with crash isolation
- **Hot code reloading** = update Symphony without stopping running agents
- **Phoenix PubSub** = real-time dashboard updates with minimal code

### 6.3 The WorkflowStore Cache Pattern
The file-watching cache is elegantly simple:
```elixir
defp current_stamp(path) do
  with {:ok, stat} <- File.stat(path, time: :posix),
       {:ok, content} <- File.read(path) do
    {:ok, {stat.mtime, stat.size, :erlang.phash2(content)}}
  end
end
```
Uses a triple of `{mtime, size, content_hash}` for change detection — more reliable than mtime alone (handles same-second edits) and cheaper than full content comparison on every poll.

### 6.4 Defensive Dispatch
The `revalidate_issue_for_dispatch/3` function re-fetches the issue from the tracker RIGHT BEFORE dispatching. This eliminates the race condition where an issue becomes ineligible between the poll fetch and the actual dispatch — a subtle but critical correctness guarantee.

### 6.5 The Acknowledgement Switch
`--i-understand-that-this-will-be-running-without-the-usual-guardrails` is not just a flag — it's a design statement. It says: "We know this is powerful and potentially dangerous. We're making you explicitly acknowledge that."

### 6.6 Token Accounting Documentation
The `docs/token_accounting.md` is a ~300-line deep-dive into Codex's internal token reporting semantics, derived from reading the Codex Rust source code. This level of integration understanding is rare and prevents subtle accounting bugs that would be incredibly hard to diagnose.

### 6.7 The Workspace Safety Model
Four layers of defense:
1. Path must be under workspace root (prefix check)
2. No symlink components (lstat walk)
3. Workspace ≠ root itself
4. Sanitized directory names

This prevents an entire class of path traversal attacks that could let an agent escape its workspace.

### 6.8 Graceful Degradation
The system degrades gracefully at every level:
- Config reload failure → keep last known good config
- Terminal fetch failure → log warning, continue startup
- State refresh failure → keep workers running, try next tick
- Hook failure on non-critical hooks → log and ignore
- Stall detection disabled when `stall_timeout_ms <= 0`

---

## 7. Architectural Lessons for Other Projects

1. **Single-writer state machines eliminate concurrency bugs.** The Orchestrator GenServer pattern is broadly applicable to any scheduling/dispatch system.

2. **Spec-first design enables polyglot implementation.** Writing a language-agnostic spec first, then implementing, produces cleaner abstractions than evolving code directly.

3. **Configuration as code (WORKFLOW.md)** collocating runtime config with the repository it governs is a powerful pattern for autonomous systems.

4. **Behaviour-based adapters** make integration points testable and extensible without conditional logic.

5. **Re-validate before acting** (the defensive dispatch pattern) should be standard in any system where state can change between read and write.

6. **Continuation turn architecture** — treating agent sessions as multi-turn conversations rather than one-shot invocations — dramatically improves agent effectiveness.

7. **Erlang Ports for subprocess management** offer a much richer interaction model than shell-out patterns in other languages.

---

## 8. File/Module Map (Quick Reference)

```
symphony/
├── SPEC.md                          # 2100-line language-agnostic specification
├── README.md                        # Project overview
├── .codex/skills/                   # 6 reusable Codex skills (commit, push, pull, land, linear, debug)
├── .github/workflows/make-all.yml   # CI: format + lint + coverage + dialyzer
└── elixir/
    ├── WORKFLOW.md                   # Self-hosting workflow config + prompt (~330 lines)
    ├── AGENTS.md                     # Contributor guide for coding agents
    ├── mix.exs                       # Project config (deps, escript, coverage)
    ├── Makefile                      # Quality gate targets
    ├── lib/
    │   ├── symphony_elixir.ex        # Application entry point + OTP supervisor tree
    │   ├── symphony_elixir/
    │   │   ├── orchestrator.ex       # Core scheduler GenServer (~1450 lines)
    │   │   ├── agent_runner.ex       # Single-issue execution with multi-turn loop
    │   │   ├── config.ex             # Typed config getters (~940 lines)
    │   │   ├── workflow.ex           # WORKFLOW.md parser (YAML + Liquid)
    │   │   ├── workflow_store.ex     # Hot-reload cache for workflow file
    │   │   ├── workspace.ex          # Isolated workspace management + safety checks
    │   │   ├── prompt_builder.ex     # Liquid template rendering
    │   │   ├── tracker.ex            # Tracker behaviour (adapter interface)
    │   │   ├── tracker/memory.ex     # In-memory test adapter
    │   │   ├── status_dashboard.ex   # Terminal UI renderer (~1950 lines)
    │   │   ├── log_file.ex           # Structured log file management
    │   │   ├── http_server.ex        # Optional Phoenix endpoint bootstrap
    │   │   ├── codex/
    │   │   │   ├── app_server.ex     # JSON-RPC client for Codex app-server (~985 lines)
    │   │   │   └── dynamic_tool.ex   # linear_graphql tool injection
    │   │   └── linear/
    │   │       ├── adapter.ex        # Linear tracker behaviour impl
    │   │       ├── client.ex         # Linear GraphQL client (pagination, normalization)
    │   │       └── issue.ex          # Normalized issue struct
    │   └── symphony_elixir_web/
    │       ├── router.ex             # LiveView dashboard + JSON API routes
    │       ├── presenter.ex          # Shared state projections
    │       ├── observability_pubsub.ex
    │       └── live/dashboard_live.ex
    ├── test/                         # ~7950 lines of ExUnit tests
    └── docs/
        ├── logging.md                # Structured logging conventions
        └── token_accounting.md       # Deep-dive on Codex token semantics
```
