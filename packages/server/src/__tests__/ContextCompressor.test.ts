import { describe, it, expect } from 'vitest';
import { ContextCompressor, type Message } from '../agents/ContextCompressor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(count: number, role: Message['role'] = 'user', contentLength = 100): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role,
    content: `${'x'.repeat(contentLength)} message-${i}`,
    timestamp: Date.now() + i,
  }));
}

function makeConversation(pairs: number, contentLength = 100): Message[] {
  const msgs: Message[] = [{ role: 'system', content: 'You are a helpful assistant.' }];
  for (let i = 0; i < pairs; i++) {
    msgs.push({ role: 'user', content: `${'u'.repeat(contentLength)} turn-${i}` });
    msgs.push({ role: 'assistant', content: `${'a'.repeat(contentLength)} response-${i}` });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('ContextCompressor.estimateTokens', () => {
  it('returns reasonable approximation (4 chars ≈ 1 token)', () => {
    expect(ContextCompressor.estimateTokens('abcd')).toBe(1);
    expect(ContextCompressor.estimateTokens('abcde')).toBe(2); // ceil(5/4)
    expect(ContextCompressor.estimateTokens('')).toBe(0);
    expect(ContextCompressor.estimateTokens('a'.repeat(400))).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// estimateMessageTokens
// ---------------------------------------------------------------------------

describe('ContextCompressor.estimateMessageTokens', () => {
  it('sums content tokens plus 4 overhead per message', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'abcd' },    // ceil(4/4)+4 = 5
      { role: 'assistant', content: 'abcd' }, // ceil(4/4)+4 = 5
    ];
    expect(ContextCompressor.estimateMessageTokens(msgs)).toBe(10);
  });

  it('returns 0 for an empty array', () => {
    expect(ContextCompressor.estimateMessageTokens([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compress — no-op cases
// ---------------------------------------------------------------------------

describe('ContextCompressor.compress — no compression needed', () => {
  it('does nothing when token usage is under 70% of contextLimit', () => {
    const msgs = makeConversation(3, 50); // small conversation
    const { messages, result } = ContextCompressor.compress(msgs, 20, 100_000);
    expect(messages).toBe(msgs); // same reference — untouched
    expect(result.savedTokens).toBe(0);
    expect(result.originalCount).toBe(result.compressedCount);
  });

  it('does nothing when message count is within keepRecent + 2', () => {
    // keepRecent = 20, so threshold is 22 messages total
    const msgs = makeMessages(22);
    const { messages, result } = ContextCompressor.compress(msgs, 20, 1); // tiny limit but small count
    expect(messages).toBe(msgs);
    expect(result.savedTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compress — actual compression
// ---------------------------------------------------------------------------

describe('ContextCompressor.compress — active compression', () => {
  it('reduces message count for a large conversation', () => {
    // Create enough tokens to exceed 70% of the contextLimit
    const msgs = makeConversation(60, 600); // 121 messages, lots of tokens
    const { messages, result } = ContextCompressor.compress(msgs, 20, 10_000);

    expect(result.compressedCount).toBeLessThan(result.originalCount);
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(messages.length).toBeLessThan(msgs.length);
  });

  it('preserves all system messages at the front', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'System prompt 1' },
      { role: 'system', content: 'System prompt 2' },
      ...makeMessages(50, 'user', 600),
    ];
    const { messages } = ContextCompressor.compress(msgs, 10, 5_000);

    const systemMsgs = messages.filter((m) => m.role === 'system');
    expect(systemMsgs).toHaveLength(2);
    expect(systemMsgs[0].content).toBe('System prompt 1');
    expect(systemMsgs[1].content).toBe('System prompt 2');
  });

  it('preserves the most recent N messages verbatim', () => {
    const keepRecent = 10;
    const msgs = makeMessages(50, 'user', 600);
    const { messages } = ContextCompressor.compress(msgs, keepRecent, 5_000);

    // Last keepRecent non-system messages should be identical
    const nonSystem = messages.filter((m) => m.role !== 'system' && !m.content.startsWith('[Context Summary'));
    const origTail = msgs.slice(msgs.length - keepRecent);

    expect(nonSystem).toHaveLength(keepRecent);
    for (let i = 0; i < keepRecent; i++) {
      expect(nonSystem[i].content).toBe(origTail[i].content);
    }
  });

  it('creates summary messages for old batches', () => {
    const msgs = makeMessages(50, 'user', 600);
    const { messages } = ContextCompressor.compress(msgs, 10, 5_000);

    const summaries = messages.filter((m) => m.content.startsWith('[Context Summary'));
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].content).toMatch(/\d+ messages compressed/);
  });
});

// ---------------------------------------------------------------------------
// shouldCompress
// ---------------------------------------------------------------------------

describe('ContextCompressor.shouldCompress', () => {
  it('returns true when estimated tokens exceed 80% of contextLimit', () => {
    // 1 message with 400 chars → 100 tokens content + 4 overhead = 104 tokens
    // 80% of 100 = 80 → 104 > 80 → should compress
    const msgs: Message[] = [{ role: 'user', content: 'a'.repeat(400) }];
    expect(ContextCompressor.shouldCompress(msgs, 100)).toBe(true);
  });

  it('returns false when estimated tokens are below 80% of contextLimit', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello' }]; // ~6 tokens
    expect(ContextCompressor.shouldCompress(msgs, 100_000)).toBe(false);
  });

  it('returns false for an empty message array', () => {
    expect(ContextCompressor.shouldCompress([], 100_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findImportantMessages
// ---------------------------------------------------------------------------

describe('ContextCompressor.findImportantMessages', () => {
  it('identifies messages containing DECISION or PROGRESS keywords', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'normal message' },
      { role: 'assistant', content: 'We made a DECISION to use TypeScript' },
      { role: 'user', content: 'PROGRESS update: phase 1 done' },
      { role: 'assistant', content: 'another normal message' },
    ];
    const important = ContextCompressor.findImportantMessages(msgs);
    expect(important).toContain(1);
    expect(important).toContain(2);
    expect(important).not.toContain(0);
    expect(important).not.toContain(3);
  });

  it('identifies build and test failures', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'The build failed due to a type error' },
      { role: 'assistant', content: 'test failed in suite AuthService' },
      { role: 'user', content: 'looks like everything passed' },
    ];
    const important = ContextCompressor.findImportantMessages(msgs);
    expect(important).toContain(0);
    expect(important).toContain(1);
    expect(important).not.toContain(2);
  });

  it('identifies [System] ✅ and [System] ❌ markers', () => {
    const msgs: Message[] = [
      { role: 'user', content: '[System] ✅ Task completed' },
      { role: 'user', content: '[System] ❌ Task failed' },
      { role: 'user', content: '[System] just a regular system msg' },
    ];
    const important = ContextCompressor.findImportantMessages(msgs);
    expect(important).toContain(0);
    expect(important).toContain(1);
    expect(important).not.toContain(2);
  });

  it('identifies ACP command messages via [[[ ]]] pattern', () => {
    const msgs: Message[] = [
      { role: 'user', content: '[[[AGENT_MESSAGE to:lead-1]]] Hello' },
      { role: 'user', content: 'plain text' },
    ];
    const important = ContextCompressor.findImportantMessages(msgs);
    expect(important).toContain(0);
    expect(important).not.toContain(1);
  });

  it('returns empty array when no important messages exist', () => {
    const msgs = makeMessages(5, 'user', 50);
    expect(ContextCompressor.findImportantMessages(msgs)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// summarizeBatch
// ---------------------------------------------------------------------------

describe('ContextCompressor.summarizeBatch', () => {
  it('collapses tool call messages to a single line', () => {
    const batch: Message[] = [
      { role: 'assistant', content: 'tool_call: editFile path/to/file.ts with new content here' },
    ];
    const summary = ContextCompressor.summarizeBatch(batch);
    expect(summary).toContain('[tool]');
    expect(summary).not.toContain('\n\n'); // collapsed
  });

  it('truncates long messages to 200 chars plus ellipsis', () => {
    const longContent = 'x'.repeat(1000);
    const batch: Message[] = [{ role: 'user', content: longContent }];
    const summary = ContextCompressor.summarizeBatch(batch);
    expect(summary).toContain('...');
    // The bullet line should not contain the full 1000 chars
    expect(summary.length).toBeLessThan(300);
  });

  it('keeps short messages as-is', () => {
    const batch: Message[] = [{ role: 'user', content: 'short message' }];
    const summary = ContextCompressor.summarizeBatch(batch);
    expect(summary).toContain('short message');
  });

  it('handles [System] prefixed content by extracting the first line', () => {
    const batch: Message[] = [
      {
        role: 'user',
        content: '[System] Task assigned: build the auth module\nExtra details here\nMore details',
      },
    ];
    const summary = ContextCompressor.summarizeBatch(batch);
    expect(summary).toContain('[System] Task assigned: build the auth module');
    expect(summary).not.toContain('Extra details here');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('ContextCompressor — edge cases', () => {
  it('handles an empty message array gracefully', () => {
    const { messages, result } = ContextCompressor.compress([], 20, 100_000);
    expect(messages).toHaveLength(0);
    expect(result.savedTokens).toBe(0);
    expect(result.originalCount).toBe(0);
  });

  it('handles a single message without throwing', () => {
    const msgs: Message[] = [{ role: 'user', content: 'hello' }];
    const { messages, result } = ContextCompressor.compress(msgs, 20, 100_000);
    expect(messages).toHaveLength(1);
    expect(result.savedTokens).toBe(0);
  });

  it('compressedTokens is always <= originalTokens after compression', () => {
    const msgs = makeConversation(60, 600);
    const { result } = ContextCompressor.compress(msgs, 20, 10_000);
    expect(result.compressedTokens).toBeLessThanOrEqual(result.originalTokens);
  });
});
