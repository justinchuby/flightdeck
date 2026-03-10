# Paperclip — Architectural Research Report

**Repository**: `/Users/justinc/Documents/GitHub/paperclip`
**Report Author**: Architect Agent (cc29bb0d)
**Date**: 2026-03-07

---

## 1. What the Project Does

**Paperclip is an open-source orchestration control plane for "zero-human companies" — organizations staffed entirely by AI agents.** It is *not* an agent framework; it's the management layer that sits above agents, providing the organizational infrastructure (org charts, budgets, goals, governance, ticketing) that makes a collection of autonomous agents operate as a coherent company.

### Core Proposition

| Layer | Responsibility |
|---|---|
| **Control Plane** (Paperclip) | Agent registry, org chart, task assignment, budget enforcement, goal alignment, heartbeat monitoring, approval gates, audit logging |
| **Execution Services** (Adapters) | Agents run externally (Claude Code, Codex, Cursor, OpenClaw, etc.) and report into the control plane via heartbeats |

Key value props:
- **Multi-company isolation**: One deployment runs unlimited companies with complete data isolation
- **Bring Your Own Agent**: Adapter system supports Claude Code, Codex, OpenClaw, Cursor, OpenCode, generic process, and HTTP webhook agents
- **Heartbeat-driven execution**: Agents wake on schedule, check for work, execute, and report back
- **Governance**: Board approval gates for agent hiring, budget enforcement with hard-stop auto-pause, config revision tracking with rollback
- **Cost tracking**: Per-agent monthly budgets in cents, automatic agent pausing when budget exhausted

---

## 2. Architecture and Key Design Patterns

### 2.1 Monorepo Structure (pnpm workspaces)

```
paperclip/
├── server/          → Express REST API + orchestration services (@paperclipai/server)
├── ui/              → React + Vite SPA board UI (@paperclipai/ui)
├── cli/             → Commander-based CLI (@paperclipai/cli)
├── packages/
│   ├── db/          → Drizzle ORM schema, migrations, DB client (@paperclipai/db)
│   ├── shared/      → Shared types, constants, validators, API paths (@paperclipai/shared)
│   ├── adapter-utils/ → Adapter interface types (no drizzle dep) (@paperclipai/adapter-utils)
│   └── adapters/    → Per-agent adapter packages
│       ├── claude-local/    → Claude Code adapter
│       ├── codex-local/     → OpenAI Codex adapter
│       ├── cursor-local/    → Cursor adapter
│       ├── openclaw/        → OpenClaw (cloud) adapter
│       └── opencode-local/  → OpenCode adapter
├── doc/             → Product specs, goal docs, developing guide
├── skills/          → Skill documents (injectable runtime context for agents)
└── scripts/         → Dev runner, build, smoke tests
```

### 2.2 Server Architecture

**Express 5 + TypeScript** with a clean layered architecture:

```
HTTP Request
  → Middleware (logger, hostname guard, actor auth, board mutation guard)
    → Routes (thin HTTP handlers, validation)
      → Services (business logic, DB operations)
        → Drizzle ORM → PostgreSQL
```

**Key patterns:**

- **Factory-function services**: Every service is a function that takes `db: Db` and returns an object of methods. Example: `goalService(db)` returns `{ list, getById, create, update, remove }`. This is clean, testable, and avoids class inheritance.

- **Actor-based auth middleware**: Every request gets an `req.actor` object resolved from bearer tokens (agent API keys or JWTs) or session cookies. Actor types: `board`, `agent`, `none`. This is the single point of identity resolution.

- **Company-scoped everything**: Every domain entity (agents, issues, goals, approvals, costs) has a `companyId` foreign key. Routes enforce company boundaries. This is the multi-tenancy model.

- **Live events via in-process EventEmitter + WebSocket**: `publishLiveEvent()` emits to a Node.js EventEmitter keyed by companyId. WebSocket clients subscribe per-company. Simple, no external message broker needed.

### 2.3 Database Architecture

**PostgreSQL** (embedded PGlite for dev, external Postgres for production)

**35 schema tables** defined via Drizzle ORM, including:

| Domain | Tables |
|---|---|
| Companies | `companies`, `company_memberships`, `company_secrets`, `company_secret_versions` |
| Agents | `agents`, `agent_api_keys`, `agent_config_revisions`, `agent_runtime_state`, `agent_task_sessions`, `agent_wakeup_requests` |
| Work | `issues`, `issue_comments`, `issue_labels`, `issue_attachments`, `issue_approvals`, `issue_read_states` |
| Goals | `goals`, `project_goals` |
| Projects | `projects`, `project_workspaces` |
| Execution | `heartbeat_runs`, `heartbeat_run_events` |
| Governance | `approvals`, `approval_comments` |
| Observability | `cost_events`, `activity_log` |
| Auth | `auth_users`, `auth_sessions`, `auth_accounts`, `invites`, `join_requests`, `instance_user_roles` |
| Assets | `assets`, `labels` |

