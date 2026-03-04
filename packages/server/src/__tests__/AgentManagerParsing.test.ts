import { describe, it, expect } from 'vitest';

// These regex patterns are copied from AgentManager.ts (module-level constants, not exported)
const SPAWN_REQUEST_REGEX = /⟦⟦\s*SPAWN_AGENT\s*(\{.*?\})\s*⟧⟧/s;
const LOCK_REQUEST_REGEX = /⟦⟦\s*LOCK_FILE\s*(\{.*?\})\s*⟧⟧/s;
const LOCK_RELEASE_REGEX = /⟦⟦\s*UNLOCK_FILE\s*(\{.*?\})\s*⟧⟧/s;
const ACTIVITY_REGEX = /⟦⟦\s*ACTIVITY\s*(\{.*?\})\s*⟧⟧/s;
const AGENT_MESSAGE_REGEX = /⟦⟦\s*AGENT_MESSAGE\s*(\{.*?\})\s*⟧⟧/s;
const DELEGATE_REGEX = /⟦⟦\s*DELEGATE\s*(\{.*?\})\s*⟧⟧/s;
const DECISION_REGEX = /⟦⟦\s*DECISION\s*(\{.*?\})\s*⟧⟧/s;
const PROGRESS_REGEX = /⟦⟦\s*PROGRESS\s*(\{.*?\})\s*⟧⟧/s;
const DECLARE_TASKS_REGEX = /⟦⟦\s*DECLARE_TASKS\s*(\{.*?\})\s*⟧⟧/s;
const TASK_STATUS_REGEX = /⟦⟦\s*TASK_STATUS\s*⟧⟧/s;
const PAUSE_TASK_REGEX = /⟦⟦\s*PAUSE_TASK\s*(\{.*?\})\s*⟧⟧/s;
const RETRY_TASK_REGEX = /⟦⟦\s*RETRY_TASK\s*(\{.*?\})\s*⟧⟧/s;
const SKIP_TASK_REGEX = /⟦⟦\s*SKIP_TASK\s*(\{.*?\})\s*⟧⟧/s;
const ADD_TASK_REGEX = /⟦⟦\s*ADD_TASK\s*(\{.*?\})\s*⟧⟧/s;
const CANCEL_TASK_REGEX = /⟦⟦\s*CANCEL_TASK\s*(\{.*?\})\s*⟧⟧/s;

