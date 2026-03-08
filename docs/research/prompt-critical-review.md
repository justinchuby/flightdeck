# Critical Review: dagTaskId Prompt Guidance in RoleRegistry.ts

> **Reviewer**: Architect agent 5699527d
> **Scope**: `git diff HEAD~1 -- packages/server/src/agents/RoleRegistry.ts`
> **Focus**: Completeness, edge cases, unintended behavior, guidance strength

---

## Overall Assessment: **Good direction, incomplete coverage**

The changes correctly identify the core problem (fuzzy matching is unreliable) and prescribe the right solution (use explicit dagTaskId). However, the guidance has structural weaknesses that will limit its effectiveness.

---

## Issue 1: CRITICAL — Guidance only targets the Lead, ignores the child agent's COMPLETE_TASK

**The biggest gap in this change.**

The prompt adds dagTaskId guidance for CREATE_AGENT and DELEGATE (lead-side commands), but says nothing about what happens on the **child agent side**. Look at lines 614-617 (child agent prompt):

```
When you finish a task that's tracked in the DAG, signal completion:
⟦⟦ COMPLETE_TASK {"summary": "what you accomplished"} ⟧⟧
⟦⟦ COMPLETE_TASK {"taskId": "task-id", "summary": "what you accomplished"} ⟧⟧
This notifies the lead and updates the DAG automatically. If your task has a DAG ID, it's used automatically; otherwise specify "taskId".
```

This is fine when `child.dagTaskId` was set (i.e., the lead used dagTaskId in CREATE_AGENT). But when the lead **doesn't** use dagTaskId, the fuzzy match may fail, `child.dagTaskId` is never set, and the child agent's COMPLETE_TASK without an explicit taskId **falls through to message-only notification** — the DAG never gets updated.

**The child agent has no idea this happened.** There's no guidance telling child agents: "If you see `[DAG Task: xxx]` in your task header, use that as your taskId in COMPLETE_TASK."

**Recommendation**: The child agent prompt (lines 614-617) should explicitly say:
- "Your task header shows `[DAG Task: xxx]` — this is your dagTaskId, used automatically for COMPLETE_TASK"
- "If you don't see a DAG task header but know the taskId, specify it explicitly"

This closes the loop: lead uses dagTaskId → child inherits it → completion is reliable.

---

## Issue 2: HIGH — Three repetitions of the same guidance dilute the signal

The same "use dagTaskId" message appears in **three places** with slight variations:

1. **Line 414-416** (under CREATE_AGENT examples): "ALWAYS include `dagTaskId`..."
2. **Line 420-421** (under DELEGATE examples): "Include `dagTaskId` when delegating... same rationale as above"
3. **Lines 510-515** (under AUTO-DAG section): "IMPORTANT — Always use `dagTaskId`..."

LLMs process long system prompts with diminishing attention. Repeating the same guidance 3 times with slight wording variations doesn't make it 3x more likely to be followed — it makes the prompt noisier and the signal weaker.

**Recommendation**: Consolidate to TWO locations:
1. **Brief inline hint** with each command example (one line, not a paragraph)
2. **One authoritative section** with the full rationale (the AUTO-DAG section at line 510)

Remove the paragraph at lines 414-416 and the sentence at line 421. Replace with minimal hints:
```
⟦⟦ CREATE_AGENT {"role": "developer", "task": "Extract RoPEConfig", "dagTaskId": "rope-config"} ⟧⟧  ← always include dagTaskId
```

This is how effective prompt engineering works — show the pattern inline, explain once.

---

## Issue 3: HIGH — "Always prefer creating a dagTaskId" (line 414 area) is misleading

Previous reviewers flagged line 416 says "ALWAYS include dagTaskId to explicitly bind" — but the word "creating" was mentioned in earlier review. Looking at the current text:

> "When a DAG task already exists (from DECLARE_TASKS or ADD_TASK), ALWAYS include `dagTaskId`"

This is better than "always prefer creating" but still has a gap: **What if the lead is doing ad-hoc delegation without DECLARE_TASKS?** The guidance says "When a DAG task already exists" — but what about the common case where leads skip DECLARE_TASKS entirely and just use CREATE_AGENT with tasks?

In that case, dagTaskId doesn't exist yet. The auto-DAG system creates it. This is fine! But the guidance could confuse leads into thinking they MUST use DECLARE_TASKS first to get a dagTaskId, when the auto-creation path is also a supported workflow.

**Recommendation**: Add a clarifying sentence:
> "If you haven't used DECLARE_TASKS, the system auto-creates DAG tasks from delegations. But once a DAG exists with named tasks, always reference them by dagTaskId."

