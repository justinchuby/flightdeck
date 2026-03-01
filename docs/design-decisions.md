# Design Decisions

Key architectural choices and their rationale.

## 1. ACP over PTY as Default Communication

**Decision:** Use the Agent Client Protocol (ACP) as the primary communication mode, with PTY as a fallback.

**Rationale:** ACP provides structured JSON-RPC messaging instead of raw terminal I/O. This gives us:
- Typed session management (initialize → newSession → prompt)
- Tool call visibility with status lifecycle (pending → in_progress → completed)
- Plan reporting for progress tracking
- Permission gating for file writes and terminal commands
- Proper cancellation support

PTY is retained for backward compatibility and for scenarios where full terminal fidelity is needed.

**Trade-off:** ACP requires Copilot CLI to support `--acp` flag. Older CLI versions fall back to PTY.

**Configuration:** `AGENT_MODE=acp|pty` environment variable, default `acp`.

## 2. Dual-Mode Agent Architecture

**Decision:** Each `Agent` instance supports both ACP and PTY modes, selected at spawn time.

**Rationale:** Rather than separate classes, a single Agent with mode branching keeps the API surface consistent. The `AgentManager`, `TaskQueue`, and UI don't need to know which mode an agent uses — they interact through the same interface (`write()`, `onData()`, `toJSON()`).

**Implementation:** `start()` delegates to `startAcp()` or `startPty()`. User input calls `prompt()` in ACP mode vs raw `pty.write()` in PTY mode.

## 3. SQLite with WAL Mode

**Decision:** Single-file SQLite database with Write-Ahead Logging.

**Rationale:**
- Zero external dependencies (no PostgreSQL/Redis to configure)
- WAL mode enables concurrent reads while writing (important since multiple agents generate events simultaneously)
- Good enough performance for the expected scale (≤20 concurrent agents)
- File-based, easy to backup or reset

**Tables:** `tasks`, `task_deps`, `conversations`, `messages`, `roles`, `settings`, `file_locks`, `activity_log`

**Trade-off:** Not suitable for distributed deployment. If multi-server becomes necessary, would migrate to PostgreSQL.

## 4. Role-Based Agent Specialization

**Decision:** Agents are assigned roles with system prompts that constrain their behavior.

**Built-in roles (12):**
| Role | Focus | Default Model |
|------|-------|---------------|
| Project Lead | Orchestration, delegation, team coordination | Claude Opus 4.6 |
| Developer | Code writing and modification | Claude Opus 4.6 |
| Architect | System design, architecture decisions | Claude Opus 4.6 |
| Code Reviewer | Readability, maintainability, patterns | Gemini 3 Pro |
| Critical Reviewer | Security, performance, edge cases | Gemini 3 Pro |
| Product Manager | User needs, product quality, UX | GPT-5.3 Codex |
| Technical Writer | Docs, API design review | GPT-5.2 |
| Designer | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| Generalist | Cross-disciplinary problem solving | Claude Opus 4.6 |
| Radical Thinker | Challenge assumptions, unconventional ideas | Gemini 3 Pro |
| Secretary | Plan tracking, status reports, session summaries | GPT-4.1 |
| QA Tester | Test strategy, quality assurance, coverage analysis | Claude Sonnet 4.6 |

**Rationale:** Specialization improves output quality — an agent told "you are a code reviewer" catches more bugs than a general-purpose agent. Roles also enable smart task routing (assign review tasks to reviewers, not developers).

**Custom roles:** Users can create custom roles with their own system prompts, colors, and icons via the Settings UI. Built-in roles cannot be deleted.

**Persistent role instructions:** Each role generates an `.agent.md` file in `~/.copilot/agents/ai-crew-<role-id>.agent.md`. These files are loaded by Copilot CLI via the `--agent` flag, ensuring role instructions survive context compression. The system prompt is also included in the initial message as a belt-and-suspenders approach.

**Skills format:** Agents record reusable knowledge in `.github/skills/<skill-name>/SKILL.md` with YAML frontmatter (name, description) and Markdown body. Skills are auto-loaded by Copilot CLI when relevant.

