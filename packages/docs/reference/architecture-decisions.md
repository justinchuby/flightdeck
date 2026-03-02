# Architecture Decision Records

Key architecture decisions made during Flightdeck development (Waves 1–20).

---

## ADR-001: Class-based dark mode toggle

**Status**: Accepted
**Context**: The UI needed a reliable light/dark theme toggle that persists across page loads, works without flash-of-wrong-theme (FOWT), and plays nicely with Tailwind CSS v4.

**Decision**: Use a CSS class (`dark`) on the `<html>` element to gate dark styles, toggled by a small initialization script injected into `<head>` before the React bundle loads.

**Rationale**:
- **No FOWT**: The inline script runs synchronously before any paint, reading `localStorage` and setting the class before the browser renders anything. A CSS media-query-only approach would flash light mode first on dark-preferring users until React hydrates.
- **Explicit user control**: A class toggle lets the user's saved preference override `prefers-color-scheme`, which is the correct UX for a tool people will use all day.
- **Tailwind integration**: Tailwind v4's `darkMode: 'class'` config generates `dark:` variants that apply when the class is present — zero extra CSS-in-JS overhead.
- **Framework-agnostic**: The class lives on `<html>`, so any component tree can read it without prop drilling or context.

**Alternatives considered**: CSS `prefers-color-scheme` only (no user override), `data-theme` attribute (works but less idiomatic with Tailwind), Zustand-driven class toggle (requires hydration before applying).

---

## ADR-002: CSS custom properties for theming

**Status**: Accepted
**Context**: The app uses a rich color system for agent roles, status indicators, severity levels, and UI chrome. These colors need to be consistent across components and easy to update.

**Decision**: Define all semantic colors as CSS custom properties (variables) on `:root` and the `.dark` selector, then reference them in Tailwind config and component styles.

**Rationale**:
- **Single source of truth**: Change `--color-agent-running` once and every component using it updates automatically — no grep-and-replace across TSX files.
- **Dynamic theming**: CSS variables respond to the `.dark` class switch instantly without re-rendering any React components. The browser handles it.
- **Design token alignment**: Variables like `--color-critical`, `--color-notable`, `--color-routine` map 1:1 to the three-tier message classification system, making the relationship explicit.
- **Composability**: Tailwind's `theme()` function can consume the variables, giving us the full Tailwind utility class system on top of our semantic tokens.

**Alternatives considered**: Hardcoded Tailwind color classes (fragile, theme-blind), CSS-in-JS runtime injection (adds bundle weight and runtime cost), separate light/dark class sets (doubles the CSS).

---

## ADR-003: SQLite over PostgreSQL

**Status**: Accepted
**Context**: Flightdeck needs to persist agent conversations, decisions, activity logs, and DAG tasks. The server runs locally as a CLI tool (`npx @flightdeck-ai/flightdeck`), not on a cloud host.

**Decision**: Use SQLite with WAL mode via Drizzle ORM, tuned with pragmas: `busy_timeout=5000`, `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`.

**Rationale**:
- **Zero-infrastructure install**: A user running `npx @flightdeck-ai/flightdeck` should not need to have PostgreSQL running. SQLite is embedded in the process — no separate server, no connection strings, no Docker.
- **WAL mode provides concurrency**: Write-Ahead Logging allows concurrent reads alongside a single writer, which matches the access pattern (many agents reading, one process writing batched activity).
- **Sufficient scale**: A local project session generates thousands of rows, not millions. SQLite handles this comfortably. The `busy_timeout` pragma prevents write-contention errors under the batched-write pattern.
- **Drizzle ORM portability**: If a team deployment scenario ever requires PostgreSQL, Drizzle's dialect system allows migrating with minimal schema changes — the SQL is largely compatible.
- **Simplicity of deployment**: The database is a single file at `~/.flightdeck/crew.db`, trivially copyable, inspectable with any SQLite browser, and deletable to reset state.

**Alternatives considered**: PostgreSQL (requires external server), PGlite (browser-only), LevelDB (no SQL, harder to query), in-memory only (no persistence).

---

## ADR-004: EventPipeline architecture

**Status**: Accepted
**Context**: As the system grew, more cross-cutting reactions were needed: run tests after a commit, log a summary when a task completes, send a webhook when an agent fails. Wiring these directly into command handlers created tangled dependencies.

**Decision**: Implement an `EventPipeline` — a typed event bus where command handlers emit domain events (`agent.committed`, `task.completed`, `agent.failed`) and reactive handlers subscribe to them independently.

