# Presentation Recommendations

Tips for presenting AI Crew to your team.

## Before the Presentation

- **Run through the slides once** with speaker notes visible (`S` key in reveal.js) to familiarize yourself with talking points
- **Have the dev server running** (`npm run dev`) so you can switch to a live demo at any point
- **Pre-create a sample task** — something simple like "build a utility function with tests" so the demo stays focused (~5 min)
- **Check Copilot CLI access** — ensure your API key is configured and you can spawn at least 3–4 agents simultaneously

## During the Presentation

### Timing Guide (~20 minutes)
| Section | Slides | Time |
|---------|--------|------|
| Problem & Solution | 1–3 | 3 min |
| Architecture & Roles | 4–6 | 4 min |
| Features Deep-Dive | 7–12 | 6 min |
| Real Stats & Demo | 13–14 | 4 min |
| Differentiators & Roadmap | 15–18 | 3 min |

### Key Moments to Emphasize
1. **Slide 4 (How It Works)** — This is the "aha" moment. Stress that the lead agent does the planning, not the user.
2. **Slide 9 (Coordination)** — The scoped commit / file locking system is novel. This is where most multi-agent systems fail.
3. **Slide 13 (Real Stats)** — Use concrete numbers. "10 agents, 9 features, 30 minutes" is more compelling than abstractions.

### Live Demo Tips
- Start with the **Mission Control** dashboard — it's the most visually impressive screen
- Show the **Timeline** swim lanes after 2–3 minutes of agent activity — the parallel nature becomes immediately visible
- Demonstrate **human-in-the-loop** by messaging an agent mid-task — this shows you're not just watching, you're in control
- If something goes wrong during the demo, use **System Pause** — it's a feature, not a bug!

## Audience-Specific Angles

### For Engineering Managers
- Focus on **parallelism and velocity**: "What took one agent 2 hours took 10 agents 15 minutes"
- Highlight **built-in quality gates**: reviewers catch bugs before they ship
- Show the **cost tracking** panel — managers care about economics

### For Individual Engineers
- Emphasize that agents use **real Copilot CLI sessions** — same tools they use daily
- Show the **file locking and commit scoping** — these prevent the chaos they'd expect
- Demonstrate the **human-in-the-loop** chat — they're not replaced, they're amplified

### For Product/Leadership
- Lead with the **problem slide** — sequential AI is a bottleneck
- Focus on the **real session stats** — concrete output over technical details
- Show the **roadmap** — this is an evolving platform, not a static tool

## Technical Setup

### Running the Presentation
```bash
# Option 1: Open directly in browser
open presentations/index.html

# Option 2: Serve locally (for remote sharing)
npx serve presentations/
```

### Keyboard Shortcuts (reveal.js)
| Key | Action |
|-----|--------|
| `→` / `Space` | Next slide |
| `←` | Previous slide |
| `S` | Speaker notes (opens a new window) |
| `F` | Fullscreen |
| `O` | Overview mode |
| `Esc` | Exit overview/fullscreen |
| `B` | Black screen (pause) |

### Customization
- Edit `presentations/index.html` — it's a single self-contained file
- Theme colors are CSS variables at the top (GitHub's color palette)
- Reveal.js is loaded from CDN — no build step needed
- To add slides, copy an existing `<section>` block and edit content

## Common Questions & Answers

**Q: How much does this cost per session?**
A: Depends on agent count and task complexity. A typical 10-agent session uses ~2M tokens. Content hashing and optimizations reduce waste by 40-60%.

**Q: Can agents break things?**
A: Agents run real code, so yes — but coordination features (file locks, scoped commits, input validation, code review agents) minimize risk. System pause lets you freeze everything instantly.

**Q: How is this different from ChatGPT/Claude with tools?**
A: Those are single-agent. AI Crew runs parallel agents with distinct roles, structured communication, dependency resolution, and real-time observability. It's the difference between one person doing everything and an engineering team.

**Q: Can I add custom roles?**
A: Yes — the RoleRegistry supports custom role definitions with their own system prompts and model preferences.

**Q: What models does it use?**
A: Copilot CLI's underlying models (currently Claude and GPT variants). Different roles can use different models — an architect might use a reasoning model while a developer uses a fast coding model.
