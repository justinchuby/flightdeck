# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - Unreleased

### Added

#### Multi-CLI Provider Support

- **6 provider presets** — Built-in configurations for Copilot, Gemini CLI, OpenCode, Cursor, Codex, and Claude. Each preset defines binary path, transport mode, ACP version, environment variables, and capability flags.
- **Cross-CLI model resolver** — 4-step resolution: tier alias → native passthrough → cross-provider equivalence mapping → fallback. Standard/fast/premium tier aliases work across all providers.
- **Claude SDK adapter** — Direct in-process adapter via `@anthropic-ai/claude-code` SDK with native session resume. Two-layer session ID (Flightdeck UUID immediate, SDK session ID async). Dynamic SDK loading with graceful fallback.
- **Unified adapter factory** — `createAdapterForProvider()` with `resolveBackend()` (acp/claude-sdk/copilot-sdk) and `buildStartOptions()`. Single entry point for all agent spawning regardless of CLI provider.
- **Role file writers** — Per-provider role file generation for agent identity injection.

#### Agent Server Architecture (Two-Process Model)

- **Agent server entry point** — `AgentServer` class with message dispatch for spawn, terminate, prompt, cancel, list, subscribe, shutdown, configure. Orphan self-termination timer (12h default). PID file management.
- **ForkTransport** — Orchestrator-side transport using `child_process.fork()` IPC. Detached child survives orchestrator restarts. State machine: disconnected → connecting → connected → reconnecting.
- **ForkListener** — Agent server-side listener with dual IPC + TCP modes. IPC auto-created from `process.send`; TCP on localhost with port file for reconnection.
- **TCP reconnection auth** — 256-bit token, 5s timeout, `timingSafeEqual` validation. IPC connections skip auth. Token stored in `agent-server.token` file.
- **Health monitoring** — 3-state machine (connected → degraded → disconnected) with configurable ping intervals and thresholds. ForkListener auto-responds to pings.
- **AgentServerClient** — Client SDK with auto-reconnect, event subscription with `lastSeenEventId` cursor-based replay, and request timeout management.
- **Agent migration** — All agent spawning moved from orchestrator to agent server. `AgentManager` refactored to use IPC via `ServerClientBridge`.
- **State persistence** — Write-on-mutation with self-recovery. Orchestrator reconciliation on reconnect.

#### Knowledge System

- **KnowledgeStore with FTS5** — Full-text search backed by SQLite FTS5 with 4-tier memory categories (core, procedural, semantic, episodic).
- **Hybrid search with RRF fusion** — Reciprocal Rank Fusion combining FTS5 and semantic similarity for best-of-both retrieval.
- **Token-budgeted injection** — Knowledge injected into agent prompts within configurable token budgets, with prompt injection defense at the write boundary.
- **Training capture** — Records agent corrections and learning events for team knowledge accumulation.
- **Session knowledge extraction** — Automatic extraction of reusable knowledge from session transcripts.
- **Identity protection** — Shared memory with access controls preventing cross-agent identity leakage.

#### Portable Teams

- **Team export bundles** — Versioned `.flightdeck-team/` directory with manifest, per-agent configs, knowledge by category, and training history. SHA-256 integrity checksums. Selective export by agents or knowledge categories.
- **Team import with validation** — 5-phase validation (format, version, integrity, size, conflicts). Conflict strategies: agent (rename/skip/overwrite), knowledge (keep_both/prefer_import/prefer_existing/skip). Dry-run mode.
- **Team REST API** — POST export, POST import, GET list, GET team details. Rate-limited write endpoints.
- **Team management UI** — Consolidated Team page with roster, agent profiles, health dashboard, and lifecycle controls (retire/clone/retrain with confirmations).

#### Multi-Team / Multi-Project

- **`(projectId, teamId)` scoping** — Human-readable project IDs with collision-resistant generation. DB migration adds `team_id` to agent_roster, active_delegations, and dag_tasks with backward-compatible defaults.
- **Storage architecture** — `SyncEngine` for cross-device state synchronization, `StorageManager` for structured persistence.

#### UI

- **Projects panel** — Project management and selection interface.
- **Knowledge panel** — Browse, search, and manage knowledge entries across categories.
- **Agent Server panel** — Real-time status, agent list with expand/collapse, lifecycle controls (stop server, terminate agents) with confirmation dialogs. Renamed from DaemonPanel to AgentServerPanel.
- **Team Health page** — Status cards, mass failure alerts, polling-based live updates.
- **Agent Lifecycle modal** — Retire, clone, and retrain agents with confirmation workflows.

#### Research & Design Documents

