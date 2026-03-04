# Command Design Principles

Design guidelines for Flightdeck's agent command system. These principles ensure commands are consistent, predictable, and easy for both humans and AI agents to use.

## AI-Agent Friendliness

All command arguments should be **explicitly typed** — no bare `id` fields. Use `taskId`, `agentId`, `timerId`, `issueId`, etc.

AI agents compose commands from memory across 46+ commands. Consistency and explicitness are more important than brevity.

**Why this matters:** An agent remembering that `id` means a task in one command and a timer in another creates confusion. When every ID is typed, the agent never has to remember exceptions. Consistency is the most AI-friendly design choice.

```
# ❌ Bad — what kind of ID?
CANCEL_TIMER {"id": "check-build"}
COMPLETE_TASK {"id": "rope-config"}

# ✅ Good — self-documenting
CANCEL_TIMER {"timerId": "check-build"}
COMPLETE_TASK {"taskId": "rope-config"}
```

## Naming Conventions

All field names use **camelCase** (no snake_case).

### Standard Field Names

| Field | Usage | Example |
|-------|-------|---------|
| `to` | Messaging target (agent ID or prefix) | `AGENT_MESSAGE {"to": "abc123", ...}` |
| `content` | Message body | `BROADCAST {"content": "Use factory pattern"}` |
| `summary` | After-the-fact description of what happened | `COMPLETE_TASK {"summary": "Implemented auth"}` |
| `reason` | Justification for an action | `TERMINATE_AGENT {"reason": "need slot"}` |
| `task` | Work description (what to do) | `DELEGATE {"task": "Fix the tests", ...}` |
| `filePath` | File reference | `LOCK_FILE {"filePath": "src/auth.ts"}` |

### Typed IDs

IDs are always prefixed with their entity type:

| Field | Entity | Example |
|-------|--------|---------|
| `taskId` | DAG task | `COMPLETE_TASK {"taskId": "rope-config"}` |
| `agentId` | Agent | `CANCEL_DELEGATION {"agentId": "abc123"}` |
| `timerId` | Timer | `CANCEL_TIMER {"timerId": "check-build"}` |
| `issueId` | Deferred issue | `RESOLVE_DEFERRED {"issueId": 1}` |
| `groupId` | Chat group | `GROUP_MESSAGE {"groupId": "config-team", ...}` |
| `delegationId` | Delegation | `CANCEL_DELEGATION {"delegationId": "del-123"}` |

### Help Text Format

Command help uses a consistent format for argument visibility:

- **Required arguments:** `<fieldName: type>` — must be provided
- **Optional arguments:** `[fieldName: type]` or `[fieldName: type = default]` — can be omitted

```
SET_TIMER <label: string> <delay: number> <message: string> [repeat: boolean = false]
```

## Adding New Commands

When adding a new command:

1. **Use typed IDs** — never a bare `id` field
2. **Follow camelCase** — no exceptions
3. **Reuse standard field names** where they fit (`to`, `content`, `summary`, `reason`, `task`)
4. **Add help metadata** — description, example, category, and argument definitions with types
5. **Co-locate help with the command definition** — don't maintain a separate list
