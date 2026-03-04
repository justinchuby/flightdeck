---
name: agent-collaboration-patterns
description: Proven collaboration patterns for flightdeck-based multi-agent crews. Covers architect-first mapping, dual review, file lock coordination, context pressure, and DAG management. Use when planning any crew session with 3+ agents.
---

# Agent Collaboration Patterns

Extracted from a 10-agent session that resolved 8 sub-issues across 6 GitHub issues in ~15 minutes with 966+ tests passing (retrospective #36).

## When This Doesn't Apply

- Solo agent tasks or 2-agent sessions — these patterns add overhead that isn't justified.
- Sessions under 3 issues or 10 minutes estimated duration — simpler coordination suffices.
- Fully independent workstreams where agents share no files, types, or interfaces.

## Known System Limitations

Be aware of these constraints when applying the patterns below:
- **File locking is file-level, not function-level.** Two agents cannot edit different functions in the same file simultaneously.
- **Reviewer diffs can go stale.** There is no notification when a file changes while a reviewer is reading it.
- **DAG completion requires manual `COMPLETE_TASK` calls.** Auto-update on agent message-based completion is not yet implemented.

## Pattern 1: Architect-First Codebase Mapping

**What:** Before any code is written, have the architect explore the codebase scoped to the assigned issues and produce a targeted map with files, methods, line numbers, and proposed fixes.

**Scope guidance:** Limit the architect's exploration to packages/directories that the issues reference. For large codebases (100K+ files), do NOT explore the entire repo — focus on the relevant modules. Budget 5 minutes maximum for the mapping phase.

**Why it works:** 5 minutes of architect analysis saved ~30 minutes of cumulative developer exploration (6 developers × 5 minutes each). The map also ensures consistent approaches — e.g., all developers agreed on `'terminated'` as the status string rather than each choosing their own.

**How to do it:**
1. Architect reads all issues and explores relevant directories.
2. Architect produces a map file at `.flightdeck/shared/architect-<id>/issue-map.md`.
3. Every developer's delegation prompt includes: "Read the architect map at [path] before starting."
4. The map should include: file paths, function/method names, approximate line numbers, and the proposed change.

**Important:** The architect's map is a starting point, not a contract. Developers should verify line numbers and proposed approaches against current code (line numbers shift after other agents commit). If a developer finds the map is wrong, they should message the architect and the lead immediately.

**Example entry from the retro's map:**
```
### Issue #28 — Silent state failures
- File: packages/server/src/TaskDAG.ts
- Method: completeTask(), failTask()
- Line: ~45-60
- Fix: Add state guards — throw if task is already in terminal state
```

## Pattern 2: Dual Reviewer Pattern (Correctness + Security)

**What:** Use two reviewers with different focuses:
- **Code Reviewer:** "Does it work? Does it match the requirements?"
- **Critical Reviewer:** "What breaks? What are the edge cases and security implications?"

**Why it works:** In the retro, the code reviewer approved both initial implementations. The critical reviewer then found a **P0 blocker** the code reviewer missed: the frontend `AgentStatus` type didn't include `'terminated'`, meaning the server would emit a status the frontend couldn't handle.

**When to use dual review:** Assign both reviewer types when changes modify both client-facing types AND server-side logic, or when a contract (API, type definition, event schema) is modified. For single-file bug fixes within one package, one reviewer suffices.

## Pattern 3: Broadcast-Then-Refactor for Cross-Cutting Concerns

**What:** When a developer creates a reusable helper, they broadcast its existence so other agents use it instead of writing inline alternatives.

**Example from the retro:** Developer 355166b5 extracted `isTerminalStatus()` from Agent.ts and broadcast: "New helper available: `isTerminalStatus()` — use it instead of inline status checks." This prevented 5+ locations from using inconsistent inline checks.

**Guideline:** Any time you create a utility function, type, or constant that other agents might need, broadcast it immediately. Don't wait for code review to catch the duplication.

## Pattern 4: Parallel Execution with File-Lock Discipline

**What:** Identify independent workstreams by file ownership, then run them in parallel with strict file locking.

**How the lead did it in the retro:**
| Agent | Files | Independence |
|-------|-------|-------------|
| Dev 78f3 | 4 `.tsx` files | Fully independent (frontend) |
| Dev 3551 | AgentManager.ts, Agent.ts | Independent |
| Dev b398 | TaskDAG.ts | Independent |
| Dev 80a8 | Agent.ts, CommandDispatcher.ts | Shared Agent.ts with 3551 |
| Dev 4358 | config.ts, ChatGroupRegistry.ts | Independent |

**Result:** Zero merge conflicts despite 6+ developers editing files in the same package.

**Guideline:** When planning parallel work, map out which files each agent will touch. If two agents need the same file, sequence them explicitly and have the first agent release locks promptly.

## Anti-Pattern 1: God Files Create Bottlenecks

**Problem:** `CommandDispatcher.ts` (1,248 lines) required changes for 6 out of 8 issues. File-level locking serialized all work on it, causing ~5 minutes of blocked developer time.

**Guideline:** When you encounter a hot file (3+ agents need it), consider:
1. **Sequencing explicitly:** Assign clear order — Agent A → Agent B → Agent C — and have each release locks immediately after committing.
2. **Batching:** Have one agent make all changes to the hot file based on the architect's map, rather than passing it between 4 agents. Batching works best when the changes are small and well-specified. For complex changes requiring deep understanding, prefer explicit sequencing with prompt lock handoff.
3. **Long-term:** Flag the file for decomposition in a future session.

## Anti-Pattern 2: Declaring a DAG But Not Updating It

**Problem:** The lead used `DECLARE_TASKS` to create the DAG but tracked progress mentally instead of using `TASK_STATUS`/`QUERY_TASKS`. The DAG showed all tasks as "pending" despite most being done.

**Guideline:**
- When agents report completion via messages, the lead (or secretary) should call `COMPLETE_TASK` for the corresponding DAG task.
- Check DAG state after each major milestone: when a workstream completes, when reviews finish, and when transitioning between phases. Also check when an agent reports unexpected state.
- See the `use-task-dag-for-coordination` skill for detailed DAG management patterns.

## Anti-Pattern 3: Skipping the Secretary When Coordination Gets Heavy

**Problem:** The lead managed 10 agents, 8 issues, and multiple review rounds entirely in its own context window. By the end, context was heavily loaded and updates were processed in batches with less granular attention.

**Guideline:** Consider a secretary agent when you expect significant parallel work with frequent status updates. The secretary overhead (~30 seconds to create) is only justified if the lead is struggling to track multiple workstreams. If in doubt, skip the secretary for the first 5 minutes and create one if coordination becomes overwhelming.

## Anti-Pattern 4: Reviewers Working on Stale Diffs

**Problem:** A reviewer flagged an issue that the architect had already fixed 30 seconds earlier. The reviewer was reading a stale `git diff` snapshot.

**Guideline:**
- Reviewers should pull fresh diffs (`git diff`) immediately before writing their review, not at the start of their analysis.
- If a review takes more than 60 seconds, re-check the diff before submitting findings.
- When receiving review feedback, check if the issue is already fixed before acting on it.

## Anti-Pattern 5: Deferred Findings With No Tracking

**Problem:** The critical reviewer found 5 P1 issues but only the P0 was addressed. The other 4 P1s existed only in a shared markdown file that would be lost after the session.

**Guideline:** Use `DEFER_ISSUE` during the session to queue deferred findings. At session end, file GitHub issues as a batch for any deferred findings that weren't resolved. Only file immediately for P0/P1 issues that definitely won't be addressed this session. Never leave deferred findings only in ephemeral session files — a finding that isn't tracked is a finding that's lost.

## Anti-Pattern 6: Context Pressure From Long-Running Agents

**Problem:** Long-running agents accumulated context over multiple review-fix iterations. Later delegations relied on accumulated (potentially stale) context rather than fresh reads.

**Guideline:** Watch for signs of context pressure: inconsistent references to earlier work, repeated questions about things already discussed, or outputs that contradict the agent's own prior actions. These signal it's time to rotate — spin up a fresh agent with a summary of what's been done so far. When re-delegating to an existing agent, include a brief summary rather than assuming they remember accurately.

## Anti-Pattern 7: Duplicate Task Assignment

**Problem:** The lead delegated overlapping tasks to multiple agents without checking whether a similar task was already assigned. This wasted agent compute and created confusion about ownership.

**Guideline:** Before delegating a task, use `QUERY_TASKS` to check if a similar task is already active. If using a DAG, the task list shows what's assigned. If not, check recent AGENT_MESSAGE history for delegation acknowledgments. When in doubt, ask: "Is anyone already working on [topic]?" via BROADCAST before delegating.

## Session Planning Checklist

- [ ] Have the architect map relevant code and all issues before delegating to developers.
- [ ] Map file ownership to identify parallel workstreams and bottleneck files.
- [ ] Consider a secretary if the lead is tracking 5+ parallel agents.
- [ ] Create a DAG with `DECLARE_TASKS` and assign someone to keep it updated.
- [ ] Check `QUERY_TASKS` before delegating to avoid duplicate assignments.
- [ ] Plan explicit sequencing for shared files (who goes first, second, third).
- [ ] Assign dual reviewers for changes that cross package boundaries or modify contracts.
- [ ] Use `DEFER_ISSUE` for findings that won't be addressed this session; batch-file GitHub issues at session end.
