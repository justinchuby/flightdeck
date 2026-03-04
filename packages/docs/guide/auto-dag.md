# Auto-DAG: Automatic Task Tracking

The Auto-DAG system automatically creates and manages task DAG entries from agent delegations. Instead of manually declaring every task before delegating, the system tracks delegations as they happen — **zero bookkeeping required**.

## How It Works

When the lead delegates work to an agent (via `CREATE_AGENT` or `DELEGATE`), the system:

1. **Checks for an existing DAG task** — if `dagTaskId` is provided or a matching ready task exists, it links to that task
2. **Auto-creates a new task** — if no matching task exists, a DAG task is created automatically with a readable ID
3. **Infers dependencies** — using a 3-tier system (see below)
4. **Auto-completes on finish** — when the agent reports completion or goes idle, the matching DAG task is marked done

### Two Modes, One DAG

| Mode | When to use | How it works |
|------|------------|--------------|
| **Explicit DAG** | Planned work with known structure | Lead calls `DECLARE_TASKS` upfront, delegations link to pre-declared tasks |
| **Auto DAG** | Ad-hoc work, quick tasks | Each delegation auto-creates a DAG task if none exists |

Both modes coexist. Auto-DAG fills gaps when explicit planning is incomplete — it's the safety net, not a replacement for thoughtful planning.

## Auto-Creation

When a delegation doesn't match any existing DAG task, the system:

1. **Checks for near-duplicates** — if an active task with a similar description exists (>60% similarity), it warns instead of creating a duplicate
2. **Generates a readable task ID** — e.g., `auto-developer-fix-dag-bugs-1a2b`
3. **Creates the task** with auto-populated fields
4. **Starts the task** and assigns it to the delegated agent

### Auto-Populated Fields

| Field | Source | Example |
|-------|--------|---------|
| `id` | Generated from role + task keywords | `auto-developer-fix-dag-bugs-1a2b` |
| `role` | Role from the delegation | `developer` |
| `title` | First 120 chars of task text | "Fix DAG auto-linking bugs" |
| `description` | Full task text | Complete delegation description |
| `priority` | Default | `5` (medium) |
| `assignedAgentId` | Set automatically when started | `0b85de78...` |

### Near-Duplicate Detection

Before creating a new task, the system compares the delegation text against all active tasks using text similarity. If a match exceeds 60% similarity, it warns:

```
⚠️ Similar DAG task exists: "p0-2-autolink". Use dagTaskId: "p0-2-autolink" to link explicitly.
```

This prevents the same work from being tracked twice when re-delegating or rephrasing tasks.

## Dependency Inference (3 Tiers)

Dependencies are detected through three complementary mechanisms, from most reliable to most flexible:

### Tier 1: Explicit `dependsOn` (Recommended)

Include a `dependsOn` array in the delegation payload:

```
⟦⟦ DELEGATE {"to": "agent-id", "task": "Review the API changes", "dependsOn": ["implement-api"]} ⟧⟧
```

```
⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build the frontend", "dependsOn": ["design-api", "setup-db"]} ⟧⟧
```

This is the most reliable path — no inference needed, dependencies are exact.

### Tier 2: Review Role Inference

When delegating to a `code-reviewer` or `critical-reviewer`, the system automatically detects what's being reviewed using three strategies:

**Agent ID reference** — mentions an agent's ID in the task text:
```
⟦⟦ DELEGATE {"to": "reviewer-id", "task": "Review the fix by developer 0b85de78"} ⟧⟧
// → auto-links to the DAG task assigned to agent 0b85de78
```

**Task ID reference** — mentions a DAG task ID:
```
⟦⟦ DELEGATE {"to": "reviewer-id", "task": "Review P0-2 autolink changes"} ⟧⟧
// → auto-links to task "p0-2-autolink"
```

**Role reference** — mentions a role with "by" or "from":
```
⟦⟦ DELEGATE {"to": "reviewer-id", "task": "Review the API changes from the architect"} ⟧⟧
// → auto-links to the most recent architect task
```

### Tier 3: Secretary-Assisted Inference

