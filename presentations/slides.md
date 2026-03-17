---
theme: default
title: "Flightdeck — Building a Multi-Agent AI Development System"
info: |
  How I built a system where AI agents coordinate, review, and ship code together — using Copilot.
  15-minute presentation for college students at Copilot Dev Days.
highlighter: shiki
drawings:
  persist: false
transition: slide-left
css: unocss
colorSchema: dark
layout: center
fonts:
  sans: Inter
  mono: Fira Code
---

<div class="text-center max-w-3xl mx-auto">

<div class="text-2xl text-gray-100 leading-relaxed font-light">

*"What if AIs could work together like a real engineering team?"*

</div>

<div class="text-sm text-gray-400 mt-8">Define goals. Collaborate. Run for hours. No interruptions.</div>

</div>

<!--
Let this question hang for 2-3 seconds. Everyone in the room using
Copilot CLI has felt this pain — you start a task, the context fills up,
you lose momentum, you have to re-explain everything. What if the AI
could just... keep going? With a team? That's what we built.

Time: ~0:30
-->


---

# The Problem → The Vision

<div class="grid grid-cols-2 gap-6 mt-6">
<div class="bg-gray-800 rounded-lg p-5 border border-red-500/30">

### Single AI Agent

<div class="space-y-2 text-sm mt-3">

- Context fills up on anything complex
- Sequential — one thing at a time
- No one checks its work
- **You** manage everything

</div>
</div>

<div class="bg-gray-800 rounded-lg p-5 border border-green-500/30">

### A Full Engineering Crew

<div class="space-y-2 text-sm mt-3">

- Parallel execution, shared context
- Architects, devs, reviewers, QA
- Peer review built in
- **Lead** orchestrates for you

</div>
</div>
</div>

<div class="text-center mt-8 text-gray-300 text-sm">

Spin up **13 specialized roles** in 30 seconds. Each with its own context, tools, and model.

</div>

<!--
Everyone knows the limits of single-agent AI. One context window, one task at a time.

Real engineering teams don't work that way. You have architects who plan, developers
who implement, reviewers who catch bugs, a secretary who tracks everything.

That's the vision: spin up a full team in 30 seconds. 13 roles — Architect, Developer,
Code Reviewer, Technical Writer, Secretary, QA, DevOps, Security, and more. Each with
its own context window and process.

Time: ~2:00
-->


---

# "Built With Itself"

<br/>

<div class="space-y-6 text-lg">

<div class="flex items-start gap-4">
<div class="text-2xl">🐣</div>
<div>
  <strong class="text-blue-300">Day 1:</strong> One human + one Copilot CLI agent
</div>
</div>

<div class="flex items-start gap-4">
<div class="text-2xl">📈</div>
<div>
  <strong class="text-blue-300">Version N builds Version N+1</strong>
  <div class="text-sm text-gray-400 mt-1">Each iteration: more agents, more features, better architecture.</div>
</div>
</div>

<div class="flex items-start gap-4">
<div class="text-2xl">🔄</div>
<div>
  <strong class="text-blue-300">Recursive</strong>
  <div class="text-sm text-gray-400 mt-1">Each version is built by the previous version's team.</div>
</div>
</div>

</div>

<!--
The recursive origin story.

Day 1: just me and Copilot CLI. I asked it to help build a server that could
coordinate multiple copies of itself. Then I used that server to build the next version.

Every version is built by the previous one. The agents that build Flightdeck ARE Flightdeck.

Time: ~3:30
-->

---

# ACP: The Protocol

<br/>

<div class="space-y-6">

**How agents talk to the server:**

<div class="bg-gray-900 p-6 rounded font-mono text-sm mt-4">
<div class="flex items-center justify-center gap-6">
<div class="text-blue-300 text-center">
<div>Server</div>
<div class="text-xs text-gray-500">(coordination)</div>
</div>
<div class="text-gray-500">⟵ ACP (NDJSON/stdio) ⟶</div>
<div class="text-green-300 text-center">
<div>Copilot CLI Agent</div>
<div class="text-xs text-gray-500">(any model)</div>
</div>
</div>
</div>

<div class="space-y-2 text-sm mt-6">
  <div>**Model-agnostic.** GPT, Claude, Gemini — any LLM that can output structured commands.</div>
  <div>**Each agent = a real process.** Full file access, terminal, tools, its own context window.</div>
  <div>**Bidirectional.** Agents send commands. Server handles state, routing, scheduling.</div>
