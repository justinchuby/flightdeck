# Squad — Research Report

**Repository:** `/Users/justinc/Documents/GitHub/squad`
**Version:** 0.8.21-preview.1 (Alpha)
**License:** MIT
**Author:** Brady Gaster (@bradygaster)
**Report Date:** 2026-03-07

---

## 1. What the Project Does

**Squad is a programmable multi-agent runtime for GitHub Copilot.** It gives developers an AI development team — frontend, backend, tester, lead, scribe — that lives in the repo as files, persists across sessions, learns the codebase, shares decisions, and compounds knowledge over time.

### Core Value Proposition

- **One command (`squad init`) scaffolds an AI team** in any project
- **Each agent has a persistent identity** (charter, history, learnings) stored in `.squad/agents/{name}/`
- **Agents run in parallel** with independent context windows, coordinated by a routing engine
- **Knowledge compounds** — after a few sessions, agents know your conventions, preferences, and architecture
- **Everything is in git** — anyone who clones the repo gets the team with all accumulated knowledge

### Key Capabilities

| Feature | Description |
|---------|-------------|
| Interactive Shell | `squad` with no args opens a REPL where you talk to your team |
| Agent Routing | Coordinator analyzes messages and routes to the right specialist(s) |
| Parallel Execution | Multiple agents work simultaneously on independent tasks |
| Issue Triage (Ralph) | Automated GitHub issue scanning, classification, and agent assignment |
| Casting System | Agents get themed personas from movie universes (Usual Suspects, Ocean's Eleven, etc.) |
| Skills System | Domain-specific knowledge packages matched on-demand to tasks |
| Hook Governance | Programmatic policy enforcement (file guards, command blocks, PII scrubbing) |
| Session Persistence | Sessions save/resume; context never lost |
| Remote Access | WebSocket-based remote control with xterm.js terminal in browser |
| Marketplace | Extension packaging, security scanning, and distribution readiness |
| Export/Import | Portable JSON snapshots of entire squad state |
| Context Hygiene (`nap`) | Compress, prune, and archive accumulated state |

---

## 2. Architecture and Key Design Patterns

### 2.1 Monorepo Structure

```
squad/
├── packages/
│   ├── squad-sdk/     # Core runtime, agent orchestration, tools (no CLI deps)
│   └── squad-cli/     # CLI interface + interactive shell (depends on squad-sdk)
├── test/              # 130 test files, ~3,446 test cases
├── templates/         # 22+ scaffold templates
├── samples/           # 8 runnable example projects
├── docs/              # Internal documentation (concepts, SDK, specs, proposals)
├── scripts/           # Build versioning
└── .squad/            # Real living squad that maintains Squad itself (dogfooding)
```

**npm workspaces** with independent versioning via changesets. The SDK has zero CLI dependencies; the CLI depends on the SDK. This separation enables the SDK to be embedded in VS Code extensions without pulling in terminal UI code.

### 2.2 Layered Architecture (SDK)

The SDK has a clean 6-layer architecture with ~8,000+ lines of TypeScript:

```
┌─────────────────────────────────────────────────────┐
│  Domain Layer                                        │
│  casting/ · ralph/ · skills/ · marketplace/ · sharing│
├─────────────────────────────────────────────────────┤
│  Coordinator Layer                                   │
│  coordinator/ (orchestration, routing, fan-out)      │
├─────────────────────────────────────────────────────┤
│  Agent Layer                                         │
│  agents/ (lifecycle, charter compilation, model sel) │
├─────────────────────────────────────────────────────┤
│  Tools & Hooks Layer                                 │
│  tools/ (squad_route, squad_decide, squad_memory)    │
│  hooks/ (pre/post tool governance pipeline)          │
├─────────────────────────────────────────────────────┤
│  Client Layer                                        │
│  client/ (session pool, event bus integration)       │
├─────────────────────────────────────────────────────┤
│  Runtime Layer                                       │
│  runtime/ (event bus, streaming, telemetry, config)  │
│  adapter/ (Copilot SDK isolation)                    │
├─────────────────────────────────────────────────────┤
│  Foundation                                          │
│  resolution.ts · config/ · types.ts · parsers.ts     │
└─────────────────────────────────────────────────────┘
```

### 2.3 Key Design Patterns

#### Pattern 1: Coordinator Pipeline (Multi-Stage Orchestration)

The coordinator replaces monolithic prompt-based coordination with a typed pipeline:

```
User Message
  → Direct Response Check (status/help → instant response, <20ms)
  → Routing Analysis (compile rules from team.md + routing.md)
  → Spawn Strategy (select response tier: direct/lightweight/standard/full)
  → Fan-Out Execution (parallel agent spawning via Promise.allSettled)
  → Result Collection
```

**Response Tiers** provide progressive disclosure:
- `direct`: No spawn, <20ms (status queries, greetings)
- `lightweight`: 1 fast agent, 30s timeout
- `standard`: 1 standard agent, 120s timeout
- `full`: Up to 5 premium agents, 300s timeout

#### Pattern 2: Adapter Layer (SDK Isolation)

The `adapter/` layer decouples Squad from the Copilot SDK's types, preventing API instability from cascading through the codebase. `CopilotSessionAdapter` normalizes events (`assistant.message_delta` → `message_delta`), and `SquadSessionConfig` provides a stable configuration surface. This means the SDK can evolve independently of Copilot's release cadence.

#### Pattern 3: Event-Driven Architecture

A central `EventBus` (292 lines) provides pub/sub for:
- **Lifecycle events**: session:created, session:idle, session:error, session:destroyed
- **Operational events**: session:message, tool_call, coordinator:routing, pool:health

Error isolation is built in — handler failures don't cascade to other subscribers. This enables loose coupling between the coordinator, telemetry, session pool, and UI.

#### Pattern 4: Dual-Root Path Resolution

Squad supports two deployment modes:
- **Local mode**: `projectDir === teamDir` (single `.squad/` directory)
- **Remote mode**: Separate `projectDir` (decisions, logs) and `teamDir` (agents, casting, skills)

`resolveSquadPaths()` walks up from the working directory, respects `.git` boundaries, checks for `.squad/config.json` with `teamRoot` pointers, and handles worktrees. This enables a personal squad to "consult" on external projects without polluting their repos.

#### Pattern 5: Charter-Driven Agent Identity

Each agent is defined by a markdown charter file with YAML frontmatter:

```markdown
---
name: fenster
role: lead-developer
expertise: [architecture, code-review, decisions]
style: direct, opinionated
modelPreference: claude-sonnet-4.5
---
# Fenster — Lead Developer
Architecture, code review, decisions
...
```

The `CharterCompiler` parses these into typed `AgentCharter` objects. Charters are human-readable, git-trackable, and modifiable by both humans and agents.

#### Pattern 6: Hook-Based Governance Pipeline

Instead of prompt-level rules (fragile, bypassable), Squad uses a typed hook pipeline:

```typescript
type HookAction = 'allow' | 'block' | 'modify';
// Pre-tool hooks: intercept before execution
// Post-tool hooks: inspect/modify after execution
```

Built-in hooks include file write guards (glob patterns), shell command blocking, `ask_user` rate limiting, reviewer lockout, and PII scrubbing. This is **programmatic governance** — enforceable, testable, composable.

#### Pattern 7: Ghost Response Retry

A resilience pattern addressing a real-world problem: sometimes the LLM returns an empty response (race condition where `session.idle` fires before `assistant.message`). The shell detects this and retries with exponential backoff (1s → 2s → 4s, max 3 retries).

### 2.4 CLI Architecture

The CLI uses **Ink (React for terminals)** with a shell-based interaction model:

```
User Input → Router
  ├── /command → Slash command handler
  ├── @AgentName → Direct agent dispatch
  ├── AgentName, task → Comma syntax dispatch
  └── plain text → Coordinator routing
```

**Streaming bridge** maps SDK events → React state updates → Ink component re-renders. The shell supports session warm-up (eagerly creates coordinator session before first message), parallel multi-agent dispatch, and automatic session persistence.

**Remote UI**: A WebSocket-bridged PWA with xterm.js that allows remote terminal access from any browser, with token/ticket authentication.

---

## 3. Notable Techniques and Innovations

### 3.1 Knowledge Compounding (the "Big Idea")

This is Squad's most distinctive innovation. Every agent session writes lasting learnings to its `history.md`. After a few sessions, agents know your conventions, preferences, and architecture. They stop asking questions they've already answered.

Because it's all in git, **knowledge travels with the code**. Clone a repo, get the team — with all their accumulated wisdom. This is fundamentally different from stateless LLM interactions.

### 3.2 Casting Engine (Themed Personas)

Agents are assigned personas from movie universes — "The Usual Suspects," "Ocean's Eleven," "Breaking Bad," "Firefly," etc. Each character maps to a role (Keyser=lead, McManus=dev, Fenster=tester). This is clever for several reasons:
- Makes agents **memorable** and **distinguishable**
- Creates natural **personality differentiation** that persists across sessions
- Makes the experience **fun** (team members have backstories)
- Provides a **deterministic casting registry** that supports rollback

### 3.3 Markdown-as-State

Squad's state is almost entirely markdown files in `.squad/`:
- `team.md` — roster
- `routing.md` — who handles what
- `decisions.md` — shared brain
- `agents/{name}/charter.md` — agent identity
- `agents/{name}/history.md` — agent learnings

This means: human-readable, git-diffable, merge-friendly, LLM-comprehensible, and editable by both humans and agents. No databases. No binary formats. Pure text.

### 3.4 Response Tier System

Instead of always spawning expensive multi-agent pipelines, Squad classifies requests into tiers. "What's the team status?" gets a direct response in <20ms without spawning any agents. "Build the login page" gets a full multi-agent fan-out. This is practical efficiency that dramatically improves perceived performance.

### 3.5 Consult Mode

A personal squad can be "consulted" on an external project without modifying that project's repo. Squad uses `.git/info/exclude` to make its `.squad/` invisible to git. Learnings can optionally be extracted back to the personal squad. This enables a "roaming expert team" pattern.

### 3.6 Three-Tier Model Selection with Nuclear Fallback

```typescript
models: {
  fallbackChains: {
    premium: ['claude-opus-4.6', 'claude-opus-4.5', 'claude-sonnet-4.5'],
    standard: ['claude-sonnet-4.5', 'gpt-5.2-codex', 'claude-sonnet-4'],
    fast: ['claude-haiku-4.5', 'gpt-5.1-codex-mini', 'gpt-4.1']
  },
  nuclearFallback: { enabled: false, model: 'claude-haiku-4.5', maxRetriesBeforeNuclear: 3 }
}
```

Provider-aware fallback chains with tier ceilings (don't upgrade from standard to premium) and a nuclear fallback option. This handles model unavailability gracefully.

### 3.7 Ralph — Automated Issue Triage

Ralph parses `team.md` and `routing.md` to build a routing table, then classifies incoming GitHub issues by module path ownership, work type keywords, role-based matching, and lead fallback. Each decision includes a confidence score (`high/medium/low`) and source attribution. This brings structured project management to AI teams.

### 3.8 Dogfooding at Scale

Squad uses itself to maintain itself. The `.squad/` directory in the repo contains a **real, living team** with agents, decisions, learnings, constraints, and orchestration logs. This is the ultimate validation — the tool is its own customer.

---

## 4. Tech Stack and Dependencies

### Core Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict, ESM-only, target ES2022) |
| Runtime | Node.js ≥20 |
| Module System | NodeNext (ESM with .js extensions) |
| Build | tsc (TypeScript compiler) |
| Package Management | npm workspaces with changesets |
| LLM Integration | `@github/copilot-sdk` (^0.1.29) |
| CLI UI Framework | Ink 6.8 (React 19 for terminals) |
| Terminal Emulator | xterm.js (remote UI) |
| Observability | OpenTelemetry (optional, opt-in) |

### Key Dependencies

**SDK (`squad-sdk`):**
- `@github/copilot-sdk` — Core LLM integration
- `@opentelemetry/api` — Telemetry instrumentation
- Optional: OTel exporters, ws (WebSocket)

**CLI (`squad-cli`):**
- `@bradygaster/squad-sdk` — The SDK
- `ink` + `react` — Terminal UI
- Dev: esbuild, ink-testing-library

**Dev/Test:**
- Vitest 3.0 — Test framework
- Playwright — E2E testing
- @vitest/coverage-v8 — Code coverage
- TypeScript 5.7 — Type checking

### Dependency Philosophy

Remarkably lean. The SDK has only 2 production dependencies (`@github/copilot-sdk` and `@opentelemetry/api`). All OTel exporters are optional dependencies. The CLI adds only Ink and React. There are no utility libraries (lodash, etc.), no ORMs, no HTTP frameworks. Everything is built from TypeScript primitives.

---

## 5. Testing Approach

### Scale

- **130 test files** across 4 directories
- **~3,446 test cases** total
- Average ~26 tests per file, key files 200-635 lines each

### Framework & Tools

| Tool | Purpose |
|------|---------|
| Vitest 3.0 | Primary test framework |
| ink-testing-library | React terminal UI testing |
| vi.fn/vi.mock/vi.spyOn | Mocking |
| Custom TerminalHarness | CLI E2E testing (child_process.spawn) |
| Custom Gherkin parser | BDD acceptance tests |
| @vitest/coverage-v8 | Code coverage |

### Test Types

| Type | Count | Examples |
|------|-------|---------|
| Unit | ~90 | agents.test.ts, casting.test.ts, config.test.ts |
| Integration | ~20 | coordinator.test.ts, config-integration.test.ts |
| Journey/E2E | 6 | journey-first-conversation.test.ts, journey-power-user.test.ts |
| Acceptance/BDD | 2 | Gherkin feature files for CLI commands |
| CLI Command | 9 | cli/consult.test.ts, cli/doctor.test.ts |
| Performance | 3 | benchmarks.test.ts, stress.test.ts, speed-gates.test.ts |
| OTel/Telemetry | 8+ | otel-*.test.ts files |

### Testing Patterns

1. **Factory functions over fixtures** — `makeContext()`, `makeConfig()` for lightweight, customizable test data
2. **Minimal mocking** — Prefer real implementations; mock only external SDK boundaries
3. **ShellHarness for UI tests** — Wraps Ink's render() with helpers: `type()`, `submit()`, `frame()`, `waitFor()`
4. **TerminalHarness for CLI E2E** — Spawns real CLI process, strips ANSI, captures exit codes
5. **Environment control** — `vi.stubEnv()` for test isolation
6. **Filesystem scaffolding** — `mkdtempSync` + `writeFileSync` for integration tests
7. **Cleanup in afterEach** — Temp dirs removed after each test
8. **Custom Gherkin BDD** — Lightweight, not full Cucumber (74-line parser + 80-line runner)

### Coverage Areas

Well-covered: charter compilation, routing, config parsing, casting, session management, event bus, OTel, marketplace, migrations. Less covered: interactive shell (requires real Copilot SDK), long-running daemons.

---

## 6. What's Particularly Clever or Well-Done

### 6.1 ⭐ Markdown-as-Database Architecture

The decision to use markdown files as the entire persistence layer is architecturally bold and pays off enormously:
- **Zero infrastructure** — no databases, no servers, no setup
- **Git-native** — version control, branching, merging, history for free
- **Human-readable** — developers can inspect, edit, and understand state directly
- **LLM-friendly** — models can read and write markdown natively
- **Portable** — copy `.squad/` to any project, done

This eliminates an entire category of infrastructure complexity.

### 6.2 ⭐ The Response Tier Progressive Disclosure

Most multi-agent systems treat every request the same way — spawn the full pipeline. Squad's 4-tier system (`direct` → `lightweight` → `standard` → `full`) means simple queries resolve in milliseconds while complex tasks get full orchestration. This is **architectural performance optimization** — not just caching, but fundamentally different execution paths based on request complexity.

### 6.3 ⭐ Adapter Layer for SDK Stability

Wrapping the Copilot SDK in an adapter layer (`CopilotSessionAdapter`, `SquadSessionConfig`) is a textbook example of protecting internal architecture from external API instability. When the Copilot SDK changes (and it will — it's at v0.1.x), only the adapter needs updating. The rest of the codebase is insulated.

### 6.4 ⭐ Hook Pipeline for Governance

Replacing prompt-level governance ("don't write to protected files") with typed hook pipelines (`PreToolUseContext` → `HookAction`) is a significant architectural improvement. Prompt-based rules are fragile, untyped, and unenforceable. Hook pipelines are testable, composable, and deterministic.

### 6.5 ⭐ Dogfooding as Quality Assurance

Squad maintaining itself with a real squad is more than marketing — it's a continuous integration test of the core value proposition. The `.squad/decisions.md` file contains real architectural decisions, and `.squad/agents/*/history.md` files contain real accumulated learnings. If Squad breaks, the team that fixes it feels the pain.

### 6.6 ⭐ Module Export Granularity

The SDK's `package.json` exports map is remarkably granular — 30+ subpath exports enabling precise tree-shaking:

```json
"./coordinator": "...",
"./hooks": "...",
"./runtime/streaming": "...",
"./runtime/event-bus": "...",
```

Consumers import exactly what they need. This is clean API design that respects downstream bundle sizes.

### 6.7 ⭐ Casting as Team-Building UX

The casting system (movie universe personas) is a UX innovation that makes multi-agent systems approachable. Instead of "Agent-1" and "Agent-2," you have Keyser (the lead) and McManus (the dev). Names create memorability, personality differentiation, and emotional engagement. The deterministic casting registry with rollback support shows engineering rigor behind the whimsy.

### 6.8 ⭐ Dual-Root for Team Portability

The local/remote mode split enables a powerful deployment pattern: a central team repo (with agents, casting, skills) that individual projects link to. Projects get their own decisions and logs while sharing the same team identity. This is the multi-tenant pattern applied to AI agent teams.

---

## 7. Architecture Diagram

```
                          ┌──────────────────┐
                          │   User / CLI     │
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │   Interactive    │
                          │   Shell (Ink)    │
                          │  ┌─────────────┐ │
                          │  │Router/Parser│ │
                          │  └──────┬──────┘ │
                          └─────────┼────────┘
                     ┌──────────────┼──────────────┐
                     │              │              │
              ┌──────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
              │ /commands   │ │Coordinator│ │ @agent      │
              │ (direct)    │ │ Pipeline  │ │ (direct)    │
              └─────────────┘ └────┬─────┘ └──────┬──────┘
                                   │              │
                          ┌────────▼─────────┐    │
                          │  Response Tier   │    │
                          │  Selection       │    │
                          │  (direct/light/  │    │
                          │   standard/full) │    │
                          └────────┬─────────┘    │
                                   │              │
                          ┌────────▼─────────┐    │
                          │  Agent Spawner   │◄───┘
                          │  (parallel via   │
                          │  allSettled)     │
                          └────────┬─────────┘
                     ┌─────────────┼─────────────┐
                     │             │             │
              ┌──────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
              │  Agent A    │ │Agent B │ │  Agent C    │
              │  (charter   │ │        │ │             │
              │   + model)  │ │        │ │             │
              └──────┬──────┘ └───┬────┘ └──────┬──────┘
                     │            │             │
              ┌──────▼────────────▼─────────────▼──────┐
              │        Copilot SDK Adapter             │
              │  (event normalization, session pool)   │
              └──────────────────┬──────────────────────┘
                                 │
              ┌──────────────────▼──────────────────────┐
              │          @github/copilot-sdk            │
              └─────────────────────────────────────────┘

  ═══════════════ Cross-Cutting Concerns ═══════════════

  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ EventBus │ │  Hooks   │ │  OTel    │ │ Config   │
  │ (pub/sub)│ │(govern.) │ │(traces)  │ │(schema)  │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘

  ════════════════ Persistence (.squad/) ════════════════

  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ team.md  │ │routing.md│ │decisions │ │ agents/  │
  │ (roster) │ │ (rules)  │ │  .md     │ │charter.md│
  └──────────┘ └──────────┘ └──────────┘ │history.md│
                                          └──────────┘
```

---

## 8. Potential Inspiration for Other Projects

| Pattern | Applicability |
|---------|--------------|
| **Markdown-as-state** | Any project needing git-native, human-readable, LLM-friendly persistence |
| **Response tier system** | Any multi-agent system that needs to balance speed vs. capability |
| **Adapter layer for SDK isolation** | Any project integrating with rapidly-evolving third-party SDKs |
| **Hook-based governance** | Any AI agent system needing enforceable, testable policy rules |
| **Charter-driven agent identity** | Any multi-agent system where agents need persistent, distinct personalities |
| **Dual-root architecture** | Any system that needs to separate team/shared state from project-specific state |
| **Ghost response retry** | Any LLM integration dealing with empty/failed responses |
| **Casting engine** | Any product that benefits from making AI agents memorable and distinguishable |
| **Dogfooding-as-testing** | Any developer tool that can use itself |
| **Granular subpath exports** | Any SDK/library that wants to enable precise tree-shaking |

---

## 9. Summary Assessment

Squad is a **sophisticated, well-architected multi-agent runtime** that makes several bold architectural choices — markdown-as-state, progressive response tiers, typed governance hooks — that pay off in simplicity, portability, and developer experience. The codebase is remarkably lean (2 production deps for the SDK), rigorously tested (130 test files, 3,446 tests), and well-documented internally.

The project's most distinctive innovation is **knowledge compounding** — the idea that AI agent teams should accumulate and persist learnings across sessions, creating a "team memory" that lives in git. This is a fundamentally different approach from stateless LLM interactions and could be the defining pattern for the next generation of AI-assisted development tools.

**Maturity:** Alpha (0.8.x), actively developed, clear path to 1.0. The architecture is solid; the remaining work appears to be polish, API stabilization, and public documentation.