## 5. Lead-Controlled Agent Creation

**Decision:** Only the Project Lead can create agents (`CREATE_AGENT`) and assign tasks (`DELEGATE`). Specialist agents cannot spawn sub-agents.

**Rationale:** Centralizing agent creation in the lead provides:
- Explicit control over which models are used for each agent
- Clear parent-child relationships for accountability
- Prevention of runaway spawning by specialists
- The lead can assemble diverse model combinations for different tasks

**Safeguards:**
- Concurrency limit prevents runaway spawning
- Parent-child relationships are tracked
- All spawns are logged to the activity ledger
- Sub-agents inherit the crew context manifest
- Non-lead agents that attempt `SPAWN_AGENT` or `CREATE_AGENT` get an error message

**Protocol:** The lead creates agents with `<!-- CREATE_AGENT {"role": "developer", "model": "...", "task": "..."} -->` and assigns tasks to existing agents with `<!-- DELEGATE {"to": "agent-id", "task": "..."} -->`. Both are detected by regex in `AgentManager`.

## 6. HTML Comment Protocol for PTY Mode

**Decision:** Use HTML comment patterns (`<!-- COMMAND {...} -->`) for structured communication in PTY mode.

**Rationale:**
- Invisible in normal terminal rendering
- Unambiguous — won't collide with regular agent output
- JSON payload is flexible and extensible
- Easy to parse with simple regex

**Commands:** `CREATE_AGENT`, `DELEGATE`, `LOCK_REQUEST`, `LOCK_RELEASE`, `ACTIVITY`, `AGENT_MESSAGE`, `BROADCAST`, `DECISION`, `PROGRESS`, `QUERY_CREW`

**Trade-off:** Relies on the AI correctly formatting these patterns. In ACP mode, this is replaced by structured protocol messages.

## 7. WebSocket for Real-Time Updates

**Decision:** WebSocket for bidirectional real-time communication between server and UI.

**Rationale:**
- Terminal output needs to stream in real time (character by character for PTY)
- User input needs low-latency delivery to agents
- Events (agent spawned, task updated, lock acquired) need instant broadcast
- SSE is unidirectional; polling adds latency; WebSocket is the natural fit

**Reconnection:** Client auto-reconnects after 2 seconds on disconnect.

**Subscription model:** Clients subscribe to specific agent output streams. `*` subscribes to all agents. On subscribe, the server sends buffered output history.

## 8. Configurable Concurrency at Runtime

**Decision:** Max concurrent agents is adjustable via UI slider (1–50) without restart.

**Rationale:** The right number of agents depends on the task, machine resources, and API rate limits. Users need to tune this dynamically — start with 2 agents, scale to 10 when tackling a large feature, back down when reviewing.

**Enforcement:** Checked at spawn time in `AgentManager`. Task auto-spawn respects the limit.

## 9. File Locking with TTL and Glob Support

**Decision:** Pessimistic file locking with automatic expiration.

**Rationale:**
- **Pessimistic** (lock before edit) rather than optimistic (merge after) because AI agents can't reliably resolve merge conflicts
- **TTL** (5 min default) prevents deadlocks from crashed or forgotten agents
- **Glob patterns** (`src/auth/*`) allow locking a directory without enumerating every file

**Trade-off:** False positives from overly broad globs. Mitigation: agents are instructed to lock specific files, not directories, when possible.

## 10. Permission Gating — Autopilot vs Manual Mode

**Decision:** Permission behavior depends on the agent's autopilot mode:
- **Autopilot ON** (spawned by a lead, or user-selected): tool calls are immediately auto-approved. No user interaction needed.
- **Autopilot OFF** (manually spawned without autopilot): tool calls show a permission dialog. If the user doesn't respond within 60 seconds, the tool call is **auto-denied** (cancelled) for safety.

**Rationale:**
- Agents managed by a lead are trusted to operate autonomously — the lead already approved the task
- Manually spawned agents without autopilot should default to a safe, supervised mode
- Auto-deny after timeout prevents unattended agents from making unexpected changes
- Users can still approve individual tool calls or enable autopilot to opt into full autonomy

