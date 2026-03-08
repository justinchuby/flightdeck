# ZeroClaw Memory System Research

**Repository**: /Users/justinc/Documents/GitHub/zeroclaw  
**Focus**: Memory system design, storage, retrieval, lifecycle  
**Total Memory System**: ~7,926 lines of Rust across 16 files  
**Agent**: Architect (f9a74593)

---

## 1. What ZeroClaw Is

ZeroClaw is a 100% Rust AI agent runtime — "an agnostic runtime OS for agentic workflows." Key stats:
- <5MB RAM, <10ms startup, ~8.8MB binary
- Trait-driven architecture: everything is pluggable (providers, channels, tools, memory, SOPs)
- Supports: OpenAI, Anthropic, Gemini, Ollama, Groq, Cerebras, OpenRouter, xAI, DeepSeek
- Ships as a single binary with optional features (matrix, bluetooth, firmware)

The memory system is one of its most sophisticated subsystems — a hybrid search engine with 6 interchangeable backends, automatic lifecycle management, and transparent cold-boot recovery.

---

## 2. Memory Architecture Overview

### Trait-Based Pluggable Design

The core abstraction is the `Memory` trait (~20 methods), implemented by 6 backends:

| Backend | Storage | Search | Delete | Lines | Use Case |
|---------|---------|--------|--------|-------|----------|
| **SQLite** | Local file (`brain.db`) | Hybrid (vector + FTS5 keyword) | ✅ | 1,900 | Default — production-grade |
| **Lucid** | SQLite + external CLI | Hybrid + external memory | ✅ | 675 | Scale-out (larger memory pools) |
| **Qdrant** | Distributed vector DB | Pure semantic (cosine) | ✅ | 642 | Cloud deployments |
| **Postgres** | Remote SQL | SQL queries | ✅ | 393 | Enterprise |
| **Markdown** | Append-only `.md` files | Linear keyword scan | ❌ | 355 | Git-friendly audit trail |
| **None** | /dev/null | No-op | No-op | 65 | Disable persistence |

Backend selection is config-driven (`[memory] backend = "sqlite"`), resolved at startup via a factory function. All backends implement the same trait so the agent loop is completely backend-agnostic.

### Memory Categories (4 tiers)

```rust
enum MemoryCategory {
    Core,          // Permanent — user preferences, project facts, identity
    Daily,         // Expires after 24h — today's context
    Conversation,  // Session-scoped — tied to a specific conversation
    Custom(String) // User-defined (SOPs, project metadata, etc.)
}
```

Session scoping is enforced at the backend level — conversation memories from session A are invisible in session B.

### Data Model

```rust
struct MemoryEntry {
    id: String,                    // UUID
    key: String,                   // Lookup key (upsert identifier)
    content: String,               // The actual data (free text)
    category: MemoryCategory,      // Core|Daily|Conversation|Custom
    timestamp: String,             // RFC3339
    session_id: Option<String>,    // Session scope
    score: Option<f64>,            // Relevance score (0-100)
}
```

Key insight: The `key` field is an **upsert identifier** — storing with the same key replaces the previous entry (in SQLite/Postgres/Qdrant). In Markdown, it appends (no updates, audit trail by design).

---

## 3. Storage: SQLite Backend Deep Dive (1,900 lines)

The SQLite backend is a full-stack search engine — not just a key-value store.

### Database Schema

```sql
CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'core',
    embedding BLOB,           -- Serialized f32 vector
    session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- FTS5 virtual table for BM25 keyword search
CREATE VIRTUAL TABLE memories_fts USING fts5(key, content, content=memories, content_rowid=rowid);

-- Auto-sync triggers (insert/update/delete keep FTS5 in sync)
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, key, content) VALUES (new.rowid, new.key, new.content);
END;

-- Embedding cache (avoids redundant API calls)
CREATE TABLE embedding_cache (
    content_hash TEXT PRIMARY KEY,   -- SHA-256 of content
    embedding BLOB NOT NULL,
    created_at TEXT NOT NULL
);
```

