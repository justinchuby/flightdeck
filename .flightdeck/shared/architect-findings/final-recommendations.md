# Final UI Architecture Improvement Recommendations

**Author**: Architect Agent (20818db3)  
**Date**: 2026-03-06  
**Status**: Final v2 — all blocking issues resolved, critical reviewer approved

**Source documents**:
1. [Architect Analysis](./ui-architecture-analysis.md)
2. [Developer Proposals](../developer-proposals/ui-improvements.md)
3. [Code Review](../code-reviewer-536bf3ea/implementation-review.md)
4. [Critical Review](../critical-review/improvements-review.md)
5. [Readability Review](../readability-review/improvements-review.md)

---

## Implementation Order

The code reviewer recommended reordering from the original priority list. After weighing all feedback, the final implementation order is:

| Order | Improvement | Rationale |
|:-----:|-------------|-----------|
| **0** | Quick Wins (Toast a11y, dead props, formatTokens) | Zero risk, immediate value — do these first or in parallel |
| **1** | API/WS Prop Drilling Extraction | Smallest scope, highest type-safety win, unblocks cleaner interfaces for improvements 2 and 3 |
| **2** | Shared `<Modal>` Component | Biggest a11y win (32 modals), but needs careful migration — benefits from clean component interfaces established in #1 |
| **3** | Keyboard-Accessible `AgentCard` | Quick fix, but should follow Modal since the a11y patterns established there inform this work |

---

## Quick Wins — Do These Immediately (P0)

All three reviewers independently flagged these as missing from the original proposals. Zero risk, trivial effort, outsized impact.

### A. Toast `aria-live` — 2-line fix, massive a11y impact

`Toast.tsx:47` has no live region attributes. Screen readers don't announce **any** toast notification (agent spawned, errors, status changes).

**Fix** — change the container div:
```tsx
// Toast.tsx:47 — before:
<div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">

// After:
<div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm" role="status" aria-live="polite">
```

Also add `aria-label="Close notification"` to the close button (`Toast.tsx:57`).

**Done when**: `Toast.tsx` container has `role="status"` + `aria-live="polite"`, close button has `aria-label`.

### B. Dead `ws` prop on AgentCard — delete 2 lines

`AgentCard.tsx:12` receives `ws: any` but never references it. This is phantom prop drilling.

**Done when**: `grep "ws" packages/web/src/components/AgentDashboard/AgentCard.tsx` returns 0 results for prop declarations.

### C. Extract `formatTokens` utility — consolidate 4 copies

Independently defined in 4 files: `TeamStatus.tsx:6`, `AgentReportBlock.tsx:4`, `TokenEconomics.tsx:7`, `CostBreakdown.tsx:7`. Plus a variant `formatTokensCompact` in `PulseStrip.tsx:18`.

**Fix** — create `utils/formatTokens.ts`:
```tsx
export function formatTokens(n: number, compact = false): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(compact ? 0 : 1)}k`;
  return String(n);
}
```

**Done when**: `grep -rn "function formatTokens" packages/web/src/` returns exactly 1 result.

---

## Improvement 1: Extract API/WebSocket from Prop Drilling

**Priority**: P1 → moved to implement first (smallest blast radius)  
**Effort**: Low-Medium  
**Files touched**: `hooks/useApi.ts`, `App.tsx`, and 12 consumer components

### Problem

The `useApi()` hook is called once in `App.tsx` and its return value is prop-drilled as `api: any` through 12+ components. The `ws` return from `useWebSocket()` follows the same pattern through 8 components.

```
App.tsx → LeadDashboard (api: any, ws: any)
       → AgentDashboard (api: any, ws: any)  → AgentCard (api: any, ws: any)
       → OverviewPage (api: any, ws: any)
       → GroupChat (api: any, ws: any)
       → OrgChart (api: any, ws: any)
       → TaskQueuePanel (api: any)
       → SettingsPanel (api: any)
       → TimelinePage (api: any, ws: any)
