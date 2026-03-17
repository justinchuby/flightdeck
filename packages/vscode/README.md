# Flightdeck for VS Code

Multi-agent orchestration platform integration for Visual Studio Code.

## Features

- **Agent Sidebar** — Hierarchical tree view of all agents (leads and children) with live status icons, role/model info, and context usage
- **Task DAG View** — Browse the task dependency graph with status tracking (pending, in-progress, done, failed, blocked)
- **File Lock Browser** — See which files are locked and by whom; click to open locked files
- **File Lock Decorations** — Lock badges (🔒) on files in the explorer, with editor gutter highlights for open locked files
- **Agent Terminals** — Pseudo-terminal panels that stream agent output and accept user input forwarded via REST
- **Status Bar** — Quick access to the Flightdeck dashboard
- **Decision Notifications** — Get notified when agents need human approval *(coming soon)*
- **Dashboard Webview** — Embedded overview dashboard *(coming soon)*

## Requirements

- A running [Flightdeck](https://github.com/justinchuby/flightdeck) server (default: `http://localhost:3001`)
- VS Code 1.85.0 or later

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `flightdeck.serverUrl` | `http://localhost:3001` | URL of the Flightdeck server |
| `flightdeck.autoConnect` | `true` | Automatically connect on startup |
| `flightdeck.showNotifications` | `true` | Show notifications for agent events |

## Getting Started

1. Install the extension
2. Start your Flightdeck server
3. The extension auto-connects on startup (or run **Flightdeck: Connect to Server** from the Command Palette)
4. Open the Flightdeck sidebar (rocket icon in the Activity Bar)

## Screenshots

*Screenshots coming soon.*

## Known Issues

- WebSocket real-time updates not yet implemented — tree views require manual refresh
- Dashboard webview is a placeholder
- Agent message sending is stubbed

## Links

- [Flightdeck Repository](https://github.com/justinchuby/flightdeck)
- [Documentation](https://justinchuby.github.io/flightdeck/)
- [Issue Tracker](https://github.com/justinchuby/flightdeck/issues)

## License

MIT