### PRAGMA Tuning (Production-Optimized)

```sql
PRAGMA journal_mode = WAL;      -- Concurrent reads during writes
PRAGMA synchronous = NORMAL;     -- 2x speed, still crash-safe
PRAGMA mmap_size = 8388608;     -- 8MB memory-mapped I/O
PRAGMA cache_size = -2000;      -- 2MB in-process cache
PRAGMA temp_store = MEMORY;     -- Temp tables in RAM
```

These PRAGMAs are significant — WAL mode is critical for an agent that reads and writes memory concurrently (e.g., storing a memory while recalling context for the next message).

### Hybrid Search Algorithm

The recall path combines two search strategies:

1. **BM25 Keyword Search** — FTS5 `MATCH` query, normalized score
2. **Vector Cosine Similarity** — Embedding dot product, [0,1] range
3. **Weighted Fusion**:

```
final_score = vector_weight × cosine_sim + keyword_weight × normalized_bm25
```

Default weights: **0.7 vector + 0.3 keyword** (configurable).

The hybrid approach is crucial: pure vector search misses exact matches ("Rust" vs semantic "programming language"), while pure keyword search misses semantic relationships ("memory management" should find entries about "garbage collection").

### Embedding Cache

- **Key**: SHA-256 hash of content text → deterministic, no duplicates
- **Storage**: Same SQLite database, separate table
- **Eviction**: LRU-based, configurable max size
- **Purpose**: Embedding API calls are slow (100-500ms) and costly. Cache avoids recomputing embeddings for content that hasn't changed.

### Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Store (upsert) | ~1-5ms | Plus embedding computation if enabled (~100-500ms) |
| Recall (keyword, 1000 entries) | ~5-10ms | FTS5 is very fast |
| Recall (vector cosine, 1000 entries) | ~50-200ms | Depends on embedding dimensions |
| Get by key | ~1ms | Direct index lookup |
| Forget (delete) | ~1ms | Cascades to FTS5 via triggers |

---

## 4. Retrieval: How Memories Are Found

### Agent Loop Integration

Memory is injected **before every message** in the agent loop:

```
1. User sends message
2. Agent loop calls mem.recall(user_message, limit=5, session_id)
3. Results filtered: score ≥ 0.4 threshold
4. Relevant memories injected as context block:
   "[Relevant memories]\n- [core] user_lang: User prefers Rust [98%]\n- [core] editor: Uses VS Code [92%]"
5. System prompt + memory context + user message → LLM
```

This is **automatic** — the agent doesn't need to use the `memory_recall` tool for basic context. The tool exists for explicit, user-directed recall queries.

### Memory Context Format

Memories are formatted as a structured text block injected into the conversation:

```
[Relevant memories]
- [core] user_lang: User prefers Rust [98%]
- [daily] meeting_notes: Standup at 9am PST [85%]
- [conversation] last_topic: Discussing memory architecture [72%]
```

The category tags and relevance scores give the LLM signal about memory reliability and scope.

### Recall Limit and Budget

- Default limit: **5 memories** per message
- Score threshold: **0.4** (40%) — below this, memories are dropped as noise
- No explicit token budget — limit count is the proxy for context budget
- This is notable: there's no explicit "context window budget" calculation. The limit of 5 means ~500-1000 tokens of memory context per turn, which is a practical heuristic rather than a precise budget.

---

## 5. Memory Creation: How Memories Are Made

### Automatic Memory (Implicit)

The agent loop automatically stores user messages as conversation memories:

```
1. User message received
2. If message.len() >= 20 characters:
3.   mem.store("user_msg_{timestamp}", message, Conversation, session_id)
```

This creates a **conversational log** that can be recalled in future turns. The 20-character threshold filters out "yes", "ok", "thanks" etc.

