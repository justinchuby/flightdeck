# Budget Threshold / BudgetEnforcer — Archived Design

> **Status:** Removed in cleanup/budget-threshold branch.
> **Reason:** No reliable way to estimate costs currently. Token-to-cost mapping
> is provider-specific and inaccurate; the estimation subsystem was already
> removed in #191. Without reliable cost data, budget enforcement produces
> misleading warnings.

## What It Did

The `BudgetEnforcer` class provided 3-tier budget enforcement based on
estimated session spend in USD:

| Threshold | Default | Behavior |
|-----------|---------|----------|
| **Warning** | 70% of limit | Emitted `budget:warning` event |
| **Critical (Alert)** | 90% of limit | Emitted `budget:alert` event |
| **Pause** | 100% of limit | Emitted `budget:pause` event, triggered `agentManager.pauseSystem()` |

Cost estimation used hardcoded per-token pricing:
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens

These rates were approximate and only valid for a subset of providers.

## Architecture

```
BudgetEnforcer
├── Config: loaded from DB settings (key: "budget_config" or "budget_config:{projectId}")
├── CostTracker dependency: aggregated agent token counts → estimated USD spend
├── EventEmitter: budget:warning, budget:alert, budget:pause
└── Integration points:
    ├── configSchema.ts: budgetThresholdsSchema (warning/critical/pause Zod validators)
    ├── config.ts routes: GET/POST /budget, POST /budget/check
    ├── PredictionService: BudgetSnapshot type, cost_overrun predictions
    ├── NotificationService: budget_warning, budget_exceeded alert types
    └── CrewFormatter: budget section in crew status display
```

## Files That Were Removed/Modified

### Deleted
- `packages/server/src/coordination/scheduling/BudgetEnforcer.ts` — 165 lines
- `packages/server/src/__tests__/BudgetEnforcer.test.ts` — 131 lines

### Modified
- `packages/server/src/config/configSchema.ts` — removed `budgetThresholdsSchema`, `budgetSchema`, and `budget` from top-level config
- `packages/server/src/routes/config.ts` — removed BudgetEnforcer import, instantiation, and `/budget` routes
- `packages/server/src/coordination/predictions/PredictionService.ts` — removed `BudgetSnapshot` interface, `budget` param from `generatePredictions()`, `predictCostOverrun()` method, `cost_overrun` prediction type
- `packages/server/src/coordination/alerts/NotificationService.ts` — removed `budget_warning` and `budget_exceeded` from `NotifiableEvent` type and default preferences
- `packages/server/src/coordination/agents/CrewFormatter.ts` — removed `budget` from format options and `buildBudgetSection()` helper
- `packages/server/src/coordination/scheduling/index.ts` — removed BudgetEnforcer re-export

## Config Schema (for reference)

```typescript
const budgetThresholdsSchema = z.object({
  warning: z.number().min(0).max(1).default(0.7),
  critical: z.number().min(0).max(1).default(0.9),
  pause: z.number().min(0).max(1).default(1.0),
});

const budgetSchema = z.object({
  limit: z.number().nullable().default(null),
  thresholds: budgetThresholdsSchema.optional(),
});
```

YAML config example:
```yaml
budget:
  limit: 50.00        # USD
  thresholds:
    warning: 0.7
    critical: 0.9
    pause: 1.0
```

## How to Revive

When reliable per-provider cost data is available (e.g., from ACP usage events
with cost fields, or a cost API):

1. **Re-create `BudgetEnforcer`** — copy from git history (`git show <sha>:packages/server/src/coordination/scheduling/BudgetEnforcer.ts`), but replace the hardcoded `INPUT_COST_PER_TOKEN` / `OUTPUT_COST_PER_TOKEN` with real per-provider rates from CostTracker.
2. **Re-add config schema** — add `budgetThresholdsSchema` and `budgetSchema` back to `configSchema.ts`, add `budget` to the top-level config object.
3. **Re-add routes** — restore `/budget` GET/POST routes in `config.ts`.
4. **Re-add PredictionService integration** — restore `BudgetSnapshot` interface and `predictCostOverrun()` method.
5. **Re-add NotificationService events** — add `budget_warning` and `budget_exceeded` back to `NotifiableEvent`.
6. **Re-add CrewFormatter budget section** — restore `buildBudgetSection()` and `budget` option.
7. **Run tests** — restore `BudgetEnforcer.test.ts` and update with real cost data patterns.

The key improvement needed: cost data should come from real provider-reported
usage, not token-count estimation with hardcoded rates.