</div>

</div>

<!--
ACP = Agent Communication Protocol. Not REST. Not gRPC. Plain NDJSON over stdio.

Each agent is a real spawned process — a Copilot CLI instance with its own model.
The protocol is simple: the agent outputs natural language with embedded commands,
and the server parses and executes them.

This is the key design decision. We didn't build a custom agent framework. We
plugged into the existing Copilot CLI and added a structured protocol on top.

Time: ~5:00
-->


---

# The Command System

<br/>

Agents embed **structured commands** in natural language:

<div class="bg-gray-900 p-4 rounded text-xs font-mono mt-6 leading-relaxed">
<div class="text-gray-400">I've analyzed the requirements. We need auth before the payment module.</div>
<div class="text-gray-400">Let me set up the work:</div>
<div class="mt-3">
<span class="text-yellow-300">⟦ DELEGATE ⟧</span> <span class="text-gray-300">role: Developer, task: "Implement user authentication"</span>
</div>
<div class="mt-2">
<span class="text-yellow-300">⟦ LOCK_FILE ⟧</span> <span class="text-gray-300">path: "src/auth/middleware.ts"</span>
</div>
<div class="mt-2">
<span class="text-yellow-300">⟦ ADD_DEPENDENCY ⟧</span> <span class="text-gray-300">task: "payments" dependsOn: "auth"</span>
</div>
<div class="mt-3 text-gray-400">Once auth is confirmed, I'll kick off the payment flow...</div>
</div>

<div class="text-sm text-gray-400 mt-4">
Delegation, file locking, commits, task creation, group coordination — all through commands.
</div>

<!--
This is the real exchange format. Agents don't output pure JSON — they reason in natural
language and embed commands inline. The server parses the ⟦ brackets ⟧ and executes.

Commands cover everything: DELEGATE, LOCK_FILE, COMMIT, ADD_DEPENDENCY, CREATE_GROUP,
BROADCAST, COMPLETE_TASK, and more. The agent learns the protocol from its prompt.

This is what gives agents real agency — they're not just chatting, they're acting.

Time: ~6:30
-->


---

# Server Architecture

<br/>

<div class="space-y-4 text-sm">

<div class="flex items-start gap-3">
<div class="text-blue-300 font-bold w-36">Task DAG</div>
<div>Auto-schedule work with 3-tier dependency inference</div>
</div>

<div class="flex items-start gap-3">
<div class="text-blue-300 font-bold w-36">File Locks</div>
<div>Prevent conflicts when multiple agents edit the same files</div>
</div>

<div class="flex items-start gap-3">
<div class="text-blue-300 font-bold w-36">Agent Manager</div>
<div>Spawn, monitor, and orchestrate N child processes</div>
</div>

<div class="flex items-start gap-3">
<div class="text-blue-300 font-bold w-36">Chat Groups</div>
<div>Agents self-organize into persistent topic-based channels</div>
</div>

<div class="flex items-start gap-3">
<div class="text-blue-300 font-bold w-36">Activity Ledger</div>
<div>Complete audit trail of every command and decision</div>
</div>

</div>

<div class="bg-gray-900 p-3 rounded text-xs font-mono mt-6 text-center text-gray-400">
All SQLite. One server process + N agent child processes. Runs on a laptop.
</div>

<!--
The server is the coordination layer. Five core components:

Task DAG with auto-scheduling — agents don't manually order work, the system infers
dependencies from explicit commands, file access patterns, and NLP heuristics.

File locks prevent the classic merge conflict nightmare when 15 agents edit code.

Agent Manager is like a process supervisor — spawns agents, monitors health, restarts on failure.

Chat Groups are emergent — agents create groups to organize around features or problems.

All state in SQLite. No Redis. No Postgres. No external dependencies. Runs on your laptop.

Time: ~8:00
-->


---

# Communication Channels

<br/>

<div class="space-y-5 mt-4">

<div class="flex items-start gap-4">
<div class="text-2xl">💬</div>
<div>
  <strong class="text-blue-300">Direct Messages</strong> — Point-to-point, for clarification and handoffs
</div>
</div>

