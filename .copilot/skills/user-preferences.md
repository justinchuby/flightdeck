# User Preferences for Flightdeck

Documented preferences from user feedback. Follow these when building new features.

## Cost & Token Display

- **No monetary cost estimates** — show token counts only, never dollar amounts.
- Token counts should be labeled as estimates: `~` prefix, `(est.)` suffix.
- Budget: `null` or `0` means unlimited — don't show warnings for these values.

## Alerts & Notifications

- **No idle agent alerts** — the Lead assigns tasks, not the user. Idle agents are normal.
- **No context pressure alerts** — Copilot handles compaction automatically.
- **No predictions feature** — agent stall prediction, cost prediction, context prediction are all handled by the system. Don't surface them.

## Metrics & Analytics

- Remove metrics that don't account for task complexity:
  - No model effectiveness charts (can't fairly compare when tasks vary in size).
  - No role contribution charts (not a meaningful metric).
  - No session score stars (subjective, not useful).
- Session history table is useful — keep it, but without stars.

## Data & Historical Sessions

- **Historical data on ALL pages** — never show an empty state for existing projects. Every page must fall back to REST API data when live WebSocket data isn't available.
- Data retention/cleanup controls belong in Settings page.

## Navigation & UX

- **Everything that looks clickable must BE clickable** — no decorative buttons or fake links.
- **Unified project selection via tabs** across all pages — use `<ProjectTabs>`, not dropdowns.
- **Milestones = progress events only** — show task completions, progress reports, decisions, commits. Filter out agent spawn/termination/delegation noise.

## Timeline

- **Vertical scroll separate from horizontal** — mouse wheel scrolls vertically only. Shift+wheel or trackpad horizontal gesture for horizontal pan.
- **Default replay speed: 4×** (not 1×).
- Replay scrubber must always be visible (sticky bottom, not clipped by overflow).

## Chat & Communication

- **User messages highest priority** — always visible, never buried.
- Virtual scrolling for performance with large message histories.
- **Group chats persist per project** — don't lose them on session change.

## General Philosophy

- Prefer showing real data with estimation disclaimers over showing "not available".
- Curate what's shown — less noise is better than more data.
- Consistent UX patterns everywhere — if one page uses tabs, all pages use tabs.
