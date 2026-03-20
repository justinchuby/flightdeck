# Contributing to Flightdeck

Thank you for your interest in contributing to Flightdeck! This is a multi-agent orchestration platform — the coordination layer for AI coding agents. We welcome contributions of all kinds: bug fixes, features, documentation, skills, and crew templates.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style & Conventions](#code-style--conventions)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Writing Skills](#writing-skills)
- [How the Agent System Works](#how-the-agent-system-works)
- [Getting Help](#getting-help)

---

## Development Setup

### Prerequisites

- **Node.js** ≥ 20
- **npm** (comes with Node.js)
- At least one AI provider CLI installed (e.g., GitHub Copilot CLI, Claude Code, Gemini CLI)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck

# Install all dependencies (workspaces are linked automatically)
npm install

# Build the shared package first (other packages depend on it)
npm run build:shared

# Start the full development environment (server + web)
npm run dev
```

The dev server starts the Express backend and the Vite frontend with hot-reload. The web UI is available at `http://localhost:5173` and the API server at `http://localhost:3001`.

### Per-Package Development

```bash
# Server only (Express + SQLite)
npm run dev:server

# Web only (React + Vite)
npm run dev:web

# Documentation site (VitePress)
npm run docs:dev
```

### Building

```bash
# Build all packages (shared → server → web)
npm run build

# Build individual packages
npm run build:shared
npm run build --workspace=packages/server
npm run build --workspace=packages/web
```

> **Important:** Always build `packages/shared` first. The server and web packages depend on its compiled output. If you see "module not found" errors for `@flightdeck/shared`, run `npm run build:shared`.

---

## Project Structure

Flightdeck is an npm workspaces monorepo with four main packages:

```
flightdeck/
├── packages/
│   ├── shared/          # Shared types, schemas, and protocol definitions
│   │   └── src/
│   │       ├── protocol/    # Agent communication protocol types
│   │       └── api/         # API request/response schemas (Zod)
│   │
│   ├── server/          # Express.js backend
│   │   └── src/
│   │       ├── index.ts         # Server entry point
│   │       ├── container.ts     # Service container / dependency injection
│   │       ├── api.ts           # API route registration
│   │       ├── db/              # Drizzle ORM schema and database
│   │       ├── routes/          # Express route handlers
│   │       ├── agents/          # Agent lifecycle management
│   │       ├── adapters/        # Provider adapters (Copilot, Claude, etc.)
│   │       ├── coordination/    # Multi-agent coordination (DAG, decisions, etc.)
│   │       ├── knowledge/       # Skills loader, knowledge injection
│   │       ├── comms/           # WebSocket communication layer
│   │       └── middleware/      # Express middleware
│   │
│   ├── web/             # React frontend
│   │   └── src/
│   │       ├── components/      # React components (organized by feature)
│   │       ├── pages/           # Route-level page components
│   │       ├── stores/          # Zustand state stores
│   │       ├── utils/           # Utility functions
│   │       └── constants/       # App constants
│   │
│   └── docs/            # VitePress documentation site
│       ├── guide/           # User guide (37 pages)
│       └── reference/       # API and database reference
│
├── .github/
│   ├── skills/          # Reusable knowledge for AI agents (35 skills)
│   └── workflows/       # CI/CD workflows
│
├── docs/                # Internal architecture docs, specs, and research
├── scripts/             # Build utilities and quality checks
├── bin/                 # CLI entry point (flightdeck.mjs)
└── presentations/       # Slidev presentation decks
```

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | Root workspace config, top-level scripts |
| `tsconfig.base.json` | Shared TypeScript settings (strict mode) |
| `eslint.config.mjs` | ESLint config with import boundary enforcement |
| `.prettierrc` | Prettier formatting rules |
| `flightdeck.config.example.yaml` | Example configuration file |
| `packages/server/src/db/schema.ts` | Database schema (Drizzle ORM) |
| `packages/server/drizzle/` | SQL migration files |

---

## Architecture Overview

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Express.js 5, TypeScript, Node.js ≥ 20 |
| **Database** | SQLite with Drizzle ORM |
| **Frontend** | React 19, Vite 8, TypeScript |
| **State Management** | Zustand |
| **Data Fetching** | React Query (TanStack) |
| **Styling** | Tailwind CSS |
| **Real-time** | WebSocket (ws) |
| **Routing** | React Router 7 |
| **Validation** | Zod |
| **Testing** | Vitest (unit), Playwright (E2E) |
| **Documentation** | VitePress |

### Data Flow

```
User (Browser) ←→ React Frontend ←→ Express API ←→ Agent Adapters ←→ AI Providers
                        ↕                ↕                              (Copilot, Claude,
                   WebSocket          SQLite DB                          Gemini, Codex, etc.)
                   (real-time)       (Drizzle ORM)
```

### Package Dependencies

```
@flightdeck/shared  ←  @flightdeck/server
                    ←  @flightdeck/web
```

The `shared` package exports TypeScript types and Zod schemas used by both server and web. Import boundaries are enforced by ESLint — the server cannot import from web and vice versa.

---

## Development Workflow

### Branch Naming

Use descriptive branch names with a prefix:

```
feat/add-session-replay
fix/decision-feed-filtering
docs/update-contributing
refactor/knowledge-injection
```

### Making Changes

1. Create a branch from `main`
2. Build shared types if you've changed `packages/shared`:
   ```bash
   npm run build:shared
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Make your changes
5. Run tests and linting:
   ```bash
   npm run lint
   npm run test
   npm run check:guardrails
   ```
6. Commit and push

### Database Migrations

Flightdeck uses Drizzle ORM with SQLite. To create a new migration:

1. Modify the schema in `packages/server/src/db/schema.ts`
2. Generate the migration:
   ```bash
   cd packages/server
   npx drizzle-kit generate
   ```
3. Migrations are applied automatically on server start

### Quality Checks

Run all quality gates before submitting a PR:

```bash
# Run all checks at once
npm run check:guardrails

# Individual checks
npm run lint                 # ESLint with TypeScript rules
npm run check:file-size      # Enforce file size limits
npm run check:boundaries     # Verify import boundary rules
npm run check:circular       # Detect circular dependencies
```

---

## Testing

### Unit Tests (Vitest)

Both server and web packages use Vitest with co-located test files in `__tests__/` directories.

```bash
# Run server tests
npm run test

# Run web unit tests
npm run test --workspace=packages/web

# Watch mode (web)
npm run test:watch --workspace=packages/web

# Coverage reports
npm run test:coverage --workspace=packages/server
npm run test:coverage --workspace=packages/web
```

### End-to-End Tests (Playwright)

The web package has Playwright E2E tests in `packages/web/e2e/`:

```bash
# Run E2E tests
npm run test:e2e

# Run with browser UI visible
npm run test:e2e:headed

# Run with Playwright inspector
npm run test:e2e:ui
```

### Writing Tests

- Place unit tests in `__tests__/` directories next to the code they test
- Use descriptive test names: `it('should filter decisions by project scope')`
- For React components, use `@testing-library/react`
- For E2E tests, use Playwright's page object pattern

---

## Code Style & Conventions

### TypeScript

- **Strict mode enabled** (`strict: true` in tsconfig)
- Target: ES2022 with NodeNext module resolution
- Use explicit types for function parameters and return values
- Avoid `any` — use `unknown` with type narrowing when the type is truly unknown

### Formatting

Prettier is configured (`.prettierrc`):

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### ESLint Rules

- Unused variables produce warnings (underscore-prefix `_var` to intentionally ignore)
- Import boundaries are enforced: `@flightdeck/web` cannot import from `@flightdeck/server` and vice versa
- Use `@flightdeck/shared` for any types or schemas shared between packages

### Naming Conventions

- **Files:** camelCase for utilities (`crewUtils.ts`), PascalCase for React components (`DecisionPanel.tsx`)
- **Functions/variables:** camelCase (`formatForInjection`, `tokenBudget`)
- **Types/interfaces:** PascalCase (`AgentConfig`, `LoadedSkill`)
- **Constants:** UPPER_SNAKE_CASE for true constants (`MAX_RETRY_COUNT`), camelCase for config objects
- **Skill directories:** kebab-case (`websocket-push-pattern/`)

### File Organization

- Keep files small and focused on one responsibility
- Co-locate tests next to the code they test (`__tests__/` subdirectories)
- Prefer explicit exports over barrel files
- Group components by feature, not by type

### Agent-Friendly Code

This codebase is worked on by AI agents as well as humans. Write code that is easy for AI systems to navigate:

- Use clear, searchable names — avoid abbreviations and single-letter names
- Use consistent patterns across the codebase
- Write self-documenting code; add comments only for "why", not "what"
- Include good error messages that explain what went wrong
- Define clear module boundaries with explicit exports

---

## Pull Request Guidelines

### PR Process

1. **One feature per PR** — keep branches focused
2. **Triple review** — PRs go through code review, readability review, and critical review before merge
3. **Label AI-generated PRs** — add the `ai` label if the PR was created by or with AI agents
4. **Mention dependencies** — if your PR depends on another PR, note it in the description
5. **Include context** — explain *why* the change is needed, not just *what* changed

### PR Template

```markdown
## What

Brief description of the change.

## Why

What problem does this solve? Link to issue if applicable.

## How

Technical approach — what did you change and why this approach?

## Testing

How was this tested? (unit tests, E2E, manual testing)

## Screenshots

If UI changes, include before/after screenshots.
```

### Commit Messages

Use conventional commit style:

```
feat: add decision importance classification
fix: aggregate decisions across all sessions
docs: add contributing guide
refactor: extract crew detection into shared utility
test: add E2E tests for session replay
```

Include a co-authoring trailer for AI-assisted commits:
```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## Writing Skills

Skills are reusable knowledge snippets that Flightdeck injects into AI agent prompts. They live in `.github/skills/` and are a great way to contribute domain expertise.

### Skill Format

Create a directory with a `SKILL.md` file:

```
.github/skills/your-skill-name/
└── SKILL.md
```

The file uses YAML frontmatter:

```markdown
---
name: your-skill-name
description: When to use this skill — be specific so it's loaded at the right time.
---

## When to Use

Describe the situation where this skill is relevant.

## The Pattern

Explain the pattern, technique, or approach.

## Example

Show a concrete example with code if applicable.

## Files

List relevant file paths in the codebase.
```

### What Makes a Good Skill

- **Reusable** — helps future sessions, not just the current task
- **Specific** — "how to add a new API endpoint" not "how APIs work"
- **Actionable** — includes concrete steps, file paths, and code examples
- **Concise** — aim for < 4KB; large skills get truncated during injection

### Current Skills

There are 35 skills covering architecture patterns, frontend conventions, debugging tips, multi-agent coordination, and infrastructure. Browse `.github/skills/` to see examples.

---

## How the Agent System Works

Understanding the agent architecture helps when contributing to coordination or knowledge features.

### Core Concepts

```
Project → Session → Lead Agent → Crew (specialized agents)
                                    ├── Developer (writes code)
                                    ├── Architect (system design)
                                    ├── Code Reviewer (quality checks)
                                    ├── QA Tester (testing)
                                    ├── Tech Writer (documentation)
                                    └── ... (14 roles total)
```

1. **Projects** group related work. Each project has configuration, knowledge, and session history.
2. **Sessions** are active work periods. A session has one Lead Agent that coordinates the crew.
3. **The Lead Agent** receives a task from the user, decomposes it into a task DAG (directed acyclic graph), and delegates subtasks to specialized agents.
4. **Crew Agents** work in parallel, each with their own context window and AI provider. They communicate via structured messaging and coordinate through file locks.

### Provider Adapters

Flightdeck supports multiple AI providers through an adapter pattern (`packages/server/src/adapters/`). Each adapter implements the `AgentAdapter` interface and translates between Flightdeck's internal protocol and the provider's CLI/API:

- **Copilot** (GitHub Copilot CLI via ACP)
- **Claude** (Claude Code CLI)
- **Gemini** (Google Gemini CLI)
- **Codex** (OpenAI Codex CLI)
- **Cursor** (Cursor editor agent)
- **OpenCode** (OpenCode CLI)

### Knowledge System

Agents receive context through three independent systems:

1. **Skills** (`.github/skills/`) — reusable patterns injected based on task relevance
2. **Project Knowledge** — project-specific context stored in the database
3. **Collective Memory** — cross-session learning (patterns, decisions, gotchas)

Key files:
- `packages/server/src/knowledge/SkillsLoader.ts` — loads and formats skills
- `packages/server/src/agents/services/AgentKnowledgeService.ts` — orchestrates injection
- `packages/server/src/coordination/knowledge/CollectiveMemory.ts` — persistent learning

### Coordination Primitives

- **Task DAG** — dependency graph for work decomposition (`packages/server/src/coordination/`)
- **File Locks** — prevent conflicting edits by multiple agents
- **Decision Queue** — agent decisions that may need human approval
- **Trust Dial** — controls agent autonomy level (supervised → balanced → autonomous)
- **Inter-Agent Messaging** — direct messages and group chats between agents

---

## Getting Help

- **GitHub Issues** — bug reports and feature requests
- **GitHub Discussions** — questions, ideas, and community conversation
- **Documentation** — run `npm run docs:dev` for the full docs site
- **Internal Docs** — browse `docs/` for architecture docs and specs

---

## License

Flightdeck is [MIT licensed](LICENSE). By contributing, you agree that your contributions will be licensed under the same license.