**Trade-off:** Non-autopilot agents will stall if the user is AFK and not approving tool calls. This is intentional — if you want unattended operation, enable autopilot.

## 11. Task Auto-Assignment with Auto-Spawn

**Decision:** Creating a task automatically assigns it to an available agent, spawning one if needed.

**Rationale:** The queue should not require manual intervention. If you create a task, you want it done — the system should find or create an agent to do it.

**Assignment priority:**
1. Find a running agent with no task, matching the required role
2. Spawn a new agent with the task's assigned role (or `developer` as default)
3. Skip if concurrency limit reached (task stays queued)

**Trade-off:** Auto-spawning agents consumes resources. Mitigated by the concurrency limit.

## 12. Monorepo with npm Workspaces

**Decision:** Single repository with `packages/server` and `packages/web` workspaces.

**Rationale:**
- Shared TypeScript config and tooling
- Atomic commits across frontend and backend
- Single `npm install` sets up everything
- Vite proxy eliminates CORS issues in development

**Structure:**
```
ai-crew/
├── packages/server/    # Express + ws + node-pty + ACP
├── packages/web/       # React + Vite + Tailwind + xterm.js
├── docs/               # Architecture documentation
├── tsconfig.base.json  # Shared TS config
└── package.json        # Workspace root
```

## 13. Testing Strategy

**Decision:** Two-tier testing: Vitest unit tests for server logic, Playwright E2E tests for UI workflows.

**Unit tests (110 cases, 10 suites):**
- Run in-memory SQLite (`:memory:`) for test isolation — no shared state between tests
- Mock external dependencies (AgentManager stubs via `vi.fn()`) to test subsystems in isolation
- Suites: FileLockRegistry, ActivityLedger, RoleRegistry, TaskQueue, MessageBus, ConversationStore, ContextRefresher, AgentManager output parsing

**E2E tests (67+ cases, 9 suites):**
- Playwright with Chromium, dual webServer config (server:3001, web:5173)
- Tests use `page.request` for API calls to avoid dependency on Copilot CLI binary
- Terminal panel tests use conditional checks since Copilot CLI may not be installed
- Suites: smoke, agent dashboard, task queue, settings, terminal panel, coordination, task lifecycle, multi-agent coordination, error states

**Rationale:** Unit tests catch logic regressions fast (<3s). E2E tests validate the full stack integration including WebSocket events, API responses, and UI state. Together they cover both correctness and user workflows.

**Trade-off:** E2E tests are slower and require both servers running. Mitigated by Playwright's webServer config which starts them automatically.

## 14. Drizzle ORM (Replacing Raw SQL)

**Decision:** Migrate from hand-written SQL strings to Drizzle ORM with a typed schema.

**Rationale:**
- Raw SQL queries (`db.run("INSERT INTO ...")`) offered no compile-time safety — typos in column names or wrong parameter counts silently broke at runtime
- Drizzle provides full TypeScript inference from schema definitions, so every `select()`, `insert()`, and `where()` is type-checked
- Migration files are auto-generated numbered SQL files in `packages/server/drizzle/`, giving a clear audit trail of schema changes
- Drizzle sits on top of `better-sqlite3`, so the underlying driver is unchanged — no performance penalty

**Implementation:**
- Schema defined in `packages/server/src/db/schema.ts` (13 tables)
- `Database` class exposes `public readonly drizzle` property for typed queries
- Legacy `run()`, `get()`, `all()` methods marked `@deprecated` and retained for edge cases during migration
- All new code uses `db.drizzle.select(...)`, `db.drizzle.insert(...)`, etc.

**Trade-off:** Adds a dependency (~50KB). Accepted because the type-safety gains vastly outweigh the bundle cost, and Drizzle is the lightest ORM option for SQLite.

## 15. Typed Event Bus

**Decision:** Replace raw `EventEmitter` with a generic `TypedEmitter<T>` class that enforces event name and payload types at compile time.

