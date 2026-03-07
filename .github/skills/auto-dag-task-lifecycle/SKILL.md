---
name: auto-dag-task-lifecycle
description: How the Auto-DAG task lifecycle works — task states, dependency resolution, and common pitfalls
---

# Auto-DAG Task Lifecycle

Tasks in the DAG follow a state machine: **pending** → **ready** → **running** → **done/skipped/failed**.

## States

| State | Meaning |
|-------|---------|
| `pending` | Dependencies not yet satisfied |
| `ready` | All dependencies satisfied, files available for lock |
| `running` | Delegated to an agent |
| `done` | Completed successfully |
| `skipped` | Skipped (e.g., superseded by another task) |
| `failed` | Failed after attempts |

## Dependency Resolution

The `resolveReady()` method promotes `pending` tasks to `ready` when their dependencies complete. It is called reactively inside `completeTask()`, `skipTask()`, and `cancelTask()`.

## Key Rule

When adding tasks whose dependencies are already `done`, the task must be set to `ready` not `pending`. The `resolveReady()` method must also be called after batch task creation (`declareTaskBatch`) to catch tasks with pre-completed deps.

## Common Pitfall

Tasks added **after** their deps complete can get stuck in `pending` if dependency satisfaction isn't checked at creation time. `findReadyTask()` has a safety net that auto-promotes stuck pending tasks, but this is a fallback — not the primary mechanism.

## Best Practice

After calling `declareTaskBatch()`, always call `resolveReady()` to promote any tasks whose deps are already satisfied.
