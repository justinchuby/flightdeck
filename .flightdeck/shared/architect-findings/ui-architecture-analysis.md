# Flightdeck UI Architecture Analysis

**Author**: Architect Agent (20818db3)  
**Date**: 2026-03-06  
**Scope**: `packages/web/` — the sole UI package in this monorepo  
**Reviewed by**: Code Reviewer (536bf3ea) — corrections incorporated

---

## Executive Summary

Flightdeck's UI is a React 19 SPA built with Vite, Zustand, Tailwind CSS, and React Router. The codebase has **181 non-test components** across **~50 feature directories** with only **3 shared components**. The architecture shows strong fundamentals (Zustand for state, code splitting, WebSocket real-time updates) but suffers from three systemic issues:

1. **Missing component abstraction layer** — Inline modal, button, and layout patterns are copy-pasted across 32 files
2. **Monolithic components + untyped prop drilling** — `LeadDashboard.tsx` is 2,513 lines with ~30 useState calls and zero useMemo; `api: any` is threaded through 12+ components
3. **Accessibility is ad-hoc** — Only 7 of 32 modals have `role="dialog"`, several escape-key handlers are dead code on unfocused divs, interactive `<div onClick>` elements lack keyboard support, no a11y testing infrastructure

---

## 1. Component Reusability

### 1.1 Current State: Shared Component Library

The shared library at `components/Shared/` contains only **3 components**:

| Component | File | Purpose |
|-----------|------|---------|
| `EmptyState` | `Shared/EmptyState.tsx` | Generic empty state with icon, title, CTA |
| `SkeletonCard` / `SkeletonList` | `Shared/SkeletonCard.tsx` | Loading skeleton |
| `ErrorPage` | `Shared/ErrorPage.tsx` | Full-page error display |

**Barrel export**: `Shared/index.ts` (line 1-3) exports all three.

### 1.2 Problem: Duplicated Patterns

#### A. `formatTokens()` duplicated 4 times

The same token formatting function is independently defined in:

- `components/LeadDashboard/TeamStatus.tsx` (line 6-9) — local function
- `components/LeadDashboard/AgentReportBlock.tsx` (line 4) — exported
- `components/TokenEconomics/TokenEconomics.tsx` (line 7) — local function
- `components/TokenEconomics/CostBreakdown.tsx` (line 7) — local function
- `components/Pulse/PulseStrip.tsx` (line 18) — variant named `formatTokensCompact`

**Impact**: Bug in formatting logic requires fixing 4-5 files. Should be a single utility in `utils/`.

#### B. `SkeletonCard` duplicated in two locations

- `components/Shared/SkeletonCard.tsx` — the "official" shared version with props
- `components/Skeleton.tsx` — a completely separate implementation at root level

Both are used in different parts of the app. The root-level `Skeleton.tsx` also exports `SkeletonRow` which doesn't exist in the shared version.

**Impact**: Inconsistent loading states across the app.

#### C. `EmptyState` — 2 separate implementations

- `components/Shared/EmptyState.tsx` — generic shared version with CTA support
- `components/Timeline/EmptyState.tsx` — Timeline-specific version that doesn't reuse the shared one

**Impact**: Drift between empty state patterns. The Timeline version could easily wrap the shared component.

#### D. Modal/Dialog pattern — no shared component, 25+ inline implementations

Every modal in the codebase manually constructs backdrop + overlay + content using inline Tailwind. Examples:

```
// SpawnDialog.tsx:30
<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">

// PermissionDialog.tsx:115
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">

// GroupChat.tsx:712
<div className="fixed inset-0 z-50 flex items-center justify-center" onClick={...}>

// SessionEndArchive.tsx:64
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>

// OnboardingWizard.tsx:106
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
```