### Explicit Memory (Agent Tools)

Three tools exposed to the LLM:

**memory_store** — Agent decides something is worth remembering:
```json
{
  "key": "user_lang_preference",
  "content": "User prefers Rust and dislikes Python",
  "category": "core"
}
```

**memory_recall** — Agent explicitly searches memory:
```json
{
  "query": "user programming preferences",
  "limit": 5
}
```

**memory_forget** — Agent deletes a memory:
```json
{
  "key": "temp_session_data"
}
```

### Security Controls

Memory operations respect a `SecurityPolicy`:
- **Readonly mode**: Blocks store/forget operations
- **Rate limiting**: Prevents rapid-fire memory writes
- **Content scrubbing**: Removes tokens, passwords, API keys from content before storage

---

## 6. Memory Lifecycle Management

### Hygiene System (Every 12 Hours)

ZeroClaw runs a periodic hygiene pass that manages memory lifecycle:

1. **Archive**: Move old Daily memories to a historical table
2. **Purge**: Delete Conversation memories from expired sessions
3. **Prune**: Remove Core memories not accessed in >90 days (configurable)
4. **Snapshot**: Export Core memories to `MEMORY_SNAPSHOT.md` (if enabled)
5. **Compact**: VACUUM the SQLite database

The hygiene system ensures memory doesn't grow unbounded while preserving important long-term knowledge.

### Conversation Compaction (Auto-Summarization)

When conversation history exceeds **50 messages**:

1. Take messages 0..N-20 (everything except the last 20)
2. Send to LLM with summarization prompt
3. Store summary as a Core memory: `"conversation_summary_{timestamp}"`
4. Truncate history to last 20 messages
5. Summary is recalled in future turns via normal memory search

This is a critical pattern: it converts ephemeral conversation into durable knowledge while keeping the active context window bounded.

### Snapshot & Cold-Boot Recovery

**Export** (on hygiene pass if `snapshot_on_hygiene=true`):
- Exports **Core memories only** to `MEMORY_SNAPSHOT.md` in workspace root
- Human-readable markdown format
- Git-friendly (can be committed, diffed, reviewed)

**Auto-Hydration** (on startup if `auto_hydrate=true`):
- **Trigger**: `brain.db` missing/empty AND `MEMORY_SNAPSHOT.md` exists
- **Process**: Parse markdown → create fresh DB → re-index FTS5
- **Embeddings**: Re-computed on next recall (cache miss)
- **Transparent**: No manual intervention needed

This is the "soul backup" pattern — the agent's accumulated knowledge survives catastrophic data loss as long as the markdown file exists. Since it's Git-friendly, it can even be version-controlled.

---

## 7. Advanced: Lucid Bridge Pattern

The Lucid backend is architecturally interesting — it's a **hybrid local + external memory** system:

```
┌──────────────────────────────┐
│         Lucid Backend        │
│                              │
│  ┌────────┐    ┌──────────┐ │
│  │ SQLite  │    │ Lucid CLI │ │
│  │ (local) │    │ (external)│ │
│  └────────┘    └──────────┘ │
│       ↕              ↕       │
│  Primary          Secondary  │
│  (authoritative)  (optional) │
└──────────────────────────────┘
```

### Smart Latency Optimization

On recall:
1. Query local SQLite first
2. If results ≥ threshold (default 3): **return immediately** (skip Lucid)
3. Else: Query Lucid in parallel (500ms timeout)
4. Merge results (deduplicate by key+content)
5. On Lucid failure: Enter **15-second cooldown** (circuit breaker)

This is a "local cache with external fallback" pattern. The local hit threshold is the key insight — if local memory answers the question, avoid the network round-trip entirely.

### Async Sync

Stores write to both SQLite and Lucid, but the Lucid write is **async and non-blocking**. If Lucid is down, the store succeeds locally and the data syncs later. This means the agent never blocks on external memory operations.

---