**Rationale:**
- `AgentManager` emits 27+ events. With raw `EventEmitter`, it was easy to `emit('agent:spawnd', ...)` (typo) or pass wrong payload shapes — both are silent bugs
- `TypedEmitter<TEvents>` maps each event name to its exact payload type via a TypeScript interface (`AgentManagerEvents`)
- Listeners get full autocomplete and type errors on mismatched handlers

**Implementation:**
- `packages/server/src/utils/TypedEmitter.ts` — wraps Node's `EventEmitter` with generic `emit<K>`, `on<K>`, `off<K>`, `once<K>` methods
- `AgentManager extends TypedEmitter<AgentManagerEvents>` where `AgentManagerEvents` is an interface with 27 event→payload mappings
- Each event maps to a single typed payload object (e.g., `'agent:spawned': { agent: AgentInfo }`)

**Trade-off:** Requires maintaining the event interface alongside the emitting code. Accepted because the event interface also serves as documentation of the system's event catalog.

## 16. Batched Activity Log Writes

**Decision:** Buffer `ActivityLedger` writes in memory and flush to SQLite every 250ms or when the buffer reaches 64 entries, whichever comes first.

**Rationale:**
- During peak activity (agent spawns, multiple lock acquisitions, rapid tool calls), the ledger could see dozens of writes per second
- Individual SQLite inserts under WAL are fast (~0.1ms), but the overhead of many small transactions adds up
- Batching amortizes transaction overhead while keeping write latency imperceptible to users (250ms max delay)

**Implementation:**
- `ActivityLedger` holds an in-memory buffer array
- A `setInterval` timer flushes every 250ms; buffer size check triggers immediate flush at 64 entries
- All read operations (`getRecent`, `getSummary`) call `flush()` first for read-after-write consistency
- `stop()` method flushes remaining entries and clears the timer for graceful shutdown

**Trade-off:** Up to 250ms of data could be lost on an unclean crash. Acceptable because activity log entries are informational, not transactional — the source of truth for tasks and locks is always in SQLite directly.

## 17. SQLite Pragma Optimization

**Decision:** Apply a specific set of SQLite pragmas at database open to optimize for our workload.

**Rationale & pragma choices:**
| Pragma | Value | Why |
|--------|-------|-----|
| `journal_mode = WAL` | Write-Ahead Logging | Concurrent reads during writes; critical for multi-agent workload |
| `synchronous = NORMAL` | Sync on checkpoint only | 10x write speedup vs FULL; acceptable durability (WAL protects against corruption) |
| `busy_timeout = 5000` | 5 second wait | Prevents `SQLITE_BUSY` errors when multiple subsystems write simultaneously |
| `cache_size = -64000` | 64MB page cache | Keeps hot pages (locks, activity, tasks) in memory; negative value = KB |
| `wal_checkpoint(PASSIVE)` | Non-blocking checkpoint | Reclaims WAL space at startup without blocking reads |
| `foreign_keys = ON` | Enforce FK constraints | Ensures referential integrity (e.g., messages reference valid conversations) |

**Trade-off:** `synchronous=NORMAL` trades a small durability window for speed. In the unlikely event of an OS crash (not app crash), the last few WAL frames may be lost. This is acceptable for a development tool.

## 18. Tool Permission Timeout Behavior

**Decision:** Tool permission requests have a 60-second timeout. The timeout behavior depends on autopilot mode:
- **Autopilot ON:** Permissions are auto-approved immediately (timeout never reached).
- **Autopilot OFF:** After 60 seconds without user response, the tool call is **auto-denied** (cancelled).

**Rationale:**
- AI Crew distinguishes between supervised and autonomous operation modes
- Lead-spawned agents run in autopilot by default — they are part of a managed workflow and should proceed without blocking
- Manually spawned agents without autopilot are in supervised mode — the user is expected to be actively watching
- Auto-deny prevents non-autopilot agents from silently modifying files or running commands when the user is away
- This makes the permission dialog a true gatekeeping mechanism for supervised agents, not just a notification

**Trade-off:** Non-autopilot agents require active user attention. Users who want fire-and-forget should enable autopilot explicitly.