**26 migration files** managed via Drizzle Kit with a custom migration runner that handles the journal and checksums.

### 2.4 Adapter System (Plugin Architecture)

The adapter system is the most architecturally significant pattern. It's a **strategy pattern** with a unified interface:

```typescript
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;
  sessionCodec?: AdapterSessionCodec;
  onHireApproved?: (payload, adapterConfig) => Promise<HireApprovedHookResult>;
  models?: AdapterModel[];
  listModels?: () => Promise<AdapterModel[]>;
  agentConfigurationDoc?: string;
}
```

Each adapter package has a **three-surface architecture**:
- `src/server/` — Server-side execution logic (spawning processes, managing sessions)
- `src/ui/` — UI-specific rendering (stdout line parsers, transcript formatters)
- `src/cli/` — CLI-specific output formatting
- `src/index.ts` — Shared config docs, model lists

The registry (`server/src/adapters/registry.ts`) maps adapter types to modules and falls back to the generic `process` adapter for unknown types.

**Currently supported adapters**: `claude_local`, `codex_local`, `cursor`, `openclaw`, `opencode_local`, `process` (generic), `http` (webhook)

### 2.5 Heartbeat System

The heartbeat is the core execution model. Agents don't run continuously — they **wake on schedule** (or on-demand triggers like task assignment, @-mentions):

1. Scheduler finds agents with due heartbeats
2. Creates a `heartbeat_run` record (atomic checkout)
3. Resolves workspace (project workspace → task session → agent home fallback)
4. Resolves session params (session continuity across heartbeats)
5. Calls adapter's `execute()` with full context
6. Streams logs via `onLog` callback → WebSocket live events
7. Records usage, exit code, session state, cost events
8. Updates agent runtime state

**Concurrency control**: Per-agent `startLocksByAgent` map using promise chaining prevents double-starts. Configurable `maxConcurrentRuns` per agent (1-10).

### 2.6 UI Architecture

**React 19 + Vite + TailwindCSS v4 + Radix UI + TanStack Query**

- **Company-prefixed routing**: All board routes are under `/:companyPrefix/...` (e.g., `/PAP/dashboard`). This enables the multi-company URL scheme.
- **API client layer**: Thin fetch-based clients in `ui/src/api/` that mirror the server routes.
- **Real-time updates**: WebSocket connection per-company for live event streaming.
- **Pages**: Dashboard, Agents, Projects, Issues, Goals, Approvals, Costs, Activity, Inbox, OrgChart, CompanySettings.
- **Component library**: shadcn/ui-style components (Radix + CVA + Tailwind).

### 2.7 CLI Architecture

**Commander.js** with two command families:
1. **Setup/Admin**: `onboard`, `doctor`, `configure`, `run`, `env`, `db:backup`, `auth bootstrap-ceo`
2. **Client operations**: `issue list/create/update`, `agent list`, `approval list/approve`, `dashboard get`, etc.

Supports **context profiles** for storing API base URL and company ID defaults.

---

## 3. Notable Techniques or Innovations

### 3.1 Embedded PostgreSQL for Zero-Config Dev

The most impressive DX decision: leaving `DATABASE_URL` unset triggers **embedded PGlite** (via `embedded-postgres` npm package). This means `pnpm dev` "just works" — no Docker, no Postgres install. Data persists at `~/.paperclip/instances/<id>/db`. For production, set `DATABASE_URL` and it connects to external Postgres. This eliminates the #1 developer friction point.

### 3.2 Agent Config Revisions with Rollback

Every agent config change is recorded as a revision in `agent_config_revisions`, storing `beforeConfig` and `afterConfig` snapshots, `changedKeys`, and attribution (`createdByAgentId`/`createdByUserId`). This enables safe rollback of bad configuration changes and full audit trail.

### 3.3 Atomic Issue Checkout

The `checkoutRunId` and `executionRunId` fields on issues, combined with `executionLockedAt`, implement an **atomic checkout model** — preventing double-assignment and ensuring exactly one agent works on an issue at a time. This is enforced at the database level.

### 3.4 Runtime Skill Injection

The `skills/` directory contains injectable markdown documents (e.g., `skills/paperclip/SKILL.md`) that agents receive at runtime. This allows agents to learn Paperclip-specific workflows and context without retraining — a form of dynamic context injection.

### 3.5 Secret Reference Binding System