- **Agent server architecture doc** — Two-process model design covering transport layer, reconnection, state persistence, and portable teams.
- **Multi-CLI ACP research** — Compatibility matrix for 6 CLI tools with ACP protocol analysis.
- **Claude agent-sdk comparison** — Evaluation of direct SDK integration vs. subprocess approach.

#### Knowledge Pipeline Integration

- **KnowledgeInjector wired into AgentManager.spawn()** — Agents receive project knowledge on startup with 4-category priority and 1,200-token budget.
- **SessionKnowledgeExtractor** — Automatic extraction of decisions, patterns, and error resolutions from agent sessions on exit.
- **CollectiveMemory** — Wired into DI container for cross-agent shared memory.
- **SkillsLoader** — Reads `.github/skills/` SKILL.md files and injects into agent prompts with token budget and truncation.
- **AgentReconciliation** — Auto-runs on WebSocket reconnect to sync agent state.
- **E2E integration tests** — Full knowledge loop verified with AgentManager + SkillsLoader integration (16 tests).

#### SDK Adapter Enhancements

- **CopilotSdkAdapter** — Native adapter via `@github/copilot-sdk` JSON-RPC with explicit session resume (`client.resumeSession()`).
- **Lazy dynamic imports** — All 3 SDK adapters converted to `import()` so the server compiles and starts without any SDK installed. SDKs load only when the adapter is configured.
- **AcpAdapter unit tests** — Comprehensive test suite added (59 tests).
- **Connection timeouts** — All SDK adapters now have configurable connection timeouts.

#### Telegram Integration

- **TelegramBot** — Core bot implementation with grammY framework.
- **NotificationBatcher** — 5-second debounce batching for grouped message delivery.
- **IntegrationRouter** — Deterministic message routing from agent events to external channels.
- **Challenge-response authentication** — Session binding security for all Telegram REST endpoints.
- **Settings UI panel** — Configure Telegram bot token and chat ID from the web interface.
- **Security hardening** — 4-layer prompt injection sanitization, deny-all on empty allowlist, token masking in logs, retry queue persistence.

#### Home Dashboard

- **5-section layout** — Active Projects, Decisions Made, Decisions Needing Approval, User Action Required, and Progress/Milestones.
- **Compact stats** — Grouped work items with failed task indicators and relative timestamps.
- **Attention API** — Wired to `GET /attention` API with client-side fallback when server is unavailable.

#### Interactive Kanban Board

- **Drag-and-drop** — Status transitions via `@dnd-kit` with validation (prevents invalid moves like done→running).
- **Context menu** — Right-click actions: Retry, Pause, Resume, Skip, Force Ready.
- **Scope switcher** — Toggle between global (all projects) and per-project task views.
- **Add Task form** — Create tasks directly from the board with title, description, and priority.
- **Load More pagination** — Paginated task loading for large backlogs.
- **Visual polish** — Agent avatar on card face, time-in-status display, filter bar, stale badge, emerald done column, auto-collapse done tasks.
- **116 tests** across the TaskQueue module — DnD interaction, form, filter, DAG graph, Gantt, and critical path tests.

#### AttentionBar

- **3 escalation states** — Green (all clear), yellow (needs attention), red (action required). Persistent system-wide component.
- **WebSocket push** — Replaced 10-second polling with server-pushed signals for <3s latency.
- **Connection-lost indicator** — Visual feedback when the WebSocket connection drops.
- **Trust Dial integration** — Escalation sensitivity adjusts with the user's oversight level.

#### Trust Dial

- **3-level oversight** — Detailed (all notifications, expanded cards), Standard (exceptions only, balanced density), Minimal (action-required only, compact cards).
- **Per-project overrides** — Override the global oversight level for individual projects.
- **Toast notification gating** — Notifications filtered by Trust Dial level (AC-16.5).

#### Catch-Up Banner

- **"While you were away" summary** — Slide-down banner summarizing tasks completed, decisions pending, and failures encountered.
- **Smart thresholds** — Triggers after ≥5 events accumulate; shows failed task count with direct navigation button.

#### Backend APIs (Kanban + Attention)

- **`GET /tasks`** — Global task query with scope, status, role, and agent filters plus `limit`/`offset` pagination.
- **`GET /attention`** — Attention items with escalation level for AttentionBar.
- **`PATCH /tasks/:id/status`** — Drag-and-drop status transitions with validation.
- **`PATCH /tasks/:id/priority`** — Priority reordering.
- **`POST /tasks`** — Create tasks from the Kanban board.

#### Project Design Tab

- **File browser + Markdown preview** — Browse project files and preview Markdown documents directly in the project view.

#### Navigation & UX