```

Key evidence:
- `AgentDashboard/AgentCard.tsx:11-12` — receives `ws: any` but **never references it** (dead prop)
- `AgentDashboard/SpawnDialog.tsx:6` — `api: any` with zero autocomplete or type checking
- `hooks/useApi.ts:139-153` — return value has no explicit type, no `useMemo`

### Solution

**Step 1**: Define typed interfaces for both hooks.

```tsx
// hooks/useApi.ts
export interface FlightdeckApi {
  spawnAgent: (roleId: string, task?: string, autopilot?: boolean) => Promise<void>;
  terminateAgent: (id: string) => Promise<void>;
  interruptAgent: (id: string) => Promise<void>;
  restartAgent: (id: string) => Promise<void>;
  resumeAgent: (id: string, sessionId: string) => Promise<void>;
  updateAgent: (id: string, patch: { model?: string }) => Promise<void>;
  updateConfig: (patch: Partial<ServerConfig>) => Promise<ServerConfig>;
  createRole: (role: Omit<Role, 'builtIn'>) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  resolvePermission: (agentId: string, approved: boolean) => Promise<void>;
  fetchGroups: (leadId: string) => Promise<ChatGroup[]>;
  fetchGroupMessages: (leadId: string, groupName: string) => Promise<GroupMessage[]>;
  fetchDagStatus: (leadId: string) => Promise<DagStatus>;
}
```

> **Critical review fix**: The developer proposal had 3 `Promise<any>` returns (`fetchGroups`, `fetchGroupMessages`, `fetchDagStatus`). These are replaced with proper types above. The purpose of this proposal is type safety — `any` returns undermine it.

**Step 2** *(critical review BLOCKING fix)*: Wrap the return value in `useMemo`.

```tsx
export function useApi(): FlightdeckApi {
  const spawnAgent = useCallback(/* ... */);
  // ... all existing useCallback definitions ...

  return useMemo(() => ({
    spawnAgent, terminateAgent, interruptAgent, restartAgent,
    resumeAgent, updateAgent, updateConfig, createRole,
    deleteRole, resolvePermission, fetchGroups,
    fetchGroupMessages, fetchDagStatus,
  }), [spawnAgent, terminateAgent, interruptAgent, restartAgent,
       resumeAgent, updateAgent, updateConfig, createRole,
       deleteRole, resolvePermission, fetchGroups,
       fetchGroupMessages, fetchDagStatus]);
}
```

Without `useMemo`, each component calling `useApi()` independently gets a new object reference per render. If any component passes the `api` object into a `useEffect` dependency array or child prop, it triggers infinite re-render loops.

**Step 3**: Keep initialization in `App.tsx`, not in `useApi()`.

> **Critical review fix**: The developer proposal used a module-level `let initialized = false` flag. This is unsafe: it survives HMR (stale closures after hot reload), is unreliable under React StrictMode (double-fired effects), and not SSR-safe. Instead, `loadRoles()` and `loadConfig()` remain in their existing `useEffect` in `App.tsx:106-109`. The `useApi()` hook becomes a pure function with no side effects.

**Step 4**: Define `WebSocketApi` interface for `ws` consumers.

> **Readability review fix**: The `ws` migration was underspecified. Here's the type:

```tsx
// hooks/useWebSocket.ts
export interface WebSocketApi {
  send: (msg: WsMessage) => void;
  subscribe: (agentId: string) => void;
  unsubscribe: (agentId: string) => void;
  subscribeProject: (projectId: string | null) => void;
  sendInput: (agentId: string, text: string) => void;
  resizeAgent: (agentId: string, cols: number, rows: number) => void;
  broadcastInput: (text: string) => void;
}
```

The `useWebSocket()` hook already returns a `useMemo`-wrapped object (line 434-437), so it's already stable. The fix is adding the type and having consumers call it directly.

> **Critical new finding from code reviewer**: Investigation of `ws` prop usage across all 8 receiving components revealed that **7 of 8 have phantom `ws` dependencies** — the prop is destructured or declared in the interface but **never actually called**. Only `LeadDashboard` genuinely uses `ws.subscribe`/`ws.unsubscribe`/`ws.subscribeProject`. This dramatically simplifies and de-risks the `ws` migration:
>
> - **7 components** (AgentDashboard, AgentCard, OverviewPage, GroupChat, OrgChart, TimelinePage, FleetOverview): Migration is simply **deleting the prop** — no logic changes needed.
> - **1 component** (LeadDashboard): Move the `useWebSocket()` call from `App.tsx` into `LeadDashboard` directly. It's the only actual consumer.

**Step 5**: Migrate consumers — `ws` first (trivial), then `api` leaf-first.

Migration order:
1. **ws phantom prop deletion** (7 components — zero-risk, just delete the prop): `AgentDashboard`, `AgentCard`, `OverviewPage`, `GroupChat`, `OrgChart`, `TimelinePage`, `FleetOverview`
2. **ws real consumer** (1 component): Move `useWebSocket()` call into `LeadDashboard`
3. **api leaf components** (no further drilling): `SpawnDialog`, `SettingsPanel`, `TaskQueuePanel`
4. **api intermediate components**: `AgentCard` (also remove dead `ws` prop done in step 1), `AgentDashboard`, `GroupChat`
5. **Route components + App.tsx cleanup**: Remove all `api={api} ws={ws}` from Route elements

### Success Criteria

- [ ] `grep -r "api: any" packages/web/src/components/` returns 0 results
- [ ] `grep -r "ws: any" packages/web/src/components/` returns 0 results
- [ ] All Route elements in `App.tsx` have no `api` or `ws` props
- [ ] `FlightdeckApi` and `WebSocketApi` interfaces have zero `any` types
- [ ] `useApi()` return is wrapped in `useMemo` (verified by code review)
- [ ] TypeScript strict mode reports no new errors on API calls
- [ ] No `let initialized` module-level flags exist in `useApi.ts`

### Testing Strategy

Reference pattern: `Timeline/__tests__/accessibility.test.tsx` (420 lines, 24 ARIA assertions)

For each migrated component, add or verify:
1. **Type test**: Component renders without `api`/`ws` props (remove from test fixtures)
2. **Mock test**: `jest.mock('../../hooks/useApi')` works at module level
3. **Integration test**: API calls through the hook reach the right endpoints

### Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Unstable `useApi()` reference causes re-render loops | **High** | `useMemo` wrapper (Step 2) — **must be implemented before any migration** |
| Tests that mock `api` prop break when prop is removed | Low | Update to mock `useApi` module; standard `jest.mock` pattern |
| HMR breaks with module-level initialization flag | Medium | Don't use a flag — keep initialization in `App.tsx` (Step 3) |
| `useApi()` called in 12+ components creates 12 `useCallback` allocations | Negligible | All deps are stable; React skips recomputation. Only a concern at 50+ consumers |

---

## Improvement 2: Shared `<Modal>` Component

**Priority**: P0  
**Effort**: Medium  
**Files touched**: New `components/Shared/Modal.tsx`, then 32 consumer files incrementally

### Problem

32 files manually construct modal overlays with inline Tailwind. Each re-implements backdrop, click-to-close, escape handling, and content positioning — with inconsistent results:

- Only **7 of 32** have `role="dialog"` (screen readers don't announce the rest)
- Only **4** have `aria-modal="true"`
- **Zero** implement focus trapping (Tab escapes to content behind overlays)
- Several escape-key handlers are **dead code** (`onKeyDown` on a `<div>` that never receives focus — e.g., `ShareLinkDialog.tsx:69`)
- Backdrop opacity varies arbitrarily (`/30`, `/40`, `/50`, `/60`)

### Solution

Create `components/Shared/Modal.tsx` with these capabilities built in:

```tsx
interface ModalProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;                          // required — no optional labels
  className?: string;                          // content sizing (default: 'w-[480px]')
  closeOnBackdropClick?: boolean;              // default: true
  closeOnEscape?: boolean;                     // default: true
  children: React.ReactNode;
}
```

**Key implementation decisions** *(readability review fix — annotating the non-obvious choices)*:

1. **Portal rendering** via `createPortal(jsx, document.body)` — eliminates stacking context and `overflow: hidden` clipping bugs from inline modals
2. **Escape key via `useEffect` on `document`** — NOT `onKeyDown` on a div. The `onKeyDown` approach is dead code when the div doesn't have focus (code reviewer's finding)
3. **`requestAnimationFrame` for initial focus** — ensures DOM is painted before focusing the dialog container
4. **`tabIndex={-1}` on dialog** — makes the container programmatically focusable without adding it to the tab order
5. **`event.target === event.currentTarget`** for backdrop click — ensures only backdrop clicks (not content clicks that bubble) trigger close

**Critical review BLOCKING fix #1: Dynamic focus trap**

The developer proposal cached `focusableElements` once when the effect ran. This breaks for modals with async content (PermissionDialog loading agent details, OnboardingWizard advancing steps). Fix: re-query on each Tab press:

```tsx
function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && closeOnEscape) {
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== 'Tab') return;

  // Query fresh on each Tab — handles dynamic content, wizard steps, async loads
  const focusable = dialog!.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), ' +
    'summary, [contenteditable]'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
