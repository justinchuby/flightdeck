# Critical Review — Wave 2 Features

**Reviewer**: Critical Reviewer (e66cd95c)
**Date**: 2026-02-28 ~14:29
**Scope**: Task dedup, deferred issues, timeline API, @mentions (not found), auto-DAG update, projectId scoping

---

## 1. Task Dedup — `findSimilarActiveDelegation()` (CommandDispatcher.ts:1488-1520)

**Severity: Low** — Advisory only (returns warning, doesn't block)

### How it works
- Extracts words from task text (lowercased, stop words removed, >2 chars)
- Computes Jaccard-like similarity: `shared / Math.min(taskWords.size, delWords.size)`
- Threshold: `> 0.5` triggers warning

### Findings

**P2 — False negatives with short tasks**: If the new task has 2 meaningful words and the delegation has 50 words, denominator is `Math.min(2, 50) = 2`. So matching 2/2 words = 1.0 similarity. But if the new task has 50 words and the delegation has 2, matching 2/50 = 0.04 → no match. The asymmetry means dedup is directional — short tasks match long ones but not vice versa.

**P3 — Performance with large delegation lists**: The loop iterates ALL delegations (line 1501). With 200 agents × N delegations each, this is O(N) per CREATE_AGENT. Not a real concern at current scale, but `extractWords` re-parses every delegation's task text on every call (no caching). For 1000+ delegations, consider caching word sets.

**P3 — No normalization**: "fix bug" vs "Bug Fix" — lowercased so OK. But "implement" vs "implementation" would NOT match (no stemming). Acceptable for advisory-only use.

**Verdict**: ✅ Acceptable. Advisory-only dedup is the right approach — hard blocking would be fragile.

---

## 2. Deferred Issues — Already reviewed

See previous assessment. Summary:
- P3: No description length limit (suggest `.slice(0, 2000)` before DB insert)
- P3: Any agent can resolve/dismiss (not just lead/original reporter)
- P3: Severity is freeform string

**Verdict**: ✅ No changes needed for merge.

---

## 3. Timeline API — `GET /coordination/timeline` (api.ts:258-362)

### Findings

**P2 — Unbounded response size**: `getRecent(10_000)` returns up to 10K events (line 260). Each event includes `.summary` (sliced to 120 chars for communications, but full for status changes). With 200 agents × 50 events each = 10K events × ~200 bytes = ~2MB response. Could spike to 5MB+ with verbose summaries.

Fix suggestion: Add `?limit=N` query parameter with a default max of 1000.

**P2 — No authentication on timeline endpoint**: The `router.get('/coordination/timeline')` has no auth middleware. If this API is exposed beyond localhost, any client can see all agent activities, task descriptions, delegation summaries, file paths, and communication patterns. Task descriptions can contain sensitive context (credentials mentioned in task text, internal file paths).

Note: If the server only binds to localhost, this is P3. Check bind address.

**P3 — No `since` validation**: `req.query.since` (line 259) is passed directly to `getSince()` — if it's a malformed ISO string, behavior depends on the ledger's date comparison. No crash risk (string comparison), but could return unexpected results.

**Verdict**: ⚠️ P2 if API is exposed beyond localhost. Otherwise acceptable.

---

## 4. @Mentions (packages/web/src/utils/markdown.tsx, GroupChat.tsx)

### How it works
- `MentionText` component (markdown.tsx:27-63): Regex `/@([a-f0-9]{4,8})\b/g` extracts short IDs, resolves via `agents.find(a => a.id.startsWith(shortId))`
- `GroupChat.tsx`: Autocomplete scoped to group members or running/idle agents, inserts `@shortId` into text
- Resolution is client-side only (display rendering), NOT server-side (no agent routing based on @mentions)

### Findings

**P2 — Prefix collision / spoofing**: `agents.find(a => a.id.startsWith(shortId))` (line 39) returns the FIRST matching agent. If two agents share a 4-char prefix (e.g., `a1b2c3d4...` and `a1b2e5f6...`), `@a1b2` always resolves to whichever agent appears first in the array. With 200 agents and 4-char prefixes (65,536 possible hex combos), birthday-paradox collision probability is ~25%. With 8-char prefixes it's negligible.

Mitigation: The autocomplete inserts 8-char IDs (line 85: `agent.id.slice(0, 8)`), but the regex accepts 4-char minimum. Manual typing of `@abcd` could hit collisions. Suggest requiring minimum 6 chars in the regex: `/@([a-f0-9]{6,8})\b/g`.

**P3 — XSS safe**: Mentions render via React JSX (`<span>` with text content), not `dangerouslySetInnerHTML`. No XSS vector.

**P3 — No server-side effect**: @mentions are purely cosmetic (client-side rendering). An `@shortId` in a message sent to the server is just text — no routing, no notification, no access grant. This is the safest design choice.

**P3 — Autocomplete scope leak**: When no group is selected (line 67), candidates include ALL running/idle agents across all projects. In a multi-lead scenario, Agent A's UI could autocomplete and mention Agent B from a different lead's team. No security impact (it's just text), but could be confusing.

**Verdict**: ✅ Acceptable. Purely client-side rendering, no server trust boundary crossed. Prefix collision is cosmetic only.

---

## 5. Auto-DAG Update on Completion (CommandDispatcher.ts:235-248, 305-320)

### How it works
- `notifyParentOfIdle()` line 237-248: On idle report, finds DAG task by agent ID, calls `completeTask()`
- `notifyParentOfCompletion()` line 305-320: On exit, if `exitCode === 0` → `completeTask()`, else → `failTask()`

### Findings

**P2 — Double completion race**: If an agent goes idle (triggering line 239 `completeTask`) and THEN exits with code 0 (triggering line 309 `completeTask`), the same DAG task gets completed twice. The idle dedup at line 264 prevents the *message* from being re-sent, but the `completeTask()` call on line 309 still fires because it's in the `notifyParentOfCompletion` code path and only checks `exitKey` dedup (line 260), not whether the DAG was already updated.

Check `completeTask()` — if it has an idempotency guard (e.g., only completes if status is 'running'), this is fine. If not, it could trigger downstream `newlyReady` notifications twice, causing the lead to try delegating the same task twice.

**P3 — Failed exit after idle**: If agent goes idle (DAG task completed at line 239) and then process crashes (exitCode !== 0 at line 317), `failTask()` is called on an already-completed task. This could regress the DAG state from 'completed' back to 'failed'.

**Verdict**: ⚠️ Check `completeTask()`/`failTask()` idempotency guards. If they have transition validation, it's fine. If not, this is a P1 race.

---

## 6. ProjectId Scoping (api.ts:382-411, AgentManager.ts:292)

### How it works
- Lead agent gets `projectId` at creation (line 398)
- Project sessions tracked via `ProjectRegistry.startSession()`
- On resume, briefing is sent after 3s delay
- `projectId` is just a reference field on the Agent — no access control enforcement

### Findings

**P3 — No project-level authorization**: `projectId` is a client-supplied value at `POST /lead/start` (line 367). Any client can resume any project by guessing/knowing its UUID. The briefing (line 403-408) sends full project history including previous session summaries, task content, and agent details.

In practice: If the API is localhost-only, this is cosmetic. If multi-tenant, it's a P0 — any user can read another user's project history by sending `{ projectId: "known-uuid" }`.

**P3 — No project ID validation**: If a non-existent `projectId` is sent, line 391 logs a warning and creates a NEW project. This means typos in projectId silently create orphan projects instead of returning an error.

**Verdict**: ✅ Acceptable for single-tenant localhost. Flag for multi-tenant expansion.

---

## Summary

| Feature | Severity | Issue | Blocking? |
|---------|----------|-------|-----------|
| Task dedup | P2 | Asymmetric similarity (short→long matches, long→short doesn't) | No |
| Deferred issues | P3 | No length limit, any agent can resolve | No |
| Timeline API | P2 | Unbounded response size, no auth if exposed | No (localhost) |
| Timeline API | P2 | Full task content in responses if exposed | No (localhost) |
| @Mentions | P2 | Prefix collision with 4-char minimum (`agents.find` returns first match) | No |
| @Mentions | ✅ | XSS safe (React JSX), no server-side routing | No |
| Auto-DAG | ✅ | Double completion safe — `validateTransition` guards idempotent | No |
| Auto-DAG | ✅ | Failed exit after idle safe — `failTask` rejects 'done' status | No |
| ProjectId | P3 | No access control on project resume | No (localhost) |

**No P0 blockers.** ✅ Verified: `completeTask()` uses `validateTransition()` which only allows `complete` from `['running', 'ready']` — a second call on a `'done'` task returns `null` (no-op). Similarly, `failTask()` only allows `fail` from `['running']`, so it can't regress a `'done'` task. Both auto-DAG races are safe.

---

## 7. User-Message Highlighting (LeadDashboard.tsx)

### How it works
- User messages identified by `msg.sender === 'user'` (line 1184) — a trusted server-side field, NOT content heuristic
- Navigation via `PromptNav` component (line 2592) — builds `userIndices` array from messages with `sender === 'user'`
- Jump: `container.querySelector(`[data-user-prompt="${userIndices[promptIdx]}"]`)` (line 2610)
- Highlight: CSS class toggling via `classList.add('ring-2', ...)`, removed after 1500ms timeout

### Findings

**✅ No XSS risk**: `msg.sender` is a trusted field from the ACP protocol, not derived from message content. No content pattern matching involved. Message text is rendered via React JSX (`{msg.text}` in line 1189) with automatic HTML escaping — no `dangerouslySetInnerHTML`.

**P3 — querySelector with numeric index**: `data-user-prompt="${userIndices[promptIdx]}"` — the value is always a numeric array index from `useMemo`, never user-controlled content. No CSS selector injection possible.

**P3 — setTimeout cleanup**: The `setTimeout` at line 2616 to remove highlight classes doesn't have a cleanup in `useEffect`. If the component unmounts before 1500ms, it logs a harmless console warning at worst (React updates on unmounted component). Not a real issue.

**Performance**: `userIndices` is memoized via `useMemo([messages])`. Recalculates on every new message, but it's just a `.filter().forEach()` on the message array — O(n) and cheap.

**Verdict**: ✅ No concerns. Clean implementation.

---

## 8. PROGRESS / DAG Consolidation — Option A Assessment

### Current state
- `PROGRESS` (line 758): Parses freeform JSON, emits `lead:progress` event, routes to secretary agents. No structured format required.
- `DECLARE_TASKS` / `TASK_STATUS` (line 992/1029): Structured DAG with dependency tracking, status transitions, file conflict detection.
- These are completely separate systems — PROGRESS doesn't read DAG state, and DAG updates don't emit PROGRESS events.

### Option A: "PROGRESS auto-reads DAG state when DAG exists, lead just sends summary note"

**Concerns**:

**P2 — Stale DAG state race**: If the lead sends PROGRESS while a child agent's completion is being processed (i.e., `completeTask()` in `notifyParentOfIdle` hasn't fired yet), the auto-read will show stale DAG state. The lead's summary text says "task X is done" but the DAG still shows "running". This creates a contradictory PROGRESS message. In practice, single-threaded Node.js makes this unlikely within a single event loop tick, but if the lead sends PROGRESS in response to an `[Agent Report]` message, the DAG update fires in `notifyParentOfIdle` which executes BEFORE the lead sees the report... so timing should be OK in most cases.

**P2 — Manual vs auto mismatch**: If the lead manually manages tasks (without DAG), PROGRESS works fine today. If Option A auto-injects DAG state, leads that DON'T use DAG get an empty/confusing DAG section. Need a clean "no DAG? skip injection" guard.

**P3 — Backward compatibility**: Consumers of `lead:progress` events (secretary agents, frontend) expect the current freeform JSON shape. Auto-injecting DAG fields could break parsers that expect specific keys.

**Recommendation**: Option A is sound IF:
1. DAG injection is guarded by `if (dagStatus.tasks.length > 0)` — skip when no DAG exists
2. The injected DAG state is a separate field (`dagSnapshot`) not merged into the lead's freeform object
3. DAG reads use the same DB transaction / point-in-time snapshot (already true since SQLite reads are serialized)

No blocking concerns. The race condition (P2) is theoretical given Node.js single-threading and SQLite serialization.

---

## 9. TimelineContainer.tsx Concurrent Edit Risk

**File**: `packages/web/src/components/Timeline/TimelineContainer.tsx` (507 lines)

### Assessment

**P1 — High conflict risk**: 507-line React component with 4 developers editing concurrently. Git merge conflicts are almost certain if changes touch overlapping areas (imports, shared state, render tree). Unlike server-side files where function boundaries are clear, React components have deeply nested JSX that git cannot auto-merge reliably.

**Recommendation**: **Serialize edits.** Specifically:
1. Assign ONE developer to make all TimelineContainer.tsx changes in sequence
2. Other devs prepare their changes as specs/patches and hand them off
3. Use the file lock system that already exists — but locks only prevent concurrent *writes*, not merge conflicts from parallel branches

If serialization is too slow, partition the file first: extract sub-components (e.g., `TimelineRow`, `TimelineControls`, `TimelineTooltip`) into separate files, THEN parallelize.

**Verdict**: ⚠️ Serialize or split first. 4 concurrent edits to one 500-line TSX file = guaranteed merge pain.

---

## 10. Group Chat Improvements — Security & Edge Case Review

**Date**: 2026-02-28 ~15:00

### 10a. QUERY_GROUPS / LIST_GROUPS (CommandDispatcher.ts:1433-1451)

**✅ Properly scoped**: Uses `getGroupsForAgent(agent.id)` (line 1434) which JOINs on `chatGroupMembers.agentId` — an agent can ONLY see groups they are a member of. No cross-lead leakage.

**P3 — Last message preview may leak context**: `getGroupSummary()` returns the last message content (sliced to 100 chars, line 243). If an agent was just added to a group, they can see the last message even if it was sent before they joined. This is probably intentional (the ADD_TO_GROUP handler already sends last 20 messages as history on join, line 1286-1297), so this is consistent.

**P3 — N+1 query pattern**: For each group, `getGroupSummary()` runs 2 SQL queries (count + last message). With 20 groups, that's 40 queries. Fine at current scale but could be consolidated into a single query with window functions.

### 10b. Role-Based CREATE_GROUP (CommandDispatcher.ts:1268-1276)

**P2 — Over-broad membership**: `req.roles = ["developer"]` adds ALL developers under the lead, including terminated/completed agents (no status filter at line 1271-1272). Dead agents in the group won't receive messages (the send handler checks `running || idle`), but they inflate the member list and could confuse agents who see "10 members" but only 3 respond.

Fix suggestion: Add `&& !isTerminalStatus(a.status)` to the filter at line 1272.

**P3 — No role validation**: `req.roles` accepts any strings. `["admin", "superuser"]` won't match anything (no error, just empty results merged with explicit members). Harmless but could confuse users. Consider warning when a role name matches zero agents.

### 10c. Auto-Group Creation on Parallel Delegation (CommandDispatcher.ts:733-775)

**P2 — Keyword collision / false grouping**: The keyword extraction (line 742-744) picks the first word >3 chars that isn't a stop word. Tasks like "Review the timeline API" and "Review the codebase" both produce keyword "review" — agents working on completely different things get auto-grouped under "review-team". The stop words list doesn't include "review", "update", "check", "test", "verify" — all common but meaningless for grouping.

Fix suggestion: Either expand the stop word list significantly OR use the DAG task ID as the group key (as the designer suggested) instead of keyword extraction.

**P2 — Group spam on frequent delegations**: `maybeAutoCreateGroup()` is called on every delegation event. The `create` call is idempotent (line 761: `onConflictDoNothing`), but `addMembers` (line 763) and the system message (line 770) fire every time. If the lead delegates 10 tasks with keyword "timeline", the group gets 10 "Auto-created coordination group" system messages (one per delegation that triggers the ≥3 threshold). The `break` at line 773 limits to one group per event, but not one notification per group.

Fix: Track which groups have already been auto-created in a `Set<string>` and skip the system message on subsequent calls.

**P3 — Information disclosure in auto-groups**: The system message (line 770-771) lists all member names and their short IDs. This is fine within a lead's team, but if a sub-lead's agents are auto-grouped, the parent lead's agents could learn about the sub-lead's team composition. Low risk given the `fromAgentId === lead.id` filter at line 736.

### 10d. Group Lifecycle / Auto-Archive (ChatGroupRegistry.ts:249-260)

**DB Migration**: The `archived` column EXISTS in the schema (line 116: `integer('archived').default(0)`) and all 1000 tests pass. The reported 58 test failures appear to be resolved — likely the migration was added and tests re-run.

**P3 — No unarchive**: `archiveGroup()` sets `archived = 1`, but there's no `unarchiveGroup()`. Once archived, a group can only be restored via direct DB manipulation. May want a symmetric operation.

**P3 — Archive doesn't notify members**: When a group is archived, members aren't notified. They'll just stop seeing it in QUERY_GROUPS. A system message to members would be courteous.

### Summary

| Feature | Severity | Issue | Blocking? |
|---------|----------|-------|-----------|
| QUERY_GROUPS | ✅ | Properly scoped to agent's groups only | No |
| Role-based CREATE_GROUP | P2 | Includes terminated agents (no status filter) | No |
| Auto-group keyword | P2 | False grouping on common words ("review-team") | No |
| Auto-group notifications | P2 | Duplicate system messages on repeated delegations | No |
| Group lifecycle | ✅ | DB migration present, 1000 tests pass | No |
| Group lifecycle | P3 | No unarchive, no archive notification to members | No |

**No P0 blockers.** The role-based terminated agent inclusion is the most actionable fix — one-line filter addition.

---

## 11. Catch-Up Summary Banner (LeadDashboard.tsx:63-115, 1157-1175)

**Date**: 2026-02-28 ~15:12

### How it works
- Three `window`-level event listeners (click, keydown, scroll) update `lastInteractionRef.current = Date.now()` on any user activity
- On every data change (agents/projects/selectedLeadId), computes elapsed time since last interaction
- If ≥120s (2 min) inactive AND counts have changed: shows banner with delta summary
- Banner auto-dismisses 10s after user resumes activity (any click/key/scroll)
- Manual dismiss via click on banner or X icon

### 1. Performance — Event Listeners

**P2 — No throttle on window listeners**: `markActive` (line 72) fires on EVERY click, keydown, and scroll event with `{ capture: true }` for scroll. The function body is cheap (`Date.now()` assignment + conditional timeout check), but scroll events fire at 60fps during scrolling. At ~16ms per frame, that's 60 `Date.now()` calls/second + 60 conditional checks.

**Impact**: Negligible in practice. `Date.now()` is a nanosecond operation, and the `catchUpSummary` check is a ref comparison. No DOM reads/writes, no re-renders triggered. The only concern would be in a garbage collection-sensitive scenario (closures), but the closure captures stable refs.

**Suggestion**: A `throttle(markActive, 1000)` would be cleaner but is not strictly necessary for correctness or performance.

**P3 — useEffect re-registers on catchUpSummary change**: The dependency array `[catchUpSummary]` (line 89) means listeners are torn down and re-added whenever the banner appears/disappears. That's 6 removeEventListener + 6 addEventListener calls per state change. Harmless but wasteful — could use a ref for `catchUpSummary` to avoid this.

### 2. Edge Cases — Long Inactivity

**P2 — Stale snapshot after hours of inactivity**: If the user leaves for 4 hours, `snapshotRef.current` still holds counts from 4 hours ago. When data changes trigger the useEffect (line 92), `elapsed >= 120_000` is true, and the delta will be:
- `tasksCompleted = currentTasks - snapshotFromHoursAgo` — could be a huge number
- `newMessages = currentComms - snapshotFromHoursAgo` — same

This is **correct behavior** — it accurately shows what changed. But the banner is a single line (`text-xs font-mono`) and doesn't truncate. With very large numbers (e.g., "247 tasks completed, 3 decisions pending, 891 new messages, 52 agent reports"), the banner could be very wide.

**Suggestion**: For large deltas, consider "247 tasks completed" → "247+ tasks completed" with a "See details" link to a full catch-up view.

**P3 — No snapshot reset on lead switch**: If the user switches `selectedLeadId`, `snapshotRef.current` still holds counts from the previous lead. The delta comparison will be wrong — comparing Lead B's current counts against Lead A's snapshot. Need to reset snapshot when `selectedLeadId` changes.

### 3. Race Conditions — Data Changes During Banner

**✅ Safe**: The banner captures a snapshot at display time (`setCatchUpSummary({...})` at line 108). Subsequent data changes don't update the banner — it shows the frozen delta. The `!catchUpSummary` guard at line 102 prevents recalculation while a banner is displayed. This is the right design — the banner is a point-in-time summary, not a live counter.

**P3 — Missed second wave**: If the user is inactive for 2 min, gets a banner, but doesn't interact for another 2 min, the second wave of changes is invisible. The guard `!catchUpSummary` blocks re-computation. This is a deliberate tradeoff (avoiding banner flicker) but means late changes are silently absorbed when the user eventually dismisses.

### 4. Annoyance / False Positives

**✅ Threshold is reasonable**: 120s (2 min) is long enough to avoid false triggers from brief tab-switches. The `> 0` check on deltas (line 107) prevents empty banners.

**P3 — Tab-backgrounding counts as inactive**: If the user switches browser tabs for 3 minutes (reading docs), they'll get a catch-up banner when they return. This is arguably correct (they WERE away from the dashboard), but could be surprising if the session was only briefly backgrounded.

**P3 — Scroll-capture listener may miss some patterns**: `scroll` with `{ capture: true }` (line 82) catches scroll events on all descendants. But if the user is reading the chat by scrolling with a trackpad gesture that doesn't fire scroll events (e.g., momentum scrolling after the gesture ends), the timestamp won't update. Edge case — unlikely to cause real annoyance.

### 5. Accessibility

**P2 — Banner is not keyboard-accessible**: The banner is a `<div>` with `onClick` (line 1162) but no `role`, `tabIndex`, or `onKeyDown` handler. Keyboard users cannot focus or dismiss it. Screen readers won't announce it as interactive.

Fix:
```tsx
<div
  role="status"
  aria-live="polite"
  tabIndex={0}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setCatchUpSummary(null); }}
  ...
>
```

**P3 — No ARIA announcement**: When the banner appears, screen readers won't be notified. `role="status"` with `aria-live="polite"` would announce the catch-up summary without interrupting.

**P3 — X close button is decorative**: The `<X>` icon (line 1173) looks like a close button but has no separate click handler or accessible name — the entire banner dismisses on click. This is fine visually but the icon should have `aria-hidden="true"` to avoid screen reader confusion.

### Summary

| Concern | Severity | Issue |
|---------|----------|-------|
| Event listener throttle | P2 | No throttle on scroll (60fps), but impact is negligible |
| Long inactivity delta | P2 | Large numbers could overflow banner width |
| Lead switch snapshot | P3 | Snapshot not reset when switching selectedLeadId |
| Keyboard accessibility | P2 | Banner not focusable, no keyboard dismiss |
| ARIA announcement | P3 | No aria-live on banner appearance |
| Race conditions | ✅ | Point-in-time snapshot is correct |
| False positives | ✅ | 120s threshold is reasonable |

**No P0 blockers.** Top fixes for polish: (1) Add `role="status" aria-live="polite" tabIndex={0} onKeyDown` for accessibility, (2) Reset `snapshotRef` when `selectedLeadId` changes.

---

## 12. Reactive Event Pipeline (EventPipeline.ts, index.ts wiring, tests)

**Date**: 2026-02-28 ~15:13
**Scope**: Foundation infrastructure — all future event-driven features build on this

### Architecture Overview
- `EventPipeline` class: in-memory queue + serial async processor
- Handlers registered with `eventTypes` filter (specific ActionTypes or `'*'` wildcard)
- Connected to `ActivityLedger` via EventEmitter: `ledger.on('activity', ...)` → `pipeline.emit()` → queue → process
- Three built-in handlers: task-completed-summary (logger), commit-quality-gate (meta flag), delegation-tracker (logger)

### 1. Memory — Unbounded Queue Growth

**P1 — No queue size limit**: `this.queue` (line 26) is an unbounded array. `emit()` pushes unconditionally (line 37). If handlers are slow (e.g., a future handler does network I/O or waits on a lock) and events arrive faster than they're processed, the queue grows without bound.

Scenario: 200 agents each producing 10 events/second = 2000 events/sec. If a handler takes 100ms (DB write, HTTP call), processing throughput is 10 events/sec per handler. Queue grows by ~1990 events/sec → 120K events in 60 seconds → ~50MB+ of PipelineEvent objects in memory.

**Current risk: LOW** — all three built-in handlers are synchronous loggers (nanosecond execution). But this is **foundation infrastructure** — future handlers WILL be slower.

Fix: Add `MAX_QUEUE_SIZE` (e.g., 10000). When exceeded, either:
- (a) Drop oldest events (lossy but prevents OOM): `if (this.queue.length >= MAX_QUEUE_SIZE) this.queue.shift();`
- (b) Apply backpressure (block the emitter — but ActivityLedger is synchronous, so this would block the command processing thread)

Recommend option (a) with a warning log when dropping.

### 2. Race Conditions — Async Processing

**P2 — Re-entrancy during async handler execution**: `processQueue()` (line 43) is `async` and `await`s each handler. While a handler is awaiting, new events can arrive via `emit()`. The `if (!this.processing)` guard (line 38) correctly prevents a second `processQueue()` invocation — new events just sit in the queue and are picked up by the existing `while` loop.

**✅ This is correct.** The serial processing model (one event at a time, handlers in registration order) prevents race conditions between handlers. The `processing` flag is checked synchronously before entering the async loop.

**P3 — Handler order dependency**: Handlers run in registration order (line 50: `for (const handler of matching)`). The `commitQualityGateHandler` sets `meta.shouldRunTests = true` (line 96), expecting a downstream handler to read it. If the downstream handler is registered BEFORE the gate handler, it won't see the flag. This is implicit ordering — no enforcement mechanism.

Fix suggestion: Document that handler registration order matters, or add a `priority` field.

### 3. Commit Quality Gate — Blocking Risk

**✅ Currently safe**: `commitQualityGateHandler` (line 90-100) is synchronous — it just sets `meta.shouldRunTests = true` and logs. No blocking. No test execution.

**P2 — Meta flag is write-only**: `meta.shouldRunTests` is set but NEVER READ by any handler. There's no handler that actually runs tests or blocks the commit. This is dead code — a placeholder for future functionality.

**Risk**: When someone adds a test-runner handler that reads `meta.shouldRunTests`, they need to ensure it doesn't block the pipeline. If it's async and takes 30 seconds to run tests, it blocks ALL subsequent event processing for 30 seconds (serial processing model).

**Recommendation**: When implementing the actual quality gate, process it asynchronously (fire-and-forget with its own timeout) rather than awaiting it in the pipeline.

### 4. ActivityLedger Coupling

**P2 — Synthetic entry with `id: 0`**: ActivityLedger emits events BEFORE flushing to the DB (line 64-74 in ActivityLedger.ts). The emitted `entry` has `id: 0` (no DB ID yet). If a future handler needs to reference or query the entry by ID, it will fail.

**P3 — No backpressure signal**: The pipeline has no way to tell the ledger "slow down." The `connectToLedger` (line 69) is a fire-and-forget subscription. If the pipeline is overloaded, the ledger keeps emitting into the void.

**✅ Decoupling is otherwise clean**: The pipeline only depends on `ActivityEntry` type and `'activity'` event name. No circular dependencies. Handler registration is explicit. The `meta` bag allows inter-handler communication without shared state.

### 5. Security — Event Data Propagation

**P3 — `meta` bag is shared across ALL handlers for one event**: If a handler writes `meta.secret = 'api_key'`, every subsequent handler sees it. In the current codebase (3 trusted built-in handlers), this is fine. If user-registered handlers are ever supported, the meta bag becomes an information channel between untrusted handlers.

**P3 — Event data includes full `entry.details`**: The `details` object can contain sensitive fields (file paths, agent IDs, task descriptions, delegation content). All handlers see all details. Again, currently safe with trusted built-in handlers.

**P3 — No event filtering on sensitive types**: There's no mechanism to mark certain ActionTypes as "internal only" (e.g., `agent_terminated` with exit reasons could contain error stacktraces). All handlers see all events equally.

### 6. Test Coverage Assessment

**✅ Good coverage**: 8 tests covering:
- Matching dispatch ✓
- Non-matching filtering ✓
- Wildcard handler ✓
- Error isolation (failing handler doesn't block passing handler) ✓
- Handler introspection ✓
- Built-in handlers (no-throw smoke tests) ✓
- Event ordering ✓

**Missing tests**:
- No test for re-entrancy: emit during handler execution
- No test for high-volume throughput (queue growth under load)
- No test for `connectToLedger` integration
- No test verifying `meta.shouldRunTests` is actually set by commit handler

### Summary

| Concern | Severity | Issue |
|---------|----------|-------|
| Unbounded queue | P1 | No MAX_QUEUE_SIZE — OOM risk with slow future handlers |
| Async re-entrancy | ✅ | `processing` flag correctly prevents concurrent processQueue |
| Handler ordering | P3 | Implicit registration order, no priority system |
| Meta flag dead code | P2 | `shouldRunTests` set but never read |
| Synthetic entry id:0 | P2 | Entry emitted before DB flush — ID is meaningless |
| Meta bag shared | P3 | All handlers share meta — future plugin risk |
| Test coverage | P3 | Missing re-entrancy, load, and integration tests |

**One P1**: Unbounded queue. This is foundation infrastructure — add a queue cap now before handlers get more complex. Everything else is P2/P3 and acceptable for the current scope.

---

## 13. Timeline Tooltip + Idle Hatch Pattern (TimelineContainer.tsx)

**Date**: 2026-02-28 ~15:14

### Tooltip Content (lines 555-582)

**✅ Info balance is good**: Shows status (with color dot), task label (truncated to 80 chars), time range, and duration. Not too much, not too little.

**P3 — Task label may contain sensitive info**: `tooltipData.taskLabel` comes from the server's timeline API, which contains task delegation descriptions. These could include internal file paths, agent context, or specific instructions. Since this is a localhost UI, this is acceptable. Flag for multi-tenant.

### Tooltip Positioning (lines 209-213)

**P2 — No viewport edge clamping**: Position is `event.clientX - rect.left` / `event.clientY - rect.top - 10`. `TooltipWithBounds` from `@visx/tooltip` handles viewport clamping automatically — it repositions to stay within bounds. **Actually safe** — the library component handles this.

### Idle Hatch Pattern (lines 504-510)

**✅ Performance is fine**: Single `<pattern>` definition in `<defs>`, referenced via `fill="url(#idle-hatch)"`. SVG patterns are GPU-accelerated and render as a single texture lookup per rect. Even with 200 idle segments, this is trivially fast.

**P3 — Pattern ID collision**: `id="idle-hatch"` is a page-global SVG ID. If two timeline components render on the same page, they'd share the ID (first definition wins). Not a current issue (only one timeline), but worth namespacing if the component becomes reusable.

### Accessibility

**P2 — Tooltips are hover-only**: `onSegmentHover` (mouse) triggers tooltip; no keyboard equivalent. Users navigating with Tab/Enter can't see segment details. The keyboard nav implementation adds focus to lanes, but segments within lanes don't receive individual focus.

**Verdict**: ✅ Clean for v1. Accessibility (keyboard tooltips) is the main gap.

---

## 14. Three-Tier Message Hierarchy (messageTiers.ts + LeadDashboard.tsx)

### Classification Reliability

**P2 — Critical pattern gaps**: Missing patterns that could hide important messages:
- `\bout of memory\b` / `\bOOM\b` — process memory failures
- `\btimeout\b` — network/process timeouts
- `\bdeadlock\b` — concurrency issues
- `\bpermission denied\b` — auth failures
- `\bENOENT\b` / `\bENOSPC\b` — OS-level errors
- `\bsegfault\b` / `\bSIGKILL\b` — process crashes
- `\b50[0-9]\b` — HTTP 5xx errors
- `\bfatal\b` — git fatal errors

**P2 — Notable pattern false positives**: `\bcompleted?\b` and `\bdone\b` are EXTREMELY broad. "I'm not done yet" → notable. "The task is not completed" → notable. "done" appears in "abandoned", "condone", etc. These would be caught by `\b` but reversed context still triggers: "NOT done" reads as notable.

The `\bfixed?\b` pattern matches "We have not fixed this" as notable — misleading.

**P3 — No negation awareness**: The regex patterns don't check for negation prefixes ("not", "didn't", "failed to", "unable to"). "Build did NOT fail" → matches `\bbuild fail\b` → classified as CRITICAL.

### Performance / Memoization

**✅ Properly memoized**: `classifiedFeed` uses `useMemo([feed, leadId, tierFilter])` (line 2308). `tierCounts` uses `useMemo([feed, leadId])` (line 2315-2320). Classification only re-runs when the feed or filter changes.

**P3 — Double classification**: `tierCounts` (line 2318) calls `classifyMessage()` again for every feed item, separately from `classifiedFeed`. Could be consolidated into a single pass (classify once, derive both filtered list and counts from the same result).

### Animated Pulse Accessibility

**P2 — `animate-pulse` on critical messages**: `<span className="animate-pulse text-[10px]">●</span>` (lines 2374, 2398). CSS `animate-pulse` is a smooth opacity animation (1s cycle) — NOT a fast blink. WCAG 2.3.1 forbids flashing more than 3x/second; `animate-pulse` cycles at 1Hz (well under the threshold). **Safe for seizure concerns.**

However, `prefers-reduced-motion` is not respected. Users who set reduced motion in OS settings will still see the pulse. Fix: add `motion-safe:animate-pulse` (Tailwind utility) instead of `animate-pulse`.

### Tier Stability

**P3 — Messages don't flip tiers**: Classification is purely content-based (regex on message text). Since message content is immutable once received, tier assignment is deterministic and stable. No flipping risk.

**Verdict**: The missing critical patterns (P2) are the real risk — a build OOM or timeout classified as "routine" could delay the user noticing a serious issue. Recommend expanding CRITICAL_PATTERNS.

---

## 15. CommandDispatcher Decomposition — CRITICAL REVIEW

### ⚠️ TOP FINDING: Decomposition is NOT wired

**P0 — Modules exist but are unused**: CommandDispatcher.ts is still 1738 lines with all 32 inline handlers. The `commands/` directory contains extracted modules (AgentCommands.ts, CommCommands.ts, TaskCommands.ts, DeferredCommands.ts) totaling 1335 lines, but:
- CommandDispatcher.ts does NOT import from `commands/`
- CommandDispatcher.ts still contains ALL original handler methods
- The modules are dead code — never loaded, never called
- Tests pass because they test the original monolith, not the modules

This means the "decomposition" is a parallel extraction that hasn't been swapped in. The original monolith is still the live code path.

### Handler Signature Mismatch (P1)

Even when wired, there's an incompatibility:

- `types.ts CommandDefinition`: `handler: (ctx: CommandHandlerContext, agent: Agent, data: string) => void`
- `AgentCommands.ts`: Uses `CommandHandlerContext` correctly — handlers are `(ctx, agent, data)` ✅
- `CommCommands.ts`: Uses a LOCAL `CommandEntry` type with `handler: (agent: Agent, data: string) => void` — **MISSING `ctx` parameter**. The `getCommCommands(ctx)` function closes over `ctx` via arrow functions, bypassing the standard signature.

This means CommCommands handlers can't be dispatched through the same router as AgentCommands/TaskCommands handlers — they have different function signatures. The router would need two dispatch paths or CommCommands needs to be refactored to match the standard signature.

### Cross-Module Dependency (P2)

`AgentCommands.ts` imports `maybeAutoCreateGroup` from `CommCommands.ts` (line 15). This creates a compile-time circular dependency risk: if CommCommands ever needs to reference AgentCommands (e.g., to check delegation state), you get a cycle. Currently one-directional, so OK, but fragile.

### Shared Mutable State (P2)

`CommandHandlerContext` exposes three mutable collections (types.ts:28-33):
- `delegations: Map<string, Delegation>` — owned by AgentCommands, read by others
- `reportedCompletions: Set<string>` — owned by AgentCommands
- `pendingSystemActions: Map<string, ...>` — shared

Any module can mutate any of these. If CommCommands accidentally clears `delegations` or TaskCommands adds to `reportedCompletions`, the system breaks silently. No encapsulation — "owned by" is documented but not enforced.

Fix: Expose read-only views for cross-module state, with mutation methods only on the owning module.

### Regex Ordering (P3)

Both the monolith and modules define the same regexes. When wired, the dispatch order depends on the array concatenation order of `getAgentCommands()`, `getCommCommands()`, `getTaskCommands()`, `getDeferredCommands()`. Since regexes are tested via `data.match(regex)` (first match wins in the scanner), overlapping patterns could shadow each other.

Current risk: LOW — all command names are unique strings (`CREATE_AGENT`, `DELEGATE`, etc.) and regex patterns are mutually exclusive.

### Missing Commands Check

Comparing modules vs monolith:

**Monolith handlers** (32): SPAWN, CREATE_AGENT, DELEGATE, TERMINATE_AGENT, CANCEL_DELEGATION, AGENT_MESSAGE, BROADCAST, CREATE_GROUP, ADD_TO_GROUP, REMOVE_FROM_GROUP, GROUP_MESSAGE, LIST_GROUPS, QUERY_GROUPS, DECLARE_TASKS, TASK_STATUS, QUERY_TASKS, PAUSE_TASK, RETRY_TASK, SKIP_TASK, ADD_TASK, CANCEL_TASK, RESET_DAG, DEFER_ISSUE, QUERY_DEFERRED, RESOLVE_DEFERRED, PROGRESS, DECISION, QUERY_CREW, LOCK_FILE, RELEASE_FILE, ACTIVITY, LIMIT_CHANGE

**Module coverage**: AgentCommands (5), CommCommands (8), TaskCommands (9), DeferredCommands (3) = 25 commands

**Missing from modules** (~7): PROGRESS, DECISION, QUERY_CREW, LOCK_FILE, RELEASE_FILE, ACTIVITY, LIMIT_CHANGE — these remain in the monolith only.

### Summary

| Finding | Severity | Issue |
|---------|----------|-------|
| **Modules not wired** | P0 | 1335 lines of dead code — decomposition incomplete |
| Handler signature mismatch | P1 | CommCommands uses `(agent, data)`, others use `(ctx, agent, data)` |
| 7 commands missing from modules | P1 | PROGRESS, DECISION, QUERY_CREW, etc. not extracted |
| Shared mutable state | P2 | No encapsulation on delegations/completions Maps |
| Cross-module dependency | P2 | AgentCommands → CommCommands (one-way, fragile) |
| Regex ordering | P3 | Depends on array concat order, currently safe |

**P0: The decomposition is not functional.** The monolith is still the live code path. Before merging, either:
(a) Wire the modules into CommandDispatcher and verify all 1000 tests pass, OR
(b) Remove the modules and ship the monolith as-is, extracting later

Shipping both (dead modules + live monolith) is a maintenance trap — they'll drift immediately.

---

## 16. Lead Health Header (ContextRefresher.ts:96-141, Agent.ts:443-485)

**Date**: 2026-02-28 ~15:19

### How it works
- `buildHealthHeader(leadId)` called by `refreshAll()` / `refreshOne()` — only for `role.id === 'lead'`
- Computes: agent counts (active/idle/completed), pending decisions (count + oldest age), DAG completion %, blocked/failed tasks
- Produces a `== PROJECT HEALTH ==` header with traffic-light icon (🔴 critical, ⚠️ warning, ✅ ok)
- Injected into CREW_UPDATE text in `Agent.injectContextUpdate()` at line 477

### 1. Stale DAG Data

**✅ Fresh reads**: `buildHealthHeader()` calls `taskDAG.getStatus(leadId)` (line 118) synchronously on each refresh. Since this reads directly from SQLite (via drizzle), and SQLite is the single source of truth, the data is always current at the moment of read. No caching layer involved.

**P3 — Refresh timing**: The header reflects state at refresh time, which is debounced via `scheduleRefresh()`. If an agent completes a task 1 second after the last refresh, the health header won't reflect it until the next debounce trigger. This is inherent to the polling model and acceptable — the header is indicative, not real-time.

### 2. No DAG — Graceful Degradation

**✅ Handles correctly**: When no DAG exists, `getStatus(leadId)` returns `{ tasks: [], summary: { pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0, paused: 0, skipped: 0 } }`.

- `dagTotal` = 0 (line 120)
- `completionPct` = `null` (line 121: `dagTotal > 0 ? ... : null`)
- `hasCritical` = `false` (0 blocked, 0 failed)
- Line 1 skips completion percentage (line 130: `if (completionPct !== null)`)
- Line 2 = empty string (line 138: `dagTotal > 0 ? '\n0 blocked tasks' : ''`)

Result: `== PROJECT HEALTH ==\n✅ 3 active, 1 idle` — clean output with no DAG noise. **Well designed.**

### 3. Decision Age Calculation

**P3 — Assumes chronological ordering**: `pendingDecisions[0]` (line 111) is assumed to be the oldest. This depends on `decisionLog.getByLeadId()` returning results ordered by timestamp ascending. If the DB query returns newest-first, the "oldest age" is actually the newest age. Let me check:

The calculation itself is safe:
- `Date.now() - new Date(timestamp).getTime()` — both are epoch millis, subtraction is always a positive number for past timestamps
- `Math.floor(oldestMs / 60000)` — integer division, no overflow risk (JS numbers handle up to 2^53, which is ~285 million years in milliseconds)
- If `timestamp` is malformed, `new Date(badString).getTime()` returns `NaN`, and `NaN / 60000` = `NaN`, and `Math.floor(NaN)` = `NaN`, producing `"NaN min"` in the output

**Fix**: Add a guard: `if (isNaN(mins)) oldestAge = 'unknown';`

**P3 — Future timestamps**: If a decision has a timestamp in the future (clock skew), `oldestMs` would be negative, producing `mins < 0`, which passes the `mins < 1` check and shows `"<1 min"`. Harmless but inaccurate.

### 4. Information Isolation

**✅ Properly scoped**: 
- `myAgents = allAgents.filter(a => a.parentId === leadId)` (line 98) — only counts this lead's children
- `decisionLog.getByLeadId(leadId)` (line 106) — scoped to this lead's decisions
- `taskDAG.getStatus(leadId)` (line 118) — scoped to this lead's DAG
- Health header only injected when `agent.role.id === 'lead'` (lines 56, 67)
- Non-lead agents get `undefined` for healthHeader, resulting in empty string at line 477

**No cross-lead information leak.** Each lead only sees their own project's health.

### 5. Edge Cases

**P3 — Lead with zero agents**: `total = 0`, `active = 0`, `idle = 0`, `completed = 0`. Health shows `✅ 0 active, 0 idle`. No crash, but the message is slightly misleading — a lead with zero agents probably needs to create some. The icon shows green (✅) because `hasCritical = false` and `hasWarning = false` (idle 0 > Math.max(1, 0/2) = 0 is false). Technically correct but could show a hint.

**P3 — Warning threshold**: `idle > Math.max(1, total / 2)` (line 125) triggers warning when more than half the agents are idle. With 2 agents (1 idle, 1 active): `1 > Math.max(1, 1) = 1` → false, no warning. With 3 agents (2 idle, 1 active): `2 > Math.max(1, 1.5) = 1.5` → true, warning. Reasonable heuristic.

### Summary

| Concern | Severity | Issue |
|---------|----------|-------|
| Stale DAG data | ✅ | Fresh SQLite reads, no caching |
| No DAG graceful degradation | ✅ | Clean output, completion % hidden |
| Decision age NaN | P3 | Malformed timestamp → "NaN min" in output |
| Cross-lead isolation | ✅ | All queries scoped by leadId |
| Zero agents display | P3 | Shows green ✅ with 0 agents — could be confusing |

**No P0/P1/P2 issues. Solid implementation.** The two P3s (NaN guard, zero-agent hint) are polish items.

---

## 17. TaskDAG E2E Tests — Critical Review

**File:** `packages/server/src/__tests__/TaskDAG.e2e.test.ts` (760 lines, 30 tests)
**Result:** All 30 pass. Good coverage overall. Found **1 P1 implementation bug** surfaced by missing test, **3 P2 test gaps**, and **1 P3**.

### P1: cancelTask orphans dependents — real implementation bug

`cancelTask()` (TaskDAG.ts:372-381) deletes the task row but does NOT update tasks that depend on it. `resolveReady()` calls `getTask(leadId, depId)` which returns `null` for a deleted task, so `allDepsDone` evaluates to `false`. **Dependents of a cancelled task are permanently stuck in `pending` — they can never be promoted.**

```
Scenario: A→B, cancel A.
- A deleted from DB
- B stays 'pending' forever
- resolveReady checks B's deps: getTask('A') returns null → allDepsDone = false
- B can never become ready
```

**No test covers cancelling a task that has dependents.** All cancel tests (lines 316-352) use tasks with no downstream dependents.

**Fix:** `cancelTask` should either (a) treat cancelled as equivalent to `done`/`skipped` in `resolveReady` (requires keeping the row with a `cancelled` status instead of deleting), or (b) cascade-promote dependents the same way `skipTask` does after deleting.

### P2: Missing test — skipTask on FAILED task leaves BLOCKED dependents stuck

This is the known DAG limitation but the tests don't exercise it:

```
Scenario: A→B→C.
- A fails → B gets 'blocked' (direct dependent)
- skipTask(A) → A becomes 'skipped'
- B stays 'blocked' FOREVER
```

Why: `skipTask` calls `resolveReady()` which only queries `pending` tasks (TaskDAG.ts:173). B is `blocked`, not `pending`, so resolveReady never considers it. The raw SQL at line 364 includes `'blocked'` in the WHERE clause, but that's irrelevant since resolveReady never returns blocked tasks.

The tests cover:
- ✅ Retrying the failed task (which explicitly moves blocked→pending via retryTask line 339)
- ✅ Skipping the blocked task directly (line 276-291)
- ❌ Skipping the failed upstream task (blocked dependents stay stuck)

**Suggested test:**
```typescript
it('KNOWN LIMITATION: skipping a failed task does NOT unblock blocked dependents', () => {
  batch(dag, LEAD, [
    { id: 'a', role: 'Dev' },
    { id: 'b', role: 'Dev', depends_on: ['a'] },
  ]);
  dag.startTask(LEAD, 'a', 'agent-1');
  dag.failTask(LEAD, 'a');
  expect(statusMap(dag, LEAD).b).toBe('blocked');

  dag.skipTask(LEAD, 'a'); // skip the failed task
  // b stays blocked — resolveReady only checks 'pending'
  expect(statusMap(dag, LEAD).b).toBe('blocked'); // documents limitation
});
```

### P2: Weak assertion in file lock test masks potential regression (line 184)

```typescript
expect(['ready', 'pending']).toContain(c.dagStatus); // line 184
```

After `completeTask(task-a)` releases the file lock, `resolveReady` runs and promotes task-c from `pending` to `ready` deterministically. The correct assertion is:

```typescript
expect(c.dagStatus).toBe('ready');
```

The current weak assertion would still pass if file locking were completely broken (task-c would be `ready` either way). The comment on lines 180-182 even acknowledges uncertainty — that's a red flag.

### P2: retryTask semantic inconsistency in double-failure diamond — not tested

```
Scenario: root→left, root→right, left+right→merge.
- root done. left fails → merge blocked. right fails → merge already blocked (no-op).
- retryTask(left) → left ready. merge goes blocked→pending.
- But right is still failed! merge is now 'pending' when it should be 'blocked'.
```

`retryTask` (line 336-346) blindly moves ALL blocked dependents to `pending` without checking if ALL their dependencies are non-failed. The task won't actually run (resolveReady requires all deps `done`/`skipped`), but the status is misleading — `pending` implies "waiting for deps to complete" while actually one dep is failed.

### P2: addTask with already-met dependencies stays pending

```
Scenario: batch([{ id: 'a', role: 'Dev' }]). runTask('a'). 
Then addTask({ id: 'b', depends_on: ['a'] }).
```

`declareTaskBatch` (line 111) sets `dagStatus = 'pending'` for any task with dependencies. It does NOT call `resolveReady()` after insertion. So task `b` starts as `pending` even though its sole dependency `a` is already `done`. It stays `pending` until some other task completes and triggers `resolveReady`, or gets manually started.

The test at line 730-742 covers `addTask` but phase1 isn't done yet when phase2 is added — so it doesn't surface this.

### P3: Event emission test doesn't verify ActivityLedger integration

The test at line 673-698 only verifies the EventEmitter fires `dag:updated` with `{ leadId }`. It doesn't test whether these events reach the ActivityLedger or any downstream consumers. This is fine for a unit test but the test name ("event emission throughout lifecycle") could mislead someone into thinking integration is covered.

### What the tests do well

| Aspect | Verdict |
|--------|---------|
| **Flakiness** | ✅ Zero risk — all synchronous SQLite, in-memory DB, clean beforeEach/afterEach |
| **Passing for wrong reason** | ✅ Except line 184 (P2 above), all assertions are specific and correct |
| **Diamond test** | ✅ Good: happy path + failure-retry. Gap: skip + double-failure (P2 above) |
| **Test isolation** | ✅ Fresh DB per test, no shared state |
| **Mixed scenario (test 9)** | ✅ Excellent — covers pause/resume/fail/retry/skip in a realistic 7-task sprint |
| **Edge cases** | ✅ Single task, all independent, cross-batch deps, unknown deps, duplicate IDs |
| **Multi-lead isolation** | ✅ Reset test (line 549-564) verifies one lead's DAG doesn't affect another |

### Summary

| Finding | Severity | Description |
|---------|----------|-------------|
| cancelTask orphans dependents | **P1** | Deleted task leaves deps stuck in `pending` forever — real bug |
| skipTask on failed task | P2 | Missing test for known blocked→stuck limitation |
| Weak file lock assertion | P2 | Line 184 accepts 2 states, should be deterministic `ready` |
| Double-failure diamond | P2 | retryTask creates misleading `pending` when another dep is still failed |
| addTask with met deps | P2 | Task stays `pending` when deps already done — no auto-promote |
| Event integration | P3 | Tests EventEmitter only, not ActivityLedger wiring |

---

## 18. Sub-Lead Delegation (Architect CREATE_AGENT + DELEGATE) — Critical Review

**Commit:** `4d68099` — 2 files, +28/-10 lines
**Scope:** Architects can now CREATE_AGENT and DELEGATE alongside leads
**Result:** Found **1 P0**, **2 P1**, **2 P2**

### P0: CREATE_AGENT architect guard LOST in decomposition

The commit `4d68099` correctly changed the guard in the monolithic `CommandDispatcher.ts`:
```diff
-      if (agent.role.id !== 'lead') {
+      if (agent.role.id !== 'lead' && agent.role.id !== 'architect') {
```

But the **decomposed** `AgentCommands.ts` (line 208) that actually runs now still has the OLD guard:
```typescript
if (agent.role.id !== 'lead') {  // ← architect is blocked!
```

The DELEGATE guard in `AgentCommands.ts` (line 322) WAS updated correctly:
```typescript
const canDelegate = agent.role.id === 'lead' || agent.role.id === 'architect'; // ✅
```

**Impact:** Architects CAN delegate to children (DELEGATE works) but CANNOT create agents (CREATE_AGENT rejects). The feature is half-broken. An architect that delegates also needs to create agents first — this makes the delegation useless unless the lead creates agents FOR the architect beforehand.

**Fix:** Line 208 in `AgentCommands.ts`:
```typescript
if (agent.role.id !== 'lead' && agent.role.id !== 'architect') {
```
Also update the error message (line 209-210) to match.

### P1: Architect can create another architect → unbounded delegation chain

No restriction on WHAT roles an architect can create (lines 219-224 only check roleRegistry). An architect can:
1. Create another architect (parentId = creating architect)
2. New architect creates agents + delegates
3. New architect creates ANOTHER architect
4. Repeat until MAX_CONCURRENCY_LIMIT (200)

Each creation triggers auto-scale (+10 concurrency per attempt). A single rogue architect could spawn 20 architects, each spawning 10 agents = 200 agents from one unchecked root.

**Fix options:**
- (a) Restrict architect to specific roles: `if (role.id === 'lead' || role.id === 'architect') { reject }`
- (b) Add a depth limit: count ancestors, reject if > 3 levels deep
- (c) Architects can only create non-management roles (developer, designer, tech-writer, etc.)

Recommendation: **(c)** — architects should create specialist workers, not management agents.

### P1: Asymmetric privilege — architects can CREATE but not TERMINATE

`TERMINATE_AGENT` (AgentCommands.ts:399) still requires `agent.role.id !== 'lead'`. An architect that creates agents has **no way to clean them up**:

```
Architect creates 3 developers → one hangs → architect can't terminate it
Only the lead (the architect's own parent) can terminate.
```

This violates the principle of least surprise. If you can create, you should be able to destroy your own creations.

**Fix:** Update TERMINATE_AGENT guard to match CREATE_AGENT/DELEGATE:
```typescript
if (agent.role.id !== 'lead' && agent.role.id !== 'architect') {
```
Keep the existing `isAncestor` / `parentId` scope check to ensure architects can only terminate their own children.

Wait — checking: the TERMINATE handler at line 401-407 finds the target then checks ancestry:
```typescript
const target = allAgents.find((a) =>
  (a.id === req.id || a.id.startsWith(req.id)) &&
  a.id !== agent.id
);
// ... then isAncestor check (or similar)
```
Actually, looking at the decomposed module, the ancestor check may have been lost too. The current code finds ANY agent by ID without scoping. **If the role guard is relaxed without an ancestry check, architects could terminate any agent in the system.** Verify ancestry check exists before updating the role guard.

### P2: QUERY_CREW scoping doesn't account for architect role

`handleQueryCrew` in `SystemCommands.ts` (or wherever it now lives) scopes roster display:
- Sub-leads (role=lead, has parentId): see own children + sibling summary
- Top-level leads: see all agents, others' agents marked read-only
- **Architects: fall into the else branch → see ALL agents including other leads' children**

The roster output says "you can DELEGATE to these" but architect can only delegate to `a.parentId === agent.id`. Seeing all agents is misleading and leaks task/status info from other projects.

**Fix:** Add an architect-specific branch that shows only own children.

### P2: Architect doesn't see budget info

Budget line (line ~881 in old code) is only shown when `agent.role.id === 'lead'`. Architect operates blind regarding capacity — keeps creating agents until hitting concurrency cap with no warning.

**Fix:** Show budget to any role that can create agents.

### Test coverage assessment

The new test (lines +5 to +20 in diff) correctly verifies:
- ✅ Architect can delegate to own children
- ✅ Non-lead/non-architect rejected with correct message
- ❌ No test for architect CREATE_AGENT (which is now broken — P0)
- ❌ No test for architect creating another architect (chain)
- ❌ No test for architect TERMINATE_AGENT (asymmetry)
- ❌ No test for architect QUERY_CREW visibility

### Summary

| Finding | Severity | Description |
|---------|----------|-------------|
| CREATE_AGENT guard lost in decomposition | **P0** | AgentCommands.ts:208 still has lead-only guard |
| Architect → architect chain | **P1** | No role restriction on what architects can create |
| Can create but not terminate | **P1** | TERMINATE still lead-only; architect can't clean up |
| QUERY_CREW leaks roster | P2 | Architect sees all agents, not just own children |
| No budget visibility | P2 | Architect doesn't see capacity info |

---

## 19. Proactive Alert Engine — Critical Review

**File:** `packages/server/src/coordination/AlertEngine.ts` (213 lines, 5 checks)
**Wiring:** `index.ts` + `api.ts` + `WebSocketServer.broadcastEvent()`
**Result:** **No P0**. Found **1 P1**, **3 P2**, **2 P3**.

### P1: Dedup bug suppresses multiple alerts of same type without agentId

The dedup logic (line ~196) matches on `type + agentId`:
```typescript
const recent = this.alerts.find(a =>
  a.type === partial.type &&
  a.agentId === partial.agentId &&
  Date.now() - new Date(a.timestamp).getTime() < CHECK_INTERVAL_MS,
);
```

Two alert types don't set `agentId`:
- `duplicate_file_edit` — file contention alert
- `idle_agents_ready_tasks` — idle/ready mismatch

Since `undefined === undefined → true`, ALL alerts of these types within the same check cycle match each other's dedup key. **If 3 files have lock conflicts, only the first file's alert is emitted per cycle.** The other 2 are silently dropped.

**Fix:** Include a differentiator in the dedup key. Options:
- (a) Add `a.message === partial.message` to the dedup check
- (b) Set a synthetic `agentId` or add a `dedup_key` field
- (c) For duplicate_file_edit, use the filePath; for idle_agents, use the leadId

### P2: `alertEngine.stop()` not called in graceful shutdown

`index.ts` shutdown handler (line ~177) calls `contextRefresher.stop()`, `scheduler.stop()`, `activityLedger.stop()` — but NOT `alertEngine.stop()`. The `setInterval` keeps ticking during shutdown, potentially running checks after DB/AgentManager are closed → unhandled exceptions.

**Fix:** Add `alertEngine.stop();` to the shutdown handler.

### P2: Stuck agent false positives during long builds/installs

`checkStuckAgents()` uses `lastActivityByAgent` (populated from ActivityLedger events). If an agent runs `npm install` for 12 minutes with no ACP commands, it generates no activity events → flagged as stuck.

This is the most common false positive scenario:
- `npm run build` on a large project: 5-15 min
- `npm install`: 3-10 min
- LLM thinking on a complex prompt: 2-5 min (agent.status stays 'running' but no activity events)

The 10-minute threshold is reasonable for most cases but WILL false-positive on builds. In production, agents doing long builds are a significant fraction.

**Mitigation options:**
- (a) Track shell subprocess activity (any stdout from child process = activity)
- (b) Increase threshold to 15-20 min
- (c) Add `agent.suppressStuckAlert` flag that agents set before long operations
- (d) Accept as a known limitation — the alert is "warning" severity, not actionable by the system

Recommendation: **(d)** for now — document it. The alert serves as a "check on this agent" signal, not a definitive diagnosis.

### P2: Dedup timing race

The dedup window is `CHECK_INTERVAL_MS` (60s), which is also the check interval. If `setInterval` fires at T=59.999s (slightly early), old alerts are still within the dedup window → new alerts suppressed. If it fires at T=60.001s → old alerts expired → duplicates created.

This creates non-deterministic behavior: sometimes alerts are suppressed, sometimes duplicated, depending on JS timer precision. In practice, Node.js timers can drift ±5ms.

**Fix:** Use `CHECK_INTERVAL_MS * 1.5` as the dedup window (90s) to ensure old alerts always expire before the next check.

### P3: `lastActivityByAgent` never cleaned up

Terminated agents stay in the Map forever. For a single session (10-20 agents), this is ~2KB of leaked memory — negligible. But if the system were long-running with agent churn, this grows unbounded.

**Fix:** Clear entry when agent terminates (`agentManager.on('agent:terminated', (id) => lastActivityByAgent.delete(id))`).

### P3: `broadcastEvent` accepts `any` — no schema validation

`WebSocketServer.broadcastEvent(msg: any)` sends arbitrary data to all WebSocket clients. No type checking, no schema validation. Currently only AlertEngine uses it, but making it public invites unvalidated payloads. Low risk since it's server-internal, but worth noting for future callers.

### What works well

| Aspect | Verdict |
|--------|---------|
| 5 alert checks | ✅ Good selection — covers the top operational concerns |
| Ring buffer (100) | ✅ Appropriate for a single-screen dashboard. Important alerts persist in logs. |
| 60s interval | ✅ Good balance — fast enough to catch issues, slow enough to not waste CPU |
| Context pressure tiers | ✅ Nice: >85% = warning, >95% = critical |
| Idle+ready matching | ✅ Scoped per lead, counts team idle agents, good UX signal |
| API endpoint | ✅ Simple GET, returns array, graceful when engine undefined |
| Error isolation | ✅ Each check is independent — one throwing won't block others (if they throw inside try/catch... actually they DON'T have try/catch around individual checks in `runChecks()`) |

### Correction: Error isolation is MISSING

`runChecks()` calls all 5 checks sequentially with no try/catch:
```typescript
private runChecks(): void {
  this.checkStuckAgents();        // if this throws...
  this.checkContextPressure();    // ...these never run
  this.checkDuplicateFileEdits();
  this.checkIdleAgentsWithReadyTasks();
  this.checkStaleDecisions();
}
```

If `checkStuckAgents` throws (e.g., `agentManager.getAll()` fails during shutdown), the remaining 4 checks are skipped. The `setInterval` callback silently swallows the error (Node.js doesn't crash on unhandled errors in setInterval callbacks, but the error is lost).

**Fix:** Wrap each check in try/catch:
```typescript
private runChecks(): void {
  for (const check of [this.checkStuckAgents, this.checkContextPressure, ...]) {
    try { check.call(this); } catch (err) { logger.error('alerts', `Check failed: ${(err as Error).message}`); }
  }
}
```

This is borderline P1 (one bad check kills all alerts) but since the checks themselves are simple synchronous operations, the risk of throwing is low. Upgrading to **P2**.

### Summary

| Finding | Severity | Description |
|---------|----------|-------------|
| Dedup suppresses same-type alerts | **P1** | `undefined === undefined` dedup key collapses file + idle alerts |
| Missing `alertEngine.stop()` | P2 | setInterval keeps ticking during shutdown |
| Stuck agent false positives | P2 | Long builds/installs trigger 10-min threshold |
| Dedup timing race | P2 | 60s window ≈ 60s interval → non-deterministic |
| No error isolation in runChecks | P2 | One throwing check kills all subsequent checks |
| lastActivityByAgent leak | P3 | Terminated agents never removed from map |
| broadcastEvent accepts any | P3 | No schema validation on public WebSocket method |

---

## 20. CommandDispatcher Decomposition — Final Quick Pass

**State:** 193-line router + 8 modules (1838 lines total). 49/49 tests pass.

### Previous P0 — RESOLVED ✅

Modules are now fully wired. The router assembles all patterns at construction time:
```typescript
this.patterns = [
  ...getAgentCommands(this.handlerCtx),
  ...getCommCommands(this.handlerCtx),
  ...getTaskCommands(this.handlerCtx),
  ...getCoordCommands(this.handlerCtx),
  ...getDeferredCommands(this.handlerCtx),
  ...getSystemCommands(this.handlerCtx),
];
```

### Architect delegation guard — RESOLVED ✅

`AgentCommands.ts` line ~208 now has `const canCreate = agent.role.id === 'lead' || agent.role.id === 'architect'`, matching the DELEGATE guard. The earlier P0 from section 18 is no longer applicable.

### Cross-module dependency — CORRECT ✅

`AgentCommands.ts` imports `maybeAutoCreateGroup` from `CommCommands.ts` (line 13). The function is properly exported and called at line 387 after delegation.

### Shared mutable state — CORRECT ✅

`CommandHandlerContext` extends `CommandContext` with three mutable collections (`delegations`, `reportedCompletions`, `pendingSystemActions`). The `maxConcurrent` property uses a `defineProperty` getter/setter to proxy through to the original `ctx` — so auto-scaling changes are visible to all modules. This is the right pattern.

### Regex ordering — LOW RISK ✅

All module regexes use distinct command names (`CREATE_AGENT`, `DELEGATE`, `TERMINATE_AGENT`, etc.) that cannot shadow each other. The `scanBuffer` loop finds the leftmost match across ALL patterns, so ordering within the array doesn't matter — it's position-in-buffer that wins.

### Remaining concerns (carried forward)

| Finding | Severity | Notes |
|---------|----------|-------|
| Architect→architect chain | P1 | From section 18 — no role restriction on agent creation |
| Can CREATE but not TERMINATE | P1 | TERMINATE still lead-only |
| QUERY_CREW scoping for architect | P2 | Shows full roster, not own children |

**Decomposition itself is clean. No new issues introduced by the refactor.**
