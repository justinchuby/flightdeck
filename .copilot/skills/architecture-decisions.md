# Architecture Decisions & Patterns

> Captured from multi-phase development session (Phases 2–4).
> Use this as a reference when building new features or modifying existing ones.

---

## Feature Architecture

### Phase 2: Observability ("See Everything")

| Feature | Architecture | Key Files |
|---------|-------------|-----------|
| **Pulse Strip** | 44px persistent status bar with 6 segments. All data from appStore via existing WebSocket events — zero new API calls. Responsive breakpoints degrade from 6 segments to just decisions badge on mobile. | `PulseStrip.tsx` |
| **Token Pressure Gauge** | 20-point ring buffer in Agent.ts, 10s min sample interval, 10min max window. Simple slope calculation (not linear regression). Minimum 3 data points spanning ≥30s before showing predictions. Tiered thresholds: Pulse visual at 50/70/85%, AlertEngine actionable at 70/85/95%. | `Agent.ts` (tokenHistory, contextBurnRate, estimatedExhaustionMinutes) |
| **Batch Approval** | Allowlist-only auto-approve model. Server classifies decisions with `\b` word-boundary regex. Frontend uses server-provided `decision.category` — never reclassify client-side. TeachMe 3-step flow (suggest → preview → confirm). Timer pauses when queue is open via WebSocket signal. | `DecisionLog.ts`, `ApprovalSlideOver.tsx` |
| **Diff Preview** | Scoped to agent's locked files via `FileLockRegistry.getByAgent()`. 5s server-side cache TTL, 10s client polling. Abstracts isolation mechanism (works with shared directory now, worktrees later). | `DiffService.ts`, `routes/diff.ts` |
| **Focus Mode** | No separate route — `useFocusAgent()` hook + `?focus=agentId` query param. Existing pages filter in-place. Single aggregation endpoint `GET /api/agents/:id/focus` returns all data in one call. | `useFocusAgent.ts`, `routes/agents.ts` |
| **Session Replay** | On-demand query-per-table with timestamp filters + client-side LRU cache (50 states). NOT event sourcing. Each module has `getStateAt(timestamp)` method. Parallel queries assembled into WorldState. | `SessionReplay.ts`, `routes/replay.ts` |
| **Comm Flow Viz** | CommHeatmap (N×N grid) already existed. Enhanced with temporal flow data. Backend aggregates from ActivityLedger events. | `CommHeatmap.tsx`, `routes/comms.ts` |
| **Context Pressure** | Tiered alerts: warn 70%, alert 85%, critical 95%. `POST /api/agents/:id/compact` triggers context compaction. | `AlertEngine.ts` |
| **Budget Enforcement** | BudgetEnforcer monitors cost vs configurable limits. 70%/90%/100% threshold escalation. Auto-pause at 100% is idempotent and waits for in-flight commits before pausing. | `BudgetEnforcer.ts`, `routes/config.ts` |
| **Smart Sidebar** | Frontend-only. All data derives from appStore (agents[], pendingDecisions, alert count, DAG progress). No backend changes. | `Sidebar.tsx` |

### Phase 3: Intelligence ("Understand Everything")

| Feature | Architecture | Key Files |
|---------|-------------|-----------|
| **Playbooks** | Reusable crew configs (roles, models, task templates, settings). Stored in SQLite. | `routes/playbooks.ts` |
| **Catch-Up Summary** | "While you were away" banner. Reuses SessionReplay.getWorldStateAt() + getKeyframes(). Scoped per project. | `CatchUpBanner.tsx`, `routes/summary.ts` |
| **Intent Rules V2** | Extended with label, roles[], condition, priority, enabled, matchCount. Three actions: auto-approve / queue / alert. Trust presets (conservative/moderate/autonomous). Priority-ordered matching, first match wins. | `DecisionLog.ts` (IntentRule interface) |
| **Debate Visualization** | Heuristic detection from chat_group_messages using keyword signals (disagreement markers, @mentions, resolution markers). Minimum 3 messages with disagreement from ≥2 agents. Computed on-the-fly, 30s cache. | `DebateDetector.ts`, `routes/debates.ts` |
| **Canvas Lite** | Uses @xyflow/react (already in stack). Composes ALL existing store data — zero new backend APIs. Circular auto-layout with manual drag override. | `CanvasPage.tsx` |
| **Self-Healing Crews** | RecoveryService with crash detection, briefing generation, retry logic. Dedup guard (skip if active recovery exists for same agentId). Budget gate (fail recovery if budget exhausted). | `RecoveryService.ts` |
| **Cross-Session Analytics** | `/analytics` route with cost trends, model effectiveness, role contribution charts. All use @visx. Data from existing replay/events APIs. | `AnalyticsPage.tsx` |
| **Shareable Replays** | Share links with expiry + access control. Timeline annotations. Self-contained HTML export. | `SharedReplayViewer.tsx` |
| **Handoff Briefings** | Covers manual termination, model swaps, role changes, context compaction, session-end archival. Quality scoring (task coverage, message recency, file context, discoveries). | `HandoffBriefingViewer.tsx` |
| **Notifications** | Desktop (Web Notification API), Slack (webhooks), Email digest, Custom Webhooks (HMAC-signed). Event routing matrix: 9 event types × 4 channels. Quiet hours. | `NotificationManager.ts` |