describe('AgentManager output parsing regexes', () => {
  describe('SPAWN_REQUEST_REGEX', () => {
    it('matches a valid SPAWN_AGENT command and extracts JSON', () => {
      const input = '⟦⟦ SPAWN_AGENT {"roleId": "reviewer"} ⟧⟧';
      const match = input.match(SPAWN_REQUEST_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({ roleId: 'reviewer' });
    });

    it('matches with extra whitespace', () => {
      const input = '⟦⟦   SPAWN_AGENT   {"roleId": "reviewer"}   ⟧⟧';
      const match = input.match(SPAWN_REQUEST_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({ roleId: 'reviewer' });
    });

    it('does NOT match plain text without the bracket pattern', () => {
      const input = 'SPAWN_AGENT {"roleId": "reviewer"}';
      const match = input.match(SPAWN_REQUEST_REGEX);
      expect(match).toBeNull();
    });

    it('extracts roleId and task fields correctly', () => {
      const input = '⟦⟦ SPAWN_AGENT {"roleId": "developer", "task": "implement-auth"} ⟧⟧';
      const match = input.match(SPAWN_REQUEST_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.roleId).toBe('developer');
      expect(parsed.task).toBe('implement-auth');
    });
  });

  describe('LOCK_REQUEST_REGEX', () => {
    it('matches a valid LOCK_FILE command and extracts JSON', () => {
      const input = '⟦⟦ LOCK_FILE {"filePath": "src/auth.ts", "reason": "editing"} ⟧⟧';
      const match = input.match(LOCK_REQUEST_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({ filePath: 'src/auth.ts', reason: 'editing' });
    });

    it('extracts filePath and reason correctly', () => {
      const input = '⟦⟦ LOCK_FILE {"filePath": "src/components/Button.tsx", "reason": "refactoring component"} ⟧⟧';
      const match = input.match(LOCK_REQUEST_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.filePath).toBe('src/components/Button.tsx');
      expect(parsed.reason).toBe('refactoring component');
    });
  });

  describe('LOCK_RELEASE_REGEX', () => {
    it('matches a valid UNLOCK_FILE command and extracts JSON', () => {
      const input = '⟦⟦ UNLOCK_FILE {"filePath": "src/auth.ts"} ⟧⟧';
      const match = input.match(LOCK_RELEASE_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({ filePath: 'src/auth.ts' });
    });

    it('extracts filePath correctly', () => {
      const input = '⟦⟦ UNLOCK_FILE {"filePath": "src/utils/helpers.ts"} ⟧⟧';
      const match = input.match(LOCK_RELEASE_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).filePath).toBe('src/utils/helpers.ts');
    });
  });

  describe('ACTIVITY_REGEX', () => {
    it('matches a valid ACTIVITY command and extracts JSON', () => {
      const input = '⟦⟦ ACTIVITY {"actionType": "decision_made", "summary": "chose JWT"} ⟧⟧';
      const match = input.match(ACTIVITY_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1])).toEqual({ actionType: 'decision_made', summary: 'chose JWT' });
    });

    it('extracts actionType, summary, and optional details', () => {
      const input = '⟦⟦ ACTIVITY {"actionType": "file_edited", "summary": "updated config", "details": {"file": "config.json"}} ⟧⟧';
      const match = input.match(ACTIVITY_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.actionType).toBe('file_edited');
      expect(parsed.summary).toBe('updated config');
      expect(parsed.details).toEqual({ file: 'config.json' });
    });
  });

  describe('Edge cases', () => {
    it('does not match partial patterns missing closing ⟧⟧', () => {
      expect('⟦⟦ SPAWN_AGENT {"roleId": "reviewer"}'.match(SPAWN_REQUEST_REGEX)).toBeNull();
      expect('⟦⟦ LOCK_FILE {"filePath": "a.ts"}'.match(LOCK_REQUEST_REGEX)).toBeNull();
      expect('⟦⟦ UNLOCK_FILE {"filePath": "a.ts"}'.match(LOCK_RELEASE_REGEX)).toBeNull();
      expect('⟦⟦ ACTIVITY {"actionType": "test"}'.match(ACTIVITY_REGEX)).toBeNull();
    });

    it('does not match when pattern lacks bracket markers', () => {
      expect('SPAWN_AGENT {"roleId": "reviewer"} ⟧⟧'.match(SPAWN_REQUEST_REGEX)).toBeNull();
      expect('LOCK_FILE {"filePath": "a.ts"} ⟧⟧'.match(LOCK_REQUEST_REGEX)).toBeNull();
      expect('UNLOCK_FILE {"filePath": "a.ts"} ⟧⟧'.match(LOCK_RELEASE_REGEX)).toBeNull();
      expect('ACTIVITY {"actionType": "test"} ⟧⟧'.match(ACTIVITY_REGEX)).toBeNull();
    });

    it('each regex only matches its own type', () => {
      const spawn = '⟦⟦ SPAWN_AGENT {"roleId": "reviewer"} ⟧⟧';
      const lock = '⟦⟦ LOCK_FILE {"filePath": "a.ts"} ⟧⟧';
      const release = '⟦⟦ UNLOCK_FILE {"filePath": "a.ts"} ⟧⟧';
      const activity = '⟦⟦ ACTIVITY {"actionType": "test"} ⟧⟧';

      // SPAWN_REQUEST_REGEX should only match spawn
      expect(spawn.match(SPAWN_REQUEST_REGEX)).not.toBeNull();
      expect(lock.match(SPAWN_REQUEST_REGEX)).toBeNull();
      expect(release.match(SPAWN_REQUEST_REGEX)).toBeNull();
      expect(activity.match(SPAWN_REQUEST_REGEX)).toBeNull();

      // LOCK_REQUEST_REGEX should only match lock
      expect(lock.match(LOCK_REQUEST_REGEX)).not.toBeNull();
      expect(spawn.match(LOCK_REQUEST_REGEX)).toBeNull();
      expect(release.match(LOCK_REQUEST_REGEX)).toBeNull();
      expect(activity.match(LOCK_REQUEST_REGEX)).toBeNull();

      // LOCK_RELEASE_REGEX should only match release
      expect(release.match(LOCK_RELEASE_REGEX)).not.toBeNull();
      expect(spawn.match(LOCK_RELEASE_REGEX)).toBeNull();
      expect(lock.match(LOCK_RELEASE_REGEX)).toBeNull();
      expect(activity.match(LOCK_RELEASE_REGEX)).toBeNull();

      // ACTIVITY_REGEX should only match activity
      expect(activity.match(ACTIVITY_REGEX)).not.toBeNull();
      expect(spawn.match(ACTIVITY_REGEX)).toBeNull();
      expect(lock.match(ACTIVITY_REGEX)).toBeNull();
      expect(release.match(ACTIVITY_REGEX)).toBeNull();
    });
  });

  describe('DELEGATE_REGEX', () => {
    it('matches a valid DELEGATE command', () => {
      const input = '⟦⟦ DELEGATE {"to": "developer", "task": "Build login API"} ⟧⟧';
      const match = input.match(DELEGATE_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.to).toBe('developer');
      expect(parsed.task).toBe('Build login API');
    });

    it('matches with optional context field', () => {
      const input = '⟦⟦ DELEGATE {"to": "reviewer", "task": "Review PR", "context": "Focus on auth module"} ⟧⟧';
      const match = input.match(DELEGATE_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.context).toBe('Focus on auth module');
    });

    it('does not match other patterns', () => {
      expect('⟦⟦ SPAWN_AGENT {"roleId": "reviewer"} ⟧⟧'.match(DELEGATE_REGEX)).toBeNull();
      expect('⟦⟦ DECISION {"title": "test"} ⟧⟧'.match(DELEGATE_REGEX)).toBeNull();
    });
  });

  describe('DECISION_REGEX', () => {
    it('matches a valid DECISION command', () => {
      const input = '⟦⟦ DECISION {"title": "Use PostgreSQL", "rationale": "Better concurrency"} ⟧⟧';
      const match = input.match(DECISION_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.title).toBe('Use PostgreSQL');
      expect(parsed.rationale).toBe('Better concurrency');
    });

    it('matches without rationale', () => {
      const input = '⟦⟦ DECISION {"title": "Use TypeScript"} ⟧⟧';
      const match = input.match(DECISION_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).title).toBe('Use TypeScript');
    });
  });

  describe('PROGRESS_REGEX', () => {
    it('matches a valid PROGRESS command', () => {
      const input = '⟦⟦ PROGRESS {"summary": "2 of 4 done", "completed": ["API", "DB"], "in_progress": ["UI"]} ⟧⟧';
      const match = input.match(PROGRESS_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.summary).toBe('2 of 4 done');
      expect(parsed.completed).toHaveLength(2);
    });
  });

  describe('AGENT_MESSAGE_REGEX', () => {
    it('matches a valid AGENT_MESSAGE command', () => {
      const input = '⟦⟦ AGENT_MESSAGE {"to": "abc123", "content": "Please review my changes"} ⟧⟧';
      const match = input.match(AGENT_MESSAGE_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.to).toBe('abc123');
      expect(parsed.content).toBe('Please review my changes');
    });
  });

  describe('DECLARE_TASKS_REGEX', () => {
    it('matches a single-line DECLARE_TASKS command', () => {
      const input = '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "a", "role": "developer"}]} ⟧⟧';
      const match = input.match(DECLARE_TASKS_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.tasks[0].id).toBe('a');
    });

    it('matches a multi-line DECLARE_TASKS with nested task objects', () => {
      const input = `⟦⟦ DECLARE_TASKS {"tasks": [
  {"id": "rope-config", "role": "developer", "description": "Extract RoPEConfig", "files": ["src/_configs.py"]},
  {"id": "dead-fields", "role": "developer", "dependsOn": ["rope-config"]}
]} ⟧⟧`;
      const match = input.match(DECLARE_TASKS_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.tasks).toHaveLength(2);
      expect(parsed.tasks[0].files).toEqual(['src/_configs.py']);
      expect(parsed.tasks[1].dependsOn).toEqual(['rope-config']);
    });

    it('does not match without closing ⟧⟧', () => {
      const input = '⟦⟦ DECLARE_TASKS {"tasks": [{"id": "a", "role": "dev"}]}';
      expect(input.match(DECLARE_TASKS_REGEX)).toBeNull();
    });

    it('does not match other command patterns', () => {
      expect('⟦⟦ SPAWN_AGENT {"roleId": "dev"} ⟧⟧'.match(DECLARE_TASKS_REGEX)).toBeNull();
      expect('⟦⟦ TASK_STATUS ⟧⟧'.match(DECLARE_TASKS_REGEX)).toBeNull();
    });
  });

  describe('TASK_STATUS_REGEX', () => {
    it('matches a TASK_STATUS command', () => {
      expect('⟦⟦ TASK_STATUS ⟧⟧'.match(TASK_STATUS_REGEX)).not.toBeNull();
    });

    it('matches with extra whitespace', () => {
      expect('⟦⟦   TASK_STATUS   ⟧⟧'.match(TASK_STATUS_REGEX)).not.toBeNull();
    });

    it('does not match with payload', () => {
      // TASK_STATUS has no payload capture — any payload is ignored by the regex
      // but the command still matches if brackets are present
      expect('TASK_STATUS'.match(TASK_STATUS_REGEX)).toBeNull();
    });
  });

  describe('PAUSE_TASK_REGEX', () => {
    it('matches a valid PAUSE_TASK command', () => {
      const input = '⟦⟦ PAUSE_TASK {"id": "rope-config"} ⟧⟧';
      const match = input.match(PAUSE_TASK_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).id).toBe('rope-config');
    });
  });

  describe('RETRY_TASK_REGEX', () => {
    it('matches a valid RETRY_TASK command', () => {
      const input = '⟦⟦ RETRY_TASK {"id": "failed-task"} ⟧⟧';
      const match = input.match(RETRY_TASK_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).id).toBe('failed-task');
    });
  });

  describe('SKIP_TASK_REGEX', () => {
    it('matches a valid SKIP_TASK command', () => {
      const input = '⟦⟦ SKIP_TASK {"id": "optional-task"} ⟧⟧';
      const match = input.match(SKIP_TASK_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).id).toBe('optional-task');
    });
  });

  describe('ADD_TASK_REGEX', () => {
    it('matches a valid ADD_TASK command', () => {
      const input = '⟦⟦ ADD_TASK {"id": "new-task", "role": "developer", "dependsOn": ["existing"]} ⟧⟧';
      const match = input.match(ADD_TASK_REGEX);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed.id).toBe('new-task');
      expect(parsed.role).toBe('developer');
      expect(parsed.dependsOn).toEqual(['existing']);
    });
  });

  describe('CANCEL_TASK_REGEX', () => {
    it('matches a valid CANCEL_TASK command', () => {
      const input = '⟦⟦ CANCEL_TASK {"id": "unwanted-task"} ⟧⟧';
      const match = input.match(CANCEL_TASK_REGEX);
      expect(match).not.toBeNull();
      expect(JSON.parse(match![1]).id).toBe('unwanted-task');
    });
  });

  describe('DAG regex cross-matching', () => {
    it('each DAG regex only matches its own command', () => {
      const declare = '⟦⟦ DECLARE_TASKS {"tasks": []} ⟧⟧';
      const status = '⟦⟦ TASK_STATUS ⟧⟧';
      const pause = '⟦⟦ PAUSE_TASK {"id": "a"} ⟧⟧';
      const retry = '⟦⟦ RETRY_TASK {"id": "a"} ⟧⟧';
      const skip = '⟦⟦ SKIP_TASK {"id": "a"} ⟧⟧';
      const add = '⟦⟦ ADD_TASK {"id": "a", "role": "dev"} ⟧⟧';
      const cancel = '⟦⟦ CANCEL_TASK {"id": "a"} ⟧⟧';

      // DECLARE_TASKS only matches declare
      expect(declare.match(DECLARE_TASKS_REGEX)).not.toBeNull();
      expect(status.match(DECLARE_TASKS_REGEX)).toBeNull();
      expect(pause.match(DECLARE_TASKS_REGEX)).toBeNull();

      // TASK_STATUS only matches status
      expect(status.match(TASK_STATUS_REGEX)).not.toBeNull();
      expect(declare.match(TASK_STATUS_REGEX)).toBeNull();
      expect(pause.match(TASK_STATUS_REGEX)).toBeNull();

      // Each single-payload command only matches itself
      expect(pause.match(PAUSE_TASK_REGEX)).not.toBeNull();
      expect(retry.match(PAUSE_TASK_REGEX)).toBeNull();

      expect(retry.match(RETRY_TASK_REGEX)).not.toBeNull();
      expect(skip.match(RETRY_TASK_REGEX)).toBeNull();

      expect(skip.match(SKIP_TASK_REGEX)).not.toBeNull();
      expect(add.match(SKIP_TASK_REGEX)).toBeNull();

      expect(add.match(ADD_TASK_REGEX)).not.toBeNull();
      expect(cancel.match(ADD_TASK_REGEX)).toBeNull();

      expect(cancel.match(CANCEL_TASK_REGEX)).not.toBeNull();
      expect(declare.match(CANCEL_TASK_REGEX)).toBeNull();
    });
  });
});