<div class="flex items-start gap-4">
<div class="text-2xl">👥</div>
<div>
  <strong class="text-blue-300">Group Chats</strong> — Persistent, topic-based
  <div class="text-xs text-gray-400 mt-1">"react-dev-team", "architecture-team", "integration-team" — agents create these on their own</div>
</div>
</div>

<div class="flex items-start gap-4">
<div class="text-2xl">📢</div>
<div>
  <strong class="text-blue-300">Broadcast + Interrupt</strong> — Urgent updates to all agents at once
</div>
</div>

</div>

<div class="text-sm text-gray-400 mt-6">
No one assigns channels. Agents **self-organize** based on the work.
</div>

<!--
Three communication channels.

Direct messages for quick clarification. Group chats for sustained team coordination.
Broadcasts for "stop everything, security alert" moments.

The key insight: agents create these groups themselves. No one assigns them.
In one session, we saw a "react-dev-team" appear because three developers were
working on React components and needed to coordinate file locks.

This is emergent behavior — not programmed, not prompted. The agents figure it out.

Time: ~9:30
-->


---

# Emergent Behaviors

<br/>

We didn't code these. They emerged:

<div class="space-y-4 mt-6 text-sm">

<div class="flex items-start gap-3">
<div class="text-lg">🤝</div>
<div>
  <strong class="text-blue-300">Self-organizing group chats</strong>
  <div class="text-gray-400">Agents create coordination groups for technical areas, automatically.</div>
</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">🔗</div>
<div>
  <strong class="text-blue-300">Parallel workstreams under one lead</strong>
  <div class="text-gray-400">Multiple tasks in flight. Architects own design, developers own implementation. Clean handoffs.</div>
</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">📋</div>
<div>
  <strong class="text-blue-300">Self-introspection from inside the system</strong>
  <div class="text-gray-400">Agents reflect on what went wrong, file GitHub issues, and the next session implements fixes.</div>
</div>
</div>

</div>

<!--
This is the heart of the talk.

We designed the protocol and the communication channels. The behaviors — those are
the agents' own creativity.

Self-organizing groups: they see a coordination problem, they create a group.
Parallel workstreams: the Lead delegates, multiple teams run independently.
Self-introspection: agents are good at reflecting on what went wrong from inside
the system. They file actual GitHub issues, and the next session picks those up.

The system improves itself. Not in a sci-fi way — in a "this bug keeps happening,
let me add a check" way.

Time: ~11:00
-->


---

# A Real Session

<div class="mt-2">

<img src="./Screenshots/截屏2026-03-17 08.36.17.png" class="w-full rounded shadow-lg" />

</div>

<div class="text-center text-xs text-gray-400 mt-2">
18 connected agents · Multiple self-organized teams · Live group coordination
</div>

<!--
This is what it actually looks like in the Flightdeck dashboard.

Left side: a Project Lead setting coordination rules for the session. Developers
acknowledging and reporting their branch status.

Right side: live group chat. You can see the user interrupting to say "I see branches
are switched, remind agents not to conflict." The Lead immediately broadcasts to all agents.

Multiple teams: react-dev-team, docs-team, architecture-team, refactor-team, integration-team.
All created by the agents themselves.

18 agents connected. Real work shipping. One human watching.

Time: ~12:30
-->

---

# Every Engineer Gets a Crew

<br/>

<div class="space-y-6 text-lg">

<div>You make the **creative calls**.</div>

<div>The crew **executes at machine speed**.</div>

<div>You review the **completed work**.</div>

</div>

<div class="mt-10 text-sm text-gray-400 space-y-2">

<div>**Next:** Overnight autonomy — submit work at night, review in the morning.</div>
<div>**Next:** Institutional memory — every decision persists across sessions.</div>
<div>**Next:** Smart model routing — match the right model to each role.</div>

</div>

<!--
This is the vision. You're the product manager.

You say "here's what we need." The crew takes it, makes a plan, assigns roles,
coordinates, ships code. You review in the morning.

No hand-offs. No context loss. No "I forgot where we were."

The system remembers every decision, every task, every incident. And it learns
from mistakes — agents are great at self-introspection, filing issues from inside the system.

Time: ~13:30
-->


---
layout: center
---

# Let's Build Together

<br/>

<div class="space-y-4 text-center">

<div class="text-sm text-gray-300">Built with Copilot. Open source.</div>

<div class="text-lg mt-6">**Questions?**</div>

