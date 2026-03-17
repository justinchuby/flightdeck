# Messaging & State Management Architecture Audit

**Date:** March 2026
**Scope:** Lead chat flow, agent side panel flow, thinking persistence, session resume, completion tracking
**Method:** Three-model independent audit (Claude Opus 4.6, GPT-5.4, Gemini 3 Pro) with consensus synthesis

---

## Executive Summary

Three independent AI architects audited the messaging and state management system across `packages/server` and `packages/web`. All three converged on the same core issues: implicit state machines using boolean flags, dual-source-of-truth stores, a fragile `project:xxx` key pattern, and missing message deduplication. The completion tracking subsystem was universally praised as well-designed.

**Critical bugs found:** 2
**Design smells identified:** 8
**Consensus recommendations:** 5

---

## 1. Lead Chat Message Flow

**Files:** `leadStore.ts` → `useLeadWebSocket.ts` → `useLeadMessages.ts` → `ChatMessages.tsx`

### Architecture

The lead chat uses a Zustand store (`leadStore`) as the source of truth, with a WebSocket hook (`useLeadWebSocket`) handling real-time message ingestion. The `useLeadMessages` hook transforms raw store data into renderable format, and `ChatMessages` renders the UI.

### Critical Bug: storeKey / effectiveLeadId Mismatch

**Location:** `useLeadWebSocket.ts:430-439`

The hook derives two different identifiers from the same input:
- `storeKey`: Can be `"project:xxx"` (a synthetic compound key)
- `effectiveLeadId`: Always a UUID (resolved from project → agent lookup)

These diverge when a project-scoped lead is selected. The WebSocket subscribes using `effectiveLeadId` (correct), but message storage uses `storeKey` (potentially `project:xxx`). If any downstream code expects a UUID as the store key, messages are silently lost or misrouted.

**Root cause:** The `project:xxx` pattern is a UI convenience that leaked into the data layer. It creates a second identity system parallel to UUIDs.

### No Message Deduplication

**Location:** `leadStore.ts`

Unlike `groupMessages` (which has dedup logic), the lead message array performs no deduplication. During network reconnects or session resume, the same messages can be appended multiple times. This manifests as duplicate messages in the chat UI.

### Unbounded Message Array

**Location:** `leadStore.ts`

The messages array grows without limit. Other stores (activity, comms) cap their arrays, but lead messages do not. In long sessions (8+ hours), this causes increasing memory consumption and GC pressure.

### Consensus Assessment

| Aspect | Opus | GPT-5.4 | Gemini | Verdict |
|--------|------|---------|--------|---------|
| storeKey/effectiveLeadId bug | Critical | Critical | Critical | **Fix immediately** |
| Missing dedup | High | High | Medium | **Fix soon** |
| Unbounded messages | Medium | Medium | Medium | **Add cap** |
| Overall flow clarity | 6/10 | 5/10 | 6/10 | **Needs work** |

---

## 2. Agent Side Panel Message Flow

**Files:** `appStore.ts` → `useWebSocket.ts` → `AcpOutput.tsx` with `groupTimeline`

### Architecture

Agent messages are stored in `appStore.agents[].messages`, populated by WebSocket events (`agent:text`, `agent:thinking`, `agent:tool-use`, etc.) processed in `useWebSocket.ts`. The `AcpOutput` component renders agent output with a complex timeline view.

### Critical Bug: Fetch Race on Panel Open

**Location:** `AcpOutput.tsx:265-290`

When a user opens the agent side panel, `AcpOutput` fetches the agent's message history from the API. Meanwhile, WebSocket events continue arriving. The fetch response can overwrite messages that arrived via WebSocket during the fetch, causing message loss. There is no merge strategy — the last write wins.

**Reproduction:** Open an agent panel while the agent is actively producing output. Messages generated between fetch-start and fetch-complete may vanish.

### appStore Replacement Wipe

**Location:** `appStore.ts` — `setAgents()` / `addAgent()`

When the agent roster is refreshed (e.g., during session resume), `setAgents()` replaces the entire agents array. Any in-flight messages stored on the old agent objects are lost. The `addAgent()` path preserves existing messages, but `setAgents()` does not attempt to merge.

### Missing DM Deduplication

Direct messages between agents lack deduplication. The same DM can appear multiple times if:
- The WebSocket reconnects during delivery
- Session resume re-fetches messages that were already received live

