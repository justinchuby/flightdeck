# Introducing Flightdeck: Watch AI Agents Build Software Together

**What if you could see inside a team of AI agents as they collaborate to build your project?**

Flightdeck is an open-source dashboard that turns GitHub Copilot's multi-agent crews into something you can actually watch, understand, and guide — in real time.

---

## The Problem

AI coding assistants are powerful, but when you scale to multiple agents working together — a lead delegating to developers, reviewers, and testers — it becomes a black box. You kick off a task and wait. Did the agents get stuck? Are they coordinating well? Did two agents edit the same file? You have no idea.

**You shouldn't have to read terminal logs to understand what your AI team is doing.**

## The Solution

Flightdeck gives you a real-time control center for your AI agent crew.

![Lead Dashboard — track every project, agent, and task at a glance](/images/01-lead-dashboard.png)

### See Everything

- **Lead Dashboard** — one screen showing all active projects, agent status, and progress
- **Canvas View** — interactive node graph of your agents with live communication edges
- **Timeline** — Gantt chart showing exactly what each agent did and when, with zoom and session replay

![Timeline — watch agent activity unfold with session replay](/images/09-timeline.png)

### Control Everything

- **⌘K Command Palette** — 30+ natural language commands to manage your crew from one keyboard shortcut
- **Batch Approval** — review and approve multiple agent requests at once
- **File Lock Tracking** — see who's editing what, prevent conflicts before they happen

### Understand Everything

- **Session Replay** — scrub through past sessions at up to 32× speed to see how agents collaborated
- **Cumulative Flow Diagrams** — spot bottlenecks instantly
- **Agent Heatmaps** — see who's doing the work and who's idle

---

## What Makes Flightdeck Different

### 🔴 It's Real-Time
This isn't a post-mortem report. Flightdeck streams live data from your agent crew. You see messages being sent, tasks being completed, and files being locked — as it happens.

### 🎬 Session Replay
Ever wonder "what happened while I was away"? Hit Play and watch the entire session unfold — agents appearing, task bars growing, messages firing between them. Skip ahead at 32× or scrub to the exact moment something went wrong.

### 📊 Built for Multi-Agent at Scale
Horizontal scroll for 10+ agent sessions. Swim lanes that scale. Zoom from overview to individual task segments. Flightdeck was built from day one for real multi-agent workloads, not single-agent chat.

### 🔓 Open Source
MIT licensed. Run it locally, customize it, contribute to it. Your data stays on your machine — no cloud dependency, no telemetry.

---

## How It Works

```bash
# Install globally
npm install -g @flightdeck-ai/flightdeck

# Launch — dashboard opens automatically
flightdeck
```

That's it. Flightdeck detects running Copilot agent sessions and starts streaming data to the dashboard. No configuration, no API keys, no setup.

![Canvas View — see agent relationships and real-time communication](/images/03-canvas-with-panel.png)

---

## Who It's For

- **Developers using GitHub Copilot** who run multi-agent sessions and want visibility
- **Team leads** who need to understand how AI agents collaborate on their codebase
- **Anyone curious** about what happens when you give a goal to a team of AI agents

---

## Try It Now

```bash
npm install -g @flightdeck-ai/flightdeck
```

⭐ **Star us on GitHub**: [github.com/justinchuby/flightdeck](https://github.com/justinchuby/flightdeck)

📖 **Read the docs**: [Quickstart Guide](/guide/quickstart)

💬 **Join the community**: File issues, contribute features, or share your agent session replays

---

*Flightdeck is open source under the MIT License. Built with React, TypeScript, Express, and SQLite.*
