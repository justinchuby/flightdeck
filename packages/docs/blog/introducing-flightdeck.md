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
- Is this session going to cost $5 or $50?
- What actually happened while you were away?

Multi-agent AI tools exist. But none of them show you what's happening inside. **You're flying blind.**

## The Solution

Flightdeck gives you mission control.

![Lead Dashboard — track every project, agent, and task at a glance](/images/01-lead-dashboard.png)

One command to launch. No config, no API keys, no cloud dependency. Your data stays on your machine.

```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

---

## What You Get

### 🎯 Canvas View
See your agent crew as an interactive graph with real-time communication edges flowing between nodes. Click any agent to see their tasks, messages, and file locks. Spot conflicts before they happen.

![Canvas View — agents as nodes, communication as edges](/images/03-canvas-with-panel.png)

### ⏪ Session Replay
Scrub through any past session at up to 32× speed — like a flight recorder for AI work. Agents appear, task bars grow, messages fire between them, all synchronized to a scrubber you can drag to any point.

![Timeline — Gantt chart with swim lanes for every agent](/images/09-timeline.png)

### 📊 Timeline & Overview
Swim-lane Gantt charts show exactly what each agent did and when. Token usage curves, cumulative flow diagrams, and agent activity heatmaps give you the full picture at a glance.

### 🛡️ Mission Control
Fleet health monitoring, context pressure alerts, and a decision approval queue. Know when agents need attention — don't babysit them.

### 🔍 Historical Data Browser
Browse any past session, search agent output, review conversations. Per-project tabs keep everything organized. Nothing is lost.

### 🧩 Open Source
MIT licensed. Zero-infrastructure SQLite backend. Runs locally. Extensible architecture. No telemetry, no cloud, no lock-in.

---

## Who It's For

- **Developers using GitHub Copilot** who run multi-agent sessions and want visibility into what's happening
- **AI engineers** building and debugging agent systems who need observability
- **Engineering managers** who want to understand how AI-assisted development actually works
- **Anyone who's run a multi-agent session**, watched agents burn through tokens, and thought: *"I need to see what's happening in there"*

## The Competitive Gap

Most AI coding tools are single-agent. The few multi-agent tools (CrewAI, AutoGen) have no visual dashboard. **Flightdeck is the first purpose-built observability layer for AI agent crews.**

This isn't an AI tool. It's a tool *for* AI.

---

## Try It

```bash
npm install -g @flightdeck-ai/flightdeck
```

⭐ **Star on GitHub**: [github.com/justinchuby/flightdeck](https://github.com/justinchuby/flightdeck)

📖 **Read the docs**: [Quickstart Guide](/guide/quickstart)

💬 **We'd love to hear from you** — especially if you're already running multi-agent workflows. What's missing? What would make this indispensable?

---

*Built with React, TypeScript, Express, and SQLite. MIT License.*