```

Note: `:not([disabled])` was missing from the developer proposal's selector. Disabled elements must not be focusable. Also: `summary` and `[contenteditable]` are natively focusable elements that were missing from the original selector — without them, `<details>` disclosures and rich-text editors inside modals would escape the focus trap (code reviewer catch).

**Implementation note: `onClose` ref pattern**

When `onClose` is included in the `useEffect` dependency array for the keyboard handler, inline callbacks (e.g. `<Modal onClose={() => setOpen(false)}>`) cause the effect to re-run every render — tearing down and re-attaching the document listener unnecessarily. Fix with a ref:

```tsx
const onCloseRef = useRef(onClose);
onCloseRef.current = onClose;

useEffect(() => {
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && closeOnEscape) {
      event.stopPropagation();
      onCloseRef.current();  // always calls latest callback
      return;
    }
    // ... Tab handling ...
  }
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [closeOnEscape]);  // onClose excluded — accessed via ref
```

**Critical review fix #2: Reference-counted scroll lock**

`document.body.style.overflow = 'hidden'` breaks when modals nest (confirmation on top of form). Fix:

```tsx
let scrollLockCount = 0;
function lockScroll() {
  if (scrollLockCount++ === 0) document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  if (--scrollLockCount === 0) document.body.style.overflow = '';
}
```

### Success Criteria

- [ ] `grep -rn "fixed inset-0" packages/web/src/components/ --include="*.tsx" | grep -v Modal.tsx | grep -v __tests__` returns 0 results (all modals migrated)
- [ ] Every modal has `role="dialog"` + `aria-modal="true"` + `aria-label` (verified by grep)
- [ ] Focus trap test: Tab cycles within each modal, does not escape to background
- [ ] Dynamic content test: Modal with async-loaded buttons correctly traps focus after load
- [ ] Nested modal test: Opening a second modal on top of first, closing inner doesn't restore scroll
- [ ] Escape key test: Works regardless of focus position within the modal
- [ ] Focus restoration test: Focus returns to trigger element when modal closes

### Testing Strategy

Create `components/Shared/__tests__/Modal.test.tsx` with:
1. Renders children when `open={true}`, returns null when `open={false}`
2. Has `role="dialog"` and `aria-modal="true"` when open
3. Calls `onClose` on Escape keypress (via document-level listener)
4. Calls `onClose` on backdrop click
5. Does NOT call `onClose` when `closeOnBackdropClick={false}`
6. Focus traps: Tab cycles within modal, Shift+Tab cycles backward
7. Focus trap handles dynamically added focusable elements
8. Restores focus to trigger element on close
9. `aria-label` matches the provided prop value
10. Body scroll is locked when open, restored when closed

Use `Timeline/__tests__/accessibility.test.tsx` as the structural template.

### Migration Path

1. **Create `Modal` + tests** — the component and its test suite
2. **Re-export from `Shared/index.ts`** — add to barrel export
3. **Migrate lowest-risk modals** (simple, rarely open): `SpawnDialog`, `ShareLinkDialog`, `SessionEndArchive`
4. **Migrate high-traffic modals**: `PermissionDialog`, `SearchDialog`, `GroupChat` create dialog
5. **Migrate slide-over modals**: `ConflictDetailPanel`, `ApprovalSlideOver` (may need `slideFrom` variant)
6. **Migrate complex modals last**: `CommandPaletteV2`, `OnboardingWizard` (custom focus behavior)
7. **Each migration is a separate commit** — reviewable and revertable

### Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Focus trap stale on dynamic content | **High** | Re-query focusable elements on each Tab press (see fix above) |
| Nested modals break scroll lock | Medium | Reference-counted `lockScroll`/`unlockScroll` |
| Existing z-index stacking breaks | Medium | Audit all z-index values pre-migration; Modal uses z-50 (matches existing) |
| Complex modals (CommandPalette) need custom focus | Medium | Migrate last; `Modal` accepts `children` so custom focus logic can live inside |
| e2e tests depend on `div.fixed` selectors | Low | Update to use `role="dialog"` queries (more robust anyway) |

---

## Improvement 3: Keyboard-Accessible `AgentCard`

**Priority**: P0  
**Effort**: Low  
**Files touched**: `AgentDashboard/AgentCard.tsx`, then `DataBrowser.tsx:205` and `OverviewPage.legacy.tsx:267`

### Problem

`AgentCard` (`components/AgentDashboard/AgentCard.tsx:35-42`) is the **primary navigation element** for selecting agents. It renders as a `<div>` with `onClick` — no `tabIndex`, no `role`, no `onKeyDown`, no focus indicator:

```tsx
<div
  className={`... cursor-pointer ...`}
  onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