- **Navigation store** — Zustand-based navigation state management tracking active project, tab, history, and badge counts.
- **Recent projects** — Quick-access list of recent projects in the sidebar.
- **New Project button** — Create projects directly from the sidebar.
- **Breadcrumb navigation** — Contextual breadcrumb trail showing current location within the project hierarchy.
- **Tab state persistence** — Active tab selection saved per project in localStorage; restored on return.
- **Keyboard shortcuts** — Alt+1–5 to switch between project tabs.
- **Page transition animations** — Smooth transitions between pages; respects `prefers-reduced-motion`.
- **Mobile tab layout** — Touch-scrollable tab bar for narrow viewports.
- **Home empty state** — Onboarding guide shown when no projects exist.

#### Task Management

- **In-review status** — New `in_review` task status with valid state transitions (running→in_review→done).
- **Task override tracking** — `overridden_by` column in DAG tasks links superseding tasks to their predecessors.
- **Soft-delete on RESET_DAG** — Tasks archived with `archivedAt` timestamp instead of deleted. Show/hide archived toggle in KanbanBoard. Restore via `PATCH /tasks/:leadId/:taskId/unarchive`.

#### Knowledge & Skills

- **CollectiveMemory write path** — `remember()` and `recall()` wired into agent lifecycle for persistent cross-session memory.
- **Skills hot-reload** — `fs.watch` on `.github/skills/` directory; new or updated skills injected without server restart.
- **PlaybookLibrary** — Apply playbook templates directly to project creation API.

#### Infrastructure

- **Telegram rate limiting** — Challenge verification endpoint rate-limited to 5 requests per minute per chatId.
- **Token usage chart** — Restored token economics visualization on the project overview.

### Changed

- **Daemon removal** — Removed ~7,400 lines of unnecessary daemon code after agent server migration. Daemon concept replaced by two-process agent server architecture.
- **Frontend route rename** — `/daemon` → `/agent-server`, component `DaemonPanel` → `AgentServerPanel`, sidebar label updated.
- **KanbanBoard decomposition** — Refactored 1,114-line monolith into 6 focused files: `KanbanColumn`, `TaskCard`, `FilterBar`, `AddTaskForm`, `kanbanConstants`, `KanbanBoard`.
- **NotificationBridge → NotificationBatcher** — Renamed for clarity; batches notifications with 5s debounce window.
- **IntegrationAgent → IntegrationRouter** — Renamed to reflect its routing responsibility (not an agent).
- **`formatRelativeTime` extraction** — Moved from inline implementations to a shared utility used across all timestamp displays.
- **PulseStrip cleanup** — Removed pending decisions badge (moved to AttentionBar).
- **LeadDashboard decomposition** — Two rounds of extraction reduced 1,965→795 LOC across 10 modules: `InputComposer`, `ChatMessages`, `SidebarTabs`, `DecisionPanel`, `ChatRenderers`, `TeamStatusContent`, `NewProjectModal`, `ProgressDetailModal`, `useLeadWebSocket`, `useDragResize`.
- **Locale-aware relative dates** — Replaced manual relative time strings with `Intl.RelativeTimeFormat` for proper localization.
- **0 TypeScript errors** — Both `packages/server` and `packages/web` compile cleanly with `tsc --noEmit`.

### Fixed

- **Agent server fork crash** — `ForkTransport.fork()` defaulted `execArgv` to `[]`, stripping tsx's `--import` loader args. Child process couldn't load `.ts` files in dev mode. Fix: `filterExecArgv()` inherits parent's `process.execArgv` while stripping `--watch` flags. Also pipes child stderr for crash diagnostics.
- **Agent server routes not mounted** — `agentServerRoutes()` was never imported in `routes/index.ts`. Added import and mount.
- **Path traversal protection** — Shared `validatePathWithinDir()` utility handles null bytes, `../`, absolute paths, and directory boundary edge cases.
- **Prompt injection defense** — Write-boundary sanitization in `KnowledgeStore.put()` prevents stored injection attacks.
- **`resumeAll()` race condition** — Fixed concurrent resume causing duplicate agent instances.
- **HybridSearchEngine fetchLimit cap** — Prevents unbounded query expansion.
- **ModelResolver silent fallback** — Now warns when falling back to default tier model instead of silently substituting.
- **`projectId` collision** — Increased randomness from 2→3 bytes to reduce collision probability.

#### Security (6 Critical Merge-Blockers)

- **C-1: Telegram prompt injection** — 4-layer sanitization (displayName, content, structured JSON envelope) prevents malicious input from reaching agent prompts.
- **C-2: REST API authentication** — Challenge-response flow for session binding on all Telegram endpoints. Unauthenticated requests rejected.
- **C-3: Async shutdown data loss** — All shutdown handlers now awaited in sequence; prevents data loss from premature process exit.
- **C-4: Task pagination** — `GET /tasks` now requires `limit`/`offset` parameters; unbounded queries blocked.
- **C-5: Default-deny allowlist** — Changed from default-allow to default-deny when allowlist is empty. Prevents accidental open access.
- **C-6: Permission handler race condition** — Fixed in all 3 SDK adapters (Claude, Copilot, ACP). Concurrent permission requests no longer corrupt handler state.

