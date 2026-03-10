# Quick Design Spec: Catch-Up Mode + Trust Dial

> **Author:** Designer (@8baab941)
> **Status:** Build-ready — devs start immediately
> **ACs:** AC-12.26 (Catch-Up), AC-12.27 (Trust Dial)

---

## 1. Catch-Up Mode ("While you were away")

### Rendering: Slide-down banner, NOT modal

**Why not a modal?** Modals block interaction. The user returning after 15min wants to glance at what happened AND immediately act on pending decisions. A modal forces "read → dismiss → act." A banner lets them read and act simultaneously.

**Where:** Renders as a collapsible banner between AttentionBar and page content. Same insertion point as AttentionBar — uses the app shell slot. Appears on HomeDashboard and project Tasks pages.

### Component: `CatchUpBanner.tsx`

```
Location: packages/web/src/components/CatchUpBanner/CatchUpBanner.tsx
~150 LOC
```

**Props:**
```ts
interface CatchUpBannerProps {
  leadId: string;           // from current project/session context
  idleThresholdMs?: number; // default 5 * 60 * 1000 (5 min)
}
```

**Data source:** `GET /api/catchup/:leadId?since=<lastInteractionTime>`
- Backend already exists: `CatchUpService` in `packages/server/src/coordination/sessions/CatchUpSummary.ts`
- Route already exists: `packages/server/src/routes/summary.ts`

**Response shape (already defined):**
```ts
interface CatchUpSummary {
  since: string;
  generatedAt: string;
  tasksCompleted: number;
  tasksFailed: number;
  decisionsPending: number;
  decisionsResolved: number;
  commitsLanded: number;
  agentsSpawned: number;
  agentsStopped: number;
  errorsOccurred: number;
  keyEvents: KeyEvent[];
}
```

### Idle detection logic

```ts
// Track last interaction in localStorage
const LAST_INTERACTION_KEY = 'flightdeck-last-interaction';

// On any click/keypress/scroll, update timestamp (throttled to 60s)
// On component mount, check: (now - lastInteraction) > idleThreshold
// If idle: fetch catchup summary, show banner
// If not idle: don't render
```

### Visual layout

```
┌──────────────────────────────────────────────────────────┐
│ 📰 While you were away (42 min)                    [✕]  │
│                                                          │
│  ✅ 8 tasks completed  ❌ 1 failed  ❓ 2 decisions pending │
│  🔀 3 commits landed   🤖 2 agents spawned               │
│                                                          │
│  [Jump to decisions]  [View activity log]  [Dismiss]     │
└──────────────────────────────────────────────────────────┘
```

**Styling:**
- Background: `bg-blue-500/5 border border-blue-500/20` (informational, not alarming)
- If failures exist: `bg-red-500/5 border border-red-500/20` (attention needed)
- Height: auto, ~80-100px. Animates in with `slideDown 300ms ease-out`
- Dismiss: sets `lastInteraction` to now, banner slides up `200ms`

### Actions
- **"Jump to decisions"** → opens ApprovalQueue (`openApprovalQueue(true)`)
- **"View activity log"** → navigates to project activity/timeline (or scrolls to Activity section on Dashboard)
- **"Dismiss"** → hides banner, updates lastInteraction timestamp
- **"✕" button** → same as dismiss

### Key events (optional detail expansion)
- Below the summary line, show up to 3 key events from `keyEvents[]`
- Expandable: "Show N more events" toggles full list
- Each event: `[timestamp] [icon] summary` — one line

### Edge cases
- User returns after <5 min → no banner (not enough time for meaningful changes)
- No changes since last visit → no banner (nothing to report)
- Summary shows 0 across all fields → no banner
- Multiple projects → show aggregate summary on Home, project-specific on project pages

---

## 2. Trust Dial (Oversight Level Setting)

### Rendering: Settings panel section + quick-toggle in AttentionBar

**Two access points:**
1. **Settings → Preferences section**: Full 3-option radio group with descriptions
2. **AttentionBar quick toggle**: Small icon button that cycles levels (for fast switching)

### Component: `OversightLevel` section in SettingsPanel

```
Location: Add to packages/web/src/components/Settings/SettingsPanel.tsx
~60 LOC addition (new section)
```