Instead of storing raw API keys in agent configs, the system uses a **secret reference binding** pattern:
- Secrets are stored encrypted in `company_secrets` / `company_secret_versions`
- Agent configs reference secrets via `{ type: "secret_ref", secretId: "..." }`
- A `redaction.ts` module automatically detects and redacts sensitive keys (API keys, tokens, JWTs) in activity logs and events
- Strict mode forces all sensitive env vars to use secret references

### 3.6 Company Portability (Export/Import)

The `company-portability` service enables exporting and importing entire company configurations — org structures, agent configs, skills — with:
- Secret scrubbing (sensitive env keys detected by regex)
- Collision handling (rename strategy for duplicate agents)
- Manifest-based format for versioning

This is the foundation for their planned "ClipMart" — a marketplace for downloadable company templates.

### 3.7 Cost Tracking with Budget Hard-Stop

Cost events track per-token usage with provider and model attribution. When an agent's `spentMonthlyCents >= budgetMonthlyCents`, the agent is **automatically paused**. This is not a soft limit — it's enforced atomically in `costService.createEvent()`. This prevents runaway AI spend, which is one of the biggest risks in autonomous agent systems.

### 3.8 Dual Auth Modes

- **`local_trusted`**: No auth required — implicit board access. Perfect for local dev.
- **`authenticated`**: Full auth via BetterAuth (email/password, sessions) with instance admin roles and company memberships. Private hostname guard restricts access by hostname (great for Tailscale setups).

### 3.9 Multi-Surface Adapter Packages

Each adapter package exports separate server/ui/cli entry points. This means the UI can import `@paperclipai/adapter-claude-local/ui` to get Claude-specific transcript parsers without pulling in server-side process spawning code. Clean dependency boundaries.

---

## 4. Tech Stack and Dependencies

### Server
| Component | Technology |
|---|---|
| Runtime | Node.js 20+, ES2023 target |
| Framework | Express 5 |
| ORM | Drizzle ORM 0.38 |
| Database | PostgreSQL 17 (embedded PGlite for dev) |
| Auth | BetterAuth 1.4 |
| Logging | Pino + pino-http |
| WebSocket | ws 8.x |
| Validation | Zod 3.24 |
| File uploads | Multer 2.x |
| Object storage | AWS S3 SDK (optional), local disk (default) |

### UI
| Component | Technology |
|---|---|
| Framework | React 19 |
| Build tool | Vite 6 |
| CSS | TailwindCSS v4 |
| Components | Radix UI + shadcn patterns |
| State/fetch | TanStack Query 5 |
| Routing | React Router DOM 7 |
| Rich text | MDX Editor 3.x |
| Markdown | react-markdown + remark-gfm |
| DnD | dnd-kit |
| Icons | Lucide React |

### CLI
| Component | Technology |
|---|---|
| Framework | Commander.js |
| Build | esbuild |

### Build/Dev
| Component | Technology |
|---|---|
| Package manager | pnpm 9.15 |
| TypeScript | 5.7 (strict mode) |
| Monorepo | pnpm workspaces |
| Testing | Vitest 3.0 |
| Bundler | esbuild (CLI), Vite (UI), tsc (server) |
| Changesets | @changesets/cli |
| Container | Docker multi-stage build |

---

## 5. Testing Approach

**41 test files**, primarily in `server/src/__tests__/`, using **Vitest**.

### Test Categories

| Category | Examples | Pattern |
|---|---|---|
| Adapter unit tests | `claude-local-adapter.test.ts`, `codex-local-adapter.test.ts`, `cursor-local-execute.test.ts` | Test adapter execution, environment checks, session codecs |
| Adapter environment | `claude-local-adapter-environment.test.ts`, `opencode-local-adapter-environment.test.ts` | Verify adapter pre-flight checks |
| Auth/security | `agent-auth-jwt.test.ts`, `board-mutation-guard.test.ts`, `private-hostname-guard.test.ts` | Test auth middleware, hostname guards, JWT verification |
| Invite/onboarding | `invite-accept-openclaw-defaults.test.ts`, `invite-accept-replay.test.ts`, `invite-expiry.test.ts` | Test join flow semantics, replay protection, expiry |
| Domain logic | `issues-checkout-wakeup.test.ts`, `issues-user-context.test.ts`, `heartbeat-workspace-session.test.ts` | Test core business logic |
| Infrastructure | `storage-local-provider.test.ts`, `redaction.test.ts`, `health.test.ts`, `paperclip-env.test.ts` | Test storage, secret redaction, health endpoint |
| Smoke tests | `scripts/smoke/openclaw-join.sh`, `scripts/smoke/openclaw-docker-ui.sh` | End-to-end bash scripts testing real agent flows |

### Testing Configuration

