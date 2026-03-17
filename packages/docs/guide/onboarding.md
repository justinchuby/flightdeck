# Smart Onboarding

Flightdeck's onboarding system has three layers designed to make new users productive in under 60 seconds while avoiding information overload.

![New Project Dialog](/images/00-new-project-dialog.png)

## QuickStart

On first launch, instead of showing an empty dashboard, Flightdeck presents a **guided project creation** screen. Users configure their goal and team:

- **Code Review** — spawn a reviewer for existing PRs
- **Feature Build** — full team (lead, developers, architect, reviewer)
- **Bug Fix** — focused team for debugging
- **Documentation** — writer + reviewer
- **Custom** — blank slate, configure your own team

Selecting a configuration immediately launches a session. The user goes from "first visit" to "watching agents work" in seconds.

> [!TIP]
> QuickStart only appears on first visit. Returning users see the normal dashboard. Clear localStorage to re-trigger it during development.

## SpotlightTour

After launching their first session, a 5-step overlay tour highlights real UI elements:

| Step | Element | What it teaches |
|------|---------|----------------|
| 1 | Pulse strip | "This bar shows crew health at a glance" |
| 2 | Agent list | "Your active agents appear here" |
| 3 | Approval queue | "Agents ask permission here" |
| 4 | Chat panel | "Message any agent directly" |
| 5 | ⌘K palette | "Press ⌘K to control everything" |

Each step:
- Dims everything except the target element
- Shows a tooltip with description and "Next" / "Skip" buttons
- Tracks completion progress (1/5, 2/5, etc.)

The tour uses `useSpotlight(selector)` to dynamically locate DOM elements.

## Progressive Route Disclosure

The sidebar starts minimal and grows as the user demonstrates mastery:

### Tier 1 — Beginner (default)
4 items: Overview, Agents, Chat, Settings

### Tier 2 — Explorer
+2 items: Timeline, Analytics  
*Unlocked after: first session completed or 3+ agent interactions*

### Tier 3 — Operator  
+2 items: Tasks, Mission Control  
*Unlocked after: completed a session or used batch approval*

### Tier 4 — Power User
+2 items: Roles, Analytics  
*Unlocked after: created a custom role or completed 3+ sessions*

> [!TIP]
> All routes are always accessible via ⌘K or direct URL — progressive disclosure only affects the sidebar. Power users are never locked out.

### Mastery Tracking

Progression is tracked via the Onboarding API:

```
GET /api/onboarding/status   → { tier: 2, progress: { ... } }
POST /api/onboarding/progress → update mastery events
```

## Contextual Coach

Six behavior-triggered tips appear as small toasts when specific conditions are met:

| Trigger | Tip |
|---------|-----|
| First approval | "You can approve multiple items at once with batch approval" |
| 5+ manual approvals | "Adjust your Oversight level in Settings to reduce interruptions" |
| First agent crash | "Recovery is automatic — check Settings to configure" |
| Budget > 50% | "Set budget alerts in Settings → Budget" |
| 3+ repeated commands | "Try Workflow Automation to handle this automatically" |
| First ⌘K use | "You can type natural language commands here too" |

Tips appear once per trigger and are tracked in localStorage. They use the shared toast notification system.