## 8. RAG System (Separate from Memory)

ZeroClaw has a **separate RAG system** (src/rag/) that is NOT part of the memory trait:

- **Purpose**: Hardware documentation retrieval (ZeroClaw supports embedded/IoT)
- **Chunking**: Markdown headings → paragraphs → lines (~512 tokens/chunk)
- **Search**: Pure keyword matching (NOT embeddings) — simpler than the memory system
- **Loading**: At startup, reads `.md` files from a docs directory
- **Injection**: Chunks injected as `[Hardware documentation]` in system prompt

The RAG system is interesting as a contrast — it's read-only (no write path), keyword-only (no vectors), and loaded at boot (not real-time). For a documentation retrieval use case, this simpler approach works well.

---

## 9. SOP System and Memory

SOPs (Standard Operating Procedures) are TOML+Markdown automation scripts:

```toml
[sop]
name = "deploy"
trigger = "deploy to production"
cooldown = 300  # 5 minutes between runs

[[steps]]
instruction = "Run tests first"
tool = "shell"
args = { command = "cargo test" }
```

SOPs interact with memory:
- **Gate state**: Stored in Core memory (which step the SOP is on)
- **Metrics**: Execution time, success/failure stored as Daily memories
- **Audit log**: SOP executions logged to memory for traceability

This is a "memory as state machine" pattern — SOPs use memory to persist their execution state across agent restarts.

---

## 10. Key Design Patterns for Flightdeck

### Pattern 1: Hybrid Search (Vector + Keyword)

**Problem**: Pure vector search misses exact matches; pure keyword misses semantic relationships.  
**Solution**: Combine both with tunable weights (default 0.7/0.3).  
**Flightdeck relevance**: HIGH — any knowledge system should use hybrid search.

### Pattern 2: Memory Categories with Lifecycle Rules

**Problem**: All memories are not equal. Some are permanent, some are ephemeral.  
**Solution**: 4 categories (Core, Daily, Conversation, Custom) with different TTLs and hygiene rules.  
**Flightdeck relevance**: HIGH — agents need both permanent project knowledge and ephemeral session context.

### Pattern 3: Automatic Memory Injection

**Problem**: Agents forget context between turns.  
**Solution**: Auto-recall relevant memories before every message, inject as context block.  
**Flightdeck relevance**: CRITICAL — this is the #1 pattern to adopt. Agents should automatically get relevant project knowledge injected into their system prompt.

### Pattern 4: Conversation Compaction

**Problem**: Long conversations exceed context windows.  
**Solution**: Auto-summarize old messages, store summary as durable memory, keep recent N messages.  
**Flightdeck relevance**: HIGH — our agents already struggle with long sessions. Compaction → durable memory is the right approach.

### Pattern 5: Snapshot Cold-Boot Recovery

**Problem**: Database corruption or deletion loses all agent knowledge.  
**Solution**: Export Core memories to Git-friendly markdown; auto-hydrate on empty DB.  
**Flightdeck relevance**: MEDIUM — valuable for disaster recovery, but our SQLite is already WAL-mode.

### Pattern 6: Lucid's Circuit Breaker

**Problem**: External memory services can be slow or down.  
**Solution**: Local-first with threshold-based external fallback + cooldown on failure.  
**Flightdeck relevance**: HIGH if we add external memory — never block the agent on network I/O.

### Pattern 7: Embedding Cache

**Problem**: Embedding API calls are expensive (time + money).  
**Solution**: SHA-256 content hash → cached embedding. LRU eviction.  
**Flightdeck relevance**: HIGH — if we use embeddings, this is essential.

### Pattern 8: Content Scrubbing Before Storage

**Problem**: Agents might store secrets/tokens in memory.  
**Solution**: Scrub known patterns (API keys, tokens, passwords) before persisting.  
**Flightdeck relevance**: CRITICAL — we already have R12 (secret redaction). Memory should go through the same pipeline.