**32 files** use `fixed inset-0 z-50` for modal overlays. Each re-implements:
- Backdrop opacity (varies: `/40`, `/50`, `/60`)
- Click-to-close behavior (inconsistent — some have it, some don't)
- Escape key handling (only ~5 implement it, and several are **dead code** — `onKeyDown` on a `<div>` that never receives focus won't fire. Only `SearchDialog` and `ApprovalSlideOver` correctly use `useEffect` on `document` for Escape.)
- Focus trapping (none implement it)
- `role="dialog"` (only 7 of 32)
- `aria-modal="true"` (only 4 instances: ApprovalSlideOver, CommandPalette, SpotlightTour, KeyboardShortcutHelp)

**Impact**: This is the single highest-value refactoring target. A `<Modal>` component would:
- Eliminate ~500 lines of duplicated code
- Fix accessibility for all modals at once
- Standardize behavior (escape, focus trap, backdrop click)

#### E. No shared Button component

Button styles are inline everywhere with significant variation:
- Primary: `bg-accent text-black rounded-lg` (ChatPanel:279)
- Destructive: `bg-red-600/20 text-red-400 border border-red-600/30` (PermissionDialog:182)
- Ghost: `text-th-text-muted hover:text-th-text` (multiple)
- Various padding, font sizes, border-radius values

**Impact**: Visual inconsistency, hard to maintain design system changes.

### 1.3 Component Composition Strategy

The codebase primarily uses **functional components with hooks** — no HOCs, render props, or compound components detected. This is clean and modern. Key patterns:

- **Custom hooks** for behavior: `useFileDrop`, `useAttachments`, `useCommandPalette`, `useAutoScroll` — well-structured
- **Barrel exports** via `index.ts` files in feature directories (Canvas, Timeline, etc.)
- **Lazy loading** for route-level components in `App.tsx` (lines 34-46) — good for bundle size
- **Co-located tests** in `__tests__` directories within feature folders

### 1.4 Monolithic Components

`LeadDashboard.tsx` is **2,513 lines** with:
- ~30 `useState` calls
- 18 `useCallback` calls
- **1 `useMemo` call** (critically low — with ~30 state variables and frequent WebSocket-driven re-renders, the lack of memoization likely causes significant unnecessary re-rendering of child components)

This single file handles project creation, chat rendering, sidebar management, tab configuration, agent selection, file dropping, token display, and more. It should be decomposed into ~8-10 focused components.

---

## 2. State Management Patterns

### 2.1 Current Architecture

**Store Library**: Zustand v5 (consistent across all stores)

| Store | File | Lines | Responsibility |
|-------|------|-------|---------------|
| `appStore` | `stores/appStore.ts` | 97 | Agents, roles, config, connection, approval queue |
| `leadStore` | `stores/leadStore.ts` | 290 | Per-project state: messages, decisions, progress, comms, groups, DAG |
| `settingsStore` | `stores/settingsStore.ts` | 85 | Theme, sound preferences |
| `groupStore` | `stores/groupStore.ts` | 115 | Chat groups, messages, reactions |
| `timelineStore` | `stores/timelineStore.ts` | 134 | Timeline filters, view state, cached data |
| `timerStore` | `stores/timerStore.ts` | 103 | Timer state, fire/cancel logic |
| `toastStore` | `components/Toast.tsx` | 27 | Toast notifications (co-located with component) |

**Strengths**:
- Consistent Zustand usage — no mixed paradigms
- Granular selectors (e.g., `useAppStore((s) => s.agents)`) to minimize re-renders
- `useShallow` used in LeadDashboard (line 3, 41) for multi-field selection
- Server state flows via WebSocket into Zustand stores — clean unidirectional flow

### 2.2 Problem: `api: any` Prop Drilling

The `useApi()` hook returns an untyped object, and the return value is passed down as `api: any` through the component tree:

```
App.tsx → LeadDashboard (api: any, ws: any)
       → AgentDashboard (api: any, ws: any)
       → OverviewPage (api: any, ws: any)
       → GroupChat (api: any, ws: any)
       → OrgChart (api: any, ws: any)
       → TaskQueuePanel (api: any)
       → SettingsPanel (api: any)
       → TimelinePage (api: any, ws: any)
```

**12+ components** receive `api: any` as a prop. The `ws` return value is also untyped.

Affected files:
- `AgentDashboard/AgentDashboard.tsx:17-18` — `api: any; ws: any`
- `AgentDashboard/AgentCard.tsx:11-12` — `api: any; ws: any`
- `AgentDashboard/SpawnDialog.tsx:6` — `api: any`
- `LeadDashboard/LeadDashboard.tsx:35-36` — `api: any; ws: any`
- `FleetOverview/FleetOverview.tsx:38-39` — `api: any; ws: any`
- `FleetOverview/AgentActivityTable.tsx:61-62` — `api: any; ws: any`
- `GroupChat/GroupChat.tsx:115` — `api: any; ws: any`
- `OrgChart/OrgChart.tsx:297-298` — `api: any; ws: any`
- `Settings/SettingsPanel.tsx:17` — `api: any`
- `TaskQueue/TaskQueuePanel.tsx:14` — `api: any`
- `Timeline/TimelinePage.tsx:19-20` — `api: any; ws: any`

**Impact**:
- Zero type safety on API calls throughout the app
- Refactoring the API surface requires grep-based changes
- Every route component has unnecessary props
- `AgentCard.tsx` receives `ws: any` but never references it — dead prop created by cargo-cult prop threading

**Fix**: Since `useApi()` already returns **stable callbacks** (all wrapped in `useCallback`), there's no need for a Context provider. Components should simply call `useApi()` directly or import `apiFetch` for one-off calls. The prop drilling is entirely unnecessary — removing it is a straightforward mechanical change.

### 2.3 Problem: `leadStore` is overloaded

`leadStore` manages 13 distinct pieces of state per project:
- messages, decisions, progress, progressSummary, progressHistory
- agentReports, toolCalls, activity, comms
- groups, groupMessages, dagStatus
- lastTextAt, pendingNewline

With 20 actions, the store interface is 94 lines. The `projects` map creates deeply nested updates:
```ts
// leadStore.ts:128-131
set((s) => {
  const proj = s.projects[leadId] || emptyProject();
  return { projects: { ...s.projects, [leadId]: { ...proj, decisions } } };
});
```

Every update creates a new top-level `projects` object, a new project entry, and copies all sibling project data. With 10+ projects each containing hundreds of messages, this becomes an O(n) operation per message append.

**Impact**: Performance degradation at scale; difficult to reason about state ownership.

### 2.4 Problem: No Server State Caching

There's no React Query, SWR, or similar library. All data fetching patterns are:
1. WebSocket pushes → Zustand store (real-time updates)
2. `fetch()` → manual state updates (initial loads in `App.tsx:146-194`)

Initial data loading in `App.tsx:146-194` uses raw `fetch()` with `.catch(() => {})` swallowing errors silently. There's no:
- Request deduplication
- Stale-while-revalidate
- Loading/error states for API calls
- Retry logic

### 2.5 Problem: Direct Store Access Outside React

`useWebSocket.ts` extensively calls `useAppStore.getState()` and `useGroupStore.getState()` outside React render cycle (lines 71, 88, 94, etc.). While Zustand supports this, it:
- Makes state mutations invisible to React's concurrent mode
- Bypasses React's scheduling
- Creates implicit coupling between the WebSocket handler and store internals

This is a pragmatic choice for the real-time use case, but should be documented as an architectural decision.

---

## 3. Accessibility (a11y)

### 3.1 What's Good

- **Skip link**: `App.tsx:198` — proper skip-to-content link with `sr-only` + `focus:not-sr-only`
- **Semantic nav**: `Sidebar.tsx:71` — uses `<nav>` element
- **Timeline a11y**: Dedicated `AccessibilityAnnouncer.tsx` with `aria-live` regions, `useAccessibilityAnnouncements` hook, and `timeline-a11y.css`
- **FilterTabs**: `FilterTabs.tsx:43-44` — proper `role="tablist"` + `role="tab"` + `aria-selected`
- **Shared components**: `EmptyState` uses `role="status"`, `SkeletonCard` uses `aria-busy="true"`
- **ErrorPage**: Uses `role="alert"` for error display
- **Tooltip**: Uses `role="tooltip"` and shows on focus (not just hover)
- **a11y test file**: `Timeline/__tests__/accessibility.test.tsx` exists with 24 `aria-` assertions

### 3.2 Critical Issues

#### A. Interactive `<div>` elements without keyboard support

**`AgentCard.tsx:35-42`** — The entire card is a clickable div:
```tsx
<div
  className={`... cursor-pointer ...`}
  onClick={() => setSelectedAgent(isSelected ? null : agent.id)}
>
```
No `tabIndex`, no `role="button"`, no `onKeyDown` handler. Keyboard users cannot navigate or activate agent cards.

**`DataBrowser.tsx:205`** — Expandable row:
```tsx
<div className="... cursor-pointer" onClick={() => toggleExpand(row.id)}>
```

**`OverviewPage.legacy.tsx:267`** — Clickable card:
```tsx
<div className="... cursor-pointer ..." onClick={onClick}>
```

**Impact**: Core navigation flow (selecting agents) is completely inaccessible to keyboard-only users and screen readers.

#### B. Modals missing dialog semantics

Of **32 modal overlays**, only **7 have `role="dialog"`** and only **4 have `aria-modal="true"`**:

| Component | `role="dialog"` | `aria-modal` | `aria-label` | Focus trap | Escape key |
|-----------|:-:|:-:|:-:|:-:|:-:|
| ApprovalSlideOver | ✅ | ✅ | ✅ | ❌ | ✅ (`useEffect`) |
| CommandPaletteV2 | ✅ | ✅ | ✅ | ❌ | ✅ |
| SpotlightTour | ✅ | ✅ | ✅ | ❌ | ❌ |
| KeyboardShortcutHelp | ✅ | ✅ | ✅ | ❌ | ❌ |
| CommandPalette | ✅ | ❌ | ❌ | ❌ | ✅ |
| PlaybookPublishDialog | ✅ | ❌ | ❌ | ❌ | ❌ |
| MobileCommandSheet | ✅ | ❌ | ❌ | ❌ | ❌ |
| **ShareLinkDialog** | ❌ | ❌ | ❌ | ❌ | ⚠️ dead (`onKeyDown` on unfocused div) |
| **PermissionDialog** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SpawnDialog** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SearchDialog** | ❌ | ❌ | ❌ | ❌ | ✅ (`useEffect`) |
| **SessionEndArchive** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **ConflictDetailPanel** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **GroupChat create** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **HighlightsReel** | ❌ | ❌ | ❌ | ❌ | ❌ |
| All LeadDashboard modals (4+) | ❌ | ❌ | ❌ | ❌ | ❌ |

**Zero modals implement focus trapping.** When a modal opens, Tab key can reach elements behind the modal overlay.

**Impact**: Screen reader users won't know a dialog opened. Focus can escape modals, creating confusing navigation.

#### C. Toast notifications lack live region

`Toast.tsx:47` — The toast container is just a positioned div:
```tsx
<div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
```
No `role="alert"`, `role="status"`, or `aria-live` attribute. Screen readers won't announce toast messages.

**Impact**: All toast notifications (agent spawned, errors, status changes) are invisible to screen reader users.

#### D. No automated a11y testing infrastructure

- No `jest-axe` or `@axe-core/react` in `package.json`
- No `eslint-plugin-jsx-a11y` configured
- Only 1 test file (`Timeline/__tests__/accessibility.test.tsx`) tests ARIA attributes
- 41 test files total, but accessibility is only tested in the Timeline feature

**Impact**: Accessibility regressions will go undetected.

#### E. `focus-visible` styling is extremely limited

Only **4 files** in the entire codebase use `focus-visible` styles:
- `Shared/EmptyState.tsx` (CTA button)
- `Shared/ErrorPage.tsx` (action buttons)
- `Timeline/TimelineContainer.tsx`
- `Timeline/__tests__/accessibility.test.tsx`

Most interactive elements (buttons in headers, sidebar items, card actions) show no visible focus indicator. This fails WCAG 2.1 SC 2.4.7 (Focus Visible).

#### F. Color-only status indicators

Agent status is conveyed solely through color:
- `AgentCard.tsx:207-209` — colored dot with no text label
- Connection status in `App.tsx:240-241` — colored dot (green/yellow/red)

While text labels exist nearby in some cases, the colored dots themselves are the primary visual indicator and have no `aria-label`.

---

## 4. Architecture Summary & Prioritized Recommendations

### Highest Impact Improvements (ordered by ROI)

| Priority | Issue | Impact | Effort |
|----------|-------|--------|--------|
| **P0** | Create shared `<Modal>` component | Fixes a11y for 32 modals, eliminates ~500 duplicated lines, fixes dead escape handlers | Medium |
| **P0** | Make `AgentCard` keyboard-accessible | Core navigation flow is broken for keyboard users | Low |
| **P1** | Remove `api`/`ws` prop drilling (direct `useApi()` calls) | Type safety + cleaner components + remove dead props like `ws` in AgentCard | Low-Medium |
| **P1** | Decompose `LeadDashboard.tsx` (2,513 lines) + add `useMemo` | Maintainability, testability, re-render performance | High |
| **P1** | Add `aria-live` to Toast container | Screen reader support for notifications | Low |
| **P2** | Extract `formatTokens` to shared utility | DRY, single source of truth | Low |
| **P2** | Consolidate `SkeletonCard` and `EmptyState` duplicates | Consistent loading/empty states | Low |
| **P2** | Add `eslint-plugin-jsx-a11y` | Catch a11y issues at dev time | Low |
| **P2** | Add `focus-visible` ring to all interactive elements | WCAG 2.4.7 compliance | Medium |
| **P3** | Split `leadStore` into domain-specific stores | Performance at scale, code clarity | Medium |
| **P3** | Add React Query for initial data fetching | Caching, dedup, error/loading states | Medium |
| **P3** | Create shared `<Button>` component | Design system consistency | Low |

---

## 5. File Reference Index

Key files for each concern:

**Stores**: `stores/appStore.ts`, `stores/leadStore.ts`, `stores/settingsStore.ts`, `stores/groupStore.ts`, `stores/timelineStore.ts`, `stores/timerStore.ts`

**Shared Components**: `components/Shared/EmptyState.tsx`, `components/Shared/SkeletonCard.tsx`, `components/Shared/ErrorPage.tsx`

**Duplicated Components**: `components/Skeleton.tsx` (dup of Shared), `components/Timeline/EmptyState.tsx` (dup of Shared)

**Prop Drilling Chain**: `App.tsx` → `LeadDashboard.tsx` → `AgentCard.tsx` → `SpawnDialog.tsx`

**a11y Best Practice (reference)**: `components/Timeline/AccessibilityAnnouncer.tsx`, `components/FilterTabs.tsx`, `components/ApprovalQueue/ApprovalSlideOver.tsx`

**a11y Gaps**: `components/AgentDashboard/AgentCard.tsx:35-42`, `components/PermissionDialog.tsx:115`, `components/Toast.tsx:47`, `components/AgentDashboard/SpawnDialog.tsx:30`

**Monolithic Files**: `components/LeadDashboard/LeadDashboard.tsx` (2,513 lines, 35 useState)