## 19. kill → terminate Rename

**Decision:** Rename all agent termination APIs, events, and UI labels from "kill" to "terminate."

**Rationale:**
- "Kill" has violent connotations inappropriate for a professional tool
- "Terminate" is the standard term in process management (SIGTERM, not SIGKILL)
- Consistent terminology across the entire stack: API routes (`/terminate`), WebSocket events (`agent:terminated`), UI buttons ("Terminate"), activity log entries (`agent_terminated`)

**Scope:** 58 changes across 16 files — methods, events, route handlers, UI labels, tests.

## 20. PROGRESS/DAG Consolidation

**Decision:** When a task DAG exists, the `PROGRESS` command automatically reads DAG state and merges it into the progress report.

**Rationale:**
- Before: leads had to issue `PROGRESS` and `QUERY_TASKS` separately to get a complete picture
- After: a single `PROGRESS {"summary": "..."}` auto-attaches DAG status (completed, in_progress, blocked tasks)
- Eliminates redundant commands and reduces token usage
- The secretary agent also receives progress reports for tracking

**Implementation:** `detectProgress()` in `CommandDispatcher.ts` checks for an existing DAG via `taskManager.getDagSnapshot(leadId)` and merges the task lists into the progress object.

## 21. Scoped COMMIT Command

**Decision:** The `COMMIT` command stages only files the agent currently has locked, rather than using `git add -A`.

**Rationale:**
- In multi-agent workflows, several agents may have uncommitted changes in the same repository
- `git add -A` would stage everyone's changes into one agent's commit
- Scoped staging ensures each agent's commit contains only the files they were authorized to modify
- This is enforced server-side by reading the agent's current file locks from `FileLockRegistry`

**Trade-off:** If an agent edits a file without locking it first, the file won't be staged. This is intentional — it encourages proper lock discipline.

## 22. Auto-Group-Creation for Parallel Delegations

**Decision:** When 3+ active delegations from the same lead share a keyword in their task descriptions, automatically create a `{keyword}-team` coordination group.

**Rationale:**
- Parallel work on the same feature benefits from a shared communication channel
- Manually creating groups adds overhead to the lead's workflow
- Keyword extraction (first word >3 chars from task descriptions) is simple but effective
- Group creation is idempotent (`onConflictDoNothing`) — adding a new agent to the same feature simply adds them to the existing group

**Trade-off:** Keyword matching is heuristic. Tasks like "implement auth" and "fix auth tests" would correctly group, but "update documentation for auth" might not if "update" is the first significant word. Acceptable because the lead can always create groups manually for edge cases.

## 23. Timeline Visualization

