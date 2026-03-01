# Command Syntax

## The `⟦ ⟧` Fence

Agents communicate via structured commands embedded in their output. Commands use mathematical bracket syntax:

```
⟦ COMMAND_NAME {"key": "value"} ⟧
```

> [!NOTE]
> The characters `⟦` (U+27E6) and `⟧` (U+27E7) are mathematical white square brackets. They were chosen because they never appear in code, JSON, or natural language — eliminating false matches.

## Why Not `[[[ ]]]`?

The original `[[[ COMMAND {json} ]]]` syntax caused issues:
1. **Parser confusion**: `[[[` inside JSON payloads triggered false command matches
2. **UI rendering**: `[[[` in displayed content was misidentified as commands
3. **Nesting ambiguity**: Required complex tracking to distinguish real commands from text
| Never appears in code/JSON/markdown | ✅ | ✅ | ❌ (>>> in Python, git conflicts) | ❌ |
| Single char each (clean regex) | ✅ (1 char) | ✅ (1 char) | ❌ (multi-char) | ❌ |
| Visually distinct from `[` | ✅ (thick double bracket) | ✅ | ✅ | ❌ |
| Copy-paste safe | ✅ | ⚠️ (emoji skin-tone modifiers) | ✅ | ✅ |
| Terminal rendering | ✅ (all modern terminals) | ⚠️ (width issues) | ✅ (macOS only) | ✅ |
| LLM tokenizer | ✅ (1-2 tokens) | ⚠️ (variable tokens) | ✅ | ✅ |
| Keyboard accessible | ⚠️ (needs copy-paste) | ⚠️ | ⚠️ | ✅ |
| UTF-8 bytes | 3 each | 4 each | 3 each | 1 each |

**Runner-up:** `⌘{ }⌘` (U+2318) — clean but macOS-centric and overloaded with Mac's Cmd key meaning.

**Rejected:** Full emoji (🔧, 🤖, ⚡) — variable-width rendering in terminals, some tokenizers split them, skin-tone/ZWJ modifiers can corrupt them during copy-paste.

### New syntax

```
⟦ COMMIT {"message": "fix: something"} ⟧
⟦ CREATE_AGENT {"role": "developer", "task": "Build API"} ⟧
⟦ AGENT_MESSAGE {"to": "abc123", "content": "hello"} ⟧
```

## Is Backtick-Escaping Sufficient Instead?

**No.** Backtick-escaping (`\[\[\[` or `` `[[[` ``) has fundamental problems:

1. **Agents can't reliably escape**: LLMs don't consistently escape special syntax in their output. The whole point is that agents discuss `[[[` naturally.
2. **UI already solved this**: Our `isRealCommandBlock` fix handles display. But the server parser still needs `isInsideCommandBlock` string tracking.
3. **Doesn't eliminate the parser complexity**: We'd still need the JSON-string-aware scanner in CommandDispatcher.

The emoji fence **eliminates the entire category of problems** — `⟦` never appears in code, JSON, markdown, task descriptions, or natural language. Zero false matches. `isInsideCommandBlock` becomes unnecessary.

## Migration Path

### Phase 1: Dual syntax (backward compatible)

```typescript
// CommandDispatcher: accept BOTH old and new syntax
// Each command module's regex becomes:
const CREATE_AGENT_REGEX = /(?:\[\[\[|⟦)\s*CREATE_AGENT\s*(\{.*?\})\s*(?:\]\]\]|⟧)/s;
```

This is a mechanical regex change across ~50 patterns in 11 command modules. The `isInsideCommandBlock` guard stays active for `[[[` matches but is skipped for `⟦` matches (no ambiguity possible).

**Agent prompts updated** to show new syntax but mention old syntax still works:
```
Use ⟦ COMMAND {json} ⟧ syntax. Legacy [[[ ]]] also accepted.
```

### Phase 2: Prompt-only migration

Update `RoleRegistry.ts` prompts to use `⟦ ⟧` exclusively. Old syntax still parsed. Agents naturally start using new syntax because that's what they see in their prompt.

### Phase 3: Deprecate `[[[` (optional, months later)

Add a warning when `[[[` is used. Eventually remove the dual-regex patterns. At this point `isInsideCommandBlock` can be deleted entirely.

## Downsides & Mitigations

### 1. Unicode rendering on old terminals
**Risk:** `⟦` might render as `?` or a box on very old terminals.  
**Mitigation:** All terminals from the last 10 years support BMP Unicode (U+27E6 is Basic Multilingual Plane). VS Code, iTerm2, Windows Terminal, GNOME Terminal all render it correctly.

### 2. Keyboard input difficulty
**Risk:** Users can't type `⟦` directly (no standard keyboard shortcut).  
**Mitigation:** Users rarely type commands manually — agents generate them. For the rare manual case: copy-paste from docs, or use `[[[ ]]]` legacy syntax.

### 3. LLM tokenizer behavior
**Risk:** Some tokenizers might split `⟦` into multiple tokens or not recognize it.  
**Mitigation:** `⟦` (U+27E6) is a standard mathematical symbol in Unicode. GPT-4, Claude, and Gemini all handle it as 1-2 tokens. Test with each model before deploying.

### 4. Git diff noise
**Risk:** Initial migration commit changes many files.  
**Mitigation:** Phase 1 only changes regex patterns (mechanical, reviewable). No logic changes.

### 5. Incomplete command detection
**Risk:** `buf.lastIndexOf('[[[')` at line 141 of CommandDispatcher.ts needs to also check for `⟦`.  
**Mitigation:** Change to: `Math.max(buf.lastIndexOf('[[['), buf.lastIndexOf('⟦'))`.

## Implementation Effort

| Component | Files | Changes |
|-----------|-------|---------|
| Command regex patterns | 11 command modules | ~50 regex updates (mechanical) |
| CommandDispatcher.scanBuffer | 1 file | lastIndexOf dual-check |
| isInsideCommandBlock | 1 file | Skip for `⟦` matches |
| RoleRegistry prompts | 1 file | Update syntax examples |
| UI isRealCommandBlock | 2 files | Add `⟦` pattern |
| Tests | ~5 files | Add `⟦` variant tests |
| **Total** | ~20 files | ~2-3 hours for a developer |

## Decision

**Use `⟦ ⟧` (U+27E6/U+27E7).** It eliminates the entire class of bracket-parsing bugs at the source. Dual-syntax migration is safe and mechanical. The 10x win: delete `isInsideCommandBlock` entirely once `[[[` is deprecated.
