import { describe, it, expect } from 'vitest';
import { classifyHighlight as classifyMessage, isUserDirected } from '../isUserDirectedMessage';

// ══════════════════════════════════════════════════════════════════════
// Definite positive: @user tag
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — @user tag', () => {
  it('detects @user at start of message', () => {
    expect(classifyMessage('@user\nHere is the progress report.')).toBe('user-directed');
  });

  it('detects @user on a middle line', () => {
    expect(classifyMessage('Some intro.\n@user\nHere are the results.')).toBe('user-directed');
  });

  it('detects @user at end of message', () => {
    expect(classifyMessage('Done with the task.\n@user')).toBe('user-directed');
  });

  it('does NOT match @username (different word)', () => {
    expect(classifyMessage('@username-bot said something')).toBe('internal');
  });

  it('does NOT match @user mid-line (not on its own line)', () => {
    expect(classifyMessage('Tell @user about the results')).toBe('internal');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Definite negative: crew commands
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — crew commands', () => {
  it('pure crew command (doubled unicode fence) is internal', () => {
    expect(classifyMessage('⟦⟦ DELEGATE {"to": "developer"} ⟧⟧')).toBe('internal');
  });

  it('pure crew command (unicode fence) is internal', () => {
    expect(classifyMessage('⟦⟦ AGENT_MESSAGE {"to": "173808e0", "content": "status"} ⟧⟧')).toBe('internal');
  });

  it('multiple crew commands are internal', () => {
    const text = '⟦⟦ LOCK_FILE {"filePath": "foo.ts"} ⟧⟧\n⟦⟦ COMMIT {"message": "fix"} ⟧⟧';
    expect(classifyMessage(text)).toBe('internal');
  });

  it('crew command mixed with user text is internal (commands dominate)', () => {
    const text = 'Let me handle that.\n⟦⟦ DELEGATE {"to": "dev"} ⟧⟧';
    expect(classifyMessage(text)).toBe('internal');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Definite negative: system messages
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — system/status messages', () => {
  it('[System] prefix is internal', () => {
    expect(classifyMessage('[System] Lock acquired on file.ts')).toBe('internal');
  });

  it('[Message from ...] is internal', () => {
    expect(classifyMessage('[Message from Developer (abc123)]: Task completed.')).toBe('internal');
  });

  it('[Broadcast from ...] is internal', () => {
    expect(classifyMessage('[Broadcast from Lead (173808e0)]: All agents report status.')).toBe('internal');
  });

  it('[DAG Task: ...] is internal', () => {
    expect(classifyMessage('[DAG Task: fix-p1-4]\nFix the highlight detection.')).toBe('internal');
  });

  it('CREW_UPDATE block is internal', () => {
    expect(classifyMessage('== CURRENT CREW STATUS ==\nAgent 173808e0 (Lead) — Status: running')).toBe('internal');
  });

  it('AGENT BUDGET block is internal', () => {
    expect(classifyMessage('== AGENT BUDGET ==\nRunning: 5 / 20')).toBe('internal');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Definite negative: agent coordination
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — agent coordination', () => {
  it('[Starting] prefix is internal', () => {
    expect(classifyMessage('[Starting] Here is my plan: fix the bug.')).toBe('internal');
  });

  it('[Done] prefix is internal', () => {
    expect(classifyMessage('[Done] All tests pass. Committed abc123.')).toBe('internal');
  });

  it('[Blocked] prefix is internal', () => {
    expect(classifyMessage('[Blocked] Waiting for file lock on api.ts.')).toBe('internal');
  });

  it('[Waiting] prefix is internal', () => {
    expect(classifyMessage('[Waiting] For architect report.')).toBe('internal');
  });

  it('routing arrow is internal', () => {
    expect(classifyMessage('Message → Developer (3811edef)')).toBe('internal');
  });

  it('delegation arrow is internal', () => {
    expect(classifyMessage('Delegation → Architect (437a822b): review the design')).toBe('internal');
  });

  it('completion report is internal', () => {
    expect(classifyMessage('Completion report → Project Lead (173808e0)')).toBe('internal');
  });

  it('agent status line is internal', () => {
    expect(classifyMessage('Agent 3811edef (developer): status_change — Status: running')).toBe('internal');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Positive: user-directed language
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — user-directed language', () => {
  it('"Here\'s the progress report" with user context is user-directed', () => {
    expect(classifyMessage("Here's the progress report. 3 tasks complete, 2 in progress.", { prevSenderIsUser: true })).toBe('user-directed');
  });

  it('"Here\'s the progress report" without context is internal (too broad)', () => {
    expect(classifyMessage("Here's the progress report. 3 tasks complete, 2 in progress.")).toBe('internal');
  });

  it('"Summary: ..." is user-directed (specific pattern, no context needed)', () => {
    expect(classifyMessage('Summary: The team has completed 5 of 8 items.')).toBe('user-directed');
  });

  it('"I\'ve completed ..." with user context is user-directed', () => {
    expect(classifyMessage("I've completed the timeline fix. All tests pass.", { prevSenderIsUser: true })).toBe('user-directed');
  });

  it('"I\'ve completed ..." without context is internal (too broad)', () => {
    expect(classifyMessage("I've completed the timeline fix. All tests pass.")).toBe('internal');
  });

  it('"Let me explain ..." with user context is user-directed', () => {
    expect(classifyMessage('Let me explain the architecture changes.', { prevSenderIsUser: true })).toBe('user-directed');
  });

  it('"Let me explain ..." without context is internal (too broad)', () => {
    expect(classifyMessage('Let me explain the architecture changes.')).toBe('internal');
  });

  it('"Sure, I can do that" with user context is user-directed', () => {
    expect(classifyMessage('Sure, I can do that. Starting now.', { prevSenderIsUser: true })).toBe('user-directed');
  });

  it('"Sure, I can do that" without context is internal (too broad)', () => {
    expect(classifyMessage('Sure, I can do that. Starting now.')).toBe('internal');
  });

  it('"acknowledged" is user-directed', () => {
    expect(classifyMessage('Acknowledged. Working on the minimap fix now.')).toBe('user-directed');
  });

  it('"as you requested" is user-directed', () => {
    expect(classifyMessage('The docs have been updated as you requested.')).toBe('user-directed');
  });

  it('"Status report:" is user-directed (specific pattern)', () => {
    expect(classifyMessage('Status report:\n- 3 tasks done\n- 2 in progress')).toBe('user-directed');
  });

  it('[USER MESSAGE] marker is user-directed', () => {
    expect(classifyMessage('Processing [USER MESSAGE]: fix the timeline')).toBe('user-directed');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Edge cases: mentions "user" but NOT directed at user
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — edge cases mentioning "user"', () => {
  it('"the user asked" inside a [Starting] block is internal', () => {
    expect(classifyMessage('[Starting] The user asked for a fix — investigating now.')).toBe('internal');
  });

  it('"user feedback" in agent status is internal', () => {
    expect(classifyMessage('Agent 3811edef (developer): received user feedback')).toBe('internal');
  });

  it('crew command with "user" parameter is internal', () => {
    expect(classifyMessage('⟦⟦ AGENT_MESSAGE {"to": "173808e0", "content": "user wants zoom fix"} ⟧⟧')).toBe('internal');
  });

  it('"tell the user" in a delegation message is internal', () => {
    expect(classifyMessage('[Message from Architect (437a822b)]: Tell the user the fix is ready.')).toBe('internal');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Context-based: previous sender is user
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — context (prevSenderIsUser)', () => {
  it('generic text after user message is reply-to-user', () => {
    expect(classifyMessage('Working on that now.', { prevSenderIsUser: true })).toBe('reply-to-user');
  });

  it('generic text without user context is internal', () => {
    expect(classifyMessage('Working on that now.')).toBe('internal');
  });

  it('crew command after user message is still internal', () => {
    expect(classifyMessage(
      '⟦⟦ DELEGATE {"to": "developer", "task": "fix zoom"} ⟧⟧',
      { prevSenderIsUser: true },
    )).toBe('internal');
  });

  it('user-directed language overrides context to user-directed', () => {
    expect(classifyMessage(
      "Sure, I'll get that done right away.",
      { prevSenderIsUser: true },
    )).toBe('user-directed');
  });

  it('short acknowledgment with context is user-directed', () => {
    expect(classifyMessage('Will do.', { prevSenderIsUser: true })).toBe('user-directed');
  });
});

// ══════════════════════════════════════════════════════════════════════
// isUserDirected boolean helper
// ══════════════════════════════════════════════════════════════════════
describe('isUserDirected — boolean helper', () => {
  it('returns true for user-directed messages (specific pattern)', () => {
    expect(isUserDirected('Summary: all tasks complete.')).toBe(true);
  });

  it('returns false for broad pattern without context', () => {
    expect(isUserDirected("Here's what we've done so far.")).toBe(false);
  });

  it('returns true for broad pattern with context', () => {
    expect(isUserDirected("Here's what we've done so far.", { prevSenderIsUser: true })).toBe(true);
  });

  it('returns true for reply-to-user messages', () => {
    expect(isUserDirected('Got it.', { prevSenderIsUser: true })).toBe(true);
  });

  it('returns false for internal messages', () => {
    expect(isUserDirected('⟦⟦ DELEGATE {"to": "dev"} ⟧⟧')).toBe(false);
  });

  it('returns false for system messages', () => {
    expect(isUserDirected('[System] Lock acquired on foo.ts')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Mixed content / realistic messages
// ══════════════════════════════════════════════════════════════════════
describe('classifyMessage — realistic messages', () => {
  it('lead progress report with context is user-directed', () => {
    const text = "Here's the current status:\n\n- Timeline zoom: Fixed (commit b5ce004)\n- Minimap: Fixed (commit dcae2ce)\n- DAG viz: Complete\n\n3 of 5 items done.";
    expect(classifyMessage(text, { prevSenderIsUser: true })).toBe('user-directed');
  });

  it('lead progress report without context is internal (broad pattern)', () => {
    const text = "Here's the current status:\n\n- Timeline zoom: Fixed (commit b5ce004)\n- Minimap: Fixed (commit dcae2ce)\n- DAG viz: Complete\n\n3 of 5 items done.";
    expect(classifyMessage(text)).toBe('internal');
  });

  it('lead delegating work is internal', () => {
    const text = '⟦⟦ DELEGATE {"to": "developer", "task": "Fix the zoom controls"} ⟧⟧';
    expect(classifyMessage(text)).toBe('internal');
  });

  it('lead responding to crew update is internal', () => {
    const text = '== CURRENT CREW STATUS ==\n- Agent 173808e0 (Lead) — running\n- Agent 3811edef (Developer) — idle';
    expect(classifyMessage(text)).toBe('internal');
  });

  it('lead brief acknowledgment to agent is internal without context', () => {
    expect(classifyMessage('Good work. Move on to the next task.')).toBe('internal');
  });

  it('lead brief acknowledgment after user message is reply-to-user', () => {
    expect(classifyMessage('Good work. Move on to the next task.', { prevSenderIsUser: true })).toBe('reply-to-user');
  });

  it('lead→agent plain text with broad pattern is internal (false positive prevention)', () => {
    expect(classifyMessage("I've assigned you the task. Start immediately.")).toBe('internal');
  });

  it('lead→agent "Here\'s the context" is internal without user context', () => {
    expect(classifyMessage("Here's the context for your work: fix the timeline zoom.")).toBe('internal');
  });

  it('multi-line with @user tag and commands is user-directed (@user wins)', () => {
    const text = '@user\nThe fix is deployed.\n\n⟦⟦ COMPLETE_TASK {"dagTaskId": "p2-8"} ⟧⟧';
    expect(classifyMessage(text)).toBe('user-directed');
  });
});
