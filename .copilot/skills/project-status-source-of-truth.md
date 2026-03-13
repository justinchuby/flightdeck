# Project Status: Use Agent Counts, Not the DB Field

## When to use
When rendering UI that depends on whether a project is "active" or "stopped" — buttons, badges, conditional sections. The `project.status` DB field is stale after server restarts.

## The Problem

The `projects` table has a `status` field (`'active'`, `'stopped'`, `'archived'`), but it can become stale. After a server restart, `reconcileStaleSessions()` marks sessions stopped, but the project-level `status` field may not be updated consistently. This means `project.status === 'active'` can be true even when zero agents are running.

## The Fix: `projectStatusProps()`

The `projectStatusProps()` function in `packages/web/src/components/ui/StatusBadge.tsx` computes effective status from real-time agent counts:

```typescript
import { projectStatusProps } from '../ui/StatusBadge';

const effectiveStatus = projectStatusProps(project);
// effectiveStatus.variant: 'success' | 'warning' | 'error' | 'neutral'
// effectiveStatus.label: 'Active' | 'Idle' | 'Error' | 'Stopped' | 'Archived'

const isLive = effectiveStatus.variant === 'success' || effectiveStatus.variant === 'warning';
```

### Status mapping:
| Condition | variant | label |
|-----------|---------|-------|
| `runningAgentCount > 0` | `success` | Active |
| `idleAgentCount > 0` | `warning` | Idle |
| `failedAgentCount > 0` | `error` | Error |
| `activeAgentCount > 0` (fallback) | `success` | Active |
| None of the above | `neutral` | Stopped |
| `status === 'archived'` | `neutral` | Archived |

## Rule

**Always use `projectStatusProps()` for UI decisions**, not `project.status`. The badge already uses it — buttons, links, and conditional sections must match.

## Files
- Source of truth: `packages/web/src/components/ui/StatusBadge.tsx` → `projectStatusProps()`
- Consumer example: `packages/web/src/components/ProjectsPanel/ProjectsPanel.tsx` → action buttons