### Storage: localStorage + optional per-project override

```ts
// settingsStore.ts addition
type OversightLevel = 'autonomous' | 'supervised' | 'manual';

interface SettingsState {
  // ... existing
  oversightLevel: OversightLevel;       // global default
  projectOverrides: Record<string, OversightLevel>; // per-project
  setOversightLevel: (level: OversightLevel) => void;
  setProjectOversight: (projectId: string, level: OversightLevel) => void;
}
```

### Three levels defined

| Level | Label | Card density | Notifications | Auto-approval |
|-------|-------|-------------|---------------|---------------|
| `autonomous` | Minimal | Title + priority only. No agent, no time-in-status. ~36px cards. | Failures only | All non-destructive actions auto-approved |
| `supervised` | Standard (default) | Title + role + agent + priority + time-in-status. ~80px cards. | Failures + decisions + stale | Permission requests shown |
| `manual` | Detailed | All metadata: files, deps, timestamps, assigned agent, full description. ~120px cards. | Everything | All actions require approval |

### Settings UI layout

```
┌─────────────────────────────────────────┐
│ ⚙️ Oversight Level                       │
│                                         │
│ How much control do you want over       │
│ agent behavior?                         │
│                                         │
│ ○ Minimal — Agents work autonomously.   │
│   You're notified only on failures.     │
│                                         │
│ ● Standard — Agents ask before critical │
│   actions. Balanced oversight.          │
│                                         │
│ ○ Detailed — Full visibility and        │
│   approval required for all actions.    │
└─────────────────────────────────────────┘
```

**Styling:** Same pattern as existing Settings sections (bg-surface-raised, border, rounded-lg, p-4). Radio group with labels and descriptions.

### How it affects KanbanBoard TaskCard

The `TaskCard` component reads oversight level and conditionally renders fields:

```ts
// In TaskCard.tsx (after decomposition)
const oversightLevel = useSettingsStore(s => s.oversightLevel);

// Autonomous: minimal card
// - Show: title, priority badge
// - Hide: role, agent, time-in-status, expand chevron

// Supervised (default): standard card
// - Show: everything currently shown
// - Hide: nothing (current behavior)

// Manual: detailed card
// - Show: everything + files list + deps + full description (always expanded)
// - Auto-expand all cards
```

### AttentionBar quick toggle

```
[AttentionBar content...] | 👁 Supervised ▾ |
```

- Small dropdown or cycle button at the RIGHT end of AttentionBar
- Click cycles: Minimal → Standard → Detailed → Minimal
- Shows current level as text label + icon
- Icon: 👁 (eye) with fill level indicating oversight (empty/half/full)
- ~30 LOC addition to AttentionBar

### Edge cases
- Default: `supervised` (standard) for new users
- Per-project override: project settings page shows same 3-option selector, defaults to "Use global setting"
- Changing level doesn't affect running agents immediately — it affects the UI rendering and future notification filtering
- Notification filtering is frontend-only for Phase 1 (backend notification throttling is Phase 2+)

---

## 3. Build order

1. **CatchUpBanner.tsx** (~150 LOC) — new component
   - Needs: localStorage idle tracking, fetch from existing `/api/catchup` endpoint
   - Mount in App.tsx between AttentionBar and main content (conditional)
   
2. **settingsStore.ts** (~20 LOC addition) — add oversightLevel state
   - Persisted to localStorage (already has persist middleware)

3. **SettingsPanel.tsx** (~60 LOC addition) — Oversight Level section
   - Radio group, standard Settings section styling

4. **TaskCard density modes** (~30 LOC change) — read oversightLevel, conditionally render
   - After KanbanBoard decomposition, this goes in TaskCard.tsx

5. **AttentionBar quick toggle** (~30 LOC addition) — cycle button at right end

**Total: ~290 LOC new code**

---

## 4. AC mapping

| AC | Feature | Covered by |
|----|---------|-----------|
| AC-12.26 | Catch-Up banner on return after ≥5min idle | CatchUpBanner.tsx + /api/catchup endpoint |
| AC-12.27 | 3-level oversight setting affecting card density | settingsStore + SettingsPanel + TaskCard |