#### Bug Fixes

- **DAG task lifecycle on agent termination** — Running tasks assigned to a terminated agent now transition to `failed` via `failTask()`. Dependent tasks unblock correctly.
- **Keyboard scrolling** — All page containers now accept keyboard focus (`tabIndex={0}`) for arrow-key and Page Up/Down scrolling.
- **11 stale test assertions** — Updated to match current component rendering after UI refactors.
- **CollapsibleSystemEvents fallback** — Added 📨 fallback rendering for unrecognized system event types.
- **DM notification rendering** — Restored orange collapsible styling for incoming direct message notifications.
- **AttentionBar hook cleanup** — Fixed memory leak from uncleared intervals in `useAttentionItems` hook.
- **N+1 DAG progress fetches** — Parallelized with `Promise.all` to eliminate sequential API calls.
- **NotificationBatcher event listener leak** — Event listeners now removed on `stop()`.
- **AcpConnection stale mocks** — Fixed test mocks that referenced removed API surface.
- **SkillsLoader token budget** — `formatForInjection()` now truncates skills that exceed the token budget.
- **Responsive panel overflow** — Fixed sidebar and panel overflow on narrow viewports with `min-h-0` constraints.
- **Team route** — `/team` now renders standalone TeamRoster instead of redirecting to a project.
- **Session tab height** — Chat and sidebar now use full viewport height in the session view.
- **Async graceful shutdown** — Server shutdown awaits all handlers in sequence to prevent data loss.

### Stats

- 120+ commits in this session
- 69 DAG tasks created, 60+ completed
- 1,351 web tests passing, 372 adapter tests passing
- 160 acceptance criteria defined (78 P0)
- 6 critical security issues found and resolved
- 13 agents active at peak concurrency
- 0 TypeScript compilation errors (server + web)

## [0.4.0] - Unreleased

### Added

#### Architecture (8 recommendations from cross-project synthesis)

- **R1: DI Container** — `createContainer()` factory builds ~35 services in 6 dependency tiers with lifecycle shutdown. `index.ts` reduced from 411→146 lines. `apiRouter()` takes single `AppContext` object instead of 35 positional params.
- **R2: Shared Types Package** (`@flightdeck/shared`) — 11 Zod domain schemas, 46 server→client + 8 client→server WS event types as discriminated unions. Fixed 3 type drift bugs (Delegation missing `cancelled`/`terminated` statuses, DagTask missing `projectId`, ChatGroup missing `archived`). CI grep-based drift prevention.
- **R3: Coordination Reorg** — 46 files reorganized into 16 domain subdirectories with barrel exports. Root barrel re-exports everything for backward compat.
- **R4: Governance Hooks** — `GovernancePipeline` with 6 built-in hooks (file write guard, shell command blocklist, commit validation, rate limiting). Pre/post hook pipeline intercepts agent actions programmatically.
- **R5: Structured Logging** (Phases 1-2) — Replaced custom logger with pino. JSON output in production, pretty-printed in dev. AsyncLocalStorage context injection at 5 entry points — 85% of logs auto-get `agentId`/`projectId`/`role`.
- **R9: ACP Adapter** — `@agentclientprotocol/sdk` now imported in exactly 1 file (`adapters/AcpAdapter.ts`). `AgentAdapter` interface enables `MockAdapter` for testing.
- **R12: Secret Redaction** — Boundary redaction at WS broadcast, DB writes, logs, and `Agent.toJSON()`. 12 regex pattern categories (AWS, GitHub, OpenAI, Anthropic, JWT, PEM, Bearer, connection strings).
- **R15: Hot-Reload Config** — Configuration changes take effect without server restart, preserving active agent state. File watcher with mtime+size+hash change detection.

#### Performance

- **SQLite tuning** — Cache size 64→256MB, WAL monitoring with auto-checkpoint (PASSIVE mode)
- **Activity log auto-pruning** — 7-day retention + 50k row cap prevents unbounded growth
- **FileLockRegistry transaction safety** — Lock operations wrapped in transactions

#### Research & Documentation

- **Cross-project synthesis** — Analyzed 4 external repos (Symphony, Paperclip, Squad, Edict) producing 19 prioritized recommendations, 9 anti-patterns, and 6 cross-cutting themes
- **Agent Host Daemon design doc** — 1,466 lines covering architecture, security (14 threat mitigations), cross-platform support (Windows/Mac/Linux), UX design, quality bars
- **Multi-CLI ACP research** — Gemini CLI, OpenCode, Cursor CLI, Codex, Claude agent-sdk all compatible via existing AgentAdapter
- **Claude agent-sdk comparison report**
- **8 implementation specs** — Detailed specs for R1, R2, R3, R4, R5, R9, R12, R15 with migration strategies, CI verification, and integration notes

