# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

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
- Restore sibling sub-lead visibility in `CREW_UPDATE`
- Bezier edges in DAG visualization for clearer connectivity
- Hide incoming DMs in main chat feed and auto-scroll agent reports
- Hide outgoing DMs and make incoming messages collapsible
- @mention rendering in user messages, system messages, and agent comms panel
- Google eng-practices reference added to code-reviewer role
- '@ to mention files' hint in lead chat placeholder

### Changed

- Bumped all package versions from 0.1.0 to 0.2.0
- Bumped lucide-react ^0.575.0 → ^0.577.0 and postcss ^8.5.6 → ^8.5.8
- Global JSON body parser limit raised from 1MB to 10MB to support image attachments
- Renamed 'OTHER PROJECT AGENTS' to 'OTHER TEAM MEMBERS' for clarity
- Comprehensive documentation refresh across README, docs site, and presentation slides
  - Standardized command field names across all documentation
  - Added Agent role, `SPAWN_AGENT`, `ACTIVITY`, `LIST_TEMPLATES`, `APPLY_TEMPLATE`, `DECOMPOSE_TASK` to README
  - Fixed command field names to match Zod schemas
  - Documented WebSocket subscription architecture (agent vs UI)
  - Polished README for new-user experience
  - Updated repo URL and installation instructions (global install pattern)
  - Updated footer to note AI-assisted documentation

### Fixed

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
