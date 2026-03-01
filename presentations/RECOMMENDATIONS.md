# Presentation Recommendations

Tips for presenting AI Crew to your team.

## Before the Presentation

- **Run through the slides once** with speaker notes visible (`S` key in reveal.js) to familiarize yourself with talking points
- **Have the dev server running** (`npm run dev`) so you can switch to a live demo at any point
- **Pre-create a sample task** — something simple like "build a utility function with tests" so the demo stays focused (~5 min)
- **Check Copilot CLI access** — ensure your API key is configured and you can spawn at least 3–4 agents simultaneously

## During the Presentation

### Timing Guide (~40 minutes)
| Section | Slides | Time |
|---------|--------|------|
| Opening & Problem | 1–3 | 3 min |
| Architecture & Roles | 4–6 | 5 min |
| Features Deep-Dive | 7–12 | 7 min |
| **Case Study: This Session** | **13–19** | **8 min** |
| Differentiators & Philosophy | 20–22 | 4 min |
| Roadmap | 23 | 2 min |
| Live Demo | 24–25 | 7 min |
| Getting Started + Q&A | 26–27 | 4 min |

### Key Moments to Emphasize
1. **Slide 4 (How It Works)** — This is the "aha" moment. Stress that the lead agent does the planning, not the user.
2. **Slide 9 (Coordination)** — The scoped commit / file locking system is novel. This is where most multi-agent systems fail.
3. **Slides 13–19 (Case Study)** — This is the most compelling section. Real numbers, real bugs, real fixes. Don't rush it.
4. **Slide 16 (When Things Go Wrong)** — Counterintuitively, showing failures builds more credibility than only showing successes.

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
cd presentations

# Development mode (live reload at localhost:3030)
npm run dev

# Build static site
npm run build

# Export to PDF
npm run export
```

### Keyboard Shortcuts (Slidev)
| Key | Action |
|-----|--------|
| `→` / `Space` | Next slide |
| `←` | Previous slide |
| `p` | Presenter mode (speaker notes) |
| `f` | Fullscreen |
| `o` | Overview mode |
| `Esc` | Exit overview/fullscreen |
| `d` | Toggle dark mode |

### Customization
- Edit `presentations/slides.md` — single Markdown file with all slides
- Slides are separated by `---` with optional YAML frontmatter per slide
- Speaker notes go in `<!-- HTML comments -->` at the end of each slide
- Supports Mermaid diagrams, code highlighting, and UnoCSS utility classes
- Theme and global settings are in the first frontmatter block

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
