# Critical Review — Round 1

**Reviewer:** Critical Reviewer (e66cd95c)
**Scope:** Cascade kill + terminated status (Issue #21), IME isComposing fix (Issue #32)

---

## Review 1: Cascade Kill + Terminated Status

### 🔴 P0 — Frontend `AgentStatus` type NOT updated

**File:** `packages/web/src/types/index.ts:63`
```ts
export type AgentStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed';
//                                                                         ^^^^^^^^ missing 'terminated'
```

The server now emits `status: 'terminated'` via WebSocket (`agent:status` event at `AgentManager.ts:492`), but the frontend type union does NOT include `'terminated'`. This means:

1. **TypeScript won't catch missing handlers** — any `switch` or exhaustive check on `AgentStatus` in the frontend silently ignores 'terminated'.
2. **Multiple UI components display incorrect state** for terminated agents:

| Component | Line | Problem |
|-----------|------|---------|
| `FleetStats.tsx` | 12-13 | Counts `completed` and `failed` only — terminated agents are uncounted, vanish from stats |
| `AgentActivityTable.tsx` | 117-120 | Maps `completed→Finished`, `failed→Crashed` — terminated falls through to `'Idle'` (wrong!) |
| `AgentCard.tsx` | 69 | Restart button only shown for `completed \|\| failed` — terminated agents can't be restarted |
| `AgentActivityTable.tsx` | 317 | Same restart button issue |
| `TaskQueuePanel.tsx` | 195 | Stops polling when lead is `completed \|\| failed` — terminated lead keeps polling forever |
| `LeadDashboard.tsx` | 1503 | Status dot color: terminated falls into gray `else` bucket, but `ta.status` text shows raw 'terminated' — inconsistent |
| `useWebSocket.ts` | 59 | `agent:exit` handler maps codes to `completed/failed` only — but this is fine since killed agents get `agent:killed` not `agent:exit` |

**Fix required:** Add `'terminated'` to `AgentStatus` in `packages/web/src/types/index.ts` AND audit every component above.

**Severity:** P0 — This will be visible to every user who terminates an agent. The agent won't show a restart button and stats will be wrong.

---

### 🟡 P1 — Double-kill fires listeners & events redundantly

**File:** `Agent.ts:562-572`, `AgentManager.ts:454-500`

If `AgentManager.kill(id)` is called twice for the same agent (e.g., user clicks "Kill" twice, or a cascade kill reaches an already-killed agent via a different path before the visited set propagates):

1. The `visited` Set only guards within a **single call chain**. Two independent top-level `kill()` calls create two separate `visited` Sets.
2. `Agent.kill()` has NO guard — it will set `killed = true` again (harmless), set `status = 'terminated'` again, and **fire all statusListeners again**.
3. `AgentManager.kill()` will emit `agent:killed` and `agent:status` events again.
4. `notifyParentOfCompletion()` will send the "[Agent Report] ... terminated" message to the parent **a second time**.
5. `completeDelegationsForAgent()` will iterate delegations again (harmless since they're already 'failed').

**Impact:** Parent agent receives duplicate termination reports. Frontend receives duplicate events.

**Suggested fix:** Add an early return in `AgentManager.kill()`:
```ts
kill(id: string, visited: Set<string> = new Set()): boolean {
    if (visited.has(id)) return false;
    visited.add(id);
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.status === 'terminated') return false;  // ← ADD THIS
    ...
```

---

### 🟡 P1 — Delegation status inconsistency for terminated agents

**File:** `CommandDispatcher.ts:249-252` and `CommandDispatcher.ts:306-311`

When an agent is killed, `completeDelegationsForAgent()` marks its delegations as `'failed'` (line 310). But the parent notification message says `'terminated'` (line 258). The delegation record says "failed" while the report says "terminated".

The delegation `status` type is `'active' | 'completed' | 'failed'` (line 54) — there's no `'terminated'` option. This is a deliberate choice but creates a semantic gap: was the delegation "failed" because the agent crashed, or because it was terminated by the user?

**Suggestion:** Either:
- Add `'terminated'` to the delegation status type, OR
- Add a `terminatedBy?: string` field to the delegation record for auditability

---

### 🟢 P2 — `visited` Set is sufficient for infinite recursion (within a single call)

The `visited: Set<string>` parameter with default `new Set()` correctly prevents infinite recursion within a single cascade. Since Node.js is single-threaded, there's no true concurrent execution within one call chain. The check at line 455 `if (visited.has(id)) return false` runs before any recursive `kill(childId, visited)` at line 474.

**Verdict:** ✅ Sufficient for the stated problem (circular parent-child references).

---

### 🟢 P2 — Race between `agent:killed` and `agent:status` events

**File:** `AgentManager.ts:490-492`

The kill sequence emits two events:
```ts
this.emit('agent:killed', id);        // line 491 → frontend removeAgent()
this.emit('agent:status', { ... });   // line 492 → frontend updateAgent()
```

The frontend `useWebSocket.ts:54-55` removes the agent on `agent:killed`. Then `agent:status` with 'terminated' arrives and tries to update a removed agent — this is a no-op, not an error. But it's wasted work and could confuse debugging.

**Additionally**, `Agent.kill()` at line 562 fires `statusListeners` with 'terminated', which triggers the `onStatus` callback at `AgentManager.ts:316`, which emits ANOTHER `agent:status` event. So the frontend receives:
1. `agent:status { status: 'terminated' }` (from Agent.kill() → statusListeners → AgentManager.onStatus)
2. `agent:killed` (from AgentManager.kill() line 491)
3. `agent:status { status: 'terminated' }` (from AgentManager.kill() line 492)

That's **three events** for one kill, with a **duplicate** `agent:status`. Harmless but noisy.

**Suggested fix:** Remove the explicit `agent:status` emit at line 492 since `Agent.kill()` already triggers it via statusListeners.

---

### 🟢 P2 — `shutdownAll()` doesn't use visited Set

**File:** `AgentManager.ts:582-587`

`shutdownAll()` calls `agent.kill()` directly (not `this.kill(id)`), bypassing cascade logic and the visited Set. This means:
- No cascade kill of children (they're independently killed in the loop)
- No `agent:killed` event emitted
- No delegation cleanup
- No file lock release

This is a shutdown path so it may be intentional, but it's inconsistent with the normal kill flow.

---

### 🟢 P2 — DB schema doesn't store 'terminated'

**File:** `packages/server/src/db/schema.ts:189`

`projectSessions.status` is `'active' | 'completed' | 'crashed'`. When a lead agent is terminated, the `onExit` handler at `AgentManager.ts:371-374` maps non-zero codes to `'crashed'`. Terminated agents get exit code -1 (which is !== 0), so they'll be stored as `'crashed'` in the DB. This is arguably wrong but not breaking.

---

## Review 2: IME `isComposing` Fix

### 🟢 P2 — `e.nativeEvent.isComposing` vs `e.isComposing`

In React's `SyntheticEvent`, `isComposing` is NOT directly available on the synthetic `KeyboardEvent` — it must be accessed via `e.nativeEvent.isComposing`. The implementation correctly uses `e.nativeEvent.isComposing`.

**However**, React 17+ does expose `isComposing` directly on the synthetic event via the `KeyboardEvent` interface. Using `e.nativeEvent.isComposing` works across all React versions, so this is fine. It's just less idiomatic for modern React.

**Verdict:** ✅ Correct approach.

---

### 🟢 P2 — Browser compatibility

`KeyboardEvent.isComposing` browser support:
- ✅ Chrome 56+ (Jan 2017)
- ✅ Firefox 31+ (Jul 2014)
- ✅ Safari 10.1+ (Mar 2017)
- ✅ Edge 79+ (Jan 2020)
- ❌ IE11 — `isComposing` is `undefined`

Since `undefined` is falsy, the guard `if (e.nativeEvent.isComposing) return;` will simply not trigger on IE11, falling through to the existing Enter key behavior. This is a safe degradation — IE11 users get the old behavior (which is what they had before), and modern browsers get the fix.

**Verdict:** ✅ Safe across all modern browsers. Graceful degradation on unsupported browsers.

---

### 🟡 P1 — Event ordering: `compositionend` vs `keydown` on Chrome

**This is a known cross-browser difference:**

- **Chrome (Blink):** The Enter key that confirms IME composition fires `keydown` → `compositionend` → `keyup`. The `keydown` event has `isComposing: true`. ✅ Guard works.
- **Firefox (Gecko):** Same order as Chrome. ✅ Guard works.
- **Safari (WebKit):** Fires `compositionend` → `keydown` → `keyup`. The `keydown` event has `isComposing: false`. ❌ Guard does NOT fire, but the composition is already ended, so this is actually **correct behavior** — the Enter after composition end should submit.

**However**, there's a subtle Safari edge case: some IME methods fire `compositionend` with the final character AND then a `keydown` for Enter in rapid succession. If the user's intent was to confirm composition (not submit), Safari's behavior means the message IS submitted. This is the same behavior as before the fix on Safari, so it's not a regression.

**Verdict:** ✅ No regression. Chrome/Firefox get the fix. Safari behavior unchanged.

---

### ✅ No impact on non-IME keyboard shortcuts

The guard `if (e.nativeEvent.isComposing) return;` only fires when `isComposing === true`. For non-IME users:
- `isComposing` is always `false` during normal typing
- Ctrl+Enter, Shift+Enter, plain Enter all work exactly as before
- The guard is the **first** check, before any key matching, so it's a clean short-circuit

**Verified handlers:**
- `ChatPanel.tsx:156` — guards before ArrowDown/ArrowUp/Enter/Escape mention handling ✅
- `GroupChat.tsx:241` — guards before Enter-to-send ✅
- `LeadDashboard.tsx:661` — guards before Enter-to-rename ✅
- `LeadDashboard.tsx:1295` — guards before Enter-to-send (already checks `!e.shiftKey && !e.ctrlKey && !e.metaKey`) ✅
- `LeadDashboard.tsx:2513` — guards before Enter-to-save, Escape-to-cancel ✅
- `OverviewPage.tsx:122` — guards before Enter-to-reply ✅
- `OverviewPage.tsx:640` — guards before Ctrl/Meta+Enter-to-feedback ✅

**All 7 locations confirmed.** The guard is correctly placed before ALL key checks, not just Enter.

---

### 🟡 P2 — Escape key blocked during IME composition

**Files:** `LeadDashboard.tsx:2513`, `ChatPanel.tsx:156`

The guard returns early for ALL keys during composition, including Escape. If a user is in IME composition and presses Escape to cancel the composition, the `onKeyDown` handler returns early — the Escape key is never processed by the application.

This is actually **correct** — during IME composition, the IME itself handles Escape to cancel composition. The application shouldn't interfere. But it's worth noting.

---

## Summary

| Issue | Severity | Status |
|-------|----------|--------|
| Frontend AgentStatus missing 'terminated' | 🔴 P0 | **Must fix before merge** |
| Double-kill fires events redundantly | 🟡 P1 | Should fix |
| Delegation status doesn't distinguish terminated vs failed | 🟡 P1 | Should fix |
| Chrome/Safari IME event ordering difference | 🟡 P1 | No regression, document |
| Triple agent:status event emission | 🟢 P2 | Nice to fix |
| shutdownAll() skips kill() flow | 🟢 P2 | Intentional? Verify |
| DB schema stores terminated as 'crashed' | 🟢 P2 | Low impact |
| Escape key during composition | 🟢 P2 | Correct behavior |

**Blocking issue:** The frontend `AgentStatus` type mismatch (P0) MUST be fixed before these changes are merged. Multiple UI components will display incorrect state for terminated agents.
