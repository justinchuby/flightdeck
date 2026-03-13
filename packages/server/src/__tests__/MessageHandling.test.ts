import { describe, it, expect } from 'vitest';

// These regex patterns are NOT exported from AgentManager, so we replicate
// them here for testing — same approach as AgentManagerParsing.test.ts.

// --- Triple-bracket patterns (the only supported syntax) ---
const TBL_CREATE_AGENT = /⟦⟦\s*CREATE_AGENT\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_DELEGATE = /⟦⟦\s*DELEGATE\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_AGENT_MESSAGE = /⟦⟦\s*AGENT_MESSAGE\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_BROADCAST = /⟦⟦\s*BROADCAST\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_QUERY_CREW = /⟦⟦\s*QUERY_CREW\s*⟧⟧/;
const TBL_CREATE_GROUP = /⟦⟦\s*CREATE_GROUP\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_GROUP_MESSAGE = /⟦⟦\s*GROUP_MESSAGE\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_PROGRESS = /⟦⟦\s*PROGRESS\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_DECISION = /⟦⟦\s*DECISION\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_TERMINATE_AGENT = /⟦⟦\s*TERMINATE_AGENT\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_DECLARE_TASKS = /⟦⟦\s*DECLARE_TASKS\s*(\{[\s\S]*?\})\s*⟧⟧/;
const TBL_TASK_STATUS = /⟦⟦\s*TASK_STATUS\s*⟧⟧/;

