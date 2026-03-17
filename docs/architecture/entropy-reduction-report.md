# Entropy Reduction Report

**Date:** March 2026
**Scope:** Entire Flightdeck codebase — structural complexity, growth patterns, and reduction strategies
**Method:** Three-model independent analysis (Claude Opus 4.6, GPT-5.4, Gemini 3 Pro) with consensus synthesis

---

## Executive Summary

Three independent AI architects analyzed the Flightdeck codebase for entropy — unnecessary complexity that accumulates over time and makes the system harder to understand, modify, and debug. All three converged on the same root causes and proposed strikingly similar structural remedies.

**Core thesis:** Flightdeck's entropy is not from bad code — it's from missing abstractions. The codebase grew features faster than it grew structure. The fix is not a rewrite; it's installing the right boundaries, types, and patterns that prevent complexity from accumulating.

---

## Universal Consensus: Root Causes

All three models independently identified these as the primary entropy sources:

### 1. AgentManager God Object (1,517 lines, 10 responsibilities)

**Location:** `packages/server/src/agents/AgentManager.ts`

AgentManager handles: agent spawning, lifecycle management, message routing, thinking buffer management, session resume, heartbeat monitoring, tool execution coordination, provider selection, ACP protocol management, and WebSocket event emission.

**Why it matters:** Every new feature touching agents must modify this file. With 13 injected dependencies and 10 responsibilities, changes have unpredictable ripple effects. It is the single largest source of merge conflicts and the hardest file to reason about.

**Entropy pattern:** *Gravitational accumulation* — large files attract more code because "it's already here." Each addition makes the next one marginally easier but the whole marginally worse.

### 2. Boolean Flags Instead of State Machines

**Locations:** `AgentManager.ts` (`_isResuming`, `_isSpawning`, `_isIdle`), `useWebSocket.ts` (connection state booleans)

The codebase uses independent boolean flags to represent agent states: `_isResuming`, `_isSpawning`, `_isIdle`, `_hasWork`. These can combine into 2⁴ = 16 theoretical states, most of which are invalid (e.g., `_isResuming && _isIdle`). But nothing prevents those invalid states.

**Why it matters:** Every conditional that checks a flag must implicitly understand which flag combinations are valid. This knowledge is spread across dozens of call sites rather than encoded in a type. New developers (and AI agents) must reverse-engineer the valid states from scattered checks.

**Entropy pattern:** *Implicit state machine* — the state machine exists but isn't declared, making it invisible and unenforceable.

### 3. Parallel Message Pipelines (Dual Stores)

**Locations:** `leadStore.ts` + `groupStore.ts`, `appStore.agents[].messages` + API fetch results

Messages flow through multiple parallel paths:
- Lead messages: `leadStore.messages` (from WebSocket) AND `leadStore.groupMessages` (from groups)
- Agent messages: `appStore.agents[].messages` (from WebSocket) AND API fetch responses (from REST)
- Group messages: `groupStore` AND `leadStore.groupMessages`

**Why it matters:** `groupStore` and `leadStore.groupMessages` are duplicate sources of truth for group messages. When they disagree, the UI shows stale or inconsistent data. The REST/WebSocket duality for agent messages creates merge conflicts (see: fetch race bug in AcpOutput).

**Entropy pattern:** *Dual source of truth* — two representations of the same data that must be kept in sync manually.

### 4. Untyped WebSocket Events

**Location:** `useWebSocket.ts` (30+ event types), `packages/server/src/agents/AgentManager.ts`

WebSocket messages are dispatched as string-typed events with `any`-shaped payloads:
```typescript
socket.on('agent:text', (data) => { /* data is untyped */ })
```

The server and client must agree on event names and payload shapes, but this contract exists only in developer knowledge — not in code.

**Why it matters:** Adding a new event requires changes in 3+ files with no compiler assistance. Renaming an event is a find-and-replace prayer. Payload shape mismatches cause silent failures at runtime.

**Entropy pattern:** *Implicit contract* — two systems share an interface defined by convention rather than by type.

### 5. useWebSocket Monolith (556 lines, 30+ event handlers)

**Location:** `packages/web/src/hooks/useWebSocket.ts`

A single React hook handles all WebSocket event types: agent text, thinking, tool use, system messages, roster updates, task updates, cost updates, heartbeat, connection state, and more. It writes to 5 different Zustand stores.

**Why it matters:** Any change to any WebSocket event requires modifying this file. The hook's dependency array is enormous, causing unnecessary re-renders. Testing requires mocking 5 stores and dozens of events.

**Entropy pattern:** *Monolithic handler* — a single entry point that knows about every concern in the system.

---

## Unique Insights by Model

### Claude Opus 4.6: Role Special-Casing & Best Abstractions

**46 Lead Role Checks:** Opus identified 46 instances of `role.id === 'lead'` scattered across 7+ modules. This means "lead" behavior is defined by 46 special cases rather than by a role interface. Adding a new role type would require auditing all 46 sites.

**CommandEntry as Best Abstraction:** Opus highlighted the `CommandEntry` pattern in `CommandDispatcher.ts` as the codebase's best abstraction — a clean interface with regex pattern, handler function, help metadata, and explicit typing. This pattern should be replicated for WebSocket events and agent lifecycle hooks.

