# Credits & Attribution

Flightdeck is built on the shoulders of many excellent open-source projects and research efforts. This document acknowledges the projects, libraries, and communities that made it possible.

## Research & Design References

Projects whose architecture, patterns, or research informed Flightdeck's design:

| Project | Reference | Notes |
|---------|-----------|-------|
| [OpenClaw](https://github.com/nichochar/openclaw) | Memory system design, Telegram integration pattern | Inspired our multi-tier knowledge architecture and messaging integration approach |
| ZeroClaw | Memory system research | Informed our approach to agent memory persistence and retrieval |
| IronClaw | Memory system research, CLI tools | Influenced our CLI adapter patterns and memory management strategies |

## Agent & AI SDKs

Core SDKs that enable Flightdeck's multi-provider agent orchestration:

| Project | URL | Usage |
|---------|-----|-------|
| [@agentclientprotocol/sdk](https://www.npmjs.com/package/@agentclientprotocol/sdk) | [agentclientprotocol.com](https://agentclientprotocol.com) | Agent Communication Protocol — the standard wire format for CLI adapter communication |
| GitHub Copilot CLI | [docs.github.com/copilot](https://docs.github.com/en/copilot) | Copilot provider adapter integration |
| [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) | [claude.ai](https://claude.ai) | Claude Code CLI provider adapter |
| Google Gemini CLI | [ai.google.dev](https://ai.google.dev/gemini-api/docs) | Gemini provider adapter integration |

## Core Libraries

The foundation libraries that power the server and web application:

### Server

| Library | URL | Usage |
|---------|-----|-------|
| [Express](https://expressjs.com) | [github.com/expressjs/express](https://github.com/expressjs/express) | HTTP server and API routing (v5) |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite database driver — fast, synchronous, reliable |
| [Drizzle ORM](https://orm.drizzle.team) | [github.com/drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | Type-safe database schema, queries, and migrations |
| [ws](https://github.com/websockets/ws) | [github.com/websockets/ws](https://github.com/websockets/ws) | WebSocket server for real-time agent communication |
| [Pino](https://getpino.io) | [github.com/pinojs/pino](https://github.com/pinojs/pino) | Structured JSON logging |
| [Zod](https://zod.dev) | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) | Runtime schema validation for API routes and configuration |
| [Helmet](https://helmetjs.github.io) | [github.com/helmetjs/helmet](https://github.com/helmetjs/helmet) | HTTP security headers |
| [uuid](https://github.com/uuidjs/uuid) | [github.com/uuidjs/uuid](https://github.com/uuidjs/uuid) | RFC-compliant UUID generation |
| [yaml](https://eemeli.org/yaml) | [github.com/eemeli/yaml](https://github.com/eemeli/yaml) | YAML parsing for configuration files |

### Web Frontend

| Library | URL | Usage |
|---------|-----|-------|
| [React](https://react.dev) | [github.com/facebook/react](https://github.com/facebook/react) | UI component framework (v19) |
| [React Router](https://reactrouter.com) | [github.com/remix-run/react-router](https://github.com/remix-run/react-router) | Client-side routing |
| [Zustand](https://zustand-demo.pmnd.rs) | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand) | Lightweight state management |
| [Tailwind CSS](https://tailwindcss.com) | [github.com/tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | Utility-first CSS framework (v4) |
| [ReactFlow](https://reactflow.dev) | [github.com/xyflow/xyflow](https://github.com/xyflow/xyflow) | Interactive node graph for DAG visualization |
| [visx](https://airbnb.io/visx) | [github.com/airbnb/visx](https://github.com/airbnb/visx) | Low-level visualization components for analytics charts |
| [Lucide](https://lucide.dev) | [github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide) | Icon library used throughout the UI |
| [Fuse.js](https://www.fusejs.io) | [github.com/krisk/Fuse](https://github.com/krisk/Fuse) | Fuzzy search for command palette and search dialog |
| [React Virtuoso](https://virtuoso.dev) | [github.com/petyosi/react-virtuoso](https://github.com/petyosi/react-virtuoso) | Virtualized list rendering for large agent/task lists |

## Development & Testing

| Tool | URL | Usage |
|------|-----|-------|
| [TypeScript](https://www.typescriptlang.org) | [github.com/microsoft/TypeScript](https://github.com/microsoft/TypeScript) | Type-safe development across the entire codebase |
| [Vite](https://vite.dev) | [github.com/vitejs/vite](https://github.com/vitejs/vite) | Frontend build tool and dev server |
| [Vitest](https://vitest.dev) | [github.com/vitest-dev/vitest](https://github.com/vitest-dev/vitest) | Test framework — fast, TypeScript-native, Vite-integrated |
| [Playwright](https://playwright.dev) | [github.com/microsoft/playwright](https://github.com/microsoft/playwright) | End-to-end browser testing |
| [Testing Library](https://testing-library.com) | [github.com/testing-library](https://github.com/testing-library) | Component testing utilities for React |
| [ESLint](https://eslint.org) | [github.com/eslint/eslint](https://github.com/eslint/eslint) | Code linting and style enforcement |

## Design Document References

Projects referenced in design documents for future integration patterns:

| Project | URL | Context |
|---------|-----|---------|
| [grammY](https://grammy.dev) | [github.com/grammyjs/grammY](https://github.com/grammyjs/grammY) | Telegram Bot API framework — referenced in messaging integration design |
| [@slack/bolt](https://slack.dev/bolt-js) | [github.com/slackapi/bolt-js](https://github.com/slackapi/bolt-js) | Slack app framework — referenced in messaging integration design |
| [@dnd-kit](https://dndkit.com) | [github.com/clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) | Drag-and-drop toolkit — referenced in Kanban board design |

---

Thank you to all the maintainers and contributors of these projects. Open source makes projects like Flightdeck possible. 🙏