**Rationale**:
- **Decoupling**: The `COMMIT` command handler emits `agent.committed` and returns. It does not know or care that a CI runner might trigger, a webhook might fire, or an activity entry gets written. Each concern registers its own handler.
- **Testability**: Handlers can be tested in isolation by emitting mock events — no need to construct the full command execution path.
- **Extensibility**: Adding a new reaction (e.g. "notify the lead when any agent crashes") requires adding one handler, not modifying existing command code.
- **Typed events**: TypedEmitter enforces that event payloads match their declared shapes at compile time, catching integration bugs before runtime.

**Alternatives considered**: Direct method calls (tight coupling, hard to extend), Pub/Sub with string events only (no type safety), Redux-style reducers (overkill for a server-side event system).

---

## ADR-005: Command decomposition into modules

**Status**: Accepted
**Context**: The `CommandDispatcher` originally handled all ACP commands in a single large file. As commands grew to 30+, the file exceeded 800 lines and was difficult to navigate and test.

**Decision**: Split command handling into domain-grouped modules: `AgentCommands`, `AgentLifecycle`, `CommCommands`, `TaskCommands`, `CoordCommands`, `SystemCommands`, `DeferredCommands`, `TimerCommands`, `CapabilityCommands`, and others. The `CommandDispatcher` becomes a thin router that parses Unicode bracket syntax and delegates.

**Rationale**:
- **Cognitive load**: Developers working on agent coordination don't need to read messaging code. Module boundaries match mental models.
- **Parallel development**: Multiple agents on the team can work on different command modules without merge conflicts in a single file.
- **Focused tests**: Each module has its own test file. `AgentCommands.test.ts` tests agent lifecycle; it doesn't need to mock the group chat registry.
- **Discoverability**: New engineers looking for "how does LOCK_FILE work?" can go directly to `CoordCommands.ts` rather than searching a monolithic file.