**Core Thesis:** *"The codebase's entropy comes from missing types, not missing tests. Adding 100 tests won't prevent the next implicit-contract bug. Adding 5 discriminated unions will."*

### GPT-5.4: Coordination Supernova & Complexity Attractors

**Coordination Supernova:** GPT-5.4 used the metaphor of a "coordination supernova" — AgentManager has collapsed under its own gravity, and the complexity is radiating outward into every file that touches it. The solution isn't to patch the supernova but to fission it into smaller, stable elements.

**Structures That Attract Complexity:** GPT-5.4 identified that certain code structures *attract* new complexity disproportionately. The `switch` statement in `useWebSocket` for message types is one — every new feature adds a case. The `if (role.id === 'lead')` pattern is another — every new behavior check adds an instance. These structures should be replaced with registry patterns that grow by addition, not modification.

**Core Thesis:** *"Entropy isn't just about what code exists — it's about what code gets written next. The current structure incentivizes adding special cases instead of proper abstractions. Change the incentive structure."*

### Gemini 3 Pro: Phantom Shared Package, Branded IDs & Boundaries as Walls

**Phantom Shared Package:** Gemini noted that `packages/shared` contains mostly type definitions but no runtime enforcement. The "shared" contract between server and client is largely aspirational — the actual runtime behavior diverges. Shared types that aren't validated at boundaries create false confidence.

**Branded Entity IDs:** Gemini proposed branded types for entity identifiers:
```typescript
type AgentId = string & { __brand: 'AgentId' }
type ProjectId = string & { __brand: 'ProjectId' }
type SessionId = string & { __brand: 'SessionId' }
```
This would make it a compile-time error to pass a project ID where an agent ID is expected — eliminating an entire category of bugs (like the `project:xxx` store key issue).

**Boundaries as Walls:** Gemini emphasized that module boundaries should be *walls*, not *suggestions*. Currently, any file can import from any other file within a package. ESLint import boundary rules should enforce that stores don't import from components, hooks don't import from stores directly (use a defined interface), and server routes don't import from agent internals.

**Core Thesis:** *"A well-structured codebase makes wrong code look wrong. Right now, wrong code looks exactly like right code — you can't tell a `project:xxx` key from a UUID by looking at the type."*

---

## Converged Priority List

Ranked by impact-to-effort ratio, combining all three models' assessments:

### Tier 1: High Impact, Moderate Effort

#### 1. Typed WebSocket Protocol
**Effort:** 2-3 days | **Impact:** Eliminates implicit contracts, enables tooling

Define a discriminated union for all WebSocket events:
```typescript
type ServerEvent =
  | { type: 'agent:text'; agentId: AgentId; content: string; messageId: string }
  | { type: 'agent:thinking'; agentId: AgentId; content: string }
  | { type: 'roster:update'; agents: AgentSummary[] }
  | { type: 'task:update'; task: TaskUpdate }
  // ... all 30+ events
```

Both server emission and client handling become type-checked. Adding a new event requires adding to the union (compiler enforces all handlers). Removing an event produces compiler errors at all usage sites.

#### 2. Agent Phase State Machine
**Effort:** 1-2 days | **Impact:** Eliminates invalid states, makes lifecycle explicit

Replace boolean flags with a discriminated union:
```typescript
type AgentPhase =
  | { phase: 'spawning' }
  | { phase: 'resuming'; since: Date }
  | { phase: 'active'; hasWork: boolean }
  | { phase: 'idle'; since: Date }
  | { phase: 'completed'; summary: string }
  | { phase: 'error'; error: string }
```

Valid transitions are defined explicitly. Invalid states become unrepresentable. Every `if (_isResuming)` check becomes a pattern match.

#### 3. Decompose AgentManager
**Effort:** 3-5 days | **Impact:** Reduces largest entropy source, enables parallel development

Split into focused modules:
- `AgentLifecycle` — spawn, resume, terminate
- `AgentMessaging` — buffer management, message routing, thinking flush
- `AgentHeartbeat` — heartbeat monitoring, idle detection
- `AgentProvider` — ACP connection, provider selection, tool execution
- `AgentManager` — orchestrator that composes the above (< 200 lines)

Each module has a clear interface. Changes to messaging don't risk breaking lifecycle. New features go in the right module, not "wherever fits in the god object."

### Tier 2: High Impact, Lower Effort

#### 4. Unified Message Store
**Effort:** 2-3 days | **Impact:** Eliminates dual stores, fixes dedup/race bugs

Replace `leadStore.messages` + `leadStore.groupMessages` + `groupStore` + `appStore.agents[].messages` with a single message store:
```typescript
interface MessageStore {
  messages: Map<ConversationId, Message[]>
  addMessage(conversationId: ConversationId, message: Message): void  // idempotent
  getMessages(conversationId: ConversationId): Message[]
}
```

All messages have unique IDs. `addMessage` is idempotent (dedup by ID). Conversations are keyed by a typed `ConversationId` (not `project:xxx`). A single cap applies to all conversations.