When Tiers 1 and 2 produce no dependencies and a Secretary agent is active, the system sends the Secretary a dependency analysis request. The Secretary uses LLM reasoning to evaluate whether the new task depends on any active tasks and can respond with:

```
⟦⟦ ADD_DEPENDENCY {"taskId": "auto-developer-fix-bugs-1a2b", "dependsOn": ["implement-api"]} ⟧⟧
```

This is **asynchronous** — the task starts running immediately, and late-added dependencies are informational for DAG visualization and progress tracking.

## Auto-Completion

When an agent completes its work (reports idle, sends a completion message, or exits), the system automatically:

1. Looks up the agent's assigned DAG task via `assignedAgentId`
2. Calls `completeTask()` to mark it done
3. Promotes dependent tasks from `blocked` → `ready` if all their dependencies are now satisfied

No manual `COMPLETE_TASK` call is needed from the lead. Agents can also explicitly complete their own task:

```
⟦⟦ COMPLETE_TASK {"summary": "Implemented the feature", "taskId": "my-task-id"} ⟧⟧
```

## The ADD_DEPENDENCY Command

Any agent can add dependencies between tasks using `ADD_DEPENDENCY`:

```
⟦⟦ ADD_DEPENDENCY {"taskId": "build-frontend", "dependsOn": ["design-api", "setup-db"]} ⟧⟧
```

The system validates:
- Both the task and dependency targets exist
- Adding the dependency would not create a cycle (checked via BFS traversal)
- If the dependency isn't done yet, the task is blocked

Non-lead agents resolve the lead through their parent chain, so they can manage dependencies on their lead's DAG.

## Examples

### Planned Work with Explicit DAG

```
⟦⟦ DECLARE_TASKS {"tasks": [
  {"taskId": "design-api", "role": "architect", "title": "Design REST API"},
  {"taskId": "impl-api", "role": "developer", "title": "Implement API", "dependsOn": ["design-api"]},
  {"taskId": "review-api", "role": "code-reviewer", "title": "Review API", "dependsOn": ["impl-api"]}
]} ⟧⟧

⟦⟦ CREATE_AGENT {"role": "architect", "task": "Design the REST API", "dagTaskId": "design-api"} ⟧⟧
// Links to pre-declared task, marks it running
```

### Ad-Hoc Work with Auto-DAG

```
⟦⟦ DELEGATE {"to": "dev-agent-id", "task": "Fix the login bug reported by the user"} ⟧⟧
// Auto-creates: "auto-developer-fix-login-bug-3x4y" → running

⟦⟦ DELEGATE {"to": "reviewer-id", "task": "Review the login fix by developer 0b85de78"} ⟧⟧
// Auto-creates review task, auto-links dependency to 0b85de78's task
```

### Mixed Mode (Explicit + Auto)

```
⟦⟦ DECLARE_TASKS {"tasks": [
  {"taskId": "auth", "role": "developer", "title": "Build auth module"},
  {"taskId": "api", "role": "developer", "title": "Build API", "dependsOn": ["auth"]}
]} ⟧⟧

// These link to declared tasks:
⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build auth module", "dagTaskId": "auth"} ⟧⟧
⟦⟦ CREATE_AGENT {"role": "developer", "task": "Build API", "dagTaskId": "api"} ⟧⟧

// This ad-hoc task auto-creates since it's not in the DAG:
⟦⟦ DELEGATE {"to": "dev-id", "task": "Fix the CSS styling issue", "dependsOn": ["api"]} ⟧⟧
// Auto-creates "auto-developer-fix-css-styling-5z6w" with explicit dependency on "api"
```

## Behavior Summary

| Scenario | What happens |
|----------|-------------|
| Delegation matches existing DAG task | Linked via `findReadyTask()` — no auto-creation |
| Delegation with `dagTaskId` | Links to specified task directly |
| Delegation with no match | Auto-creates a DAG task |
| Near-duplicate delegation | Warns with existing task ID |
| Review delegation | Auto-links as dependency of reviewed work (Tier 2) |
| Delegation with `dependsOn` | Explicit dependencies wired (Tier 1) |
| Agent completes | Auto-marks matching DAG task as done |
| All dependencies satisfied | Blocked tasks promoted to ready |
