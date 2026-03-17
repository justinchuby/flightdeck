# Changelog

## [0.5.0] — 2026-03-14

### Added

- Initial release of the Flightdeck VS Code extension
- Sidebar with three tree views: Agents, Tasks, File Locks
- FlightdeckConnection REST client with auto-connect
- AgentsTreeProvider — hierarchical agent tree (lead → children) with status icons
- TasksTreeProvider — task DAG view with dependency children
- FileLocksTreeProvider — active file locks with click-to-open
- FileLockDecorationProvider — lock badges on files in the explorer
- LockedFileHighlighter — editor background highlights for locked files
- AgentTerminalManager — pseudo-terminals for agent output and input
- Status bar item with dashboard shortcut
- Extension settings: serverUrl, autoConnect, showNotifications
- Placeholder SVG activity bar icon
