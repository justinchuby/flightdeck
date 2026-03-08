# OpenClaw Memory System — Research Report

**Project:** [OpenClaw](https://github.com/nichochar/openclaw) (formerly Clawdbot/Moldbot/Moltbot)
**Explored:** `/Users/justinc/Documents/GitHub/openclaw`
**Focus:** Memory/knowledge system architecture for Flightdeck inspiration
**Author:** Architect Agent (a77e1782)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Memory System Architecture](#2-memory-system-architecture)
3. [Data Model & Storage](#3-data-model--storage)
4. [Memory Creation & Lifecycle](#4-memory-creation--lifecycle)
5. [Retrieval: Hybrid Search Pipeline](#5-retrieval-hybrid-search-pipeline)
6. [Temporal Decay & MMR Diversification](#6-temporal-decay--mmr-diversification)
7. [Embedding Providers](#7-embedding-providers)
8. [Query Expansion (Multilingual)](#8-query-expansion-multilingual)
9. [Memory Flush (Pre-Compaction)](#9-memory-flush-pre-compaction)
10. [Session Memory](#10-session-memory)
11. [QMD Alternative Backend](#11-qmd-alternative-backend)
12. [Agent Tools](#12-agent-tools)
13. [Configuration](#13-configuration)
14. [What Flightdeck Can Learn](#14-what-flightdeck-can-learn)
15. [Key Metrics & Defaults](#15-key-metrics--defaults)

---

## 1. Project Overview

OpenClaw is a **personal AI assistant** (~18.8K LoC in `src/memory/`, ~56 files) with multi-channel integration (Slack, Discord, Telegram, SMS, Web, CLI). Its vision: *"The AI that actually does things. It runs on your devices, in your channels, with your rules."*

**Architecture principles:**
- Terminal-first setup with explicit security posture
- Plugins over core features — core stays lean
- Memory as a plugin slot (one backend active at a time)
- Skills published externally on "ClawHub", not bundled in core
- MCP via mcporter bridge, not first-class runtime

**Key tech stack:** TypeScript, SQLite (via better-sqlite3), sqlite-vec (vector search), FTS5 (full-text search), Chokidar (file watching), multiple embedding providers.

**Memory system codebase:**
| Component | File | Lines |
|-----------|------|-------|
| Schema | `memory-schema.ts` | 97 |
| Types | `types.ts` | 81 |
| Hybrid Search | `hybrid.ts` | 150 |
| Temporal Decay | `temporal-decay.ts` | 168 |
| MMR | `mmr.ts` | 215 |
| Search Manager | `manager-search.ts` | 192 |
| Sync Operations | `manager-sync-ops.ts` | 1,240 |
| Embeddings | `embeddings.ts` | 323 |
| Query Expansion | `query-expansion.ts` | 811 |
| Memory Tools | `memory-tool.ts` | 243 |
| Memory Config | `types.memory.ts` | 68 |

---

## 2. Memory System Architecture

### High-Level Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Memory Files   │────▶│  Sync Engine     │────▶│  SQLite Database   │
│  MEMORY.md      │     │  (Chokidar watch │     │  ┌──────────────┐  │
│  memory/*.md    │     │   + 5s debounce) │     │  │ chunks       │  │
│                 │     │  Chunking (400t)  │     │  │ chunks_vec   │  │
│  (Append-only   │     │  Embedding        │     │  │ chunks_fts   │  │
│   Markdown)     │     │                   │     │  │ files        │  │
└─────────────────┘     └──────────────────┘     │  │ embedding_   │  │
                                                  │  │   cache      │  │
┌─────────────────┐     ┌──────────────────┐     │  └──────────────┘  │
│  Agent Query    │────▶│  Search Pipeline │────▶│                    │
│  memory_search  │     │  1. Query expand │     └────────────────────┘
│  memory_get     │     │  2. Vector search│
│                 │     │  3. FTS search   │
│                 │     │  4. Hybrid merge │
│                 │     │  5. Temporal decay│
│                 │     │  6. MMR rerank   │
│                 │     │  7. Score filter │
│                 │     └──────────────────┘
│                 │
│  Memory Flush   │◀─── Pre-compaction trigger
│  (silent turn)  │     at ~contextWindow - 4000 tokens
└─────────────────┘
```

### Design Philosophy

1. **Markdown-first**: All memory is plain `.md` files — human-readable, git-friendly, portable
2. **Hybrid search**: Vector similarity (semantic) + BM25 keyword search, weighted 70/30
3. **Lazy indexing**: Files synced on session start, on search, or via file watcher
4. **Graceful degradation**: No embeddings? Falls back to FTS-only. No sqlite-vec? In-memory cosine.
5. **Per-agent isolation**: Each agent gets its own SQLite DB keyed by agentId

---

## 3. Data Model & Storage

### SQLite Schema (6 tables)

```sql
-- Metadata key-value store
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Tracks: schema_version, last_sync_at

-- Indexed files with content hashes
CREATE TABLE files (
  path        TEXT PRIMARY KEY,
  contentHash TEXT NOT NULL,     -- Detects changes without re-reading
  updatedAt   INTEGER NOT NULL,  -- Unix epoch ms
  chunkCount  INTEGER NOT NULL DEFAULT 0
);

-- Text chunks with position tracking
CREATE TABLE chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filePath   TEXT NOT NULL,     -- FK to files.path
  chunkIndex INTEGER NOT NULL,  -- Position within file
  content    TEXT NOT NULL,      -- Raw chunk text
  startLine  INTEGER,           -- Source line tracking
  endLine    INTEGER,
  embedding  BLOB,              -- Float32 vector as binary blob
  UNIQUE(filePath, chunkIndex)
);

-- Virtual table: vector search (sqlite-vec extension)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[1536]         -- Dimension matches provider (1536 for OpenAI)
);

-- Virtual table: FTS5 full-text search
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id'
);

-- Embedding cache (avoids re-embedding identical content)
CREATE TABLE embedding_cache (
  key       TEXT PRIMARY KEY,   -- hash(provider + model + content)
  embedding BLOB NOT NULL,
  createdAt INTEGER NOT NULL
);
```

### Storage Location

- **Per-agent**: `~/.openclaw/memory/{agentId}.sqlite`
- **Override**: `agents.defaults.memorySearch.store.path` with `{agentId}` placeholder
- **State dir**: `~/.openclaw/` (or `OPENCLAW_STATE_DIR` env var)
- **Legacy paths**: `.clawdbot`, `.moldbot`, `.moltbot` (auto-detected)

### Memory Files (Source of Truth)

- **`MEMORY.md`** — Evergreen long-term memory (never decayed)
- **`memory/YYYY-MM-DD.md`** — Daily running logs (append-only)
- **Session transcripts** — Optional, markdown export of conversations
- No template shipped — freeform markdown, model decides structure

---

## 4. Memory Creation & Lifecycle

### Creation Pathways

| Pathway | Trigger | Mechanism |
|---------|---------|-----------|
| **Model-initiated** | Agent decides to remember | Writes to `memory/YYYY-MM-DD.md` via tool |
| **Memory flush** | Pre-compaction (~104k tokens) | Silent turn with flush prompt (see §9) |
| **Manual** | User edits `MEMORY.md` | File watcher picks up changes |

### Sync Engine (`manager-sync-ops.ts`, 1,240 lines)

The sync engine is the workhorse — it watches files, chunks content, computes embeddings, and updates the index.

**`runSync()` flow:**
1. Scan memory directory for `.md` files
2. Hash each file's content
3. Compare with `files` table — skip unchanged files
4. For changed/new files:
   a. Split into chunks (~400 tokens, 80-token overlap, line-boundary)
   b. Compute embeddings for each chunk
   c. Insert into `chunks`, `chunks_vec`, `chunks_fts`
   d. Update `files` table
5. Delete chunks for removed files
6. Update `meta.last_sync_at`

**Sync triggers:**
- `onSessionStart: true` — sync when agent starts
- `onSearch: true` — sync before search queries
- `watch: true` — Chokidar file watcher with 5s debounce
- `intervalMinutes` — periodic re-sync

**Chunking algorithm:**
- Target: ~1,600 chars (~400 tokens)
- Overlap: ~320 chars (~80 tokens)
- Split on line boundaries (never mid-line)
- Each chunk tracks `startLine`/`endLine` for citations

### Lifecycle States

```
File Created → Detected (watcher/scan) → Chunked → Embedded → Indexed
     ↓                                                    ↓
File Modified → Re-hashed → Re-chunked → Re-embedded → Re-indexed
     ↓
File Deleted → Chunks removed → Vectors removed → FTS removed
```

**No explicit decay/deletion of memories** — temporal decay only affects *search scoring*, not storage. Old memories remain forever unless manually deleted.

---

## 5. Retrieval: Hybrid Search Pipeline

### Pipeline Stages

```
Query → [Query Expand] → [Vector Search] + [FTS Search] → [Hybrid Merge]
     → [Temporal Decay] → [MMR Rerank] → [Score Filter] → Results
```

### Stage 1: Query Expansion (`query-expansion.ts`)

```typescript
// Input: "that thing we discussed yesterday"
// Keywords: ["discussed"] (removes stop words, vague references)
// Expanded: '"that thing we discussed yesterday" OR "discussed"'
```

- Tokenizes query (multilingual: EN, ES, PT, AR, KO, JA, ZH)
- Filters stop words (150+ English, plus 6 other languages)
- Removes invalid tokens (short ASCII, pure numbers, punctuation-only)
- Builds FTS5 OR query with original + extracted keywords
- Optional LLM-based expansion (falls back to local if unavailable)

**CJK handling:**
- Chinese: Character n-grams (unigrams + bigrams)
- Japanese: Script-specific chunks (kanji/kana/ASCII)
- Korean: Word + particle stripping

### Stage 2: Vector Search (`manager-search.ts`)

```sql
SELECT id, distance
FROM chunks_vec
WHERE embedding MATCH ?  -- Query embedding vector
ORDER BY distance
LIMIT ?                   -- maxResults × candidateMultiplier (default: 24)
```

- Converts distance to score: `score = 1 - distance` (cosine similarity)
- Uses sqlite-vec extension for efficient vector nearest-neighbor
- **Fallback**: If sqlite-vec unavailable, loads ALL embeddings and computes cosine in-memory

### Stage 3: FTS Search (`manager-search.ts`)

```sql
SELECT rowid, rank
FROM chunks_fts
WHERE chunks_fts MATCH ?  -- Expanded query string
ORDER BY rank
LIMIT ?                    -- maxResults × candidateMultiplier
```

- BM25 scoring via FTS5's built-in ranking
- Score normalization: `1 / (1 + |rank|)` maps BM25 rank [0,∞] → score [1.0, 0.5]

### Stage 4: Hybrid Merge (`hybrid.ts`)

```typescript
function mergeHybridResults(
  vectorResults: ScoredChunk[],
  ftsResults: ScoredChunk[],
  vectorWeight = 0.7,
  textWeight = 0.3,
  maxResults: number
): ScoredChunk[] {
  // Merge by chunk ID
  // hybridScore = vectorWeight × vecScore + textWeight × txtScore
  // If chunk only in one source, other score = 0
  // Sort by hybridScore descending
  // Return top maxResults
}
```

**Default weights:** 70% vector (semantic) + 30% keyword (BM25)

### Stage 5-7: See sections below

---

## 6. Temporal Decay & MMR Diversification

### Temporal Decay (`temporal-decay.ts`)

**Purpose:** Reduce relevance of older memories so recent context is preferred.

**Formula:**
```
decayedScore = score × e^(-λ × ageDays)
where λ = ln(2) / halfLifeDays
```

**Configuration:**
- `enabled: false` (off by default)
- `halfLifeDays: 30` (score halves every 30 days)
- `referenceDate`: defaults to now

**Special handling:**
- **Evergreen files** (`MEMORY.md`, files NOT matching `memory/YYYY-MM-DD.md`): **Never decayed**
- Date extraction: Regex on `memory/YYYY-MM-DD.md` filename pattern
- Files without dates: treated as evergreen (no decay)

**Example:** A memory from 60 days ago with score 0.8:
```
decayedScore = 0.8 × e^(-0.0231 × 60) = 0.8 × 0.25 = 0.20
```

### MMR Diversification (`mmr.ts`)

**Purpose:** Prevent redundant results (e.g., 5 chunks from the same section).

**Algorithm:** Maximal Marginal Relevance (greedy selection)

```
MMR(d) = λ × relevance(d) - (1-λ) × max_similarity(d, already_selected)
```

**Similarity metric:** Jaccard token similarity (case-insensitive word overlap)

```typescript
function jaccardTokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

**Configuration:**
- `enabled: false` (off by default)
- `lambda: 0.7` (70% relevance, 30% diversity)

---

## 7. Embedding Providers

### 6 Providers with Auto-Selection

| Provider | Model | Dimensions | Notes |
|----------|-------|-----------|-------|
| **OpenAI** | `text-embedding-3-small` | 1536 | Default, requires API key |
| **Gemini** | `text-embedding-004` | 768 | Google AI Studio key |
| **Voyage** | `voyage-3-lite` | 1024 | Voyage AI key |
| **Mistral** | `mistral-embed` | 1024 | Mistral AI key |
| **Ollama** | configurable | varies | Local, requires running Ollama |
| **Local** | GGUF via node-llama-cpp | varies | Fully offline, downloads model |

### Auto-Selection Logic

```
Try: local → openai → gemini → voyage → mistral → ollama
Pick first with available credentials
```

**Fallback chain:**
1. If no embedding provider available → **FTS-only mode** (keyword search only)
2. If sqlite-vec unavailable → **In-memory cosine** (loads all embeddings, computes manually)

### Embedding Cache

```sql
-- key = hash(provider + model + contentText)
INSERT OR IGNORE INTO embedding_cache (key, embedding, createdAt)
VALUES (?, ?, ?);
```

- Avoids re-embedding identical content across syncs
- Keyed by `provider + model + content hash` — provider change invalidates cache
- No TTL — cache entries persist indefinitely

### Vector Sanitization

```typescript
function sanitizeAndNormalizeEmbedding(vec: number[]): number[] {
  // 1. Replace NaN/Infinity with 0
  // 2. L2-normalize to unit vector
  // magnitude < 1e-10 → return as-is (zero vector)
}
```

---

## 8. Query Expansion (Multilingual)

The query expansion system (`query-expansion.ts`, 811 lines) is notably sophisticated:

### Supported Languages

| Language | Approach | Stop Words |
|----------|----------|-----------|
| English | Whitespace + punctuation split | 150+ words |
| Spanish | Whitespace + punctuation split | ~100 words |
| Portuguese | Whitespace + punctuation split | ~100 words |
| Arabic | Whitespace + punctuation split | ~80 words |
| Korean | Word + particle stripping | Particles + trailing |
| Japanese | Script-specific chunks (kanji/kana/ASCII) | Auxiliaries, particles |
| Chinese | Character n-grams (unigrams + bigrams) | Articles, verbs, time refs |

### Keyword Validation

```typescript
function isValidKeyword(token: string): boolean {
  if (!token) return false;
  if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;  // Short ASCII
  if (/^\d+$/.test(token)) return false;                             // Pure numbers
  if (/^[\p{P}\p{S}]+$/u.test(token)) return false;                 // Punctuation only
  return true;
}
```

### LLM-Assisted Expansion

Optional: sends query to LLM for synonym/concept expansion, falls back to local extraction if LLM is unavailable or slow.

---

## 9. Memory Flush (Pre-Compaction)

**File:** `src/auto-reply/reply/memory-flush.ts`

### Trigger Conditions

The flush fires when **either** condition is met:
1. **Token threshold**: session tokens ≥ `contextWindow - reserveTokensFloor - softThresholdTokens`
2. **Byte threshold**: transcript size ≥ `forceFlushTranscriptBytes` (default: 2MB)

**Guard**: Only runs once per compaction cycle (`memoryFlushCompactionCount` tracker).

### Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `softThresholdTokens` | 4,000 | Tokens before context limit to trigger |
| `forceFlushTranscriptBytes` | 2 MB | Transcript size hard limit |

### Flush Prompt (sent as user message in silent turn)

```
Pre-compaction memory flush. Store durable memories now
(use memory/YYYY-MM-DD.md; create memory/ if needed).
IMPORTANT: If the file already exists, APPEND new content only —
do not overwrite existing entries.
Do NOT create timestamped variant files (e.g., YYYY-MM-DD-HHMM.md);
always use the canonical YYYY-MM-DD.md filename.
If nothing to store, reply with [SILENT].
```

### System Prompt

```
Pre-compaction memory flush turn. The session is near auto-compaction;
capture durable memories to disk. You may reply, but usually [SILENT]
is correct.
```

### Flow

```
Context approaching limit
  → Check: flush already ran for this compaction cycle?
  → No → Inject silent turn with flush prompt
  → Model writes to memory/YYYY-MM-DD.md (append-only)
  → Model replies [SILENT] if nothing to store
  → Compaction proceeds normally
```

**Key insight:** The flush happens *before* compaction, giving the model a chance to persist anything important from the context that's about to be summarized/discarded.

---

## 10. Session Memory

### Configuration

```typescript
agents.defaults.memorySearch.experimental.sessionMemory: boolean  // default: false
agents.defaults.memorySearch.sources: ["memory"] | ["memory", "sessions"]
```

### How It Works

1. Session transcripts are automatically exported to markdown files
2. Export format: `.md` files in sessions directory
3. Delta sync: re-indexes when 100KB bytes or 50 messages change
4. Debounce: 5 seconds before re-indexing (`SESSION_DIRTY_DEBOUNCE_MS`)
5. Event-driven via `onSessionTranscriptUpdate`

### Why Off By Default

> "Indexes session transcripts into memory search so responses can reference prior chat turns. Keep this off unless transcript recall is needed, because indexing cost and storage usage both increase."

---

## 11. QMD Alternative Backend

### What is QMD?

[QMD](https://github.com/tobi/qmd) is a community markdown search & indexing tool — an alternative to the built-in SQLite memory backend.

### Comparison

| Feature | Built-in | QMD |
|---------|----------|-----|
| Storage | SQLite (in-process) | XDG-compliant index dirs |
| Search modes | Hybrid (vector+BM25) | 3 modes: `query`, `search`, `vsearch` |
| Collections | Fixed (memory + sessions) | Dynamic named collections |
| Session indexing | Auto delta sync | Export + collection registration |
| Performance | In-process (fast) | CLI spawn per search (slower) |
| Multi-collection | Single index | Multi-collection with scoping |
| MCP integration | N/A | Via mcporter bridge |

### Configuration

```yaml
memory:
  backend: "qmd"
  qmd:
    command: "qmd"
    searchMode: "search"
    includeDefaultMemory: true
    paths:
      - { path: "/path/to/docs", name: "docs", pattern: "**/*.md" }
    sessions:
      enabled: false
      exportDir: "/path/to/sessions"
      retentionDays: 30
    limits:
      maxResults: 6
      maxSnippetChars: 700
      maxInjectedChars: 10000
      timeoutMs: 4000
```

---

## 12. Agent Tools

### `memory_search`

```typescript
{
  query: string,            // Natural language search query
  maxResults?: number,      // Default: 6
  minScore?: number         // Default: 0.35
}
→ {
  results: MemorySearchResult[],  // { path, content, startLine, endLine, score }
  provider: string,               // Which embedding provider was used
  model: string,                  // Which model was used
  fallback?: { from, reason },    // If fell back from preferred provider
  citations: "auto"|"on"|"off"
}
```

**Description (shown to model):** *"Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos."*

**Error handling:**
- Missing provider → `{ results: [], disabled: true, unavailable: true, error, warning, action }`
- Quota errors → surface quota exhaustion message
- Other errors → generic embedding/provider error

### `memory_get`

```typescript
{
  path: string,     // Relative path to memory file
  from?: number,    // Start line
  lines?: number    // Number of lines
}
→ {
  path: string,
  text: string,     // File content (or slice)
  disabled?: boolean,
  error?: string
}
```

**Description:** *"Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small."*

### Citation Format

```
path/to/file#L10-L15    (range)
path/to/file#L10        (single line)
```

Modes: `auto` (show in DMs, suppress in groups), `on`, `off`

---

## 13. Configuration

### Full Memory Config Path

```
agents.defaults.memorySearch:
  ├── enabled: true
  ├── provider: "auto"    # openai|local|gemini|voyage|mistral|ollama|auto
  ├── model: null          # Override model per provider
  ├── sources: ["memory"]  # Add "sessions" for session indexing
  ├── extraPaths: []       # Additional dirs/files to index
  │
  ├── store:
  │   ├── driver: "sqlite"
  │   ├── path: "{stateDir}/memory/{agentId}.sqlite"
  │   └── vector:
  │       ├── enabled: true
  │       └── extensionPath: null
  │
  ├── chunking:
  │   ├── tokens: 400
  │   └── overlap: 80
  │
  ├── sync:
  │   ├── onSessionStart: true
  │   ├── onSearch: true
  │   ├── watch: true
  │   ├── watchDebounceMs: 5000
  │   ├── intervalMinutes: null
  │   └── sessions:
  │       ├── deltaBytes: 102400
  │       └── deltaMessages: 50
  │
  ├── query:
  │   ├── maxResults: 6
  │   ├── minScore: 0.35
  │   └── hybrid:
  │       ├── enabled: true
  │       ├── vectorWeight: 0.7
  │       ├── textWeight: 0.3
  │       ├── candidateMultiplier: 4
  │       ├── mmr: { enabled: false, lambda: 0.7 }
  │       └── temporalDecay: { enabled: false, halfLifeDays: 30 }
  │
  ├── cache:
  │   ├── enabled: true
  │   └── maxEntries: null
  │
  ├── remote:
  │   ├── baseUrl, apiKey, headers
  │   └── batch: { enabled, wait, concurrency, pollIntervalMs, timeoutMinutes }
  │
  ├── local:
  │   ├── modelPath: null
  │   └── modelCacheDir: null
  │
  └── experimental:
      └── sessionMemory: false

agents.defaults.compaction.memoryFlush:
  ├── enabled: true
  ├── softThresholdTokens: 4000
  ├── forceFlushTranscriptBytes: 2097152  # 2MB
  ├── prompt: "Pre-compaction memory flush..."
  └── systemPrompt: "Pre-compaction memory flush turn..."
```

---

## 14. What Flightdeck Can Learn

### 🔥 High-Priority Patterns

#### 1. **Memory Flush Before Compaction** (Most Transferable)

OpenClaw's pre-compaction flush is the single most valuable pattern for Flightdeck. When context approaches the limit, inject a silent turn telling the agent to persist durable memories *before* the context gets summarized.

**For Flightdeck:** We already do context compaction. Adding a memory flush turn before compaction would let agents preserve project knowledge that survives across sessions. The agent writes to `memory/YYYY-MM-DD.md`, which persists in the project workspace.

**Effort:** Low — it's a single function injected into the compaction pipeline.

#### 2. **Markdown-First Memory Storage**

Memories stored as plain `.md` files are human-readable, git-diffable, and trivially inspectable. The model writes freeform markdown; the system indexes it. No special format, no structured schema for the content itself.

**For Flightdeck:** Per-project memory files in the workspace (e.g., `.flightdeck/memory/`) that are plain markdown. Agents can write to them, humans can read/edit them, and they're version-controlled alongside the project.

#### 3. **Hybrid Search (Vector + Keyword)**

The 70/30 vector/keyword split is well-tuned. Vector catches semantic similarity; FTS catches exact matches (names, IDs, specific terms). Together they cover both "what was that thing about..." and "find references to ComponentX".

**For Flightdeck:** When we add memory search, use the same hybrid approach. SQLite + sqlite-vec + FTS5 is a proven stack that we already partially use (Flightdeck uses SQLite for activity logs).

#### 4. **Graceful Degradation Chain**

```
Full hybrid → FTS-only (no embeddings) → disabled (no DB)
sqlite-vec → in-memory cosine (no extension)
Preferred provider → fallback provider → FTS-only
```

Every component has a fallback. Memory never *breaks* — it just gets less smart.

**For Flightdeck:** Design memory features to degrade gracefully. If the user hasn't configured an embedding API key, fall back to keyword search. If no search at all, the system still works — it just doesn't remember.

### 📋 Medium-Priority Patterns

#### 5. **Per-Agent Memory Isolation**

Each agent gets its own SQLite database keyed by `agentId`. Prevents cross-contamination between agents with different contexts.

**For Flightdeck:** We could do per-project memory (more useful for our case, since multiple agents work on the same project). A shared project memory that all agents in a crew can write to and query.

#### 6. **Evergreen vs. Ephemeral Memory**

`MEMORY.md` is evergreen (never decayed). Daily logs (`memory/YYYY-MM-DD.md`) can have temporal decay. This distinction is smart — some knowledge is permanent (architecture decisions, conventions) while other knowledge fades (what we discussed last Tuesday).

**For Flightdeck:** Have a `CONVENTIONS.md` or `PROJECT_MEMORY.md` that's evergreen, plus session-dated logs for ephemeral context.

#### 7. **Embedding Cache**

Keyed by `provider + model + content hash`. Avoids re-embedding identical content across syncs. No TTL — indefinite cache.

**For Flightdeck:** Essential for cost control if using paid embedding APIs.

#### 8. **Citation Tracking**

Every search result includes `path`, `startLine`, `endLine`. Citations formatted as `path#L10-L15`. The agent can tell the user exactly *where* a memory came from.

**For Flightdeck:** When agents recall project knowledge, they should cite sources. Builds trust and makes memories verifiable.

### 💡 Nice-to-Have Patterns

#### 9. **Temporal Decay (Disabled by Default)**

Exponential decay with 30-day half-life. Smart to have it off by default — for project memory, old decisions are often *more* important than recent ones.

**For Flightdeck:** Probably not needed initially. Project conventions don't decay.

#### 10. **MMR Diversification (Disabled by Default)**

Prevents redundant search results using Jaccard token similarity. Useful when you have many similar chunks (e.g., multiple daily logs about the same topic).

**For Flightdeck:** Add later if search results become repetitive.

#### 11. **Multilingual Query Expansion**

Seven languages with custom tokenization. Impressive scope but probably overkill for Flightdeck's initial needs.

#### 12. **QMD Plugin Architecture**

The backend plugin slot (builtin vs. QMD) shows good extensibility. One active backend at a time, clean interface boundary.

**For Flightdeck:** Design memory with a pluggable backend from the start, even if we only implement one.

---

## 15. Key Metrics & Defaults

### Algorithm Parameters

| Algorithm | Formula | Default Parameters |
|-----------|---------|-------------------|
| **Hybrid Score** | `vectorWeight × vecScore + textWeight × txtScore` | 0.7 / 0.3 |
| **BM25 Normalization** | `1 / (1 + |rank|)` | Maps [0,∞] → [1.0, 0.5] |
| **Temporal Decay** | `score × e^(-λ × ageDays)`, λ = ln(2)/halfLife | 30-day half-life (disabled) |
| **MMR Selection** | `λ × relevance - (1-λ) × maxSim(d, selected)` | λ = 0.7 (disabled) |
| **Jaccard Similarity** | `|intersection| / |union|` | Token-based, case-insensitive |

### Operational Defaults

| Setting | Default | Notes |
|---------|---------|-------|
| Chunk size | 400 tokens (~1,600 chars) | Line-boundary splitting |
| Chunk overlap | 80 tokens (~320 chars) | Prevents context loss at boundaries |
| Max results | 6 | Per search query |
| Min score | 0.35 | Below this, results are filtered out |
| Candidate multiplier | 4 | Hybrid fetches 24 candidates, returns 6 |
| Watch debounce | 5 seconds | File change detection delay |
| Memory flush threshold | 4,000 tokens before limit | Soft threshold for pre-compaction flush |
| Memory flush size limit | 2 MB transcript | Hard limit triggers flush regardless |
| Embedding provider | Auto-select | local → openai → gemini → voyage → mistral → ollama |
| Session delta | 100 KB or 50 messages | Before re-indexing session transcripts |

---

## Appendix: Key Source Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/memory/memory-schema.ts` | SQLite DDL + schema migration | 97 |
| `src/memory/types.ts` | Core type definitions | 81 |
| `src/memory/hybrid.ts` | Hybrid merge algorithm | 150 |
| `src/memory/temporal-decay.ts` | Exponential decay scoring | 168 |
| `src/memory/mmr.ts` | MMR diversification | 215 |
| `src/memory/manager-search.ts` | Vector + FTS search execution | 192 |
| `src/memory/manager-sync-ops.ts` | File sync, chunking, embedding | 1,240 |
| `src/memory/embeddings.ts` | Multi-provider embedding abstraction | 323 |
| `src/memory/query-expansion.ts` | Multilingual query processing | 811 |
| `src/agents/tools/memory-tool.ts` | Agent-facing search/get tools | 243 |
| `src/config/types.memory.ts` | Memory configuration types | 68 |
| `src/auto-reply/reply/memory-flush.ts` | Pre-compaction flush trigger | ~150 |
