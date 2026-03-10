# IronClaw Memory System Research

## 1. Project Overview

**IronClaw** is a secure personal AI assistant built in Rust (148K LoC, 262 source files) by NEAR AI. It's a single-user, always-on agent that runs locally with multi-channel support (REPL, HTTP webhooks, Telegram, Slack, web gateway). Key differentiators: WASM sandbox for untrusted tools, credential protection, prompt injection defense, and a sophisticated persistent memory system.

- **Language:** Rust (edition 2024, Rust 1.92+)
- **Primary DB:** PostgreSQL 15+ with pgvector extension (vector search)
- **Alternative DB:** libSQL/Turso (embedded, for lighter deployments)
- **Embedding providers:** OpenAI (text-embedding-3-small/large), NEAR AI, Ollama (local), Mock (testing)
- **License:** MIT OR Apache-2.0

## 2. Memory Architecture

### 2.1 The "Workspace" Abstraction

IronClaw's memory system is called **Workspace** — a database-backed virtual filesystem. It does NOT use the real filesystem for memory storage. Instead, it stores documents in PostgreSQL (or libSQL) with a path-based addressing scheme that mimics a filesystem.

```
workspace/
├── MEMORY.md              ← Long-term curated memory (protected from tool overwrite)
├── IDENTITY.md            ← Agent identity (protected)
├── SOUL.md                ← Core values/principles (protected)
├── AGENTS.md              ← Behavior instructions (protected)
├── USER.md                ← User context/preferences (protected)
├── HEARTBEAT.md           ← Periodic checklist (protected)
├── README.md              ← Root runbook
├── TOOLS.md               ← Environment-specific tool notes
├── BOOTSTRAP.md           ← First-run ritual (self-deleting)
├── context/               ← Identity-related docs
│   └── vision.md
├── daily/                 ← Timestamped session logs
│   ├── 2024-01-15.md
│   └── 2024-01-16.md
└── projects/              ← Arbitrary user/agent-created hierarchy
    └── alpha/
        └── notes.md
```

**Key insight:** The virtual filesystem is backed entirely by the `memory_documents` table. There are no actual files on disk — all "files" are database rows with a `path` column. This enables hybrid search, chunking, embedding, and hygiene across the entire workspace.

### 2.2 Data Model

**Two-table design:**

```sql
-- Documents (the "files")
memory_documents (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id UUID,                          -- NULL = shared across agents
    path TEXT NOT NULL,                      -- Virtual filesystem path
    content TEXT NOT NULL,                   -- Full document content
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    UNIQUE (user_id, agent_id, path)
)

-- Chunks (for search indexing)
memory_chunks (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES memory_documents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    embedding VECTOR,                       -- Flexible dimension (was 1536, now any)
    UNIQUE (document_id, chunk_index)
)
```

**Indexes:**
- `GIN(content_tsv)` — Full-text search
- `hnsw(embedding vector_cosine_ops)` — Vector similarity (HNSW, m=16, ef_construction=64) — dropped in V9 migration for dimension flexibility; sequential cosine search used instead (acceptable for personal workspace scale)
- `text_pattern_ops` on path — Prefix matching for directory listing

### 2.3 Identity vs Memory Separation

IronClaw cleanly separates **identity** (who the agent is) from **memory** (what the agent knows):