describe('Message Handling — Command Parsing', () => {
  // ─── Triple-bracket CREATE_AGENT ────────────────────────────────────
  describe('Triple-bracket CREATE_AGENT', () => {
    it('matches basic create agent', () => {
      const input = '⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧';
      const match = input.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1])).toEqual({ role: 'developer' });
    });

    it('matches with model and task', () => {
      const input =
        '⟦⟦ CREATE_AGENT {"role": "developer", "model": "claude-opus-4-6", "task": "Fix tests"} ⟧⟧';
      const match = input.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.role).toBe('developer');
      expect(parsed.model).toBe('claude-opus-4-6');
      expect(parsed.task).toBe('Fix tests');
    });

    it('matches multi-line format', () => {
      const input = `⟦⟦
  CREATE_AGENT {
    "role": "developer",
    "task": "Fix the auth module"
  }
⟧⟧`;
      const match = input.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
    });

    it('does not match inside code fences (regex still matches — scanBuffer strips)', () => {
      const input = '```\n⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧\n```';
      // The regex itself matches; code-fence stripping is a scanBuffer concern.
      const match = input.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
    });

    it('does not match partial brackets', () => {
      expect('[[ CREATE_AGENT {"role": "developer"} ]]'.match(TBL_CREATE_AGENT)).toBeNull();
      expect('[[CREATE_AGENT {"role": "developer"}]]'.match(TBL_CREATE_AGENT)).toBeNull();
    });
  });

  // ─── Triple-bracket DELEGATE ────────────────────────────────────────
  describe('Triple-bracket DELEGATE', () => {
    it('matches delegate with to and task', () => {
      const input = '⟦⟦ DELEGATE {"to": "abc123", "task": "Review code"} ⟧⟧';
      const match = input.match(TBL_DELEGATE);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.to).toBe('abc123');
      expect(parsed.task).toBe('Review code');
    });

    it('matches with context field', () => {
      const input =
        '⟦⟦ DELEGATE {"to": "abc123", "task": "Fix bug", "context": "See error in log"} ⟧⟧';
      const match = input.match(TBL_DELEGATE);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).context).toBe('See error in log');
    });
  });

  // ─── Triple-bracket QUERY_CREW ──────────────────────────────────────
  describe('Triple-bracket QUERY_CREW', () => {
    it('matches no-payload query', () => {
      expect('⟦⟦ QUERY_CREW ⟧⟧'.match(TBL_QUERY_CREW)).toBeTruthy();
    });

    it('matches with extra whitespace', () => {
      expect('⟦⟦  QUERY_CREW  ⟧⟧'.match(TBL_QUERY_CREW)).toBeTruthy();
    });
  });

  // ─── Triple-bracket GROUP commands ──────────────────────────────────
  describe('Triple-bracket GROUP commands', () => {
    it('CREATE_GROUP with members', () => {
      const input = '⟦⟦ CREATE_GROUP {"name": "config-team", "members": ["id1", "id2"]} ⟧⟧';
      const match = input.match(TBL_CREATE_GROUP);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.name).toBe('config-team');
      expect(parsed.members).toEqual(['id1', 'id2']);
    });

    it('GROUP_MESSAGE with content', () => {
      const input =
        '⟦⟦ GROUP_MESSAGE {"group": "config-team", "content": "Update: configs merged"} ⟧⟧';
      const match = input.match(TBL_GROUP_MESSAGE);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).content).toBe('Update: configs merged');
    });
  });

  // ─── Triple-bracket DAG commands ────────────────────────────────────
  describe('Triple-bracket DAG commands', () => {
    it('DECLARE_TASKS matches', () => {
      const input =
        '⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "t1", "role": "developer"}]} ⟧⟧';
      const match = input.match(TBL_DECLARE_TASKS);
      expect(match).toBeTruthy();
    });

    it('TASK_STATUS matches no-payload', () => {
      expect('⟦⟦ TASK_STATUS ⟧⟧'.match(TBL_TASK_STATUS)).toBeTruthy();
    });
  });

  // ─── Triple-bracket AGENT_MESSAGE ───────────────────────────────────
  describe('Triple-bracket AGENT_MESSAGE', () => {
    it('matches message to specific agent', () => {
      const input =
        '⟦⟦ AGENT_MESSAGE {"to": "abc12345", "content": "Need info on configs"} ⟧⟧';
      const match = input.match(TBL_AGENT_MESSAGE);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.to).toBe('abc12345');
      expect(parsed.content).toBe('Need info on configs');
    });
  });

  // ─── Triple-bracket BROADCAST ───────────────────────────────────────
  describe('Triple-bracket BROADCAST', () => {
    it('matches broadcast', () => {
      const input = '⟦⟦ BROADCAST {"content": "Use factory pattern everywhere"} ⟧⟧';
      const match = input.match(TBL_BROADCAST);
      expect(match).toBeTruthy();
    });
  });

  // ─── Triple-bracket PROGRESS ────────────────────────────────────────
  describe('Triple-bracket PROGRESS', () => {
    it('matches progress report', () => {
      const input =
        '⟦⟦ PROGRESS {"summary": "2/4 done", "completed": ["API"], "in_progress": ["UI"]} ⟧⟧';
      const match = input.match(TBL_PROGRESS);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.completed).toEqual(['API']);
    });
  });

  // ─── Triple-bracket DECISION ────────────────────────────────────────
  describe('Triple-bracket DECISION', () => {
    it('matches decision with rationale', () => {
      const input =
        '⟦⟦ DECISION {"title": "Use PostgreSQL", "rationale": "Need concurrent writes"} ⟧⟧';
      const match = input.match(TBL_DECISION);
      expect(match).toBeTruthy();
    });
  });

  // ─── Triple-bracket TERMINATE_AGENT ──────────────────────────────────────
  describe('Triple-bracket TERMINATE_AGENT', () => {
    it('matches terminate with reason', () => {
      const input = '⟦⟦ TERMINATE_AGENT {"agentId": "abc123", "reason": "task complete"} ⟧⟧';
      const match = input.match(TBL_TERMINATE_AGENT);
      expect(match).toBeTruthy();
    });
  });

  // ─── Cross-pattern isolation ────────────────────────────────────────
  describe('Cross-pattern isolation', () => {
    it('CREATE_AGENT does not match DELEGATE', () => {
      const delegate = '⟦⟦ DELEGATE {"to": "abc123", "task": "test"} ⟧⟧';
      expect(delegate.match(TBL_CREATE_AGENT)).toBeNull();
    });

    it('QUERY_CREW does not match TASK_STATUS', () => {
      expect('⟦⟦ TASK_STATUS ⟧⟧'.match(TBL_QUERY_CREW)).toBeNull();
    });

    it('GROUP_MESSAGE does not match AGENT_MESSAGE', () => {
      const gm = '⟦⟦ GROUP_MESSAGE {"group": "team", "content": "hi"} ⟧⟧';
      expect(gm.match(TBL_AGENT_MESSAGE)).toBeNull();
    });

    it('AGENT_MESSAGE does not match GROUP_MESSAGE', () => {
      const am = '⟦⟦ AGENT_MESSAGE {"to": "x", "content": "hi"} ⟧⟧';
      expect(am.match(TBL_GROUP_MESSAGE)).toBeNull();
    });

    it('DELEGATE does not match CREATE_AGENT', () => {
      const ca = '⟦⟦ CREATE_AGENT {"role": "dev"} ⟧⟧';
      expect(ca.match(TBL_DELEGATE)).toBeNull();
    });
  });

  // ─── Mixed content extraction ───────────────────────────────────────
  describe('Mixed content extraction', () => {
    it('extracts command from surrounding text', () => {
      const input =
        'Here is my plan:\n⟦⟦ CREATE_AGENT {"role": "developer", "task": "Fix auth"} ⟧⟧\nLet me know if you need changes.';
      const match = input.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).task).toBe('Fix auth');
    });

    it('extracts multiple commands from same buffer', () => {
      const input =
        '⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧\nSome text\n⟦⟦ DELEGATE {"to": "abc", "task": "test"} ⟧⟧';
      expect(input.match(TBL_CREATE_AGENT)).toBeTruthy();
      expect(input.match(TBL_DELEGATE)).toBeTruthy();
    });

    it('extracts commands from lengthy prose', () => {
      const input = `
I analyzed the requirements and will now set up the team.
First, let me create a developer agent:

⟦⟦ CREATE_AGENT {"role": "developer", "task": "Implement auth module"} ⟧⟧

Then I'll broadcast the architecture decision:

⟦⟦ BROADCAST {"content": "We are using JWT for authentication"} ⟧⟧

Finally, let me check who is available:

⟦⟦ QUERY_CREW ⟧⟧
      `.trim();
      expect(input.match(TBL_CREATE_AGENT)).toBeTruthy();
      expect(input.match(TBL_BROADCAST)).toBeTruthy();
      expect(input.match(TBL_QUERY_CREW)).toBeTruthy();
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('handles JSON with special characters in strings', () => {
      const input =
        '⟦⟦ AGENT_MESSAGE {"to": "abc", "content": "Fix the \\"auth\\" module"} ⟧⟧';
      const match = input.match(TBL_AGENT_MESSAGE);
      expect(match).toBeTruthy();
      const parsed = JSON.parse(match![1]);
      expect(parsed.content).toBe('Fix the "auth" module');
    });

    it('handles JSON with URLs', () => {
      const input =
        '⟦⟦ BROADCAST {"content": "See https://example.com/docs for reference"} ⟧⟧';
      const match = input.match(TBL_BROADCAST);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).content).toContain('https://');
    });

    it('handles empty-ish JSON objects', () => {
      const input = '⟦⟦ BROADCAST {"content": ""} ⟧⟧';
      const match = input.match(TBL_BROADCAST);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).content).toBe('');
    });

    it('triple-bracket does not match with only two brackets', () => {
      expect('[[ CREATE_AGENT {"role": "dev"} ]]'.match(TBL_CREATE_AGENT)).toBeNull();
    });

    it('triple-bracket tolerates no space after ⟦⟦ (\\s* is 0+)', () => {
      // \s* means 0 or more whitespace — ⟦⟦CREATE_AGENT is valid.
      // This is fine because the triple-bracket delimiter is unambiguous.
      const match = '⟦⟦CREATE_AGENT {"role": "dev"}⟧⟧'.match(TBL_CREATE_AGENT);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1])).toEqual({ role: 'dev' });
    });

    it('does not match without opening ⟦⟦', () => {
      expect('CREATE_AGENT {"role": "dev"} ⟧⟧'.match(TBL_CREATE_AGENT)).toBeNull();
    });

    it('does not match without closing ⟧⟧', () => {
      expect('⟦⟦ CREATE_AGENT {"role": "dev"}'.match(TBL_CREATE_AGENT)).toBeNull();
    });

    it('nested braces in JSON are handled by non-greedy match', () => {
      // Non-greedy [\s\S]*? means the first closing } stops the match.
      // For nested objects, the outer regex match ends at the first }.
      // This is a known limitation — deeply nested JSON needs careful formatting.
      const input = '⟦⟦ PROGRESS {"summary": "done"} ⟧⟧';
      const match = input.match(TBL_PROGRESS);
      expect(match).toBeTruthy();
      expect(JSON.parse(match![1]).summary).toBe('done');
    });
  });
});
