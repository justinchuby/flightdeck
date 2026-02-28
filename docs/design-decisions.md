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

**Built-in roles (10):**
| Role | Focus | Default Model |
|------|-------|---------------|
| Developer | Code writing and modification | Claude Opus 4.6 |
| Architect | System design, architecture decisions | Claude Opus 4.6 |
| Code Reviewer | Readability, maintainability, patterns | Gemini 3 Pro |
| Critical Reviewer | Security, performance, edge cases | Claude Sonnet 4.6 |
| Product Manager | User needs, product quality, UX | GPT-5.2 Codex |
| Technical Writer | Docs, API design review | GPT-5.2 |
| Designer | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| Generalist | Cross-disciplinary problem solving | Claude Opus 4.6 |
| Radical Thinker | Challenge assumptions, unconventional ideas | GPT-5.3 Codex |
| Project Lead | Orchestration, delegation, team coordination | Claude Opus 4.6 |

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

**Decision:** Max concurrent agents is adjustable via UI slider (1–20) without restart.

**Rationale:** The right number of agents depends on the task, machine resources, and API rate limits. Users need to tune this dynamically — start with 2 agents, scale to 10 when tackling a large feature, back down when reviewing.

**Enforcement:** Checked at spawn time in `AgentManager`. Task auto-spawn respects the limit.

## 9. File Locking with TTL and Glob Support

**Decision:** Pessimistic file locking with automatic expiration.

**Rationale:**
- **Pessimistic** (lock before edit) rather than optimistic (merge after) because AI agents can't reliably resolve merge conflicts
- **TTL** (5 min default) prevents deadlocks from crashed or forgotten agents
- **Glob patterns** (`src/auth/*`) allow locking a directory without enumerating every file

**Trade-off:** False positives from overly broad globs. Mitigation: agents are instructed to lock specific files, not directories, when possible.

## 10. Permission Gating with Auto-Approve Timeout

**Decision:** Tool calls in ACP mode require user approval, with 60-second auto-approve.

**Rationale:**
- Safety: users should know when agents modify files or run commands
- Practicality: requiring approval for every action would be impractical during long-running tasks
- 60-second auto-approve lets agents proceed if the user is AFK
- "Always allow" option per agent for trusted workflows

**Trade-off:** Auto-approve means agents can act without explicit consent after timeout. Acceptable because the user has already chosen to spawn the agent and assigned it a task.

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

## 18. Tool Auto-Approve for Autonomous Operation

**Decision:** Tool permission requests auto-approve after a 60-second timeout when the user hasn't responded.

**Rationale:**
- AI Crew is designed for autonomous agent operation — a lead delegates work to a team, and agents should be able to proceed without constant human intervention
- Blocking on every file write or terminal command would make multi-agent workflows impractical
- The 60-second window gives the user time to intervene if they're actively watching, while allowing unattended operation
- Users can also set "Always allow" per agent to skip the dialog entirely

**Trade-off:** Agents can modify files and run commands without explicit consent after the timeout. This is an intentional design choice — the user has already opted into autonomous operation by spawning agents and assigning tasks. The permission dialog is a safety net, not a gatekeeping mechanism.