</div>

<!--
That's the talk.

College students: this is exactly the kind of project where anyone can contribute.
Better scheduling algorithms, smarter role assignment, new agent types, better UI.

Questions — I'm happy to dive deep into architecture, incidents, design decisions,
or anything from the appendix slides.

Time: ~14:00 (1 min for transition to Q&A)
-->


---

# APPENDIX: Meet the Crew

<br/>

<div class="grid grid-cols-2 gap-3 text-xs leading-relaxed">

<div>🏗️ **Architect** — System design, trade-offs, design docs</div>
<div>💻 **Developer** — Implementation, bug fixing, PR-ready code</div>
<div>👀 **Code Reviewer** — Correctness, quality, security, style</div>
<div>📚 **Technical Writer** — Docs, READMEs, user guides</div>
<div>🗂️ **Secretary** — Task tracking, DAG updates, coordination notes</div>
<div>🧪 **QA Engineer** — Test design, edge cases, verification</div>
<div>🚀 **DevOps** — Deployment, monitoring, infrastructure</div>
<div>🔐 **Security** — Threat modeling, vulnerability review</div>
<div>⚡ **Performance** — Profiling, optimization, metrics</div>
<div>📊 **Data** — Schema design, queries, optimization</div>
<div>🎨 **UI/UX** — Component design, user experience</div>
<div>🧠 **Project Lead** — Orchestration, decision-making, delegation</div>
<div>🔗 **Integration Lead** — Cross-team coordination, dependencies</div>

</div>

<!--
Speaker: Each role has distinct prompt engineering and responsibilities.
Some are builders, some are thinkers, some focus on quality gates.
The Lead orchestrates. The Secretary tracks everything.
-->


---

# APPENDIX: How You Interact

<br/>

<div class="space-y-4 text-sm">

<div class="flex items-start gap-3">
<div class="text-lg">1️⃣</div>
<div><strong>Describe the work.</strong> "Implement dark mode, add tests, write docs."</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">2️⃣</div>
<div><strong>Lead analyzes and plans.</strong> Breaks into tasks, assigns roles, infers dependencies.</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">3️⃣</div>
<div><strong>Agents execute in parallel.</strong> File locks prevent conflicts. Chat groups self-organize.</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">4️⃣</div>
<div><strong>Reviews + decisions.</strong> Architects make trade-off calls. Reviewers gate quality.</div>
</div>

<div class="flex items-start gap-3">
<div class="text-lg">5️⃣</div>
<div><strong>You review the output.</strong> Merge or iterate. Full audit trail available.</div>
</div>

</div>

<!--
Speaker: Simple flow. User ↔ Lead ↔ Specialized Agents ↔ Code/Docs/Tests.
The user only talks to the Lead. The Lead handles everything else.
-->


---

# APPENDIX: The Commit Catastrophe

<br/>

**What went wrong:**

One session, developers on parallel branches. DevOps agent tried to merge everything at once.
Conflict resolution failed. Tests broke. Bad commits landed on main.

**What we learned:**

- File locks aren't enough — need branch strategy
- Agents need approval gates before pushing to main
- Secretary must validate DAG before any merge

**The fix:**

- Explicit **merge lead** role coordinates integration
- No commits to main without passing checks + approval
- Activity ledger traced exactly what happened — clean rollback

**Key insight:** The system is only as good as its safety rails.

<!--
Speaker: Real incident. Scary but educational. Shows how architecture matured through actual failures.
The audit trail saved us — we traced every command and rolled back cleanly.
-->


---

# APPENDIX: The Security Bug + Review Chain

<br/>

**Scenario:** Architect found SQL injection vulnerability in the data layer.

**What happened:**

1. Architect created proposal in group chat
2. Security agent analyzed and flagged additional attack vectors
3. Developers implemented fixes in parallel (with file locks)
4. QA verified with edge-case tests
5. Code Reviewers performed multi-stage review
6. DevOps staged deployment

**Result:** All coordinated through group chat + embedded commands.
No external tickets. No email. Complete audit trail.

**Key insight:** Structured communication handles both routine dev work and critical incidents.

<!--
Speaker: Real incident turned into a strength. Shows how the system scales
from simple features to coordinated security responses.
-->


---

# APPENDIX: Task DAG Deep-Dive

<br/>

**Three-tier dependency inference:**

