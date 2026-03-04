---
name: use-task-dag-for-coordination
description: When coordinating multiple tasks across multiple agents, always use DECLARE_TASKS to create a task DAG instead of manual tracking. Applies whenever a project lead has 3 or more tasks to coordinate.
---

## Always Use Task DAG for Multi-Task Coordination

When you are a Project Lead coordinating multiple tasks across multiple agents, **always use DECLARE_TASKS** to create a task DAG at the start of the project.

### Why
- Manual tracking via TODO lists is error-prone and doesn't auto-schedule
- The DAG system handles dependency ordering, parallel execution, and status tracking automatically
- TASK_STATUS gives you real-time visibility into what's done, what's blocked, and what's ready
- Other agents and the system can query DAG state for coordination

### When to Use
- Any project with **3 or more tasks**
- Any project with **task dependencies** (B depends on A finishing first)
- Any project with **multiple agents** working in parallel

### How
1. Break the work into discrete tasks with clear IDs
2. Identify dependencies between tasks
3. Use DECLARE_TASKS with the full task list and dependency graph
4. Use TASK_STATUS to monitor progress
5. Use QUERY_TASKS to inspect state when debugging

### Example
Instead of manually delegating and tracking:
```
DECLARE_TASKS with tasks:
- {id: 'design', role: 'architect', description: '...'}
- {id: 'implement', role: 'developer', dependsOn: ['design']}
- {id: 'review', role: 'code-reviewer', dependsOn: ['implement']}
- {id: 'test', role: 'qa-tester', dependsOn: ['review']}
```

The system will auto-start each task when its dependencies complete.
