# Settings

The Settings page lets you configure the orchestration framework.

## Oversight

Control how much autonomy agents have. Three tiers:

- **Supervised** — Agents ask before most actions. Best for learning or critical codebases.
- **Balanced** (default) — Routine work flows, structural changes need approval.
- **Autonomous** — Agents work independently. You monitor results.

Each tier injects behavioral instructions into agent system prompts. You can also add **custom instructions** in natural language (e.g., "Always run tests before committing").

Oversight is per-project with a global default. New projects inherit the global setting.

→ [Oversight Guide](/guide/oversight)

## Concurrency

- **Max Concurrent Agents** — Maximum number of agents that can run simultaneously (default: 10)
- **Auto-Restart** — Automatically restart crashed agents (default: enabled)
- **Max Restarts** — Maximum restart attempts before giving up

## Model Defaults

Override the default model for any role. Changes apply to newly created agents.

## Custom Roles

Register new roles with:
- **ID** — Unique identifier (kebab-case)
- **Name** — Display name
- **Icon** — Emoji icon
- **Color** — Hex color for UI elements
- **System Prompt** — Instructions for the agent
- **Default Model** — AI model to use

## Tool Permissions

Agents request tool permissions (file writes, shell commands) during operation. Permission timeout behavior depends on the agent's mode:
- **Autopilot ON** (lead-spawned or user-enabled): tool calls are auto-approved immediately
- **Autopilot OFF** (manually spawned): tool calls are **auto-denied** after 60 seconds if the user hasn't responded

## Data Management

Monitor and manage the SQLite database that stores all session data.

- **Database Statistics** — File size, total records, oldest session date, per-table breakdown
- **Purge Old Data** — Select a retention period and preview what will be deleted before confirming
- **Safety** — Only completed sessions can be purged. Active sessions are protected. All deletions are transactional.

→ [Data Management Guide](/guide/data-management)