<div class="space-y-3 text-sm mt-4">

<div>
<span class="text-yellow-300 font-bold">Explicit:</span> ⟦ ADD_DEPENDENCY ⟧ from agent
<div class="text-xs text-gray-400 mt-1">Agent says: "I need auth before payments."</div>
</div>

<div>
<span class="text-yellow-300 font-bold">File-based:</span> DAG engine watches file reads/writes
<div class="text-xs text-gray-400 mt-1">If Task B reads a file Task A writes → auto-linked.</div>
</div>

<div>
<span class="text-yellow-300 font-bold">Heuristic:</span> NLP on task descriptions
<div class="text-xs text-gray-400 mt-1">"Implement sidebar" + "Style sidebar" → probably dependent.</div>
</div>

</div>

<div class="text-sm text-gray-400 mt-6">
Result: Fully automatic scheduling. Agents don't think about ordering.
</div>

<!--
Speaker: The DAG is the heartbeat. Auto-scheduling with three inference layers
makes the system scale without agents needing to manually coordinate ordering.
-->


---

# APPENDIX: Context Management

<br/>

**The challenge:** 15 agents, each with limited context window.

**CREW_UPDATE command:**

Agents periodically send status with:
- Summary of work completed
- Open blockers
- Next planned tasks
- Key decisions made

**Server aggregates:**
- Content hashing prevents redundant storage
- Summaries compressed and cached
- On reconnect: agent gets a briefing, not full history

**Result:** Agents work for hours without context bloat.

<!--
Speaker: This is how we solve the fundamental AI limitation — context windows.
CREW_UPDATE is like a handoff document in a real team. Each agent summarizes
its state, and the server aggregates for anyone who needs it.
-->


---

# APPENDIX: Dashboard Features

<br/>

<div class="space-y-3 text-sm">

<div><strong class="text-blue-300">Timeline</strong> — Every command, decision, and artifact from the session</div>
<div><strong class="text-blue-300">Heatmap</strong> — Which agents are busiest? Where are the bottlenecks?</div>
<div><strong class="text-blue-300">Cost Tracking</strong> — Token usage per agent, per task. Model efficiency metrics.</div>
<div><strong class="text-blue-300">DAG Visualization</strong> — Full task dependency graph. Critical path at a glance.</div>
<div><strong class="text-blue-300">Group Chat Archive</strong> — All coordination, searchable, with agent attribution.</div>
<div><strong class="text-blue-300">Incident Timeline</strong> — When something went wrong, drill down instantly.</div>

</div>

<!--
Speaker: Transparency is critical when delegating to AI.
The dashboard lets you watch 15 agents work or zoom into one task.
-->


---

# APPENDIX: Bottlenecks & Challenges

<br/>

<div class="space-y-3 text-sm">

<div>**Model quality variance** — Same prompt, different model = very different output. We route by role.</div>
<div>**Context window limits** — CREW_UPDATE helps, but longer projects are harder.</div>
<div>**File lock contention** — Sometimes too many agents waiting. Smart batching in progress.</div>
<div>**Hallucinated dependencies** — NLP heuristic sometimes links unrelated tasks. Manual override needed.</div>
<div>**Cold start** — First 5 min is slow. Agents learning the protocol.</div>
<div>**Debugging at scale** — 15 agents running = hard to trace. Full audit log is essential.</div>

</div>

<!--
Speaker: We're honest about limitations. These aren't theoretical — we hit them every session.
The work is in making each one incrementally better.
-->


---

# APPENDIX: Architecture Reference

<br/>

<div class="space-y-2 text-xs font-mono">

<div><span class="text-blue-300">server/</span> — ACP server, Task DAG, Agent Manager, Chat Groups, SQLite</div>
<div><span class="text-blue-300">agents/</span> — Agent prompt templates, role definitions, tool bindings</div>
<div><span class="text-blue-300">protocol/</span> — ACP spec, command parsing, validation</div>
<div><span class="text-blue-300">dashboard/</span> — Web UI: timeline, heatmap, chat archive, cost tracking</div>
<div><span class="text-blue-300">cli/</span> — User interface, session management</div>

</div>

<div class="text-sm text-gray-400 mt-8">
Open source. Contributions welcome.
</div>

<!--
Speaker: For anyone interested in the code. All these components are in the repo.
-->
