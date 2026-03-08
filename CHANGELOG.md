# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
