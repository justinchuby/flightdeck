import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GovernanceAction, HookContext } from '../types.js';
import { createPermissionHook } from '../hooks/PermissionHook.js';
import { createRateLimitHook } from '../hooks/RateLimitHook.js';
import { createCommitMessageValidationHook } from '../hooks/CommitMessageValidationHook.js';
import { createFileWriteGuardHook } from '../hooks/FileWriteGuardHook.js';
import { createShellCommandBlocklistHook } from '../hooks/ShellCommandBlocklistHook.js';
import { createApprovalGateHook } from '../hooks/ApprovalGateHook.js';

// ── Shared test helpers ──

function makeAction(overrides: Partial<GovernanceAction> = {}): GovernanceAction {
  return {
    commandName: 'CREATE_AGENT',
    rawText: '⟦⟦ CREATE_AGENT {"role": "developer"} ⟧⟧',
    payload: { role: 'developer' },
    agent: { id: 'agent-1', roleId: 'lead', roleName: 'Project Lead', status: 'running' },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    getAgent: () => undefined,
    getAllAgents: () => [],
    getRunningCount: () => 1,
    maxConcurrent: 10,
    lockRegistry: { getLocksForAgent: () => [], isLocked: () => false } as any,
    taskDAG: { getTasks: () => [] } as any,
    ...overrides,
  };
}

// ── PermissionHook tests ──

describe('PermissionHook', () => {
  it('allows lead to CREATE_AGENT', () => {
    const hook = createPermissionHook();
    const result = hook.evaluate(makeAction(), makeContext());
    expect(result.decision).toBe('allow');
  });

  it('allows architect to CREATE_AGENT', () => {
    const hook = createPermissionHook();
    const action = makeAction({ agent: { id: 'a1', roleId: 'architect', roleName: 'Architect', status: 'running' } });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('blocks developer from CREATE_AGENT', () => {
    const hook = createPermissionHook();
    const action = makeAction({ agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' } });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('lead or architect');
  });

  it('allows capability-acquired CREATE_AGENT for developer', () => {
    const hook = createPermissionHook({
      hasCapability: (agentId, cmd) => cmd === 'CREATE_AGENT',
    });
    const action = makeAction({ agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' } });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('does not match unrestricted commands', () => {
    const hook = createPermissionHook();
    const action = makeAction({ commandName: 'AGENT_MESSAGE' });
    expect(hook.match(action)).toBe(false);
  });

  it('supports custom permission rules', () => {
    const hook = createPermissionHook({
      rules: { CUSTOM_CMD: { allowedRoles: ['admin'] } },
    });
    const action = makeAction({ commandName: 'CUSTOM_CMD' });
    expect(hook.match(action)).toBe(true);
    expect(hook.evaluate(action, makeContext()).decision).toBe('block');
  });
});

// ── RateLimitHook tests ──

describe('RateLimitHook', () => {
  it('allows commands within rate limit', () => {
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerMinute: 5 } } });
    const action = makeAction();
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('blocks when per-minute limit exceeded', () => {
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerMinute: 2 } } });
    const now = Date.now();
    const ctx = makeContext();

    // First two should pass
    hook.evaluate(makeAction({ timestamp: now }), ctx);
    hook.evaluate(makeAction({ timestamp: now + 1 }), ctx);

    // Third should be blocked
    const result = hook.evaluate(makeAction({ timestamp: now + 2 }), ctx);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('2/min');
  });

  it('blocks when per-hour limit exceeded', () => {
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerHour: 2 } } });
    const now = Date.now();
    const ctx = makeContext();

    hook.evaluate(makeAction({ timestamp: now }), ctx);
    hook.evaluate(makeAction({ timestamp: now + 1 }), ctx);

    const result = hook.evaluate(makeAction({ timestamp: now + 2 }), ctx);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('2/hour');
  });

  it('tracks per-agent independently', () => {
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerMinute: 1 } } });
    const now = Date.now();
    const ctx = makeContext();

    // Agent 1 uses their allowance
    hook.evaluate(makeAction({ timestamp: now, agent: { id: 'a1', roleId: 'lead', roleName: 'Lead', status: 'running' } }), ctx);
    // Agent 2 should still be allowed
    const result = hook.evaluate(makeAction({ timestamp: now + 1, agent: { id: 'a2', roleId: 'lead', roleName: 'Lead', status: 'running' } }), ctx);
    expect(result.decision).toBe('allow');
  });

  it('does not rate-limit commands without configured limits', () => {
    // Override ALL defaults by providing only CREATE_AGENT limits
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerMinute: 1 } } });
    const action = makeAction({ commandName: 'SOME_UNKNOWN_COMMAND' });
    expect(hook.match(action)).toBe(false);
  });

  it('sliding window resets after time passes', () => {
    const hook = createRateLimitHook({ limits: { CREATE_AGENT: { maxPerMinute: 1 } } });
    const now = Date.now();
    const ctx = makeContext();

    hook.evaluate(makeAction({ timestamp: now }), ctx);
    // 61 seconds later, should be allowed again
    const result = hook.evaluate(makeAction({ timestamp: now + 61000 }), ctx);
    expect(result.decision).toBe('allow');
  });
});

