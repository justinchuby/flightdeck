# Timeline Accessibility

Keyboard navigation, screen reader support, and reduced motion behavior for the Timeline UI.

## Keyboard Navigation

The timeline container uses `role="application"` with full keyboard support. Click the timeline area to focus it, then use these shortcuts:

### Navigation

| Key | Action |
|-----|--------|
| `←` | Pan timeline left (earlier in time) |
| `→` | Pan timeline right (later in time) |
| `↑` | Move focus to the previous agent lane |
| `↓` | Move focus to the next agent lane |
| `Tab` | Move focus to the next agent lane |
| `Shift+Tab` | Move focus to the previous agent lane |

### Zoom

| Key | Action |
|-----|--------|
| `+` or `=` | Zoom in (with Ctrl/Cmd) |
| `-` | Zoom out (with Ctrl/Cmd) |
| `Ctrl/Cmd + Scroll` | Zoom at cursor position |
| `Home` | Fit entire timeline to view |
| `End` | Jump to last 20% of timeline (most recent activity) |

### Lane Interaction

| Key | Action |
|-----|--------|
| `Enter` or `Space` | Expand/collapse focused agent lane |
| `Escape` | Clear lane focus / close overlay |
| `f` | Focus the filter bar (dispatches `timeline:focus-filter` event) |
| `?` | Toggle keyboard shortcut help overlay |

> [!TIP]
> Expanded lanes show additional detail: agent creation time, end time (or "active"), and a taller lane (160px vs 56px) that makes status segments and lock indicators easier to see.

## ARIA Structure

The current ARIA implementation:

```
div[role="application"][aria-label="Timeline navigation: use arrow keys..."]
├── div (zoom controls)
│   ├── button[aria-label="Disable/Enable live mode"]
│   ├── button[aria-label="Zoom in"]
│   ├── button[aria-label="Zoom out"]
│   └── button[aria-label="Fit timeline to view"]
├── BrushTimeSelector (minimap)
├── Agent labels
│   └── div[role="button"][aria-expanded][aria-label="<role> agent <shortId>..."]
└── svg[role="img"][aria-label="Team collaboration timeline..."]
    └── g[role="row"][aria-label="<role> agent <shortId> timeline"]
```

### Agent Labels

Each agent label is an interactive element:
- `role="button"` — clickable to expand/collapse
- `aria-expanded="true/false"` — reflects expand state
- `aria-label` — includes role, short ID, and expand/collapse instruction

### Timeline SVG

The main SVG area uses:
- `role="img"` on the SVG container
- `role="row"` with `aria-label` on each agent lane group

### StatusBar

The StatusBar uses:
- `role="status"` with `aria-live="polite"` and `aria-atomic="true"` — announces full status on every change
- Error count button: `aria-live="assertive"` with descriptive label ("N errors. Click to view.")
- Connection indicator: `aria-live="polite"` (or `"assertive"` when offline) with `aria-label`
- Health indicator: `aria-label="Crew health: Healthy/Attention needed/Errors detected"`
- Narrative sentence: visible text on medium+ screens provides natural-language summary

### AccessibilityAnnouncer (v1)

The `AccessibilityAnnouncer` component renders two invisible ARIA live regions:
- **Polite** (`aria-live="polite"`, `role="log"`) — new events, status updates (throttled)
- **Assertive** (`aria-live="assertive"`, `role="alert"`) — errors, connection changes (immediate)

Place at the top of the Timeline component tree with announcements from `useAccessibilityAnnouncements()`.

### v1 Additions

These accessibility features are implemented or in progress for v1:

| Feature | ARIA Pattern | Description |
|---------|-------------|-------------|
| StatusBar | `role="status"`, `aria-live="polite"` | Screen readers announce status count changes |
| Error count link | Clickable button with `aria-live="assertive"` | Keyboard-accessible error count that scrolls to errors |
| ErrorBanner | `role="alert"`, `aria-live="assertive"` | Expandable error list with click-to-scroll |
| Empty state | `role="status"`, `aria-label` | Screen readers read the welcome message |
| AccessibilityAnnouncer | Dual live regions (polite + assertive) | Centralized screen reader announcements |
| `role="feed"` | Stream View semantics | Feed-based navigation for timeline events |
| `role="grid"` | Lanes View semantics | Grid navigation for parallel agent lanes |

### v2 Roadmap

Future accessibility improvements:
- Screen reader linearization of parallel swim lanes
- AI Narrative view with semantic heading structure

## Reduced Motion

The timeline respects `prefers-reduced-motion`:

- **Live mode pulse dot** — Uses `motion-reduce:animate-none` (Tailwind). The green pulse dot becomes a static indicator when reduced motion is preferred.
- **Loading spinner** — The `animate-spin` on the refresh icon stops with reduced motion.

> [!NOTE]
> Zoom and pan transitions are instantaneous (no CSS transitions on the SVG), so they already work well with reduced motion preferences.

## Color and Contrast

### Agent Status Colors

Status colors use a fill + border pattern where the filled rectangle has 30% opacity and the border provides the primary visual signal. This ensures readability on dark backgrounds.

### Role Colors

Role identity is conveyed through a 3px left border stripe on agent labels — **never as background color**. This maintains text readability while providing a scannable visual signal.

### Non-Color Indicators

Status is not communicated by color alone:

| Status | Color Signal | Non-Color Signal |
|--------|-------------|-----------------|
| Idle | Gray | Diagonal hatch pattern |
| Running | Green | Solid fill (vs hatch for idle) |
| Failed | Red | Different from all other fills + task label |
| Live mode | Green dot | Pulse animation (static dot when off) |

### Communication Link Styles

Links use distinct line patterns beyond color:

| Type | Color | Line Pattern |
|------|-------|-------------|
| Delegation | Blue | Solid line |
| Message | Purple | Dashed line |
| Group Message | Gold | Dotted line |
| Broadcast | Pink | Dotted line, thinner |

## Testing

### Manual Testing Checklist

- [ ] Navigate all zoom controls with keyboard only (no mouse)
- [ ] Expand and collapse agent lanes using Enter/Space
- [ ] Pan timeline with arrow keys
- [ ] Verify focused lane has visible ring indicator (`ring-1 ring-blue-500`)
- [ ] Verify all toolbar buttons have `aria-label`
- [ ] Verify agent labels announce role, ID, and expand state
- [ ] Test with `prefers-reduced-motion: reduce` — pulse dot should be static
- [ ] Verify at 200% browser zoom — layout should not break

### Running Tests

Timeline tests must be run from the `packages/web/` directory (not the repo root) to get the jsdom environment:

```bash
cd packages/web
npx vitest run src/components/Timeline/__tests__/Timeline.e2e.test.tsx
```

The test suite (~770 lines) covers keyboard navigation, data pipeline, segment rendering, tooltips, communication links, and edge cases.
