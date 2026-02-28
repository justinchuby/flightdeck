# Settings

The Settings page lets you configure the orchestration framework.

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
