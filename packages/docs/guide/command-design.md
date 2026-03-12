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
| `delegationId` | Delegation | `CANCEL_DELEGATION {"delegationId": "del-123"}` |

> **Note:** Groups are referenced by name (the `group` field), not by typed ID, since group names are human-readable identifiers.

### Help Text Format

Command help uses a consistent format for argument visibility:

- **Required arguments:** `<fieldName: type>` — must be provided
- **Optional arguments:** `[fieldName: type]` or `[fieldName: type = default]` — can be omitted

```
SET_TIMER <label: string> <delay: number> <message: string> [repeat: boolean = false]
```

## Schema-Driven Help (Zod → CommandArg)

Command argument metadata is **derived from Zod schemas**, not maintained separately. This eliminates drift between validation and documentation.

### How It Works

Each Zod schema field uses `.describe()` to annotate its purpose. The `deriveArgs(schema)` function introspects `schema.shape` to auto-generate `CommandArg[]` for help rendering:

```typescript
// Zod schema — single source of truth
const setTimerSchema = z.object({
  label: z.string().describe('Timer name'),
  delay: z.number().describe('Seconds to wait').pipe(z.number().int().positive()),
  message: z.string().describe('Message to deliver when timer fires'),
  repeat: z.boolean().optional().default(false).describe('Fire repeatedly'),
});

// Help metadata — derived, not hand-maintained
help: {
  ...deriveHelp(setTimerSchema, 'Set a reminder timer', 'Timers'),
  example: 'SET_TIMER {"label": "check-build", "delay": 300, "message": "Check CI"}',
}
```

`deriveArgs()` extracts field name, type, required/optional, description, and default value from each schema field. The `deriveHelp()` convenience wraps this with a command description and category.

### Conventions

- **Every Zod schema field must have `.describe('...')`** — drift detection tests catch missing annotations
- Place `.describe()` as the **last call** in the chain (after `.optional()`, `.default()`, etc.) unless using `.pipe()` — then put `.describe()` before the pipe so it describes the input type
- Use `deriveHelp(schema, description, category)` and spread into the command's `help` object
- Keep hand-written `example` strings — auto-generated examples are worse than curated ones

### Overrides

For edge cases (e.g., mutually exclusive fields), pass manual `args` that override the derived ones:

```typescript
// CANCEL_TIMER accepts timerId OR label (mutually exclusive)
help: {
  ...deriveHelp(cancelTimerSchema, 'Cancel a timer', 'Timers'),
  args: [
    { name: 'timerId', type: 'string', required: false, description: 'Timer ID to cancel' },
    { name: 'label', type: 'string', required: false, description: 'Timer label to cancel' },
  ],
  example: 'CANCEL_TIMER {"label": "check-build"}',
}
```

Manual `args` in the `help` object take precedence over derived args.

## Adding New Commands

When adding a new command:

1. **Define a Zod schema** with `.describe('...')` on every field — drift tests enforce this
2. **Use typed IDs** — never a bare `id` field
3. **Follow camelCase** — no exceptions
4. **Reuse standard field names** where they fit (`to`, `content`, `summary`, `reason`, `task`)
5. **Use `deriveHelp()`** for help metadata — add a hand-written `example`
6. **Co-locate help with the command definition** — don't maintain a separate list
