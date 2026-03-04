---
name: group-chat-adoption
description: How to get agents to use group chats for peer coordination in flightdeck-based crews. Covers hub-and-spoke anti-pattern, auto-grouping triggers, and file-lock-linked groups. Use when setting up multi-agent crews with 3+ agents or diagnosing why agents aren't collaborating directly.
---

# Group Chat Adoption Patterns

Extracted from a session where 0/6 agents used group chats despite 100+ cross-agent messages (retrospective #37).

## When This Doesn't Apply

- Sessions with 2 agents — use DIRECT_MESSAGE instead.
- Sessions where all agents work independently with no shared files or interfaces.
- Very short sessions (under 5 minutes) where setup overhead exceeds coordination benefit.

## The Core Problem: Hub-and-Spoke Kills Peer Coordination

When the lead routes all communication, agents never develop peer-to-peer habits. Group chats exist to enable peer coordination, but they don't emerge naturally when:
1. The lead relays all messages between agents.
2. Agents don't know what groups exist (discovery problem).
3. Creating a group requires manual effort with no obvious trigger (activation energy).

All 6 agents in the retrospective independently identified the same root causes.

## Pattern 1: Auto-Create Groups When 3+ Agents Share a Feature

**Rule:** When the lead delegates the same feature area to 3+ agents, automatically create a `{feature}-team` group.

"Same feature area" means: agents whose file locks overlap, agents working on the same GitHub issue or sub-issues, or agents whose task descriptions share the same component name.

**Example:** If agents are assigned to work on `TimelineContainer.tsx` fixes, authentication improvements, and API refactoring — and 3+ of them touch overlapping code — a group keeps them coordinated without the lead relaying every message.

**Why 3+:** Two agents can use DIRECT_MESSAGE. Three or more need a shared channel to avoid O(n²) pairwise messages.

## Pattern 2: Use QUERY_GROUPS Before Creating New Groups

Before creating a group, check what already exists:
```
QUERY_GROUPS
```
Auto-created groups (from delegations) may already cover your coordination need. Duplicate groups fragment conversation.

## Pattern 3: Groups Are Primarily for Peer Coordination

Groups are primarily for peer coordination, not routine status updates to the lead. Use AGENT_MESSAGE and COMPLETE_TASK for reporting to the lead.

**Good use cases for groups:**
- Multiple developers editing related files need to coordinate lock handoffs.
- Reviewers need to discuss a cross-cutting finding that affects multiple files.
- Developers implementing related features need to agree on a shared interface.
- Short status messages that help peers coordinate (e.g., "Done with my changes, lock is released") are appropriate in groups.

**Concrete missed opportunity from the retro:** 5 developers editing `TimelineContainer.tsx` in a serialized queue could have used a group to coordinate who goes next, share context about what they changed, and avoid redundant work.

## Pattern 4: New Group Members Need Context

When joining an existing group mid-session, new members receive recent message history automatically — but it may not cover the full conversation context.

**Guideline:** When adding someone to a group late, send a brief summary message to the group:
```
GROUP_MESSAGE: "Welcome @new-agent. Context: we're coordinating edits to 
CommandDispatcher.ts. Current status: Agent A finished handleDelegate(), 
Agent B is working on handleBroadcast(). You're next for handleCreateGroup()."
```

## Pattern 5: Leads Should Nudge Agents Toward Groups

Since agents default to messaging the lead, the lead needs to actively redirect:

**Instead of:**
> Agent A → Lead: "I need to coordinate with Agent B about the shared interface."
> Lead → Agent B: "Agent A wants to coordinate about the shared interface."

**Do:**
> Lead → Agent A: "Create a group with Agent B and discuss directly. Use CREATE_GROUP."

After 1-2 redirections, agents learn the pattern.

## Pattern 6: Role-Based Groups for Recurring Coordination

For roles that naturally coordinate (e.g., all code reviewers, all developers on the same package), create groups at session start — but only when you have high confidence the members will need to coordinate. For uncertain cases, wait until the first cross-agent coordination need arises.

```
CREATE_GROUP {"name": "reviewers", "members": ["reviewer-1-id", "reviewer-2-id"]}
CREATE_GROUP {"name": "server-devs", "members": ["dev-1-id", "dev-2-id", "dev-3-id"]}
```

Keep groups small (3-5 members). Larger groups tend to become noisy broadcast channels. If a group grows beyond 5, consider splitting by sub-task.

## Pattern 7: File-Lock-Linked Groups

When multiple agents need to edit the same file in sequence (a common bottleneck), create a group for them to coordinate lock handoffs.

**Example:** If Agents A, B, and C all need `CommandDispatcher.ts`, create a group:
```
CREATE_GROUP {"name": "commanddispatcher-editors", "members": ["agent-a", "agent-b", "agent-c"]}
```
Agents use the group to signal when they're done and release locks, so the next agent can start immediately instead of polling.

## Pattern 8: Group Lifecycle — Auto-Archive on Termination

Groups should be archived when all members have terminated. Stale groups clutter `QUERY_GROUPS` output and confuse agents who discover them later. If only some members terminate, the group remains active for the surviving members.

**Guideline:** Don't manually clean up groups during a session — let the system handle it. But if you notice stale groups from a previous phase, ignore them and create fresh ones rather than reviving old groups with new members.

## Checklist for Leads Setting Up a Multi-Agent Session

- [ ] Create role-based groups at session start when members will clearly need to coordinate.
- [ ] When delegating the same feature to 3+ agents, create a feature group.
- [ ] When relaying messages between agents, redirect them to message each other directly or use a group.
- [ ] When 3+ agents need the same file, create a file-lock coordination group.
- [ ] Include in agent prompts: "Use QUERY_GROUPS to find relevant groups before messaging the lead."