### Phase 4: Platform ("Orchestration Disappears")

| Feature | Architecture | Key Files |
|---------|-------------|-----------|
| **Command Palette V2** | ⌘K as the brain of the product. Fuzzy search via Fuse.js (5KB) across all entities. AI suggestion engine (rule-based, no LLM). Preview panel. | `CommandPalette.tsx` |
| **NL Crew Control** | 30 commands in 4 categories (control, query, navigate, create). Pattern matching, no LLM. Lives inside ⌘K. Mandatory action preview for destructive commands. Undo stack with 5-min TTL. | `NLCommandParser.ts` |
| **Smart Onboarding** | 3 layers: QuickStart (playbook selection), SpotlightTour (6-step overlay), Progressive Route Disclosure (sidebar grows 4→11 items as mastery develops). | `OnboardingProvider.tsx` |
| **Predictive Intelligence** | 6 prediction types, only linear extrapolation (no ML). Confidence scoring based on data quality + variance. Accuracy tracking (correct/avoided/wrong/expired). | `PredictionService.ts` |
| **Workflow Automation** | "When X then Y" rule engine. 12 event triggers × 12 action types. Predictions feed workflow triggers. Suggestions appear after 3+ repeated manual actions. | `WorkflowEngine.ts` |
| **GitHub Integration** | PAT-based auth. Auto-generated PR descriptions (template-based). CI status polling every 30s. Draft PR default for safety. Graceful degradation when not connected. | `GitHubService.ts` |
| **Conflict Detection** | 4 levels: same directory, import overlap, lock contention, branch divergence. Scans every 15s. Auto-resolution gated by Trust Gradient (Autonomous level only). | `ConflictDetectionEngine.ts` |
| **Mobile PWA** | manifest.json + vite-plugin-pwa. Cache-first shell + network-first API. Swipe-to-approve cards. Bottom tab bar with safe-area padding. | `BottomTabBar.tsx` |
| **Custom Roles** | Visual role builder with emoji/color picker, model comparison, prompt templates, live preview, "Test Role" dry-run. | `RoleBuilder.tsx` |
| **Community Playbooks** | Browse/search/filter gallery. Publish with privacy guardrails (no system prompts/secrets). Fork & customize. Versioning with diff view. | `CommunityGallery.tsx` |

---

## Data Architecture

### Historical Data Pattern

When the app loads or reconnects, WebSocket state may be empty (agents have completed/terminated). Use REST API fallback:

```
WebSocket agents[] empty?
  → Fetch GET /api/replay/:leadId/keyframes
  → Derive agent roster from spawn/exit events
  → useHistoricalAgents hook provides this pattern
```

### Session Replay: Keyframe-Based State Reconstruction

- Each coordination module has `getStateAt(timestamp)` method
- Parallel queries: ActivityLedger + TaskDAG + DecisionLog + FileLockRegistry
- Agent roster reconstructed from `sub_agent_spawned` activity events
- **Must scope all queries by projectId** — multi-project sessions will mix data otherwise
- Client-side LRU cache (50 states) + server-side 5s TTL

### Activity Ledger as Event Source

- 19 action types tracked with timestamps
- All agent communications logged (message_sent, group_message, broadcast)
- Used for: timeline rendering, keyframe generation, debate detection, replay state reconstruction
- `getSince(timestamp)` should always have a LIMIT to avoid unbounded queries