### Changed

- **R5 Phase 3-4** (in progress) — Structured logging call-site migration: 193 calls across 50 files converting to pino structured API
- **Docs reorganization** — All documentation moved to `docs/` directory (`research/`, `specs/`, `reference/`)
- **Project rename** — `ai-crew` → `flightdeck` throughout all documentation
- **Synthesis report v3** — 8/19 recommendations marked as implemented with status tracking

### Fixed

- **SQLite WAL checkpoint** — Changed from TRUNCATE to PASSIVE mode (prevents blocking concurrent reads)
- **FileLockRegistry** — `lock:acquired` event no longer fires on TTL refresh (was causing spurious UI updates)

## [0.3.2] - 2026-03-07

### Fixed

- **DAG duplicate detection** — Raised similarity thresholds (0.6→0.8, 0.7→0.85), added role filter to prevent false positives when agents share domain vocabulary. Borderline matches (0.8–0.95) now create tasks with a warning instead of silently linking.
- **DAG "already done" UX** — `COMPLETE_TASK` on an already-completed task now returns a friendly message instead of an error.
- **DAG dependency inference** — Review tasks now find ALL matching-role dependencies (not just the most recent). Added "review all" pattern and plural role name normalization.
- **DAG coverage metric** — `TASK_STATUS` now shows what percentage of active agents have corresponding DAG tasks, with warnings for untracked agents.
- **DAG idle agent info** — "Newly ready" notifications now include available idle agents with matching roles.
- **dagTaskId warning** — `DELEGATE`/`CREATE_AGENT` without explicit `dagTaskId` now warns when auto-linker has to guess.
- **Live indicator contrast** — Timeline Live button now readable in light mode with proper Tailwind dark: variants.
- **Database purge** — Fixed 7 missing tables in cleanup, sub-agent conversation orphaning, and "All data" date filter bypass.

## [0.3.1] - 2026-03-06

### Added

- **DAG edge highlighting** — hovering or clicking a task card highlights connected edges and dims unconnected ones; click to pin, Escape to unpin
- **Dynamic port allocation** — server auto-retries on EADDRINUSE (up to 10 ports), prints `FLIGHTDECK_PORT=NNNN` to stdout for discovery
- **Sequential dev launcher** (`scripts/dev.mjs`) — `npm run dev` starts Express first, captures the actual port, then starts Vite with the correct proxy target; multiple instances can run simultaneously
- **Commit sign-off convention** — all agent commits now include agent ID, role, and model name
- **Historical data on all pages** — Overview, Timeline, Canvas, Mission Control, Agents, Dashboard, and Tasks now load data from REST API when no live WebSocket agents are present. No more empty states for existing projects.
- **Unified project tabs** — Shared `<ProjectTabs>` component replaces inconsistent dropdowns/tabs. Used on Overview, Timeline, Canvas, and Mission Control with live-agent indicator dots.
- **Cumulative Flow diagram** — Replaced Task Burndown chart with stacked area chart showing created/in-progress/completed task counts over time.
- **Session Replay improvements** — Sticky scrubber bar (always visible at bottom), 4× default speed (was 1×), auto-switch to replay mode for historical sessions.
- **Timeline zoom & scroll** — Decoupled vertical/horizontal scroll axes. Ctrl+wheel zooms time axis, Shift+wheel pans horizontally. Arrow keys navigate lanes. +/−/Fit zoom buttons.
- **Timeline horizontal overflow** — Swim lanes scale with agent count (min 80px per lane). Horizontal scrollbar appears when agents exceed viewport width.
- **Chat virtualization** — `react-virtuoso` virtual scrolling for large message histories. Pinned user message banner. Grouped sequential messages from same sender.
- **PulseStrip polish** — Empty health indicators hidden. Badges link to /agents page. Client-side React Router navigation (no page reload).
- **Milestone filtering** — Milestones panel shows only progress reports, task completions, decisions, commits, and errors. Filtered out agent spawn/termination/delegation noise.
- **PROGRESS event pipeline** — Lead's PROGRESS reports now logged to activity ledger as `progress_update`, mapped to keyframes, and displayed in Milestones panel with 📊 icon.
- **Token estimation fallback** — Token tab estimates usage from `outputPreview` text (~4 chars/token) when agents don't report actual token counts. Shown with `~` prefix and `(est.)` suffix.
- **Milestone text wrapping** — Multi-line milestone labels with `line-clamp-2` and full-text tooltip. Removed backend 80-char truncation.
- **Data retention settings** — Data Management section in Settings with storage stats and cleanup by age (7d/30d/90d/all).
- **Group chat history** — Group chats persist per project and load from REST API for historical sessions.
- **Skill reference files** — 5 `.copilot/skills/` files documenting dev patterns, common bugs, user preferences, infrastructure, and testing patterns.
- **Comprehensive Timeline tests** — 45 tests covering scroll axis separation, zoom controls, drag-to-pan, horizontal overflow, keyboard navigation, lane layout, and replay controls.
- **Decision dismiss/ignore** — Dismiss clears decisions without notifying the lead agent. Works in individual decision UI, batch approval sidebar, keyboard shortcut ('d'), and mobile swipe-up gesture.