### AcpOutput Complexity

At 895 lines, `AcpOutput.tsx` is a god component handling: agent text rendering, thinking block rendering, tool use visualization, system messages, rich content, user messages, scroll management, and timeline grouping. This makes it fragile and difficult to modify.

### Consensus Assessment

| Aspect | Opus | GPT-5.4 | Gemini | Verdict |
|--------|------|---------|--------|---------|
| Fetch race bug | Critical | Critical | High | **Fix immediately** |
| setAgents wipe | High | High | High | **Add merge** |
| DM dedup missing | Medium | Medium | Medium | **Add with unified store** |
| AcpOutput size | High | High | Medium | **Decompose** |

---

## 3. Thinking / Reasoning Persistence

**Files:** `AgentManager.ts:1346-1408`

### Architecture

The server maintains two parallel buffers per agent:
- `messageBuffers`: Accumulates `agent:text` content
- `thinkingBuffers`: Accumulates `agent:thinking` content

Both use a 2-second debounce timer. When a thinking buffer flushes, it emits a `thinking` message to the database. A cross-flush guard prevents interleaving: when text starts, any pending thinking is flushed first (and vice versa).

### Assessment: Bolted-On but Functional

All three auditors characterized this as "bolted-on" — it works but lacks elegance:

1. **Dual buffer system:** Two nearly-identical buffer implementations with the same flush/debounce logic. The only difference is the message type on flush. This should be a single parameterized buffer.

2. **Chronological ordering:** The thinking buffer flushes before the text buffer when the agent transitions from thinking to speaking. But the flush timestamps are synthetic (generated at flush time, not at content-generation time). In fast think→speak transitions, the ordering can appear wrong in the UI.

3. **No content-addressed storage:** Thinking content is stored as raw text blobs. If the same thinking block is flushed twice (e.g., during reconnect), it creates duplicate database entries.

4. **Cross-flush guard complexity:** The mutual exclusion between thinking and text flushes adds subtle ordering constraints. The guard prevents data loss but makes the control flow hard to reason about.

### Consensus Assessment

| Aspect | Opus | GPT-5.4 | Gemini | Verdict |
|--------|------|---------|--------|---------|
| Dual buffer DRY | Medium | Medium | High | **Unify buffers** |
| Timestamp accuracy | Low | Medium | Low | **Accept for now** |
| Cross-flush guard | Medium | Medium | Medium | **Simplify with unified buffer** |

---

## 4. Session Resume

**Files:** `AgentManager.ts:523-524, 689-714`

### Architecture

Session resume reconstructs agent state after a server restart. The flow:
1. `_isResuming = true` set during agent spawn
2. Agent reconnects to ACP provider
3. Historical messages are replayed from database
4. `_isResuming` cleared... implicitly, as a side effect of the agent's status changing

### Critical Design Smell: _isResuming Lifecycle

The `_isResuming` flag is set explicitly but never cleared explicitly. It becomes `false` as a side effect when the agent's status transitions away from `spawning`. This creates several problems:

1. **No guaranteed cleanup:** If the status transition never fires (e.g., spawn failure), `_isResuming` stays `true` forever. Downstream code that checks this flag will behave incorrectly.

2. **Asymmetric lifecycle:** Set in one place, cleared in a completely different place via side effect. A developer reading the set-site has no indication of where/how it gets cleared.

3. **Race condition window:** Between spawn and status-transition, `_isResuming` is `true`. During this window, any code that checks it gets resume-mode behavior even for fresh spawns.

### Asymmetric Cleanup

Related to the above: the resume path sets up WebSocket subscriptions and event handlers, but the cleanup path (agent removal) does not mirror the setup path. Some handlers are cleaned up in `removeAgent()`, others in the WebSocket `close` event, and others rely on garbage collection.

### Consensus Assessment

| Aspect | Opus | GPT-5.4 | Gemini | Verdict |
|--------|------|---------|--------|---------|
| _isResuming lifecycle | High | High | Critical | **Explicit clear needed** |
| Asymmetric cleanup | Medium | High | Medium | **Mirror setup/teardown** |
| Resume robustness | 5/10 | 4/10 | 5/10 | **Fragile** |

---

## 5. Completion Tracking

**Files:** `CompletionTracking.ts:51-143`, `TaskCommands.ts`

### Architecture