#### 5. CI Guardrails
**Effort:** 1 day | **Impact:** Prevents entropy from growing

Add to CI pipeline:
- **File size limit:** No file > 500 lines (flags AgentManager, useWebSocket, AcpOutput)
- **Import boundaries:** ESLint `eslint-plugin-boundaries` or `eslint-plugin-import` rules
- **No `any` in new code:** `@typescript-eslint/no-explicit-any` as error
- **Cyclomatic complexity limit:** Flag functions with complexity > 15

These don't fix existing issues but prevent new entropy. The file size limit is the highest-leverage single rule — it forces decomposition at authorship time.

### Tier 3: Medium Impact, Targeted Effort

#### 6. Branded Entity IDs
**Effort:** 1-2 days | **Impact:** Compile-time prevention of ID misuse

```typescript
type AgentId = string & { __brand: 'AgentId' }
type ProjectId = string & { __brand: 'ProjectId' }
type SessionId = string & { __brand: 'SessionId' }

function agentId(raw: string): AgentId { return raw as AgentId }
```

Eliminates the `project:xxx` bug category entirely. A `ProjectId` cannot be used where an `AgentId` is expected.

#### 7. Kill Dual Stores (groupStore → leadStore)
**Effort:** 1 day | **Impact:** Eliminates one duplicate source of truth

Merge `groupStore` into `leadStore`. Group messages are already partially stored in both — unify them. `groupStore` currently has 3 consumers; migration is straightforward.

#### 8. Prune Coordination Sprawl
**Effort:** 2-3 days | **Impact:** Reduces surface area, simplifies mental model

The coordination system (tasks, DAG, delegation, dependencies) has grown organically across `TaskCommands.ts`, `CoordCommands.ts`, `CompletionTracking.ts`, and `AgentManager.ts`. Audit for:
- Unused coordination features (built but never exercised)
- Redundant task state checks (same check in multiple places)
- Overly flexible APIs (parameters that are always passed the same value)

---

## What Good Looks Like: Reference Patterns

### Best-in-Class Comparisons

| Pattern | Flightdeck Today | Best Practice | Reference Project |
|---------|------------------|---------------|-------------------|
| WS events | String-typed, any payload | Discriminated union | tRPC subscriptions |
| State machines | Boolean flags | Explicit states | XState, Robot |
| Store architecture | 7 Zustand stores, 2 overlapping | Normalized, single concern | Redux Toolkit slices |
| God objects | 1,517 line AgentManager | < 300 lines, composed | VS Code extension host |
| Module boundaries | Implicit (convention) | Enforced (lint rules) | Nx workspace boundaries |
| Entity IDs | Plain strings | Branded types | Effect-TS |

### The CommandEntry Pattern (Internal Reference)

Flightdeck's own `CommandEntry` interface in `CommandDispatcher.ts` is the best example of a low-entropy abstraction:

```typescript
interface CommandEntry {
  pattern: RegExp           // How to recognize it
  handler: CommandHandler   // What to do
  help: CommandHelp         // How to document it
  requiresPayload: boolean  // Explicit contract
}
```

This pattern should be replicated for:
- WebSocket event handlers (pattern → event type, handler → processor, help → schema)
- Agent lifecycle hooks (pattern → phase transition, handler → action)
- API route definitions (already partially done with Express)

---

## Implementation Strategy

### Phase 1: Stop the Bleeding (Week 1)
- CI guardrails (file size, import boundaries, no `any`)
- Branded entity IDs (AgentId, ProjectId, SessionId)
- Kill dual stores (merge groupStore → leadStore)

### Phase 2: Core Abstractions (Week 2-3)
- Typed WebSocket protocol (discriminated union)
- Agent phase state machine (replace boolean flags)
- Unified message store (with IDs and dedup)

### Phase 3: Decomposition (Week 3-4)
- Split AgentManager into focused modules
- Split useWebSocket into handler registry
- Decompose AcpOutput into focused components

### Measurement

Track entropy metrics over time:
- **Largest file in each package** (target: < 500 lines)
- **Number of `any` types** (target: 0 in new code)
- **Number of `role.id === 'lead'` checks** (target: < 5, behind interface)
- **Number of Zustand stores** (target: consolidated from 7 to 4)
- **Test coverage of state transitions** (target: 100% for agent lifecycle)

---

## Appendix: Entropy Metrics Snapshot

| Metric | Current | Target |
|--------|---------|--------|
| Largest server file | 1,517 lines (AgentManager) | < 500 lines |
| Largest web file | 895 lines (AcpOutput) | < 500 lines |
| Largest hook | 556 lines (useWebSocket) | < 300 lines |
| Boolean state flags | 4+ per agent | 0 (state machine) |
| Zustand stores | 7 (2 overlapping) | 4-5 (no overlap) |
| Lead role special cases | 46 | < 5 (behind interface) |
| WebSocket event types | 30+ (untyped) | 30+ (typed union) |
| `project:xxx` usages | ~12 | 0 (branded IDs) |
| Message dedup | Partial (groups only) | Universal |
| CI entropy checks | 0 | 4+ (size, imports, any, complexity) |