**Alternatives considered**: Single file with regions/comments (common but doesn't enforce boundaries), class-per-command (over-engineered, too many files), command pattern objects (adds abstraction without benefit at this scale).

---

## ADR-006: Capability injection over role mutation

**Status**: Accepted
**Context**: Agents accumulate expertise as they work — a developer who has touched `packages/server/src/api.ts` repeatedly has domain knowledge that should be reusable. The question was how to represent and query this: mutate the agent's role definition, or track capabilities separately.

**Decision**: Implement a `CapabilityRegistry` that stores acquired capabilities (file paths, technologies, keywords, domains) keyed by agent ID. The agent's role definition is immutable; capabilities are injected at query time via `AgentMatcher`.

**Rationale**:
- **Role immutability**: Roles are shared definitions used to spawn new agents. Mutating a role to add capabilities from one instance would corrupt the template for future spawns.
- **Queryability**: A separate registry supports rich queries (`find agents with TypeScript + React experience who are idle`) without scanning role objects.
- **Garbage collection**: When an agent is terminated, its capabilities are removed from the registry cleanly. If capabilities lived on the role, they'd be hard to scope to a session.
- **Retrospective analysis**: The capability registry provides data for the performance leaderboard and smart agent matching — it's a queryable knowledge graph, not just a tag list.
- **Capability injection pattern**: At delegation time, the system can inform a new agent "you've been matched because of your expertise in X" — this is only possible if capabilities are tracked independently.

**Alternatives considered**: Role tags mutated per session (pollutes shared role definitions), agent metadata field (works but no rich query support), in-memory only without registry (not queryable across agents).

---

## ADR-007: Smart Agent Matching

**Status**: Accepted  
**Context**: When delegating tasks, the lead needs to pick the best available agent. Manual selection is error-prone in large teams.

**Decision**: Implement `AgentMatcher` with a 6-signal scoring system: role fit, capability overlap, current load, performance history, context pressure, and recency of related work.

**Rationale**:
- **Multi-signal**: No single metric reliably predicts the best agent. Combining 6 signals produces better matches than any individual heuristic.
- **Queryable**: Returns ranked candidates with scores, allowing the lead to understand *why* an agent was recommended.
- **Performance feedback loop**: Historical performance scores feed back into future matching, creating a virtuous cycle.
- **Load balancing**: Context pressure and current-task signals prevent overloading high-performing agents.

**Alternatives considered**: Round-robin (ignores specialization), random with role filter (ignores performance), manual selection only (doesn't scale).

---

## ADR-008: Webhook Manager with HMAC signatures

**Status**: Accepted  
**Context**: External systems (CI/CD, Slack, custom dashboards) need to react to Flightdeck events without polling.

**Decision**: Implement `WebhookManager` with configurable URL endpoints, event filters, HMAC-SHA256 signature verification, and retry with exponential backoff.

**Rationale**:
- **Security**: HMAC signatures prevent replay attacks and verify payload integrity — critical when webhooks trigger CI pipelines.
- **EventPipeline integration**: Webhooks subscribe to the same typed events as internal handlers, ensuring consistency.
- **Reliability**: Exponential backoff with configurable max retries handles transient endpoint failures gracefully.
- **Selective**: Event filters let users subscribe only to events they care about (e.g., `task.completed`, `agent.failed`).

**Alternatives considered**: Polling API (high latency, wasteful), SSE (one-directional, requires persistent connection), plain HTTP POST without HMAC (insecure).

---

## ADR-009: Context Window Compression

**Status**: Accepted  
**Context**: Long-running agents accumulate large message histories that approach context window limits, degrading performance and eventually causing failures.

**Decision**: Implement `ContextCompressor` that batch-summarizes older messages when context pressure exceeds 80%, preserving recent messages verbatim while compressing older history into summaries.

**Rationale**:
- **Progressive compression**: Only compresses when needed, preserving full fidelity for recent context.
- **Batch summarization**: Groups related messages before summarizing, maintaining coherence.
- **Token accounting**: Tracks compression ratio and reports savings for the Token Economics panel.
- **Non-destructive**: Original messages are retained in the activity ledger; compression only affects the agent's active context.

**Alternatives considered**: Hard truncation (loses important early context), no compression with restart (loses all context), sliding window (arbitrary cutoff ignores message importance).

---

## ADR-010: Crash Forensics

**Status**: Accepted  
**Context**: When agents fail, the error information was scattered across logs, WebSocket events, and terminal output. Debugging required manually correlating multiple data sources.

**Decision**: Implement `CrashForensics` that captures structured crash reports with last N messages, environment snapshot, stack traces, and timing information. Reports are stored in-memory with an API endpoint.

**Rationale**:
- **Structured capture**: Every crash produces a consistent report object, eliminating ad-hoc log scraping.
- **Context preservation**: Captures the agent's last messages and active task at crash time — the most useful debugging information.
- **API accessible**: Reports available via `/coordination/crash-reports` for programmatic access and UI display.
- **Auto-retry integration**: Crash reports feed into the `RetryManager` to determine if a task should be retried or escalated.

**Alternatives considered**: Log-only approach (hard to query), external crash reporting service (requires internet access, adds dependency), manual investigation only (doesn't scale with team size).

---

## ADR-011: Report Generator (HTML + Markdown)

**Status**: Accepted  
**Context**: Users need to share session results with stakeholders who don't have access to the Flightdeck UI.

**Decision**: Implement `ReportGenerator` that produces both HTML and Markdown session reports with summary statistics, task completion details, decision log, and token usage breakdown.

**Rationale**:
- **Dual format**: HTML for rich rendering (can be opened in any browser), Markdown for GitHub/GitLab integration.
- **Self-contained**: HTML reports embed all styles inline — no external dependencies.
- **Data aggregation**: Pulls from ActivityLedger, DecisionLog, TaskDAG, and TokenEconomics to produce a comprehensive view.
- **Exportable**: Available via API endpoint for CI integration or scheduled generation.

**Alternatives considered**: PDF generation (requires heavy dependencies like Puppeteer), UI-only reports (not shareable), raw JSON export (not human-readable).

---

## ADR-012: Knowledge Transfer across projects

**Status**: Accepted  
**Context**: Agents rediscover the same patterns and solutions across projects. Knowledge gained in one session should be reusable.

**Decision**: Implement `KnowledgeTransfer` that captures and indexes reusable knowledge (patterns, solutions, anti-patterns) with relevance scoring for cross-project retrieval.

**Rationale**:
- **Institutional memory**: Unlike individual agent context (lost on termination), knowledge persists across sessions and projects.
- **Relevance scoring**: Knowledge items are matched to new tasks using keyword and capability overlap, surfacing only applicable knowledge.
- **Automatic capture**: Key outcomes (successful patterns, review feedback, architectural decisions) are captured without manual curation.
- **Brief injection**: Retrieved knowledge is injected into agent context at delegation time, providing a head start on familiar problems.

**Alternatives considered**: Manual documentation only (agents won't read it consistently), shared prompt prefix (static, not task-relevant), full session replay (too expensive, mostly noise).