>
```

Keyboard-only users and screen readers cannot navigate or activate agent cards. This breaks the core user flow.

### Solution

> **Critical review BLOCKING fix**: The developer proposal used `<button>` as the outer element. This is **invalid HTML** because `AgentCard` contains 6+ nested `<button>` elements (terminal, restart, resume, interrupt, terminate, kill confirm). The HTML spec explicitly forbids interactive content inside `<button>`. Browser behavior for nested buttons is undefined and inconsistent.

**Use `<div role="button">` instead**:

```tsx
<div
  role="button"
  tabIndex={0}
  aria-pressed={isSelected}
  aria-label={`${agent.role.name} agent, status: ${agent.status}`}
  className={`rounded-lg border p-3 cursor-pointer transition-colors
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
    focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
    isSelected
      ? 'border-accent bg-accent/5'
      : 'border-th-border bg-surface-raised hover:border-th-border-hover'
  }`}
  onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedAgent(isSelected ? null : agent.id);
    }
  }}
>
  {/* Card display content */}
  <div
    role="toolbar"
    aria-label="Agent actions"
    onClick={e => e.stopPropagation()}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
  >
    <button aria-label={`Open terminal for ${agent.role.name}`}>...</button>
    <button aria-label={`Restart ${agent.role.name}`}>...</button>
    {/* ... other action buttons ... */}
  </div>
