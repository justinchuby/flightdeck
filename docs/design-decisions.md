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

**Built-in roles:**
| Role | Focus | Default Model |
|------|-------|---------------|
| Architect | System design, architecture decisions | Claude Opus 4.6 |
| Code Reviewer | Readability, maintainability, patterns | Gemini 3 Pro |
| Critical Reviewer | Security, performance, edge cases | Claude Sonnet 4.6 |
| Developer | Code writing and modification | Claude Opus 4.6 |
| Product Manager | User needs, product quality, UX | GPT-5.2 Codex |
| Technical Writer | Docs, API design review | GPT-5.2 |
| Designer | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| Generalist | Cross-disciplinary problem solving | Claude Opus 4.6 |
| Radical Thinker | Challenge assumptions, unconventional ideas | GPT-5.3 Codex |

**Rationale:** Specialization improves output quality — an agent told "you are a code reviewer" catches more bugs than a general-purpose agent. Roles also enable smart task routing (assign review tasks to reviewers, not developers).

**Custom roles:** Users can create custom roles with their own system prompts, colors, and icons via the Settings UI. Built-in roles cannot be deleted.

**Skills format:** Agents record reusable knowledge in `.github/skills/<skill-name>/SKILL.md` with YAML frontmatter (name, description) and Markdown body. Skills are auto-loaded by Copilot CLI when relevant.

## 5. Autonomous Sub-Agent Spawning

**Decision:** Agents can spawn sub-agents without user approval.

**Rationale:** A PM agent analyzing a task should be able to delegate to specialists (spawn a reviewer, spawn a developer) without requiring the user to manually create each agent. This enables emergent team behavior.

**Safeguards:**
- Concurrency limit prevents runaway spawning
- Parent-child relationships are tracked
- All spawns are logged to the activity ledger
- Sub-agents inherit the crew context manifest

**Protocol:** Agents emit `<!-- SPAWN_AGENT {"roleId": "reviewer", "taskId": "..."} -->` which is detected by regex in `AgentManager`.

## 6. HTML Comment Protocol for PTY Mode

**Decision:** Use HTML comment patterns (`<!-- COMMAND {...} -->`) for structured communication in PTY mode.

**Rationale:**
- Invisible in normal terminal rendering
- Unambiguous — won't collide with regular agent output
- JSON payload is flexible and extensible
- Easy to parse with simple regex

**Commands:** `SPAWN_AGENT`, `LOCK_REQUEST`, `LOCK_RELEASE`, `ACTIVITY`, `AGENT_MESSAGE`, `CREW_CONTEXT`, `CREW_UPDATE`

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

**Unit tests (76 cases, 8 suites):**
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
