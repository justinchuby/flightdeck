# Mission Control for Your AI Agent Crews

**Here's the meta part: this product was built by a crew of AI agents, monitored through the product itself.**

A product manager agent wrote the specs. A designer agent created the UX. Developer agents wrote the code. A QA agent tested everything with Playwright. The tool quite literally built itself — and we watched it happen on the dashboard.

That's what Flightdeck is: **a real-time dashboard for seeing what your AI agents are actually doing.**

---

## The Problem

You kick off a multi-agent session — 5, 7, 10 AI agents coding, reviewing, and coordinating in parallel. Then you wait. And wonder:

- Who's talking to whom?
- Did two agents just edit the same file?
- Why has one agent been idle for 10 minutes?
- Is this session burning through context faster than expected?
- What actually happened while you were away?

Multi-agent AI tools exist. But none of them show you what's happening inside. **You're flying blind.**

## The Solution

Flightdeck gives you mission control.

![Lead Dashboard — track every project, agent, and task at a glance](/screenshots/lead-dashboard.png)

One command to launch. No config, no API keys, no cloud dependency. Your data stays on your machine.

```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

---

## What You Get

### 🎯 Canvas View
See your agent crew as an interactive graph with real-time communication edges flowing between nodes. Click any agent to see their tasks, messages, and file locks. Spot conflicts before they happen.

![Canvas View — agents as nodes, communication as edges](/screenshots/canvas.png)

### ⏪ Session Replay
The **Timeline** page shows a swim-lane Gantt chart of exactly what each agent did and when. **Session Replay** lets you scrub through any past session at up to 32× speed — like a flight recorder for AI work. Hit Play and watch agents appear, task bars grow, and messages fire between them, all synchronized to a scrubber you can drag to any point.

![Timeline page with Session Replay — Gantt chart with swim lanes for every agent](/screenshots/timeline.png)

### 📊 Overview Dashboard
Cumulative flow diagrams, agent activity heatmaps, and context usage tracking give you the full picture at a glance. See which projects are on track and which need attention.

### 🔎 Context Awareness
Monitor per-agent context window usage and cumulative token consumption across the crew. Spot agents approaching their context limit before they stall — and intervene early.

### 🛡️ Context & Health Alerts
See which agents are running low on context before they stall. Monitor active task counts, error rates, and idle time across the crew. Approve queued decisions from a single batch-approval panel — no terminal switching.

### 🔍 Historical Data Browser
Browse any past session, search agent output, review conversations. Per-project tabs keep everything organized. Nothing is lost.

### 🧩 Open Source
MIT licensed. Zero-infrastructure SQLite backend. Runs locally. Extensible architecture. No telemetry, no cloud, no lock-in.

---

## Who It's For

- **Developers using GitHub Copilot** who run multi-agent sessions and want visibility into what's happening
- **AI engineers** building and debugging agent systems who need observability
- **Engineering managers** who want to understand how AI-assisted development actually works

> **Real scenario:** Agent #3 gets stuck in a retry loop, burning through its context window on the same failing approach. Without Flightdeck, you find out when the session fails. With the Timeline page, you spot the loop in 2 minutes, interrupt, and redirect the agent.

## The Competitive Gap

Most AI coding tools are single-agent. The few multi-agent frameworks that exist have no visual dashboard. **Flightdeck is the first purpose-built observability layer for AI agent crews.**

This isn't an AI tool. It's a tool *for* AI.

---

## 🚀 Get Started in 60 Seconds

```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

That's it. The dashboard opens, detects your agent sessions, and starts streaming. No config files, no API keys.

⭐ **Star on GitHub**: [github.com/justinchuby/flightdeck](https://github.com/justinchuby/flightdeck)

📖 **Read the docs**: [Quickstart Guide](/guide/quickstart)

---

*Built with React, TypeScript, Express, and SQLite. MIT License.*