### Agent Data NOT Persisted to DB

- Agent objects are in-memory only (AgentManager)
- Once an agent terminates, its runtime state is gone
- Historical agent info must be derived from ActivityLedger events (spawn, status_change, completion)
- This is by design — agents are ephemeral, events are permanent

---

## UI Architecture

### App-Level Overlays

All modals, slide-overs, and command palettes render at the App.tsx root level:
- Position `fixed`, `z-50`
- Never nest inside route components (breaks stacking context)
- Examples: ApprovalSlideOver, CommandPalette, RecoveryBriefingCard

### SharedProjectTabs

Unified project selection component used across all views. Ensures consistent project scoping per the "organize all content by project" principle. All feature views default to active project — no cross-project views unless showing actionable items (Pulse, Approval Badge).

### Chat Message Integrity: groupTimeline()

When rendering agent chat messages, use `groupTimeline()` to maintain message ordering and grouping. Prevents interleaving of concurrent agent outputs.

### Virtual Scrolling

Use virtual scrolling for large message lists (agent chat output, activity feeds). Agent conversations can reach thousands of messages in long sessions.

### Sticky Bottom Pattern

For always-visible controls that should stay anchored at the bottom of their container:
- ReplayScrubber: fixed at bottom of replay view
- Chat input: sticky at bottom of message panel
- Batch action bar: sticky at bottom of approval queue

### Shared Components

Import from `components/Shared/`:
- `EmptyState` — icon, title, optional action button
- `SkeletonCard` / `SkeletonList` — loading placeholders
- `ErrorPage` — error message with retry and go-home actions
- All use theme CSS vars (`bg-surface`, `text-th-text-alt`, `border-th-border`) + motion tokens

### Theme & Styling

- Use Tailwind theme tokens: `bg-surface`, `text-th-text-alt`, `border-th-border` (not raw colors)
- Motion system: 3 tiers (micro/standard/dramatic) via `motion.css` tokens
- Charts: use `chart-theme.css` for dark/light variants (not hardcoded hex)
- `apiFetch()` is the standalone auth-aware fetch wrapper; `useApi()` is the React hook version

### Real-Time Data Flow

All real-time data flows through: `useWebSocket.ts` → `appStore`/`leadStore` → components.
- Add new WS event handlers in the WebSocket hook, not in individual components
- Debounce at appStore level (1/s for status updates), not per-component

---

## Removed Features (and Why)

These features were built during rapid development but removed after real-world testing revealed they weren't useful:

| Feature | Why Removed |
|---------|-------------|
| **Predictions (agent stall/cost/context)** | Agents stalling, running out of context, and exceeding cost are handled automatically by the platform (auto-restart, context compaction, budget enforcement). Predicting these events adds noise without actionable value — the system already responds. |
| **Cost Estimates** | Different LLM models have different token costs that change over time. We can't reliably estimate costs without knowing the provider's current pricing. Showing inaccurate estimates is worse than showing nothing. |
| **Session Score Stars** | Scoring function was too simplistic — only used task count (10+ tasks = 4★, 2-9 = 3★, 0-1 = 2★). Ignored cost efficiency, completion rate, errors, token efficiency. A misleading quality signal. |
| **Model Effectiveness Charts** | Tasks vary enormously in size and complexity. Comparing model performance across different task types produces unfair and misleading comparisons. A code review task vs. a full feature implementation can't be meaningfully compared. |
| **Role Contribution Metrics** | "Contribution" by role isn't meaningful — an architect who writes zero code but makes one critical design decision may contribute more than a developer who writes 1000 lines. Counting tasks/tokens by role creates wrong incentives. |
| **Idle Agent Alerts** | The Project Lead agent assigns work to other agents. Users don't need to be alerted about idle agents — the lead handles delegation. Alerting the user about something they can't/shouldn't act on is noise. |
| **Context Pressure Alerts** | GitHub Copilot handles context compaction automatically. Alerting users about context pressure for something that's managed transparently adds anxiety without giving them useful actions. |

### Pattern: When to Remove a Feature

Remove a feature when:
1. The system already handles the problem automatically (predictions, context pressure)
2. The data is unreliable or misleading (cost estimates, model effectiveness)
3. The metric doesn't measure what users think it measures (session stars, role contribution)
4. The alert targets someone who can't act on it (idle agents — lead handles this, not user)