// ── CommitMessageValidationHook tests ──

describe('CommitMessageValidationHook', () => {
  it('allows valid commit messages', () => {
    const hook = createCommitMessageValidationHook();
    const action = makeAction({
      commandName: 'COMMIT',
      payload: { message: 'feat: add governance pipeline for hook-based command validation' },
    });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('blocks short commit messages', () => {
    const hook = createCommitMessageValidationHook({ minLength: 10 });
    const action = makeAction({ commandName: 'COMMIT', payload: { message: 'fix' } });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('too short');
  });

  it('blocks long commit messages', () => {
    const hook = createCommitMessageValidationHook({ maxLength: 50 });
    const action = makeAction({ commandName: 'COMMIT', payload: { message: 'a'.repeat(51) } });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('too long');
  });

  it('blocks messages matching mustNotContain patterns', () => {
    const hook = createCommitMessageValidationHook({ mustNotContain: [/^WIP/i] });
    const action = makeAction({ commandName: 'COMMIT', payload: { message: 'WIP: work in progress' } });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('banned pattern');
  });

  it('only matches COMMIT commands', () => {
    const hook = createCommitMessageValidationHook();
    expect(hook.match(makeAction({ commandName: 'LOCK_FILE' }))).toBe(false);
    expect(hook.match(makeAction({ commandName: 'COMMIT' }))).toBe(true);
  });

  it('handles missing message gracefully', () => {
    const hook = createCommitMessageValidationHook();
    const action = makeAction({ commandName: 'COMMIT', payload: {} });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('too short');
  });
});

// ── FileWriteGuardHook tests ──

describe('FileWriteGuardHook', () => {
  it('blocks LOCK_FILE on protected patterns', () => {
    const hook = createFileWriteGuardHook({ protectedPatterns: ['.env*'] });
    const action = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: '.env.production' },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('.env.production');
    expect(result.reason).toContain('.env*');
  });

  it('allows LOCK_FILE on non-protected files', () => {
    const hook = createFileWriteGuardHook({ protectedPatterns: ['.env*'] });
    const action = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: 'src/index.ts' },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('respects role-based overrides', () => {
    const hook = createFileWriteGuardHook({
      protectedPatterns: ['.env*'],
      allowedRoles: { '.env*': ['lead'] },
    });
    const action = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: '.env.production' },
      agent: { id: 'a1', roleId: 'lead', roleName: 'Lead', status: 'running' },
    });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('does not match non-file commands', () => {
    const hook = createFileWriteGuardHook();
    expect(hook.match(makeAction({ commandName: 'CREATE_AGENT' }))).toBe(false);
    expect(hook.match(makeAction({ commandName: 'LOCK_FILE' }))).toBe(true);
    expect(hook.match(makeAction({ commandName: 'COMMIT' }))).toBe(true);
  });

  it('handles glob patterns correctly', () => {
    const hook = createFileWriteGuardHook({
      protectedPatterns: ['**/*.secret', 'node_modules/**'],
    });

    // '**/*.secret' matches deep paths
    const secretAction = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: 'config/db.secret' },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    expect(hook.evaluate(secretAction, makeContext()).decision).toBe('block');

    // 'node_modules/**' matches files within
    const nmAction = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: 'node_modules/foo/index.js' },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    expect(hook.evaluate(nmAction, makeContext()).decision).toBe('block');

    // Non-matching path is allowed
    const safeAction = makeAction({
      commandName: 'LOCK_FILE',
      payload: { filePath: 'src/utils.ts' },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    expect(hook.evaluate(safeAction, makeContext()).decision).toBe('allow');
  });

  it('checks COMMIT files array', () => {
    const hook = createFileWriteGuardHook({ protectedPatterns: ['.git/**'] });
    const action = makeAction({
      commandName: 'COMMIT',
      payload: { message: 'test', files: ['.git/config'] },
      agent: { id: 'a1', roleId: 'developer', roleName: 'Developer', status: 'running' },
    });
    expect(hook.evaluate(action, makeContext()).decision).toBe('block');
  });
});

// ── ShellCommandBlocklistHook tests ──

describe('ShellCommandBlocklistHook', () => {
  it('blocks git add -A in command text', () => {
    const hook = createShellCommandBlocklistHook();
    const action = makeAction({
      rawText: '⟦⟦ COMMIT {"message": "fix"} ⟧⟧ git add -A',
    });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('git\\s+add\\s+-A');
  });

  it('blocks rm -rf / patterns', () => {
    const hook = createShellCommandBlocklistHook();
    const action = makeAction({ rawText: 'rm -rf /etc/something' });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
  });

  it('allows safe commands', () => {
    const hook = createShellCommandBlocklistHook();
    const action = makeAction({ rawText: '⟦⟦ COMMIT {"message": "safe commit message"} ⟧⟧' });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('allows rm -rf /tmp (excluded by default)', () => {
    const hook = createShellCommandBlocklistHook();
    const action = makeAction({ rawText: 'rm -rf /tmp/some-dir' });
    expect(hook.evaluate(action, makeContext()).decision).toBe('allow');
  });

  it('matches all commands', () => {
    const hook = createShellCommandBlocklistHook();
    expect(hook.match(makeAction({ commandName: 'COMMIT' }))).toBe(true);
    expect(hook.match(makeAction({ commandName: 'AGENT_MESSAGE' }))).toBe(true);
  });

  it('supports custom blocked patterns', () => {
    const hook = createShellCommandBlocklistHook({ blockedPatterns: [/dangerous/] });
    const action = makeAction({ rawText: 'dangerous command here' });
    expect(hook.evaluate(action, makeContext()).decision).toBe('block');
  });
});

// ── ApprovalGateHook tests ──

describe('ApprovalGateHook', () => {
  it('blocks TERMINATE_AGENT and creates pending approval', () => {
    const hook = createApprovalGateHook();
    const action = makeAction({ commandName: 'TERMINATE_AGENT' });
    const result = hook.evaluate(action, makeContext());
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('requires approval');
    expect(hook.getPending()).toHaveLength(1);
  });

  it('blocks RESET_DAG', () => {
    const hook = createApprovalGateHook();
    const action = makeAction({ commandName: 'RESET_DAG' });
    expect(hook.evaluate(action, makeContext()).decision).toBe('block');
  });

  it('allows CREATE_AGENT when under limit', () => {
    const hook = createApprovalGateHook();
    const ctx = makeContext({ getRunningCount: () => 2, maxConcurrent: 10 });
    const action = makeAction({ commandName: 'CREATE_AGENT' });
    expect(hook.evaluate(action, ctx).decision).toBe('allow');
  });

  it('blocks CREATE_AGENT when near limit (when_limit_near)', () => {
    const hook = createApprovalGateHook({ limitThreshold: 0.8 });
    const ctx = makeContext({ getRunningCount: () => 9, maxConcurrent: 10 });
    const action = makeAction({ commandName: 'CREATE_AGENT' });
    const result = hook.evaluate(action, ctx);
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('requires approval');
    expect(result.meta?.gateType).toBe('when_limit_near');
  });

  it('approve removes pending and returns action', () => {
    const hook = createApprovalGateHook();
    const action = makeAction({ commandName: 'TERMINATE_AGENT' });
    hook.evaluate(action, makeContext());

    const pending = hook.getPending();
    expect(pending).toHaveLength(1);
    const approved = hook.approve(pending[0].id);
    expect(approved).toBeDefined();
    expect(approved!.commandName).toBe('TERMINATE_AGENT');
    expect(hook.getPending()).toHaveLength(0);
  });

  it('reject removes pending and returns action', () => {
    const hook = createApprovalGateHook();
    const action = makeAction({ commandName: 'TERMINATE_AGENT' });
    hook.evaluate(action, makeContext());

    const pending = hook.getPending();
    const rejected = hook.reject(pending[0].id);
    expect(rejected).toBeDefined();
    expect(hook.getPending()).toHaveLength(0);
  });

  it('approve returns undefined for missing ID', () => {
    const hook = createApprovalGateHook();
    expect(hook.approve('nonexistent')).toBeUndefined();
  });

  it('calls onGate callback when gating', () => {
    const onGate = vi.fn();
    const hook = createApprovalGateHook({ onGate });
    hook.evaluate(makeAction({ commandName: 'TERMINATE_AGENT' }), makeContext());
    expect(onGate).toHaveBeenCalledOnce();
  });

  it('does not match non-gated commands', () => {
    const hook = createApprovalGateHook();
    expect(hook.match(makeAction({ commandName: 'LOCK_FILE' }))).toBe(false);
  });
});
