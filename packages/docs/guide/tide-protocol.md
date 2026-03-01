# TIDE Protocol — Trust-Informed Dynamic Escalation

> An adaptive coordination protocol for multi-agent systems that dynamically adjusts coordination intensity based on real-time signals — per-task, not global.

## Abstract

Multi-agent systems face a fundamental tension: too little coordination leads to conflicts, wasted work, and silent divergence; too much coordination throttles throughput and negates the benefits of parallelism. TIDE resolves this by treating coordination as a **variable**, not a constant. Inspired by TCP congestion control, TIDE defines five coordination states and transitions between them based on observable signals — file conflicts, test failures, agent idle time, and task novelty. Each task independently tracks its own coordination phase, so two agents on independent features stay relaxed while two others hitting conflicts get tighter oversight. The result: coordination overhead stays below 15% of total agent effort while maintaining safety guarantees.

---

## Table of Contents

- [Abstract](#abstract)
- [1. Overview](#1-overview)
- [2. The Five States](#2-the-five-states)
  - [2.1 Slow Start](#21-slow-start)
  - [2.2 Congestion Avoidance](#22-congestion-avoidance)
  - [2.3 Fast Retransmit](#23-fast-retransmit)
  - [2.4 Fast Recovery](#24-fast-recovery)
  - [2.5 Audit](#25-audit)
- [3. Key Properties](#3-key-properties)
  - [3.5 Convention Investment](#35-convention-investment)
  - [3.6 Boundary Minimization](#36-boundary-minimization)
- [4. Detection Signals](#4-detection-signals)
- [5. Phase Transition Rules](#5-phase-transition-rules)
- [6. Integration with Trust Tiers](#6-integration-with-trust-tiers)
- [7. Integration with 5-Layer Communication Stack](#7-integration-with-5-layer-communication-stack)
- [8. North Star Metric](#8-north-star-metric)
- [9. UX Representation](#9-ux-representation)
- [10. Tidal Metaphor Extensions](#10-tidal-metaphor-extensions)
- [11. Biological Validation](#11-biological-validation)
- [12. Implementation Notes](#12-implementation-notes)
  - [12.5 Audit Implementation](#125-audit-implementation)
- [13. Future Work](#13-future-work)
- [Appendix A: State Transition Diagram](#appendix-a-state-transition-diagram)
- [Appendix B: Glossary](#appendix-b-glossary)

---

## 1. Overview

TIDE is an adaptive coordination protocol for multi-agent development crews. It draws directly from TCP congestion control: start cautious, ramp up autonomy as things go well, pull back hard at the first sign of trouble, then recover smoothly without resetting to zero.

**Core insight:** Coordination intensity should be a function of real-time conditions, not a fixed policy. A new agent on an unfamiliar codebase needs hand-holding. The same agent, three tasks later on familiar code, should be left alone. And if two agents collide on a merge conflict, *only those two* need tighter coordination — everyone else keeps working.

**What TIDE is NOT:**
- Not a global mode switch (it's per-task)
- Not a trust score (it works alongside trust tiers, not replacing them)
- Not a replacement for file locking or other concrete coordination mechanisms (it's the policy layer that decides *how much* coordination to apply)

---

## 2. The Five States

Each task tracked by the system is in exactly one of these five states at any time. Different tasks can be in different states simultaneously.

### 2.1 Slow Start

**When:** New or unfamiliar task. Agent hasn't worked on this area before, or the task has high novelty.

**Coordination behavior:**
- Lead assigns explicit, scoped tasks
- Agents confirm understanding before acting
- Frequent check-ins (agents report progress proactively)
- Establish task-area conventions: naming patterns, file structure, shared vocabulary. This is the infrastructure investment that makes Congestion Avoidance possible. Conventions set during Slow Start pay compound returns.
- High overhead, but safe for unknown territory

**Communication pattern:** Push-based. Lead drives.

**Analogy:** TCP slow start — begin with a small congestion window and grow it as ACKs come in.

### 2.2 Congestion Avoidance

**When:** Steady state. Agent is productive on a familiar task with no recent conflicts.

**Coordination behavior:**
- Agents work independently using conventions and shared workspace
- Lead monitors but doesn't micromanage
- Communication shifts from push (lead-driven) to pull (agent-initiated when needed)
- Lowest overhead — this is where the system should spend most of its time

**Communication pattern:** Pull-based. Agents reach out when they need something.

**Analogy:** TCP congestion avoidance — the window grows linearly, probing for capacity without being reckless.

### 2.3 Fast Retransmit

**When:** Collision or failure detected — merge conflict, test failure, agent blocked, or dependency deadlock.

**Coordination behavior:**
- Tighten coordination for **affected agents only** (not global)
- Lead re-engages with explicit task assignment
- Affected agents pause independent work and coordinate directly
- Quick diagnosis: what happened, who's affected, what's the fix?

**Communication pattern:** Push-based for affected agents. Others unaffected.

**Analogy:** TCP fast retransmit — upon detecting packet loss (3 duplicate ACKs), retransmit immediately without waiting for a full timeout.

### 2.4 Fast Recovery

**When:** After a conflict from Fast Retransmit has been resolved.

**Coordination behavior:**
- Resume **moderate** coordination — not a full reset to Slow Start
- Lead stays engaged briefly but begins loosening oversight
- Agents gradually return to independent work
- The key property: **damping**. Don't overreact to a resolved problem.

**Communication pattern:** Transitioning from push back to pull.

**Analogy:** TCP fast recovery — halve the congestion window instead of resetting to 1. The connection was working; one lost packet doesn't erase that history.

### 2.5 Audit

**When:** Periodically during prolonged Congestion Avoidance, or when a configurable time threshold passes without any state changes.

**Coordination behavior:**
- Lightweight, asynchronous coherence check
- Agents diff their assumptions against the shared workspace
- Catches **silent divergence** — contradictory work that hasn't triggered any conflict signals
- No change to coordination intensity unless issues are found

**Communication pattern:** Layer 3 (Signals) — minimal overhead.

**Analogy:** Regulatory T-cells patrolling healthy tissue for autoimmune activity. Everything looks fine, but it's worth checking.

---

## 3. Key Properties

### 3.1 Per-Task Scoping

TIDE phases are tracked **per-task**, not globally. Two agents on independent features stay in Congestion Avoidance while two others hitting conflicts escalate to Fast Retransmit. This prevents a single collision from throttling the entire crew.

### 3.2 Damping

Fast Recovery ≠ Slow Start. After resolving a conflict, the system resumes at moderate coordination rather than resetting to full hand-holding. This reflects the reality that one conflict doesn't erase an agent's track record.

### 3.3 Hysteresis (Asymmetric Thresholds)

The bar to escalate is **lower** than the bar to de-escalate:

| Direction | Threshold | Rationale |
|-----------|-----------|-----------|
| Escalate | 2 conflicts in 5 minutes | Quick to tighten — catch problems early |
| De-escalate | 5 clean cycles | Slow to relax — prove stability before loosening |

This asymmetry is intentional. **False positives** (over-coordinating) are annoying but recoverable. **False negatives** (under-coordinating during real problems) are dangerous and invisible until they become catastrophic.

### 3.4 Piggyback Signaling

Control signals are embedded in work artifacts rather than sent as separate messages. Agents writing to the shared workspace *is* the status signal. File locks acquired, commits made, tests run — these are both productive work and coordination signals. Zero extra reporting overhead.

### 3.5 Convention Investment

Slow Start isn't just about safety — it's where **conventions are established**. Naming patterns, file structure, API contracts, shared vocabulary — these are the infrastructure that makes Congestion Avoidance possible.

The cost of convention-setting is front-loaded in Slow Start, but returns compound across the entire task lifecycle:

| Phase | Convention Cost | Convention Return |
|-------|----------------|-------------------|
| Slow Start | High (establishing) | Low (not yet leveraged) |
| Congestion Avoidance | Zero (already established) | High (agents coordinate implicitly) |
| Fast Recovery | Low (reinforcing) | High (faster return to steady state) |

Conventions also compound **across sessions** — when captured as skill files (`.github/skills/`), conventions established in one session become free infrastructure for future sessions. This makes Slow Start progressively shorter for recurring task patterns.

### 3.6 Boundary Minimization

The highest-leverage COR optimization is eliminating coordination events entirely by **minimizing task boundaries**.

**Principle:** Prefer end-to-end task assignment (one agent owns an entire feature) over assembly-line decomposition (multiple agents each owning a slice).

**Why it matters:**
- Every task boundary is a potential Fast Retransmit trigger
- Fewer boundaries = fewer conflicts = more time in Congestion Avoidance = lower COR
- Context switching between agents is expensive — shared context must be explicitly communicated

**Automatic detection:** When the system detects high context overlap (>80% shared files between two tasks), it should suggest combining those tasks under a single agent. This is a structural optimization that prevents coordination problems rather than managing them.

**Tradeoff:** Boundary minimization reduces parallelism. A single agent owning a large feature is slower than two agents working in parallel — but only if those two agents don't collide. When collision probability is high, the serial approach is faster because it avoids the coordination tax entirely.

---

## 4. Detection Signals

These observable signals trigger state transitions:

| Signal | High Value Means | Transition Direction |
|--------|-----------------|---------------------|
| File conflict rate | Multiple agents hitting the same files | → Escalate |
| Test failure frequency | Increasing failure rate | → Escalate |
| Agent idle time | Unexpected inactivity (may be blocked) | → Investigate |
| Task dependency density | High coupling between tasks | → More coordination |
| Task novelty | Unfamiliar patterns or new codebase areas | → Active orchestration |

Signals are weighted and combined. A single marginal signal may not trigger a transition, but multiple converging signals will (see [Tidal Metaphor: Spring Tide](#10-tidal-metaphor-extensions)).

---

## 5. Phase Transition Rules

### 5.1 Transition Map

```
                    ┌─────────────────────────────────┐
                    │                                   │
                    ▼                                   │
              ┌──────────┐    success    ┌────────────────────┐
  start ────▶ │Slow Start│ ──────────▶  │Congestion Avoidance│◀──┐
              └──────────┘               └────────────────────┘   │
                    │                        │        │           │
                    │ conflict                │conflict│ periodic  │
                    ▼                        ▼        ▼           │
              ┌────────────────┐       ┌──────────┐  ┌─────┐     │
              │Fast Retransmit │◀──────│Fast Retr. │  │Audit│     │
              └────────────────┘       └──────────┘  └─────┘     │
                    │                                   │         │
                    │ resolved                          │ clean   │
                    ▼                                   │         │
              ┌─────────────┐                           │         │
              │Fast Recovery │──────── stable ──────────┼─────────┘
              └─────────────┘                           │
                                                issues found → Fast Retransmit
```

### 5.2 Escalation Bias

The system is biased toward escalation:
- **Escalate threshold:** Low (2 conflicts in 5 minutes)
- **De-escalate threshold:** High (5 clean cycles without incidents)
- **Reason:** Under-coordination failures are silent and compound. Over-coordination is visible and self-correcting (people notice and relax).

### 5.3 Simultaneous Phases

The system can be in different phases for different tasks at the same time. Task A might be in Congestion Avoidance while Task B is in Fast Retransmit. Each task's phase is independent.

### 5.4 Audit Triggers

Audit runs:
- Periodically during prolonged Congestion Avoidance (configurable interval)
- When a configurable time threshold passes without any state changes
- Manually, if the lead requests a coherence check

---

## 6. Integration with Trust Tiers

TIDE's current phase influences which [trust tier](./coordination.md) applies to agents:

| TIDE Phase | Default Trust Tier | Behavior |
|------------|-------------------|----------|
| Slow Start | Tier 3 — Propose-and-Wait | New agents must propose changes and wait for approval |
| Congestion Avoidance | Tier 1 — Auto-Match | Proven agents on familiar tasks act autonomously |
| Fast Retransmit | Current tier + 1 level | Escalate the current trust tier by one level |
| Fast Recovery | Gradually restore previous tier | Smooth return, not instant |
| Audit | No change | Results may trigger tier adjustments if issues found |

**Key interaction:** Trust tiers are about *agent capability*. TIDE phases are about *task conditions*. A highly trusted agent (Tier 1) working on a task in Fast Retransmit still gets tighter coordination — not because the agent is untrusted, but because the task conditions demand it.

---

## 7. Integration with 5-Layer Communication Stack

Each TIDE phase maps to preferred layers of the [communication stack](./agent-communication.md):

| TIDE Phase | Primary Layers | Communication Style |
|------------|---------------|-------------------|
| Slow Start | Layers 4–5 (Messages + Escalation) | Explicit, synchronous, lead-driven |
| Congestion Avoidance | Layers 1–2 (Conventions + Workspace) | Implicit, asynchronous, convention-driven |
| Fast Retransmit | Layers 3–4 (Signals + Messages) | Targeted, direct, problem-focused |
| Fast Recovery | Layers 3–4 → 1–2 (transitioning) | Gradually shifting from explicit to implicit |
| Audit | Layer 3 (Signals) | Lightweight coherence checks |

**Layer-shifting strategy:** Optimize not by making expensive layers (messages, escalation) faster, but by pushing coordination *down* the stack into cheaper layers (conventions, workspace). TIDE's steady state (Congestion Avoidance) relies almost entirely on Layers 1–2, which have near-zero marginal cost.

---

## 8. North Star Metric

### COR — Coordination Overhead Ratio

**Target: COR < 15%**

Agents should spend **85%+ of their effort on productive work**, not on coordination.

```
COR = (time spent on coordination) / (total agent time) × 100
```

**What counts as coordination:**
- Waiting for approvals or confirmations
- Reading status updates from other agents
- Resolving merge conflicts
- Participating in check-ins or audits
- Re-doing work due to collisions

**What counts as productive work:**
- Writing code, tests, documentation
- Reviewing code (substantive review, not coordination)
- Investigating bugs
- Making architectural decisions

**Optimization strategy:** Don't make coordination faster — make it *unnecessary*. Push coordination down to cheaper layers (conventions and workspace artifacts) so that explicit coordination events become rare. A well-tuned TIDE system spends most of its time in Congestion Avoidance, where coordination is essentially free (it's embedded in the work itself via piggyback signaling).

---

## 9. UX Representation

### 9.1 Coordination Gauge

A four-color indicator showing the current phase per task:

| Color | State | Label |
|-------|-------|-------|
| 🟢 Green | Congestion Avoidance | Cruising |
| 🟡 Yellow | Fast Recovery / Slow Start | Tightening |
| 🔴 Red | Fast Retransmit | Close Coordination |
| 🔵 Blue | Audit | Auditing |

### 9.2 Trend Sparkline

A 30-minute sparkline showing the phase history. **The trend is as important as the current state.** A task that's been green for an hour and just turned yellow is less concerning than one that's been oscillating between green and red.

### 9.3 Per-Task Phase Indicators

Small icons on agent cards showing the current phase of their active task:

| Icon | Meaning |
|------|---------|
| ⏱️ Clock | Slow Start (cautious, timed check-ins) |
| 🚀 Rocket | Congestion Avoidance (full speed) |
| ⚡ Lightning | Fast Retransmit (problem detected) |
| 🔄 Cycle | Fast Recovery (returning to normal) |

### 9.4 Phase History Timeline

In the task detail view, show the phase history as a color-banded timeline. Each band represents a period in a specific phase. This makes patterns visible: a task that keeps bouncing between states may need structural intervention (e.g., better file boundaries).

### 9.5 Audit Pulse

The Audit state should be **subtle** — a brief blue pulse that says "checked, all clear." Audit is routine and healthy. It should not demand attention. A clean audit is good news; only a *failed* audit should escalate to a visible alert.

---

## 10. Tidal Metaphor Extensions

The TIDE name invites natural metaphor extensions for discussing system behavior:

| Tidal Phenomenon | TIDE Analog | Meaning |
|-----------------|-------------|---------|
| **Spring tide** (moon + sun aligned) | Multiple escalation signals converging | Maximum coordination intensity — several independent signals all pointing to trouble |
| **Neap tide** (moon + sun opposing) | Mixed signals | Moderate response — some signals say escalate, others say things are fine |
| **Slack tide** (pause at high/low) | Hysteresis damping period | The pause before transitioning states — stability check before committing to a change |
| **Tidal bore** (rare extreme event) | Catastrophic failure | Beyond normal parameters — system-wide cascade failure requiring emergency coordination |

These metaphors are useful for team communication. "We're seeing a spring tide on the auth module" immediately conveys that multiple signals are converging on a problem.

---

## 11. Biological Validation

TIDE's design patterns are independently validated by biological coordination systems:

**Engineering validation:**

| Validation Source | TIDE Parallel | What It Validates |
|-------------------|--------------|-------------------|
| **TCP congestion control** | Overall state model | Adaptive throughput management with fast escalation and smooth recovery |

**Biological validation:**

| Validation Source | TIDE Parallel | What It Validates |
|-------------------|--------------|-------------------|
| **Ant colony stigmergy** | Congestion Avoidance | Indirect coordination through shared environment (conventions + workspace artifacts) |
| **Immune system T-cell maturation** | Trust tier integration | Progressive trust: prove capability → prove safety → deploy → earn expanded autonomy |
| **Regulatory T-cells** | Audit state | Constant patrol for autoimmune/divergence even in healthy tissue — catches silent problems |
| **Neural lateral inhibition** | File locking | One agent claims work, others inhibited from the same area — prevents duplicate effort |
| **Embryonic morphogenesis** | Dissolving hierarchy | Early centralized gradients (lead-driven) dissolve as local signaling (conventions) takes over |

These aren't just analogies — they're evidence that the patterns TIDE uses are evolutionarily stable strategies for coordinating independent agents under uncertainty.

---

## 12. Implementation Notes

### 12.1 State Storage

Each task's TIDE phase should be stored alongside the task in the DAG:

```typescript
interface TideState {
  phase: 'slow-start' | 'congestion-avoidance' | 'fast-retransmit' | 'fast-recovery' | 'audit';
  enteredAt: string;        // ISO 8601 timestamp
  conflictCount: number;    // rolling window (last 5 minutes)
  cleanCycleCount: number;  // consecutive cycles without incidents
  lastAuditAt: string;      // when Audit last ran
}
```

### 12.2 Signal Collection

Detection signals should be collected from existing infrastructure:
- **File conflict rate:** From `FileLockRegistry` — denied lock attempts
- **Test failure frequency:** From `EventPipeline` — test run results
- **Agent idle time:** From `AlertEngine` — `stuck_agent` alerts
- **Task dependency density:** From task DAG — edge count per node
- **Task novelty:** From `ActivityLedger` — has this agent worked on similar files/tasks before?

### 12.3 Transition Logic

```
on signal_received(task, signal):
  state = get_tide_state(task)
  
  if signal.severity >= ESCALATE_THRESHOLD:
    if state.phase in ['congestion-avoidance', 'fast-recovery']:
      transition(task, 'fast-retransmit')
    elif state.phase == 'slow-start':
      # already in tight coordination, log the signal
      state.conflictCount++

  if signal.type == 'conflict_resolved':
    if state.phase == 'fast-retransmit':
      transition(task, 'fast-recovery')

  if signal.type == 'clean_cycle':
    state.cleanCycleCount++
    if state.cleanCycleCount >= DE_ESCALATE_THRESHOLD:
      if state.phase == 'slow-start':
        transition(task, 'congestion-avoidance')
      elif state.phase == 'fast-recovery':
        transition(task, 'congestion-avoidance')

  if should_audit(task, state):
    transition(task, 'audit')
```

### 12.4 Configuration

All thresholds should be configurable:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `escalateConflictCount` | 2 | Conflicts in window to trigger escalation |
| `escalateWindowSeconds` | 300 | Rolling window for conflict counting (5 min) |
| `deEscalateCleanCycles` | 5 | Clean cycles required before de-escalating |
| `auditIntervalSeconds` | 1800 | Time between periodic audits (30 min) |
| `auditStaleThresholdSeconds` | 3600 | Max time without state changes before forcing audit (1 hr) |
| `corTargetPercent` | 15 | Target COR — alert if exceeded |
| `boundaryOverlapThreshold` | 0.8 | File overlap ratio to suggest task merging |
| `auditCostBudgetPercent` | 2 | Max % of agent time audits may consume |

### 12.5 Audit Implementation

The Audit state requires a concrete detection mechanism for silent divergence. This section specifies what an audit actually *does*.

**Inputs:**
- Files modified by each agent since the last audit
- Task goals and acceptance criteria for each active task
- Shared conventions (naming patterns, API contracts, architectural decisions)

**Process:** Lightweight semantic comparison at diff-level granularity (not full code review):
1. Collect file diffs per agent since last audit
2. Cross-reference: are any agents modifying files in overlapping areas?
3. Compare assumptions: do agents' changes assume compatible contracts?
4. Check convention adherence: do modifications follow established patterns?

**Outputs:**
- `clean` — no issues found. Return to Congestion Avoidance. Brief blue pulse in UX.
- `coherence-warning` — specific divergence description with affected agents and files. Triggers transition to Fast Retransmit for affected tasks only.

**Example divergence scenarios:**
- Agent A implements JWT-based auth while Agent B's API assumes session cookies
- Agent A renames a shared interface that Agent B is actively consuming
- Agent A introduces a new error handling pattern that contradicts the convention Agent B is following

**Cost budget:** Audits must consume **< 2% of total agent time** to stay within the COR < 15% target. This constrains the audit to diff-level checks, not deep code review. If an audit consistently exceeds its cost budget, increase the audit interval rather than making audits more thorough.

---

## 13. Future Work

### 13.1 Machine Learning for Signal Weighting

Currently, all detection signals are weighted equally (or manually tuned). A future enhancement could learn optimal signal weights from historical data — which combinations of signals actually predicted problems vs. false alarms.

### 13.2 Agent-Specific Phase Profiles

Some agents may need different escalation/de-escalation thresholds based on their track record. A new agent might need 10 clean cycles to de-escalate, while a proven agent needs only 3. This could be learned from the trust tier history.

### 13.3 Cross-Task Phase Correlation

Currently, phases are independent per task. But if three tasks on the same module all escalate within minutes, that's a signal about the module, not just the tasks. Future work could detect cross-task patterns and apply module-level coordination policies.

### 13.4 Predictive Escalation

Instead of reacting to conflicts, predict them. If two agents are both reading files in the same directory and one acquires a lock, the system could proactively warn the other agent before a conflict occurs.

### 13.5 COR Measurement Instrumentation

Build concrete measurement infrastructure for the COR metric. This requires classifying agent time into coordination vs. productive work — potentially using LLM-based classification of agent actions.

### 13.6 Tidal Bore Protocol

Define a formal emergency protocol for catastrophic failures (tidal bore events) that exceed TIDE's normal operating parameters — e.g., CI/CD pipeline failure affecting all agents, or a critical dependency breaking.

---

## Appendix A: State Transition Diagram

```
                         ┌──────────────────────────────────────────┐
                         │          TIDE State Machine              │
                         │          (per-task instance)             │
                         └──────────────────────────────────────────┘

     ┌─────────────┐                              ┌─────────────────────┐
     │             │    5 clean cycles             │                     │
     │  SLOW START │ ──────────────────────────▶   │ CONGESTION AVOIDANCE│
     │             │                               │                     │
     └──────┬──────┘                               └──┬──────────┬──────┘
            │                                          │          │
            │ conflict                       conflict  │          │ periodic /
            │ detected                       detected  │          │ stale timer
            │                                          │          │
            ▼                                          ▼          ▼
     ┌──────────────────┐                         ┌─────────┐
     │                  │◀────────────────────────│  AUDIT  │
     │ FAST RETRANSMIT  │   issues found          └────┬────┘
     │                  │                               │
     └────────┬─────────┘                               │ clean
              │                                         │
              │ resolved                                │
              ▼                                         │
     ┌──────────────┐       5 clean cycles              │
     │              │ ─────────────────────────▶ Congestion Avoidance
     │FAST RECOVERY │                                   │
     └──────┬───────┘                                   │
            │                              audit clean ─┘
            │ conflict detected        (returns to Congestion Avoidance)
            ▼
     Fast Retransmit (re-enter)
```

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **COR** | Coordination Overhead Ratio — percentage of agent time spent on coordination vs. productive work |
| **Clean cycle** | A work cycle (configurable duration) completed without conflicts, test failures, or other escalation signals |
| **Congestion window** | Borrowed from TCP — conceptually, how much independent work an agent is allowed before checking in |
| **Damping** | The property that recovery doesn't overshoot — Fast Recovery resumes at moderate coordination, not Slow Start |
| **Hysteresis** | Asymmetric thresholds for state transitions — easy to escalate, slow to de-escalate |
| **Piggyback signaling** | Embedding coordination signals in work artifacts (file locks, commits, workspace writes) instead of sending separate status messages |
| **Spring tide** | Multiple escalation signals converging simultaneously — maximum coordination response |
| **Stigmergy** | Indirect coordination through modifications to a shared environment (the shared workspace) |
| **TIDE phase** | One of the five states: Slow Start, Congestion Avoidance, Fast Retransmit, Fast Recovery, Audit |
| **Tidal bore** | Catastrophic failure exceeding normal TIDE operating parameters |
| **Boundary minimization** | Strategy of assigning end-to-end features to single agents to reduce coordination boundaries |
| **Convention investment** | Front-loaded cost of establishing conventions during Slow Start, with compound returns in later phases |

---

*This document is part of the AI Crew architecture documentation. For related protocols, see [Agent Coordination](./coordination.md) and [Agent Communication](./agent-communication.md).*