| Category | Files | Protected? | Injected Into |
|----------|-------|-----------|---------------|
| **Identity** | IDENTITY.md, SOUL.md, AGENTS.md, USER.md | YES — tool writes blocked | System prompt (always) |
| **Long-term memory** | MEMORY.md | Write-protected | System prompt (direct chat only, excluded from group chats) |
| **Session memory** | daily/*.md | No | System prompt (today + yesterday only) |
| **Working memory** | projects/*, context/* | No | On-demand via `memory_search` tool |
| **Environment** | TOOLS.md | No | System prompt (always) |
| **Bootstrap** | BOOTSTRAP.md | No (intentionally) | System prompt (first run only, self-deletes) |

**Security model:** Identity files (IDENTITY, SOUL, AGENTS, USER) are protected from LLM tool writes to prevent prompt injection attacks that could poison the agent's core personality. They can only be edited by the human user directly.

## 3. Memory Creation

### 3.1 Explicit Creation (Agent-Driven)

Four LLM-accessible tools:

1. **`memory_write`** — Write/append to any workspace path
   - Targets: `memory` (MEMORY.md), `daily_log` (timestamped), `heartbeat`, `bootstrap`, or any custom path
   - Default: append mode (preserves existing content)
   - Rate limited: 20 requests/minute, 200/hour
   - Protected paths blocked (returns `NotAuthorized`)

2. **`memory_read`** — Read any workspace file by path

3. **`memory_search`** — Hybrid search across all documents (see §4)

4. **`memory_tree`** — Browse workspace structure (recursive directory listing)

### 3.2 Implicit Creation (Automatic)

- **Daily logs** are auto-created with timestamps: `[HH:MM:SS] content`
- **HEARTBEAT.md** seeded with a template on first access (all HTML comments, so heartbeat runner treats it as empty)
- **TOOLS.md** seeded with guidance template
- **BOOTSTRAP.md** seeded with first-run ritual (greet user → learn preferences → save to MEMORY.md → delete bootstrap)

### 3.3 First-Run Bootstrap Ritual

On first startup, BOOTSTRAP.md is injected into the system prompt, instructing the agent to:
1. Greet the user
2. Ask questions about who they are and what they need
3. Save learned facts to MEMORY.md and TOOLS.md
4. Self-delete BOOTSTRAP.md when done

**This is the primary mechanism for implicit knowledge accumulation** — the agent learns about the user organically through conversation and persists it to the workspace.

### 3.4 Human-Editable

The CLI provides direct workspace access:
```
ironclaw memory search "project alpha"
ironclaw memory read MEMORY.md
ironclaw memory write notes/idea.md "content here"
ironclaw memory tree --depth 3
ironclaw memory status
```

## 4. Memory Retrieval & Search

### 4.1 Hybrid Search (FTS + Vector)

IronClaw uses **Reciprocal Rank Fusion (RRF)** to combine two retrieval methods:

1. **Full-Text Search (FTS):** PostgreSQL `ts_rank_cd` with `plainto_tsquery('english', query)`
2. **Vector Similarity:** pgvector cosine distance `1 - (embedding <=> query_embedding)`

**RRF Algorithm:**
```
score(chunk) = Σ 1/(k + rank_i) for each method where chunk appears
```
- Default k = 60 (higher = more weight on top results)
- Scores normalized to 0-1 range (max score = 1.0)
- Results that appear in BOTH methods (hybrid matches) naturally get higher scores
- Configurable: FTS-only, vector-only, or hybrid
- Minimum score threshold filter
- Pre-fusion limit: 50 results per method, then fuse

### 4.2 Document Chunking

Documents are split into overlapping chunks before indexing:
- **Chunk size:** 800 words (≈800 tokens)
- **Overlap:** 15% (120 words overlap between adjacent chunks)
- **Minimum chunk size:** 50 words (tiny trailing chunks merged with previous)
- **Two strategies:**
  - `chunk_document()` — Word-boundary splitting with overlap
  - `chunk_by_paragraphs()` — Paragraph-aware splitting (preserves semantic boundaries)
- Re-indexed on every write/append (delete old chunks → create new chunks → embed)

### 4.3 Embedding Pipeline

- Embedding generated at chunk-write time (synchronous, inline)
- If embedding fails, chunk stored without embedding (FTS still works)
- Background backfill: `get_chunks_without_embeddings()` for lazy embedding
- Multiple providers supported: OpenAI, NEAR AI, Ollama (local), configurable via env vars
- Flexible dimension: V9 migration dropped fixed 1536-dim constraint to support any provider

### 4.4 Context Injection

**System prompt composition** (from `Workspace::system_prompt_for_context()`):

```
1. Bootstrap ritual (BOOTSTRAP.md, first-run only)
   ---
2. Agent Instructions (AGENTS.md)
   ---
3. Core Values (SOUL.md)
   ---
4. User Context (USER.md)
   ---
5. Identity (IDENTITY.md)
   ---
6. Tool Notes (TOOLS.md)
   ---
7. Long-Term Memory (MEMORY.md, direct chat only, excluded from group chats)
   ---
8. Today's Notes (daily/YYYY-MM-DD.md)
   ---
9. Yesterday's Notes (daily/YYYY-MM-DD.md)
```

**On-demand retrieval:** The `memory_search` tool description tells the LLM it "MUST be called before answering questions about prior work, decisions, dates, people, preferences, or todos." This is RAG-style: search → retrieve → include in next LLM turn.

## 5. Memory Lifecycle

### 5.1 Creation
- Agent writes via `memory_write` tool (explicit)
- Bootstrap ritual captures initial user info (semi-automatic)
- Daily logs accumulate via `append_daily_log()` (automatic per-session)

### 5.2 Update
- Overwrite mode (`append: false`) replaces entire document
- Append mode adds content with newline separator
- MEMORY.md uses double-newline separation (semantic paragraphs)
- Every write triggers full re-indexing (chunk + embed)

### 5.3 Decay & Deletion

**Hygiene system** (`workspace/hygiene.rs`, 465 lines):
- Runs on configurable cadence (default: every 24 hours)
- **Daily logs:** Deleted after retention period (configurable days)
- **Conversations:** Deleted after retention period
- **Identity files NEVER deleted** (MEMORY, IDENTITY, SOUL, AGENTS, USER, HEARTBEAT, README, TOOLS, BOOTSTRAP)
- AtomicBool guard prevents concurrent hygiene passes
- State file tracks last run time in `~/.ironclaw/`
- Case-insensitive identity path matching (Windows/macOS compat)

### 5.4 Context Window Management

**ContextMonitor** (`agent/context_monitor.rs`):
- Estimates token count: words × 1.3 tokens/word
- Default limit: 100K tokens, threshold at 80%
- Three compaction strategies:
  1. **Summarize** (default): Keep 5 recent turns, summarize older ones
  2. **Truncate**: Keep N recent turns, drop older ones
  3. **MoveToWorkspace**: Persist context to workspace memory
- Escalating: >95% → aggressive truncation (keep 3), >85% → summarize (keep 5), >80% → summarize (keep 8)

## 6. Per-Project vs Global Memories

IronClaw is primarily a **single-workspace** system scoped by `user_id`:

- `user_id` + `path` is the unique key (with optional `agent_id` for multi-agent isolation)
- No per-project separation in the current schema
- The `agent_id` field allows multi-agent isolation (each agent has its own workspace view), but shared documents (agent_id = NULL) are visible to all agents

**Missing:** There's no per-project workspace isolation. If IronClaw were used across multiple projects, all memories would share the same workspace. The path hierarchy (`projects/alpha/`) provides soft organization but no hard boundaries.

## 7. Storage Backend

### 7.1 PostgreSQL (Primary)
- Full-featured: pgvector for embeddings, GIN for FTS, HNSW indexes
- Connection pooling via `deadpool-postgres`
- Custom SQL function `list_workspace_files()` for directory-like listing
- Views: `memory_documents_summary`, `chunks_pending_embedding`

### 7.2 libSQL/Turso (Alternative)
- 619-line workspace store implementation mirrors PostgreSQL
- Embedded database (no server needed)
- FTS via SQLite FTS5 (`MATCH` syntax)
- No vector search (falls back to FTS-only)
- Turso replication for edge deployment

### 7.3 Storage Abstraction
- `WorkspaceStorage` enum dispatches to either `Repository` (PostgreSQL) or `dyn Database` (libSQL)
- Clean `Database` trait with `WorkspaceStore` sub-trait
- Feature-gated: `#[cfg(feature = "postgres")]`

## 8. Notable Patterns for Flightdeck

### 8.1 Virtual Filesystem over Database ⭐⭐⭐

**The most transferable pattern.** Instead of using actual files, IronClaw stores all memory as database rows with filesystem-like paths. Benefits:
- **Atomic operations** — No partial writes, no file locking
- **Hybrid search** — FTS + vector on the same data
- **Automatic indexing** — Every write triggers re-chunking and re-embedding
- **Hygiene** — Database-level retention policies, no orphaned files
- **Directory listing** — SQL function emulates `ls` with path prefix matching

**For Flightdeck:** Our current `.flightdeck/shared/` uses actual files. A database-backed virtual workspace would give us searchable agent artifacts, automatic knowledge indexing, and clean lifecycle management.

### 8.2 Identity Protection from LLM Writes ⭐⭐⭐

Identity files (SOUL.md, IDENTITY.md, AGENTS.md, USER.md) are injected into the system prompt but **cannot be overwritten by the LLM via tools**. This is a critical security boundary:
- Prevents prompt injection from poisoning the agent's personality
- Human-only editability for core identity
- Case-insensitive path matching prevents bypass

**For Flightdeck:** Our role prompts in `RoleRegistry.ts` could benefit from similar protection. If agents could modify their own role definitions, that's a prompt injection vector.

### 8.3 Reciprocal Rank Fusion for Hybrid Search ⭐⭐

RRF is elegant and well-implemented:
- Results from FTS and vector search are ranked independently
- Combined score = sum of `1/(k + rank)` across methods
- Hybrid matches (in both result sets) naturally score higher
- No need to normalize raw scores — rank-based fusion is score-agnostic
- Configurable: k parameter, min score threshold, result limits

**For Flightdeck:** If we implement knowledge search, RRF is the right approach. It's simpler and more robust than score-weighted averages.

### 8.4 Bootstrap Ritual Pattern ⭐⭐

The first-run bootstrap is clever:
- BOOTSTRAP.md is seeded with onboarding instructions
- Injected into system prompt on every session start (when non-empty)
- Agent completes ritual → saves learnings to MEMORY.md → clears BOOTSTRAP.md
- Self-deleting: never repeats after first run
- **Not** write-protected (agent must be able to clear it)

**For Flightdeck:** We could use a similar pattern for new project onboarding. First session: agent asks about the project, coding style, team conventions → saves to project knowledge.

### 8.5 Context Window Budgeting ⭐⭐

System prompt composition is deliberate:
- Identity files loaded in priority order (AGENTS > SOUL > USER > IDENTITY)
- MEMORY.md excluded from group chats (prevents personal context leaks)
- Only last 2 days of daily logs included (bounded recency)
- Everything else is on-demand via `memory_search` (RAG-style)

**For Flightdeck:** Our knowledge injection pipeline should follow the same pattern: always-injected core identity, bounded recency for session notes, RAG for everything else.

### 8.6 Hygiene as Infrastructure ⭐

Automatic cleanup as a first-class system:
- Configurable retention periods
- AtomicBool guard against concurrent runs
- State file for cadence tracking
- Identity files never deleted (explicit exclusion list)

**For Flightdeck:** With 144+ agent artifact directories, we need hygiene. Auto-cleanup of old session artifacts, but preserve training data and knowledge.

### 8.7 Skills System with Trust-Based Attenuation ⭐

Skills (SKILL.md files with YAML frontmatter) are matched to user messages via deterministic scoring:
- Keyword exact match: 10 pts, substring: 5 pts (capped at 30)
- Tag match: 3 pts (capped at 15)
- Regex pattern: 20 pts (capped at 40)
- Max 4000 tokens of skill context
- **Trust levels**: Trusted (local/user-placed) get full tool access, Installed (registry/external) get read-only only
- Lowest-trust active skill determines the tool ceiling (prevents privilege escalation)

**For Flightdeck:** We already have skills in `.copilot/skills/` but they're not automatically loaded. IronClaw's deterministic scoring + trust attenuation is a production-ready pattern we could adopt.

## 9. Architecture Comparison: IronClaw vs Flightdeck

| Aspect | IronClaw | Flightdeck |
|--------|----------|------------|
| **Memory storage** | PostgreSQL + pgvector (database-backed virtual filesystem) | SQLite (session state) + real filesystem (.flightdeck/shared/) |
| **Search** | Hybrid FTS+vector with RRF | None (no memory search) |
| **Embeddings** | OpenAI/NEAR AI/Ollama, configurable | None |
| **Identity persistence** | IDENTITY.md, SOUL.md, AGENTS.md, USER.md (DB-backed) | RoleRegistry.ts (code, not data) |
| **Knowledge accumulation** | MEMORY.md + daily logs + arbitrary docs | AgentMemory (per-session key-value), CollectiveMemory (coded but not wired) |
| **Context injection** | System prompt composition with priority ordering | Role prompt + task (no knowledge injection yet) |
| **Hygiene** | Automated retention-based cleanup | None |
| **Skills** | SKILL.md with trust attenuation + deterministic selection | .copilot/skills/ (markdown, not auto-loaded) |
| **CLI access** | `ironclaw memory search/read/write/tree/status` | None |
| **Multi-user** | user_id scoping | Single-user (local tool) |

## 10. Recommendations for Flightdeck Knowledge System

Based on IronClaw's patterns, the highest-impact adaptations for Flightdeck:

1. **Database-backed knowledge store** — Don't put training data in filesystem files. Use SQLite tables with FTS5 for search. Path-based addressing gives users the mental model of files without the operational complexity.

2. **Hybrid search** — Even without vector embeddings, SQLite FTS5 alone would be a huge improvement. Add embeddings later as an optional enhancement. RRF fusion is simple to implement.

3. **Identity/knowledge separation** — System prompt = identity (role, instructions). Knowledge = searchable database. Don't bloat the system prompt with accumulated knowledge. Use RAG-style retrieval.

4. **Bootstrap ritual** — On first session with a project, prompt agents to learn about it and persist findings. Self-deleting, never repeats.

5. **Hygiene from day one** — Build retention policies into the knowledge system. Don't let the `~/.flightdeck/projects/<id>/` directory grow unbounded.

6. **Context budget** — IronClaw's system prompt includes identity + last 2 days of logs + MEMORY.md ≈ bounded. Everything else is on-demand. Our 1200-token budget from the knowledge system design is consistent with this approach.