### Changed

- **Token display** — Removed monetary cost estimates. Token counts shown as estimates with `~` prefix and `(est.)` suffix.
- **Default replay speed** — Changed from 1× to 4× for faster session review.
- **Milestone curation** — Filtered from all system events to meaningful progress markers only.
- **Sidebar nav cleanup** — Removed agent count badge from Team sidebar tab (distracting)
- Vite proxy target is now configurable via `SERVER_PORT` env var instead of hardcoded `:3001`

### Fixed

- **Timeline scrub display for untitled projects** — SessionReplay team-resolution fallback now correctly resolves agents when project has no title
- **ProjectTabs/OverviewPage project identity** — Tab IDs and replay fetches now use project UUID instead of agent UUID, fixing timeline data mismatch for untitled projects
- **Project creation always assigns valid ID** — All spawn paths (lead/start, POST /agents, resume) now guarantee a project UUID; AgentManager has 4-layer fallback
- **Auto-DAG stuck pending tasks** — DAG engine now checks dependency satisfaction at task creation time, not only reactively; fixes tasks with pre-completed deps getting stuck
- **Ghost 'not in DAG' warning** — Fixed false warning firing on every completed task (#104)
- **Message segmentation** — Replaced heuristic-based bubble breaks with deterministic `agent:response_start` server signal for reliable message grouping
- **COMMIT command silent file exclusion** — Now warns about untracked files in related packages when new files aren't locked
- **Spawn mock arg count in CI** — Updated api.integration.test.ts for 9-arg spawn signature after project creation fix
- **Stale MobileApprovalStack test** — Updated Skip → Dismiss assertion after dismiss feature rename
- **Gantt chart vertical alignment** — fixed SVG viewBox stretching, time axis overlap with first task row, and container height formula for small task counts
- **Array sanitization in Community Playbooks** — secrets inside arrays now detected and stripped
- **PredictionService expired accuracy** — expired predictions marked instead of removed, counted correctly in accuracy stats

### Removed

- **Session score stars** — Removed subjective star ratings from Analytics session table.
- **Model Effectiveness chart** — Removed from Analytics (can't fairly compare models across varying task sizes).
- **Role Contribution chart** — Removed from Analytics (not a meaningful metric).
- **Predictions feature** — Removed from frontend (agent stall/cost/context handled automatically by the system).
- **Cost estimates** — Removed dollar amounts from token display; token counts only.
- Tool call activity cards from agent chat panel (redundant with inline activity messages)
- `.flightdeck/port` file mechanism replaced with stdout-based port discovery

---

## Phase 2 — Observability & Control

Ten features giving leads full visibility and control over their agent fleet.

- **Batch Approval** — confirm/reject multiple decisions at once with keyword-based classification, intent rules, and auto-approval
- **Token Pressure Gauge** — burn rate tracking per agent with tiered context pressure alerts (70/85/95%) and actionable compact/restart/dismiss
- **Diff Preview** — git diff scoped to each agent's locked files with 5s TTL cache
- **Focus Mode** — aggregated agent view (output, activities, decisions, file locks, diff) via single endpoint
- **Session Replay** — world-state reconstruction at any timestamp with keyframes, event range queries, and scrubber UI
- **Communication Flow Viz** — agent-to-agent message graph with edge aggregation, type filtering, and stats
- **Budget Enforcement** — session/project budget limits with warning/alert/pause events and dedup
- **The Pulse** — persistent ambient status strip showing fleet health at a glance
- **Canvas Lite** — spatial agent graph with ReactFlow for visual crew topology
- **Smart Sidebar** — collapsible 7-item navigation with live badges

## Phase 3 — Understanding & Intelligence

Thirteen features adding learning, analysis, and self-healing capabilities.

- **Playbook Library** — CRUD playbook service with apply/save, library UI with cards and picker
- **Catch-Up Summary** — idle detection + activity aggregation since last interaction
- **Intent Rules V2** — structured conditions, role scopes, priority ordering, effectiveness tracking, trust presets (conservative/moderate/autonomous)
- **Debate Detection** — pattern-based disagreement detection with confidence scoring and thread grouping
- **Shareable Session Replays** — token-based share links with expiry, access tracking, and revocation
- **Cross-Session Analytics** — overview dashboard with cost trends, role contributions, model effectiveness, session comparison
- **Overview Page Redesign** — temporal visualizations (progress timeline, task burndown, cost curve, agent heatmap, milestones)
- **Self-Healing Crews** — automatic crash recovery with handoff briefing generation, review, retry logic, and metrics
- **Agent Handoff Briefings** — 6 trigger types, quality scoring, session-end archival, review/edit/deliver lifecycle
- **Notification Channels** — 5 channel types (desktop, slack, discord, email, webhook) with quiet hours, HMAC signing, and tier routing
- **Tech Debt Fixes** — cache cleanup intervals, budget event dedup, error handling, WS throttle + heartbeat
- **CatchUp URL Alias** — cleaner REST endpoint for catch-up banner
- **RecoveryService Hardening** — dedup guard for same-agent recoveries + budget gate

## Phase 4 — Platform & Automation

Ten features transforming Flightdeck into a full automation platform.

- **NL Crew Control** — natural language command engine with 30 patterns, 3-pass matching, preview/execute/undo lifecycle
- **Command Palette V2** — fuzzy search across commands, navigation, and agents with keyboard shortcuts
- **Smart Onboarding** — server-persisted progress tracking with contextual suggestions
- **Predictive Intelligence** — 6 prediction types (context exhaustion, cost overrun, agent stall, task duration, completion estimate, file conflict) with linear extrapolation and accuracy tracking
- **Workflow Automation** — 12 event triggers × 13 action types with AND conditions, cooldown/throttling, 12 templates, dry-run
- **GitHub Integration** — PAT auth, PR creation (draft default), CI status polling, commit→task linking
- **Conflict Detection** — 4 detection levels (same directory, import overlap, lock contention, branch divergence) with graduated severity and resolution suggestions
- **Custom Role Builder** — visual builder with emoji, color, prompt templates, model preference, and dry-run testing
- **Community Playbooks** — publish/browse/search/rate/fork with version tracking, featured gating, and privacy guardrails (secret stripping)
- **Mobile PWA** — responsive layout with mobile navigation and touch-optimized controls

## Infrastructure

### Performance
- React.lazy() code splitting for all route components
- Granular Zustand selectors replacing destructured store access
- WebSocket agent:text batching (100ms flush interval)
- ActivityLedger query limits and timeline data caching
- Unbounded Map caps on AlertEngine, FileDependencyGraph, ComplexityMonitor
- DebateDetector N+1 query elimination
- Token pricing constants extracted to shared modules

### Accessibility
- `<main>` landmark wrapper around route content
- Skip-to-content link (sr-only, visible on focus)
- ARIA labels on Settings inputs and dialog semantics
- Role and status attributes on shared components

### Polish
- **Motion system** — unified animation tokens with 3 tiers (micro/standard/dramatic), 4 easings, prefers-reduced-motion support
- **Chart theme** — dark/light color tokens for all visx charts replacing 15+ hardcoded hex colors
- **Shared components** — EmptyState, SkeletonCard, ErrorPage integrated across 13 panels
- LeadDashboard split into focused subcomponent files

### Testing
- **3,617 tests** across server (2,751) and web (866)
- Coverage audit identified and filled 3 gaps: SessionRetro, rateLimit middleware, AgentEvents
- Phase 4 alone: 267 backend tests across 5 cycles

---

## [0.2.0] - 2026-03-05

### Added

- CHANGELOG.md to track project changes
- **Image/file attachment support** — upload images via drag-and-drop, clipboard paste, or file selection
  - `useAttachments` hook for attachment state management (add, remove, clear)
  - `AttachmentBar` component with thumbnail previews, displayed as a floating tooltip above the input
  - `DropOverlay` component for full-pane drag indicator
  - `useFileDrop` hook extended with `handlePaste` for clipboard image support
  - ACP `ContentBlock[]` support in `AcpConnection` for sending images to agents
  - Server-side `buildContentBlocks()` with `supportsImages` check (graceful text fallback)
  - Full integration in both LeadDashboard and ChatPanel
  - `MAX_IMAGE_SIZE` guard to prevent memory bomb on large file drops
- Full-window drop zones — drag-and-drop targets now cover the entire chat area, not just the input strip
- **Multiproject isolation** — CREW_UPDATE, heartbeat data, and message commands are now project-scoped
- **Per-project model config** — wire model config enforcement into agent spawning with caching and integration tests
- `RESUME_TASK` command and allow `COMPLETE_TASK` on paused tasks
- **`REOPEN_TASK` command** — reverts a completed (done) task back to ready/pending based on dependency state; clears completedAt and assignedAgentId; warns if dependents already started
- Restore sibling sub-lead visibility in `CREW_UPDATE`
- Bezier edges in DAG visualization for clearer connectivity
- Hide incoming DMs in main chat feed and auto-scroll agent reports
- Hide outgoing DMs and make incoming messages collapsible
- @mention rendering in user messages, system messages, and agent comms panel
- Google eng-practices reference added to code-reviewer role
- '@ to mention files' hint in lead chat placeholder
- **Drag & drop images hint** — chat input placeholder now mentions drag & drop image support

### Changed

- Bumped all package versions from 0.1.0 to 0.2.0
- Bumped lucide-react ^0.575.0 → ^0.577.0 and postcss ^8.5.6 → ^8.5.8
- Global JSON body parser limit raised from 1MB to 10MB to support image attachments
- Renamed 'OTHER PROJECT AGENTS' to 'OTHER TEAM MEMBERS' for clarity
- **Updated default model allowlist** — updated DEFAULT_MODEL_CONFIG for 7 roles: developer, architect, code-reviewer, critical-reviewer, readability-reviewer, tech-writer, secretary
- Comprehensive documentation refresh across README, docs site, and presentation slides
  - Standardized command field names across all documentation
  - Added Agent role, `SPAWN_AGENT`, `ACTIVITY`, `LIST_TEMPLATES`, `APPLY_TEMPLATE`, `DECOMPOSE_TASK` to README
  - Fixed command field names to match Zod schemas
  - Documented WebSocket subscription architecture (agent vs UI)
  - Polished README for new-user experience
  - Updated repo URL and installation instructions (global install pattern)
  - Updated footer to note AI-assisted documentation

### Fixed

- **`COMPLETE_TASK` now works on `ready` tasks** — previously only accepted running/paused; also fixed stale error messages to use `formatTransitionError()`
- **`resumeTask` dep-check alignment** — aligned resumeTask's dependency checking with the canonical `resolveReady` pattern; missing/deleted dependencies are now correctly treated as satisfied
- **Attachment schema** — `attachmentSchema` was referenced before definition (ReferenceError); fixed `const` ordering
- **Body parser dead code** — route-level `json({ limit })` middleware was shadowed by global parser
- **Attachment schema security** — mimeType restricted to `image/png`, `image/jpeg`, `image/gif`, `image/webp`; data field capped at ~10MB base64
- `clearAttachments()` now only runs on successful send, not after failed fetch
- **Project isolation** — project-scoped resolution for `AGENT_MESSAGE` and all message commands
- `addDependency()` guard against regressing running/done tasks to blocked status
- Dedup threshold raised to 0.7 to reduce false task matches
- Interrupt button now always works regardless of text input state
- Interrupt separator and DM/group message visibility in UI
- Subscribe to all agent text events and fetch message history on connect
- Prevent DM notifications from fragmenting streaming agent responses
- MentionText null guard and sidebar tab visibility toggle
- Show all 8 sidebar tabs by default; improve model config tab visibility
- Right-align model name in sidebar Team tab when no activity text
- Prevent agent mention tooltip from being occluded by sidebar
- @user mention styling: brighter highlights in dark mode, font-medium and light-mode text refinements
- @mentions now render inline instead of block-level
- Make project creation dialog scrollable and apply liquid glass to settings dropdown
- Re-apply overwritten UI fixes (dialog scroll, glass-dropdown, collapsed model config)
- CLI: use correct working directory and handle browser spawn errors
- Use `which` instead of `command` builtin; guard against double exit
- Double-bracket command parsing in agent chat pane
- Graceful spawn error handling with preserved error details
- ISO 8601 UTC timestamps (Z suffix) for all datetime defaults
- Gantt chart scroll padding and timezone-safe timestamp parsing
- Timeline legend visibility and timestamp formatting
- Exit code normalization, scroll fix, and shell safety improvements
- ContextRefresher test mocks updated for project scoping

## [0.1.0] - 2026-03-01

### Added

- Initial release of Flightdeck
- Multi-agent orchestration with 13 specialized roles
- Real-time web UI with Lead Dashboard, Agents View, and Settings
- Agent Client Protocol (ACP) support
- Task DAG with auto-dependency inference
- TIDE Protocol (Trust-Informed Dynamic Escalation)
- Timeline visualization with swim-lane display
- Chat groups with auto-creation for multi-agent coordination
- File locking and crash recovery coordination
- Mission Control with 8 configurable panels
- SQLite database with Drizzle ORM
- VitePress documentation site