---

## 11. Architectural Comparison: ZeroClaw vs Gastown vs Squad

| Feature | ZeroClaw | Gastown | Squad |
|---------|----------|---------|-------|
| **Language** | Rust | Go | TypeScript |
| **Memory storage** | SQLite (hybrid search) | Git worktrees (markdown) | Markdown files |
| **Search** | Vector + FTS5 keyword | Git grep | Direct file read |
| **Categories** | Core/Daily/Conversation/Custom | Per-worktree state | Per-session markdown |
| **Lifecycle** | 12h hygiene + compaction | Git GC | None (append-only) |
| **Embeddings** | Yes (OpenAI/local) | No | No |
| **Recovery** | Snapshot → auto-hydrate | Git history | File system |
| **Agent count** | 1 (single agent) | 20-50+ | 2-10 |
| **Budget mgmt** | Limit count (5) | Token counting | None |

**Key insight**: ZeroClaw is the most sophisticated memory system of the three, but it's designed for a single-agent runtime. Flightdeck needs to handle **multi-agent memory** — shared knowledge + per-agent context — which none of these systems address directly.

---

## 12. Recommendations for Flightdeck

### Must-Have (adopt directly)
1. **Hybrid search** (vector + keyword) for knowledge retrieval
2. **Memory categories** (project-permanent, session-scoped, agent-scoped)
3. **Auto-injection** of relevant knowledge into agent system prompts
4. **Content scrubbing** before memory persistence (integrate with R12 secret redaction)

### Should-Have (adapt for multi-agent)
5. **Conversation compaction** → store summaries as project knowledge
6. **Embedding cache** with SHA-256 keying
7. **Hygiene cycle** for memory lifecycle management
8. **Snapshot export** (Git-friendly knowledge backup)

### Could-Have (explore later)
9. **Lucid-style bridge** for external knowledge bases
10. **SOP-like automation** using memory as state machine
11. **Per-agent memory scoping** (agents can have private + shared memories)

### Unique Flightdeck Challenge: Multi-Agent Memory
None of the researched systems handle multi-agent shared memory. Flightdeck needs:
- **Shared project knowledge** (all agents can read/write)
- **Agent-private memory** (personal context, working notes)
- **Cross-session persistence** (knowledge survives session boundaries)
- **Conflict resolution** (two agents update the same memory)
- **Access control** (who can read/write what)

This is architecturally novel — the closest analog is a shared database with row-level security, which is exactly what SQLite + categories + agent_id scoping could provide.

---

## 13. Implementation Sketch for Flightdeck Knowledge System

Based on all three research reports (ZeroClaw + Gastown + Squad), here's a rough architecture:

```
┌─────────────────────────────────────┐
│         Knowledge Service           │
│  (singleton, registered in DI)      │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────┐  ┌────────────────┐  │
│  │ Store API │  │ Recall API     │  │
│  │ (write)   │  │ (hybrid search)│  │
│  └──────────┘  └────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Memory Categories:            │  │
│  │  • Project (shared, permanent)│  │
│  │  • Session (shared, scoped)   │  │
│  │  • Agent (private, scoped)    │  │
│  │  • Custom (SOP state, etc.)   │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ SQLite Backend                │  │
│  │  • FTS5 for keyword search    │  │
│  │  • Embedding BLOB for vectors │  │
│  │  • WAL mode for concurrency   │  │
│  │  • Scrubbing pipeline (R12)   │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Lifecycle Manager             │  │
│  │  • Session cleanup on end     │  │
│  │  • Compaction (long sessions) │  │
│  │  • Snapshot export (to docs/) │  │
│  │  • Hygiene (prune old entries)│  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

This could be implemented as a new `packages/server/src/knowledge/` directory, registered as a Tier 3 singleton in the DI container (R1 pattern), with the memory table added to our existing Drizzle schema.

---

*Research completed by Architect agent (f9a74593)*