**Decision:** Swim-lane timeline built with [visx](https://airbnb.io/visx/) for agent activity visualization.

**Rationale:**
- Agents running in parallel need a time-based view — the DAG shows dependencies but not timing
- Swim lanes (one per agent) show when each agent was active, idle, or communicating
- Interactive features: brush time selector for zooming, keyboard navigation (←→ pan, +/- zoom), live auto-scroll mode, role/status/comm-type filtering
- Idle periods shown with hatch patterns to distinguish "doing nothing" from "not yet started"
- Communication links drawn between lanes when agents message each other

**Trade-off:** visx adds bundle weight but is much more flexible than chart libraries for custom timeline rendering.

## 24. Decision Comments (Accept/Reject with Reasons)

**Decision:** Users can provide a text reason when accepting or rejecting an agent's decision.

**Rationale:**
- Simple accept/reject gives the agent no context on *why* it was rejected
- Reason comments are injected back into the agent's context, enabling it to revise its approach
- Optimistic UI — buttons hide immediately on click before server responds, eliminating perceived lag

**Implementation:** The reason is stored in the `decisions` table and included in context refresh messages to the affected agent.

## 25. Group Chat Auto-Archive Lifecycle

**Decision:** Groups are automatically archived when all non-lead members reach terminal status.

**Rationale:**
- As a session progresses, completed groups accumulate and clutter `QUERY_GROUPS` results
- Auto-archive keeps the active group list clean without losing message history
- Archived groups can still be queried directly via the API for post-mortem review
- The `archived` column is a simple boolean flag — no complex state machine needed

**Trade-off:** If a terminated agent is restarted, its groups remain archived. The lead would need to create a new group. This is acceptable because restarted agents often have different context anyway.

## 26. Three-Tier Message Hierarchy

**Decision:** Classify comms messages into Critical, Notable, and Routine tiers using pattern matching, with client-side filter toggles.

**Rationale:**
- The comms feed in a busy session can have hundreds of messages — most are routine lock/status updates
- Classification surfaces what matters: build failures (Critical) vs progress updates (Notable) vs heartbeats (Routine)
- Client-side classification avoids server changes and lets the user override tier visibility instantly
- 23 critical patterns (failures, crashes, blocked, OOM, SIGTERM) and 8 notable patterns (completions, merges, reviews)
- Messages to the lead auto-bump to ≥Notable since they're always relevant

**Trade-off:** Pattern-based classification can misclassify novel messages. Mitigated by defaulting unknown long messages to Notable and providing filter toggles so users always have access to all messages.

## 27. Catch-Up Summary Banner

**Decision:** Show a floating summary banner after 60 seconds of user inactivity, summarizing what happened while they were away.

**Rationale:**
- Users frequently switch to other tabs/apps while agents work; returning to a wall of messages is disorienting
- The banner provides instant context: "3 tasks completed, 1 decision pending (5m old), 12 new messages"
- Uses a snapshot-comparison approach: snapshot counts when active, compare on return
- Only shows when ≥5 items accumulated or decisions are pending (avoids noise for short absences)
- Accessible: `role="status"`, `aria-live="polite"`, keyboard-dismissible

**Trade-off:** The 60-second threshold is a heuristic. Too short = annoying; too long = user already scrolled through messages manually. 60s is a reasonable default.

## 28. Lead Health Header in CREW_UPDATE

**Decision:** Prepend a 2-3 line health summary to every `CREW_UPDATE` context refresh sent to lead agents.

**Rationale:**
- Leads receive long context updates with agent rosters and activity logs, but no synthesized status
- The health header gives the lead instant situational awareness: completion %, fleet status, pending decisions, blocked tasks
- Emoji indicators (✅/⚠️/🔴) enable quick triage without reading the full update
- Follows the "add a lens, don't remove data" principle — raw data is preserved below the header
- Graceful degradation — if no DAG exists, shows only agent/decision counts

**Trade-off:** Adds ~3 lines of tokens to every context refresh. Acceptable because it saves the lead from issuing separate QUERY_TASKS and PROGRESS commands to understand project state.

## 29. Mission Control — Single-Screen Overview

**Decision:** Add a dedicated `/mission-control` page with 8 configurable panels (HealthSummary, AgentFleet, TokenEconomics, AlertsPanel, ActivityFeed, DagMinimap, CommHeatmap, Performance) that answers "how's the project?" in 3 seconds.

**Rationale:**
- The Lead Dashboard is optimized for the lead agent's workflow (chat + decisions); humans need a passive monitoring view
- All data comes from existing Zustand stores — zero new API endpoints required
- Panel layout uses CSS Grid (3×2 on desktop, single-column on mobile) for information density
- Zero-state handling — each panel degrades gracefully when data isn't available yet

**Trade-off:** Another route to maintain. Justified because it serves a fundamentally different use case (monitoring vs. interaction).

## 30. Sub-Lead Delegation

**Decision:** Allow architects (not just leads) to use `CREATE_AGENT` and `DELEGATE` commands.

**Rationale:**
- Complex tasks benefit from hierarchical decomposition — an architect analyzing tech debt may need to spawn helper agents for specific investigations
- Reduces lead bottleneck: architect can spin up 2-3 focused agents without routing through lead
- Guard implemented in `AgentCommands.ts` checks `role === 'lead' || role === 'architect'`
- Created agents are still visible to the lead via `QUERY_CREW` — transparency is preserved

**Trade-off:** Increases coordination complexity. Mitigated by limiting to architect role (not all agents) and maintaining full visibility.

## 31. CommandDispatcher Decomposition

**Decision:** Break the monolithic `CommandDispatcher.ts` (1,738 lines) into a thin router (~193 lines) plus 7 focused modules: `AgentCommands`, `CommCommands`, `TaskCommands`, `CoordCommands`, `SystemCommands`, `DeferredCommands`, `TimerCommands`.

**Rationale:**
- At 1,738 lines, the file was the biggest source of merge conflicts in multi-agent sessions
- Each module owns a command category and has clear dependencies
- The router only does dispatch — no business logic
- Adding a new command now means editing one focused file, not a monolith

**Trade-off:** More files to navigate. Mitigated by predictable naming and one-to-one command-to-module mapping.

## 32. Proactive Alert Engine

**Decision:** Run an `AlertEngine` on a 60-second interval that detects and broadcasts conditions needing attention (stuck agents, context pressure, stale decisions, idle-ready mismatches, duplicate edits).

**Rationale:**
- Agents and humans shouldn't have to poll for problems — the system should surface them proactively
- Five alert types cover the most common multi-agent failure modes
- Ring buffer of 100 alerts in memory (no persistence — alerts are ephemeral by nature)
- WebSocket broadcast (`alert:new`) enables real-time UI updates
- Dedup logic prevents repeated alerts for the same condition

**Trade-off:** 60-second interval is a balance between responsiveness and CPU cost. Configurable if needed.

## 33. Secretary Auto-Refresh

**Decision:** Roles with `receivesStatusUpdates: true` in the RoleRegistry (currently only secretary) automatically receive periodic `CREW_UPDATE` context refreshes.

**Rationale:**
- The secretary role's job is to track project status, but it can only report what it knows
- Without auto-refresh, the secretary's information goes stale between explicit queries
- The `receivesStatusUpdates` flag is a clean role-level opt-in — other roles can be added later
- Refresh interval matches the existing `CREW_UPDATE` cadence

**Trade-off:** Additional token cost for periodic context updates. Justified because the secretary's core value depends on having current information.

## 34. Theme Persistence via Shared Zustand Store

**Decision:** Move theme state from component-local `useState` in `SettingsPanel` to a shared `settingsStore` (Zustand) that persists to `localStorage`.

**Rationale:**
- Theme was previously local state in the Settings panel — changes were lost on navigation and couldn't be accessed by other components
- The Command Palette also needs to toggle theme — a shared store gives both components the same source of truth
- `settingsStore` already existed for sound preferences, so theme state is a natural addition
- Three modes: `'light' | 'dark' | 'system'` where system uses `prefers-color-scheme` media query listener
- The `applyTheme()` helper applies the appropriate class to `<html>` and is called both from the store and the media query listener

**Trade-off:** Adds a zustand store dependency where `useState` would have sufficed for a single component. Justified because theme is genuinely shared state accessed from multiple UI locations.

## 35. Draggable Dashboard Panel Layout

**Decision:** Replace up/down arrow buttons with HTML5 drag-and-drop for Mission Control panel reordering.

**Rationale:**
- Arrow buttons required multiple clicks to move a panel across 8 positions
- Drag-and-drop is the standard UX pattern for list reordering in dashboards
- HTML5 DnD API works without additional dependencies (no `react-beautiful-dnd`)
- Panel config persists to `localStorage` via `useDashboardLayout` hook
- New panels added in code auto-merge into existing user layouts without losing their customizations

**Trade-off:** HTML5 DnD has limited mobile support (no native touch events). Acceptable because AI Crew is primarily a desktop tool.

## 36. Zustand Selector Discipline

**Decision:** Adopt strict rules for zustand store selectors: never return derived objects/arrays from selectors; use module-level empty constants for fallbacks.

**Rationale:**
- Multiple infinite re-render bugs traced to zustand selectors returning new references on every call:
  - `Object.keys(s.projects)` → always new array → `useSyncExternalStore` sees changed state → re-render → repeat
  - `s.foo ?? []` → new `[]` when `foo` is undefined → same infinite loop
  - `useStore()` without selector → subscribes to entire store → any `set()` causes re-render
- These bugs are latent — they only manifest when the subscribed store is updated frequently (e.g., during WebSocket streaming)
- Fix: select stable references from the store, derive keys/filters outside the selector, use `useShallow` for multi-field selections
- Module-level constants (`const EMPTY: T[] = []`) provide stable fallback references

**Trade-off:** Slightly more verbose selector code. Justified because the alternative is invisible infinite-loop bugs that only appear under load.

## 37. App-Level Startup Data Loading

**Decision:** Load active leads and persisted projects into `leadStore` from an `App.tsx` `useEffect` on mount, rather than relying on individual page components.

**Rationale:**
- Previously, `leadStore.projects` was only populated when the user visited the Lead Dashboard
- Mission Control and other pages that depend on lead data showed nothing on first visit
- After server/frontend restart, chat history was lost because no component loaded it
- The App.tsx effect runs regardless of which page the user navigates to first
- Loads active leads from `/api/lead`, pre-fetches message history from `/api/agents/:id/messages`, and loads persisted projects from `/api/projects`

**Trade-off:** Additional API calls on every app mount, even if the user doesn't visit lead-related pages. Acceptable because the calls are lightweight and the data is almost always needed.

## 38. Model Selection Strategy

**Decision:** Use different default models for different roles, with automatic model selection based on task complexity.

**Current defaults (12 built-in roles):**
| Role | Model | Rationale |
|------|-------|-----------|
| Project Lead | Claude Opus 4.6 | Complex orchestration needs premium reasoning |
| Developer | Claude Opus 4.6 | Code generation benefits from large context + reasoning |
| Architect | Claude Opus 4.6 | System design requires deep analysis |
| Code Reviewer | Gemini 3 Pro | Fast, good at pattern recognition |
| Critical Reviewer | Gemini 3 Pro | Security analysis benefits from broad training data |
| Product Manager | GPT-5.3 Codex | Creative thinking + structured output |
| Technical Writer | GPT-5.2 | Documentation generation |
| Designer | Claude Opus 4.6 | Visual reasoning |
| Radical Thinker | Gemini 3 Pro | Novel perspective generation |
| Secretary | GPT-4.1 | Status tracking, low complexity |
| QA Tester | Claude Sonnet 4.6 | Test reasoning, balanced cost |
| Generalist | Claude Opus 4.6 | Needs broad capabilities |

The `ModelSelector` component can override defaults at task assignment time, considering task complexity, agent role, and token budget constraints.

**Trade-off:** Model diversity increases system complexity and makes behavior less predictable. Justified because different models genuinely excel at different tasks, and the cost savings from using cheaper models for simpler tasks are significant.

## 39. Performance Scorecard Metrics

**Decision:** Track 5 agent performance metrics: throughput (tasks/hour), first-pass rate (% accepted without revision), velocity (lines/hour), cost efficiency (tasks/token), and review score (average review rating).

**Rationale:**
- Multi-agent teams need objective measures to identify top performers and bottlenecks
- Metrics drive the smart agent matching system (`AgentMatcher`) — agents with higher scores get assigned similar future tasks
- The leaderboard API (`/coordination/leaderboard`) provides ranked views for the UI
- Metrics are computed from existing activity ledger data — no additional instrumentation needed

**Trade-off:** Metrics can be gamed or misleading (e.g., high throughput ≠ high quality). Mitigated by using multiple metrics and weighting review scores highly.

## 40. Concurrency Limit Increase (20 → 50)

**Decision:** Increase the UI slider maximum for concurrent agents from 20 to 50, matching the server's existing capacity.

**Rationale:**
- The server already supported up to 50 concurrent agents, but the UI artificially limited to 20
- Complex projects with multiple parallel work streams benefit from more agents
- The actual limit depends on the user's API rate limits and machine resources, not a UI cap
- Users can still set lower limits — the slider is just an upper bound

**Trade-off:** More concurrent agents means more API calls, more WebSocket traffic, and more context to track. Users should increase gradually based on their infrastructure capacity.