</div>
```

**Key design decisions**:

1. **`<div role="button">` over `<button>`** — avoids invalid nested interactive content. `role="button"` requires manual `onKeyDown` for Enter/Space, but this is a 4-line addition.
2. **`aria-label` excludes the truncated agent ID** — `agent.id.slice(0,8)` is meaningless to screen reader users (critical review feedback). The label conveys role name and status.
3. **`role="toolbar"` wrapper** for action buttons — groups them semantically and allows `stopPropagation` at the group level. **Important**: the toolbar also needs `onKeyDown` with `stopPropagation` for Enter/Space — otherwise pressing Enter on an inner button bubbles up and toggles card selection (code reviewer catch).
4. **`aria-label` on every action button** — icon-only buttons must have text labels for screen readers.
5. **Status dot gets `aria-hidden="true"`** — decorative, since status is already in the card's `aria-label`.

### Success Criteria

- [ ] `AgentCard` renders with `role="button"` and `tabIndex={0}`
- [ ] Keyboard test: Tab to card → Enter toggles selection → `aria-pressed` updates
- [ ] Keyboard test: Space bar also toggles selection
- [ ] Screen reader text includes agent role name and status (no truncated UUID)
- [ ] Inner button clicks do NOT trigger card selection
- [ ] Visible focus ring appears on keyboard focus (not on mouse click)
- [ ] No `<div onClick>` with `cursor-pointer` and no `role` remains in `AgentCard.tsx`
- [ ] Same pattern applied to `DataBrowser.tsx:205` and `OverviewPage.legacy.tsx:267`

### Testing Strategy

Create `AgentDashboard/__tests__/AgentCard.test.tsx` with:
1. Renders with `role="button"` and `tabIndex={0}`
2. `aria-pressed` reflects selection state
3. `aria-label` includes role name and status, no truncated IDs
4. Enter key toggles selection
5. Space key toggles selection
6. Inner action button clicks do not bubble to card selection
7. Focus ring class is present (`focus-visible:ring-2`)
8. Status dot has `aria-hidden="true"`

### Migration Path

1. **Refactor `AgentCard.tsx`** — `<div>` → `<div role="button">`, add ARIA + keyboard + focus styles
2. **Wrap action buttons** in `<div role="toolbar">` with collective `stopPropagation`
3. **Add `aria-label`** to all icon-only action buttons
4. **Write tests** per the strategy above
5. **Apply same pattern** to `DataBrowser.tsx:205` and `OverviewPage.legacy.tsx:267`

### Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Existing e2e tests depend on `div` selector for AgentCard | Low | Update to `getByRole('button')` — more robust |
| `stopPropagation` on toolbar group misses edge cases | Low | Keep individual `stopPropagation` as fallback on critical actions |
| `onKeyDown` handler not called if inner element captures key | Low | Only Enter/Space on the card itself; inner buttons handle their own keys natively |

---

## Follow-Up: LeadDashboard Decomposition

This is documented as a **P1 follow-up** — not part of the initial 3 improvements, but the next priority.

### Problem

`LeadDashboard.tsx` is **2,513 lines** with ~30 `useState` calls, 18 `useCallback` calls, and critically **zero `useMemo` calls** (code reviewer finding — this is a bigger performance issue than the useState count, because every state change re-renders the entire component tree including all children).

### Recommended Decomposition Order

Per code reviewer analysis, extract in order of independence:

1. **Project creation form** (lines ~57-68, 742-786) — 8 useState + startLead callback → `useProjectCreation()` hook + `ProjectCreationForm` component
2. **Sidebar resize logic** (lines ~72-76, 605-686) — 4 useState + 3 useCallback + mouse handlers → `useSidebarResize()` hook
3. **Tab management** (lines ~77-101, 688-730) — 4 useState + 4 useCallback + drag handlers → `useProjectTabs()` hook + `TabBar` component

### Target

- No component file exceeds 300 lines
- No component has more than 5 `useState` calls
- Key computed values use `useMemo` to prevent unnecessary re-renders

### Architectural Note: `leadStore` Scaling Risk

The critical reviewer flagged that `leadStore` (290 lines, 13 state fields, 20 actions per project) uses O(n) object spread patterns per message append. With built-in limits (50 tool calls, 100 activity events, 200 comms, 500 group messages), this is acceptable today. But the `appendText` function (lines ~180-194) does string operations on potentially large message content every WebSocket frame — this should use a ref or buffer pattern as message volume grows.

### Architectural Note: `useWebSocket.getState()` Pattern

`useWebSocket.ts` uses `useAppStore.getState()` at 28+ call sites to mutate stores outside React's render cycle. This is an **intentional architectural choice**: WebSocket messages arrive asynchronously and must update state without waiting for React renders. This is correct for Zustand and should be documented in an `ARCHITECTURE.md` note to prevent future developers from either cargo-culting it inappropriately or "fixing" it and breaking real-time updates.

---

## Summary

| # | Improvement | Order | Effort | Key Risk | Critical Review Fix |
|---|-------------|:-----:|--------|----------|-------------------|
| 0 | Quick wins (Toast a11y, formatTokens, dead ws prop) | **Immediate** | Trivial | None | All 3 reviewers flagged independently |
| 1 | API/WS prop drilling extraction | First | Low-Medium | Unstable ref without `useMemo` | ✅ `useMemo` + no module-level flag. 7/8 `ws` props are phantom (just delete) |
| 2 | Shared `<Modal>` component | Second | Medium | Stale focus trap on dynamic content | ✅ Re-query on each Tab + ref-counted scroll lock |
| 3 | Keyboard-accessible `AgentCard` | Third | Low | Invalid nested `<button>` HTML | ✅ `<div role="button">` + `role="toolbar"` wrapper |
| — | LeadDashboard decomposition | Follow-up | High | Scope creep | Documented as next priority |
