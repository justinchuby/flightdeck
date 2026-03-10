---
name: trust-dial-oversight-integration
description: How the Trust Dial 3-level oversight system works and how to integrate new features with it. Use when building features that should behave differently based on the user's oversight level.
---

# Trust Dial / Oversight Level Integration

The Trust Dial is Flightdeck's 3-level oversight system that controls how much information and how many notifications the user sees. Any new feature that surfaces information to the user should respect the Trust Dial setting.

## The Three Levels

| Level | Name | Behavior | Target User |
|-------|------|----------|-------------|
| 1 | **Detailed** | All notifications, expanded cards, heads-up at 1 exception | Hands-on managers who want to see everything |
| 2 | **Standard** | Exceptions only, balanced density, alerts at 2+ exceptions | Default. Balanced awareness without noise |
| 3 | **Minimal** | Action-required only, compact cards, failures only | Autonomous mode. Trust the agents, intervene only on failure |

## How It Works

### Storage

The oversight level is stored in Settings (persisted to the database) with per-project overrides:

```typescript
// Global setting
const oversightLevel = settings.oversightLevel; // 'detailed' | 'standard' | 'minimal'

// Per-project override (optional)
const projectLevel = project.oversightLevel ?? settings.oversightLevel;
```

### Gating Notifications

Toast notifications are filtered by the Trust Dial level:

```typescript
function shouldShowToast(event: AgentEvent, level: OversightLevel): boolean {
  switch (level) {
    case 'detailed':
      return true; // Show everything
    case 'standard':
      return event.severity === 'warning' || event.severity === 'error';
    case 'minimal':
      return event.severity === 'error' && event.requiresAction;
  }
}
```

### AttentionBar Escalation

The AttentionBar adjusts its escalation thresholds based on the Trust Dial:

| Condition | Detailed | Standard | Minimal |
|-----------|----------|----------|---------|
| Yellow threshold | 1 exception | 2 exceptions | N/A (no yellow) |
| Red threshold | 3 exceptions | 5 exceptions | Any failure |
| Show info items | ✅ Yes | ❌ No | ❌ No |

### UI Density

Components adjust their visual density:

```typescript
// Card rendering based on oversight level
function AgentCard({ agent, oversightLevel }) {
  if (oversightLevel === 'minimal') {
    return <CompactCard agent={agent} />; // One-line summary
  }
  if (oversightLevel === 'detailed') {
    return <ExpandedCard agent={agent} />; // Full details, all metrics
  }
  return <StandardCard agent={agent} />; // Balanced view
}
```

## Integrating a New Feature with the Trust Dial

When building a feature that shows information to the user:

1. **Read the oversight level** from the settings store (or accept it as a prop)
2. **Define 3 behaviors** — one for each level. Ask: "What does a Minimal user need to see? What does a Detailed user want?"
3. **Default to Standard** — if the level is unknown, use Standard behavior
4. **Document the 3 behaviors** — in the component's JSDoc or a comment block

### Checklist for New Features

- [ ] Feature respects the Trust Dial setting
- [ ] Minimal level only shows action-required items
- [ ] Detailed level shows all available information
- [ ] Standard level is a sensible middle ground
- [ ] Per-project overrides are supported (if relevant)
- [ ] Tests cover all 3 levels

## Anti-patterns

- **Ignoring the Trust Dial** — New notification or display features MUST check the oversight level
- **Only supporting 2 levels** — All 3 levels must have defined behavior, even if 2 are similar
- **Hardcoding thresholds** — Use the Trust Dial constants, not magic numbers
- **Per-project override without fallback** — Always fall back to the global setting if no project override exists