```typescript
// vitest.config.ts (root)
export default defineConfig({
  test: {
    projects: ["packages/db", "packages/adapters/opencode-local", "server", "ui", "cli"],
  },
});
```

Each package can have its own `vitest.config.ts` for package-specific test configuration.

### Testing Tools
- **Vitest** for unit/integration tests
- **Supertest** for HTTP route testing (dev dependency of server)
- **Shell scripts** for end-to-end smoke tests

---

## 6. Particularly Clever or Well-Done Aspects

### 6.1 🏆 Zero-Config Developer Experience

The combination of embedded PGlite + auto-migration + `pnpm dev` is exceptional. A new contributor can `git clone && pnpm install && pnpm dev` and have a fully working system with a real PostgreSQL database in seconds. No Docker, no database setup, no `.env` files required. The `npx paperclipai onboard --yes` one-liner is the gold standard for developer-facing tools.

### 6.2 🏆 Company-Scoped Multi-Tenancy Done Right

Every single entity is company-scoped. Every service function takes `companyId` as the first parameter. Every route enforces company boundaries through actor middleware. This isn't bolted on — it's the fundamental design constraint. It means data isolation is guaranteed by construction, not by convention.

### 6.3 🏆 The Adapter System's Clean Separation

The `adapter-utils` package providing types with zero ORM dependencies, combined with the three-surface (server/ui/cli) export structure per adapter, is elegant. It means:
- Third parties can write adapters without importing Drizzle
- The UI imports only what it needs (transcript parsers, not process spawners)
- The adapter interface is well-defined and testable in isolation

### 6.4 🏆 Governance as a First-Class Concern

Many agent orchestration systems treat governance as an afterthought. Paperclip makes it structural:
- Board approval required for agent hiring (configurable)
- Budget hard-stops that actually pause agents
- Config revision tracking with rollback capability
- Activity logging for all mutations
- Immutable audit trail via `activity_log` table

### 6.5 🏆 Session Continuity Across Heartbeats

The `agentRuntimeState` + `agentTaskSessions` + `AdapterSessionCodec` pattern ensures agents can resume context across heartbeats. The session codec is adapter-specific (Claude stores session differently than Codex), but the heartbeat system handles serialization/deserialization generically. This is critical for agents that need to maintain context without re-reading everything.

### 6.6 🏆 Secret Redaction by Pattern

The `redaction.ts` module auto-detects sensitive keys by regex pattern (`/api[-_]?key|access[-_]?token|...`) and JWTs by structure. This means even if a developer forgets to explicitly mark a field as sensitive, the system will catch and redact it in logs and events. Defense in depth.

### 6.7 🏆 Workspace Resolution Chain

The heartbeat system's workspace resolution (`project_primary → task_session → agent_home`) with fallback is thoughtful. It means:
- An agent working on a project gets the project's workspace (git repo)
- An agent resuming a task gets the same workspace it used before
- An agent with no assignment gets a clean agent home directory
- All paths honor `PAPERCLIP_HOME` for instance isolation

---

## 7. Architecture Assessment

### Strengths
- Clean layered architecture with clear module boundaries
- Excellent developer experience (zero-config)
- Multi-tenancy by design, not afterthought
- Adapter system is extensible without core changes
- Governance/audit trail built into the foundation
- Smart use of embedded Postgres for dev vs external for prod

### Areas to Watch
- **Single-process architecture**: Live events use in-process EventEmitter. Works perfectly for single-instance deployments but would need Redis/NATS pub-sub for horizontal scaling
- **No queue/worker pattern**: Heartbeat execution happens in-process on the server. For production scale (many agents, many companies), a job queue (BullMQ, etc.) would separate concerns
- **Test coverage focus on adapters**: 41 test files with heavy focus on adapter tests. The core domain services (issues, goals, costs, approvals) could use more direct testing
- **Database migrations**: 26 SQL migrations with custom runner — works but adds maintenance burden vs vanilla Drizzle Kit

### What Other Projects Can Learn From Paperclip
1. **Embedded database for dev, external for prod** — eliminates setup friction without compromising production architecture
2. **Factory-function services** over classes — simpler, more composable, easier to test
3. **Actor-based auth middleware** as single point of identity — clean separation of auth from business logic
4. **Config revision tracking** — applicable to any system where configuration changes need audit trails
5. **Pattern-based secret redaction** — defense-in-depth for logging sensitive data
6. **Multi-surface package exports** (server/ui/cli) — clean way to share types while keeping runtime dependencies minimal
7. **Company-prefixed URL routing** — elegant multi-tenant URL scheme that keeps everything stateless

---

*This report was produced by thoroughly exploring the repository structure, reading core source files, schema definitions, adapter implementations, tests, documentation, and configuration files.*