Completion tracking uses a 5-layer guard to determine when an agent's task is truly complete:

1. **Has work?** — Did the agent produce any meaningful output?
2. **Parent alive?** — Is the parent agent/lead still active?
3. **Deduplication** — Has this completion already been processed?
4. **DAG check** — Are all DAG tasks marked done?
5. **COMPLETE_TASK in output?** — Did the agent explicitly signal completion?

### Assessment: Well-Designed

All three auditors agreed this is the best-designed subsystem in the messaging stack. The guard layers are logically ordered, each serves a clear purpose, and the overall flow is easy to follow.

**Minor issues:**

1. **DRY opportunity:** The completion check logic appears in both `CompletionTracking.ts` and partially in `TaskCommands.ts`. A single source of truth would be cleaner.

2. **Same-turn race guard (lines 77-85):** Prevents a COMPLETE_TASK command from racing with the completion tracker's own check. This is correct but the comment explaining it could be clearer about why the race exists.

3. **Magic timeouts:** The completion debounce uses hardcoded timeout values. These should be named constants.

### Consensus Assessment

| Aspect | Opus | GPT-5.4 | Gemini | Verdict |
|--------|------|---------|--------|---------|
| Guard design | Solid | Solid | Solid | **Keep as-is** |
| DRY with TaskCommands | Low | Medium | Low | **Minor cleanup** |
| Race guard clarity | Medium | Low | Low | **Better comments** |

---

## Cross-Cutting Consensus

All three independent auditors converged on these recommendations, listed by priority:

### 1. Eliminate the `project:xxx` Pattern

The synthetic `project:xxx` key creates a parallel identity system that leaks across store boundaries. Replace with direct UUID lookups and a clean project→lead resolution layer.

**Impact:** Eliminates the storeKey/effectiveLeadId bug, simplifies leadStore, removes implicit contract between UI and data layer.

### 2. Unified Message Store with IDs and Deduplication

Replace the current split (leadStore messages, appStore agent messages, groupStore group messages) with a single message store that:
- Assigns unique IDs to every message at creation
- Deduplicates on ingest (idempotent writes)
- Caps total messages per conversation
- Supports pagination for long sessions

**Impact:** Fixes all dedup bugs, fixes unbounded growth, fixes setAgents wipe, simplifies 3 stores into 1 message concern.

### 3. Explicit `_isResuming` Lifecycle

Replace the implicit side-effect-based clearing with:
```typescript
agent.beginResume()   // sets _isResuming = true
// ... resume work ...
agent.endResume()     // sets _isResuming = false, always called (try/finally)
```

Add a timeout safety net: if `_isResuming` is still true after 60 seconds, force-clear it and log a warning.

**Impact:** Fixes the fragile resume lifecycle, makes the state machine explicit.

### 4. Fix Fetch Race in AcpOutput

Replace the current fetch-then-replace pattern with:
- Fetch returns messages with IDs
- Merge (don't replace) into existing messages
- Sort by timestamp/sequence after merge

**Impact:** Fixes the critical message-loss bug on panel open.

### 5. Completion Tracking Is Solid — Preserve the Pattern

The 5-layer guard pattern in CompletionTracking should be documented as a reference pattern for other subsystems. Minor DRY cleanup is warranted but the core design should not change.

---

## Appendix: File Reference

| File | Lines | Role | Health |
|------|-------|------|--------|
| `packages/web/src/stores/leadStore.ts` | 330 | Lead message storage | ⚠️ No dedup, unbounded |
| `packages/web/src/hooks/useLeadWebSocket.ts` | 473 | Lead WS connection | 🔴 storeKey bug |
| `packages/web/src/stores/appStore.ts` | ~400 | Agent state storage | ⚠️ setAgents wipe |
| `packages/web/src/hooks/useWebSocket.ts` | 556 | Agent WS connection | ⚠️ God hook |
| `packages/web/src/components/ChatPanel/AcpOutput.tsx` | 895 | Agent output rendering | 🔴 Fetch race, god component |
| `packages/server/src/agents/AgentManager.ts` | 1517 | Agent lifecycle | ⚠️ God object |
| `packages/server/src/agents/commands/CompletionTracking.ts` | 362 | Task completion | ✅ Well-designed |
| `packages/server/src/agents/commands/TaskCommands.ts` | ~200 | Task command handlers | ✅ Minor DRY opportunity |