---

## Issue 4: MEDIUM — Missing guidance for the "dagTaskId not found" case

When the lead provides a dagTaskId that doesn't match any task (typo, wrong ID, task already completed), the system returns a warning:
```
⚠️ DAG task "xxx" not found or not ready. Check TASK_STATUS.
```

But the prompt gives no guidance on what the lead should do when this happens. The agent created successfully, the task was delegated, but it's not tracked in the DAG. Should the lead:
- Re-check TASK_STATUS and correct the ID?
- Use ADD_TASK to create the missing task retroactively?
- Ignore it?

**Recommendation**: Add a brief recovery instruction:
> "If you see '⚠️ DAG task not found', run TASK_STATUS to verify the task ID. Common causes: typo in dagTaskId, task already completed, or task not yet declared."

---

## Issue 5: MEDIUM — No guidance on dagTaskId for ADD_TASK → DELEGATE pattern

Line 567 already says "use ADD_TASK before DELEGATE" for emergent work. But it doesn't say to use the taskId from ADD_TASK as dagTaskId in the subsequent DELEGATE. This is the most natural place to reinforce the pattern:

```
Pattern: ADD_TASK → DELEGATE with dagTaskId
Example: ADD_TASK {"taskId": "fix-auth-bug", ...} → DELEGATE {"task": "Fix auth", "dagTaskId": "fix-auth-bug"}
```

---

## Issue 6: LOW — COMPLETE_TASK guidance for lead is inconsistent

Line 487 shows:
```
⟦⟦ COMPLETE_TASK {"taskId": "task-id"} ⟧⟧ — mark a task as done
```

But line 568 says:
```
When an agent reports task completion, your FIRST action MUST be to update the DAG (COMPLETE_TASK or SKIP_TASK)
```

These work together, but the lead guidance never shows dagTaskId in COMPLETE_TASK examples. When the lead manually marks a task done, they need the taskId from the DAG. This is obvious but would benefit from consistency with the new dagTaskId emphasis.

---

## Will This Guidance Actually Change Behavior?

**Partially.** The guidance is structurally sound and correctly explains the problem. However:

**What works:**
- Clear examples with realistic task IDs (`"rope-config"`, `"dead-fields"`) that match DECLARE_TASKS examples
- The "rule of thumb" at line 515 is direct and actionable
- The warning about fuzzy matching being "unreliable" is appropriately scary

**What won't work well:**
- Three repetitions create prompt fatigue
- No positive reinforcement — the system already sends `💡 Tip: Add dagTaskId` when it's missing, but the prompt doesn't tell the lead to **watch for and act on** these tips
- The guidance lives in the middle of a very long prompt (~200 lines of commands). LLMs lose attention in the middle of long prompts — consider moving the most critical guidance closer to the top or bottom

**Strongest behavioral lever not used:**
The system already logs warnings when dagTaskId is missing (line 495 in AgentLifecycle.ts). The most effective behavioral change would be to **make the warning louder** in the ACK back to the lead. Currently it says:
```
💡 Tip: Add dagTaskId to CREATE_AGENT for reliable DAG tracking.
```
Consider upgrading this to:
```
⚠️ dagTaskId missing — task was fuzzy-matched to "xxx". This can silently break. Next time: dagTaskId: "xxx"
```

Prompt wording changes have diminishing returns. System-level feedback is more reliable.

---

## Security / Correctness Concerns

**None identified.** The examples use safe, realistic values. The dagTaskId field is already properly validated in the handler (non-existent IDs produce a warning, not a crash). No injection vectors.

---

## Summary of Recommendations

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | CRITICAL | Child agent prompt ignores dagTaskId lifecycle | Add `[DAG Task: xxx]` awareness to child COMPLETE_TASK guidance |
| 2 | HIGH | Triple repetition dilutes signal | Consolidate to inline hint + one authoritative section |
| 3 | HIGH | Guidance unclear for ad-hoc delegation (no DECLARE_TASKS) | Add clarifying sentence about auto-creation path |
| 4 | MEDIUM | No recovery guidance for "dagTaskId not found" | Add brief troubleshooting instruction |
| 5 | MEDIUM | ADD_TASK → DELEGATE pattern missing dagTaskId link | Add explicit pattern example at line 567 |
| 6 | LOW | COMPLETE_TASK examples don't show dagTaskId | Add consistency |

**Bottom line**: The change is directionally correct but focuses only on one side of the interaction (lead's CREATE/DELEGATE). The biggest miss is the **child agent's COMPLETE_TASK** path, which is where DAG updates actually break in practice. Fix that, consolidate the repetition, and this becomes solid guidance.
