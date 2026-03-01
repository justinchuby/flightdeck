import { describe, it, expect } from 'vitest';
import { SmartActivityFilter, getActivityPriority } from '../coordination/SmartActivityFilter.js';
import type { ActivityEntry, ActionType } from '../coordination/ActivityLedger.js';

function makeEntry(overrides: Partial<ActivityEntry> & { id: number; actionType: ActionType }): ActivityEntry {
  return {
    agentId: 'agent-aaa',
    agentRole: 'developer',
    summary: 'test',
    details: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('SmartActivityFilter', () => {
  const filter = new SmartActivityFilter();

  describe('getActivityPriority', () => {
    it('classifies HIGH priority actions', () => {
      expect(getActivityPriority('error')).toBe('high');
      expect(getActivityPriority('task_completed')).toBe('high');
      expect(getActivityPriority('delegated')).toBe('high');
      expect(getActivityPriority('sub_agent_spawned')).toBe('high');
      expect(getActivityPriority('agent_terminated')).toBe('high');
      expect(getActivityPriority('agent_interrupted')).toBe('high');
      expect(getActivityPriority('heartbeat_halted')).toBe('high');
      expect(getActivityPriority('delegation_cancelled')).toBe('high');
    });

    it('classifies MEDIUM priority actions', () => {
      expect(getActivityPriority('file_edit')).toBe('medium');
      expect(getActivityPriority('decision_made')).toBe('medium');
      expect(getActivityPriority('message_sent')).toBe('medium');
      expect(getActivityPriority('group_message')).toBe('medium');
      expect(getActivityPriority('task_started')).toBe('medium');
    });

    it('classifies LOW priority actions', () => {
      expect(getActivityPriority('status_change')).toBe('low');
      expect(getActivityPriority('lock_acquired')).toBe('low');
      expect(getActivityPriority('lock_released')).toBe('low');
      expect(getActivityPriority('file_read')).toBe('low');
    });
  });

  describe('filter', () => {
    it('returns empty array for empty input', () => {
      expect(filter.filter([], 20)).toEqual([]);
    });

    it('passes through entries under the limit unchanged', () => {
      const entries = [
        makeEntry({ id: 3, actionType: 'file_edit', agentId: 'a1' }),
        makeEntry({ id: 2, actionType: 'delegated', agentId: 'a2' }),
        makeEntry({ id: 1, actionType: 'status_change', agentId: 'a3' }),
      ];
      const result = filter.filter(entries, 20);
      expect(result).toHaveLength(3);
    });

    it('preserves newest-first order in output', () => {
      const entries = [
        makeEntry({ id: 5, actionType: 'error', agentId: 'a1' }),
        makeEntry({ id: 4, actionType: 'file_edit', agentId: 'a2' }),
        makeEntry({ id: 3, actionType: 'status_change', agentId: 'a3' }),
        makeEntry({ id: 2, actionType: 'delegated', agentId: 'a4' }),
        makeEntry({ id: 1, actionType: 'lock_acquired', agentId: 'a5' }),
      ];
      const result = filter.filter(entries, 20);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]!.id).toBeGreaterThan(result[i + 1]!.id);
      }
    });

    it('prioritizes HIGH over MEDIUM over LOW when limit is tight', () => {
      const entries = [
        makeEntry({ id: 6, actionType: 'status_change', agentId: 'a1' }),
        makeEntry({ id: 5, actionType: 'lock_acquired', agentId: 'a2' }),
        makeEntry({ id: 4, actionType: 'file_edit', agentId: 'a3' }),
        makeEntry({ id: 3, actionType: 'message_sent', agentId: 'a4' }),
        makeEntry({ id: 2, actionType: 'error', agentId: 'a5' }),
        makeEntry({ id: 1, actionType: 'delegated', agentId: 'a6' }),
      ];
      // Limit to 3: should get both HIGH (error, delegated) + 1 MEDIUM
      const result = filter.filter(entries, 3);
      expect(result).toHaveLength(3);
      const types = result.map((e) => e.actionType);
      expect(types).toContain('error');
      expect(types).toContain('delegated');
      // Third slot should be a MEDIUM entry, not LOW
      const lowTypes = ['status_change', 'lock_acquired', 'lock_released', 'file_read'];
      const hasLow = result.some((e) => lowTypes.includes(e.actionType));
      expect(hasLow).toBe(false);
    });

    it('deduplicates status_change per agent — keeps only latest', () => {
      const entries = [
        makeEntry({ id: 5, actionType: 'status_change', agentId: 'a1', summary: 'Status: running' }),
        makeEntry({ id: 4, actionType: 'status_change', agentId: 'a1', summary: 'Status: idle' }),
        makeEntry({ id: 3, actionType: 'status_change', agentId: 'a1', summary: 'Status: running' }),
        makeEntry({ id: 2, actionType: 'status_change', agentId: 'a2', summary: 'Status: running' }),
        makeEntry({ id: 1, actionType: 'status_change', agentId: 'a2', summary: 'Status: idle' }),
      ];
      const result = filter.filter(entries, 20);
      // Should have 2 entries: latest for a1 (id=5) and latest for a2 (id=2)
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe(5);
      expect(result[1]!.id).toBe(2);
    });

    it('deduplicates lock_acquired per agent — keeps only latest', () => {
      const entries = [
        makeEntry({ id: 4, actionType: 'lock_acquired', agentId: 'a1', summary: 'Locked file2.ts' }),
        makeEntry({ id: 3, actionType: 'lock_acquired', agentId: 'a1', summary: 'Locked file1.ts' }),
        makeEntry({ id: 2, actionType: 'lock_released', agentId: 'a1', summary: 'Released file0.ts' }),
        makeEntry({ id: 1, actionType: 'lock_acquired', agentId: 'a2', summary: 'Locked file3.ts' }),
      ];
      const result = filter.filter(entries, 20);
      // a1: 1 lock_acquired (id=4), 1 lock_released (id=2). a2: 1 lock_acquired (id=1)
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.id)).toEqual([4, 2, 1]);
    });

    it('does NOT deduplicate non-deduplicatable types', () => {
      const entries = [
        makeEntry({ id: 3, actionType: 'file_edit', agentId: 'a1', summary: 'Edit 3' }),
        makeEntry({ id: 2, actionType: 'file_edit', agentId: 'a1', summary: 'Edit 2' }),
        makeEntry({ id: 1, actionType: 'file_edit', agentId: 'a1', summary: 'Edit 1' }),
      ];
      const result = filter.filter(entries, 20);
      expect(result).toHaveLength(3);
    });

    it('fills LOW slots only when HIGH and MEDIUM leave room', () => {
      const entries: ActivityEntry[] = [];
      // 3 HIGH entries
      for (let i = 0; i < 3; i++) {
        entries.push(makeEntry({ id: 20 - i, actionType: 'error', agentId: `err-${i}` }));
      }
      // 3 MEDIUM entries
      for (let i = 0; i < 3; i++) {
        entries.push(makeEntry({ id: 17 - i, actionType: 'file_edit', agentId: `edit-${i}` }));
      }
      // 10 LOW entries (different agents to avoid dedup)
      for (let i = 0; i < 10; i++) {
        entries.push(makeEntry({ id: 14 - i, actionType: 'status_change', agentId: `sc-${i}` }));
      }

      // Limit 8: should get 3 HIGH + 3 MEDIUM + 2 LOW
      const result = filter.filter(entries, 8);
      expect(result).toHaveLength(8);
      const priorities = result.map((e) => getActivityPriority(e.actionType));
      expect(priorities.filter((p) => p === 'high')).toHaveLength(3);
      expect(priorities.filter((p) => p === 'medium')).toHaveLength(3);
      expect(priorities.filter((p) => p === 'low')).toHaveLength(2);
    });

    it('handles limit smaller than HIGH entries count', () => {
      const entries = [
        makeEntry({ id: 5, actionType: 'error', agentId: 'a1' }),
        makeEntry({ id: 4, actionType: 'delegated', agentId: 'a2' }),
        makeEntry({ id: 3, actionType: 'task_completed', agentId: 'a3' }),
        makeEntry({ id: 2, actionType: 'file_edit', agentId: 'a4' }),
        makeEntry({ id: 1, actionType: 'status_change', agentId: 'a5' }),
      ];
      // Limit 2: should get only 2 HIGH (newest first)
      const result = filter.filter(entries, 2);
      expect(result).toHaveLength(2);
      expect(result.every((e) => getActivityPriority(e.actionType) === 'high')).toBe(true);
    });

    it('realistic scenario: status churn is suppressed, important events survive', () => {
      // Simulate a noisy session: lots of status_change + lock churn, few meaningful events
      const entries: ActivityEntry[] = [];
      let id = 50;

      // Agent a1 status_change x5 (churn)
      for (let i = 0; i < 5; i++) {
        entries.push(makeEntry({
          id: id--,
          actionType: 'status_change',
          agentId: 'agent-a1',
          summary: `Status: ${i % 2 === 0 ? 'running' : 'idle'}`,
        }));
      }
      // Agent a2 status_change x3
      for (let i = 0; i < 3; i++) {
        entries.push(makeEntry({
          id: id--,
          actionType: 'status_change',
          agentId: 'agent-a2',
          summary: `Status: ${i % 2 === 0 ? 'running' : 'idle'}`,
        }));
      }
      // Lock churn: a1 locks/unlocks 4 files
      for (let i = 0; i < 4; i++) {
        entries.push(makeEntry({
          id: id--,
          actionType: i % 2 === 0 ? 'lock_acquired' : 'lock_released',
          agentId: 'agent-a1',
          summary: `file${i}.ts`,
        }));
      }
      // The important events buried in the noise:
      entries.push(makeEntry({ id: id--, actionType: 'error', agentId: 'agent-a3', summary: 'Build failed' }));
      entries.push(makeEntry({ id: id--, actionType: 'delegated', agentId: 'agent-lead', summary: 'Task to a4' }));
      entries.push(makeEntry({ id: id--, actionType: 'file_edit', agentId: 'agent-a1', summary: 'Edited main.ts' }));
      entries.push(makeEntry({ id: id--, actionType: 'message_sent', agentId: 'agent-a2', summary: 'Message to lead' }));

      const result = filter.filter(entries, 10);

      // Important events MUST be present
      const summaries = result.map((e) => e.summary);
      expect(summaries).toContain('Build failed');
      expect(summaries).toContain('Task to a4');
      expect(summaries).toContain('Edited main.ts');
      expect(summaries).toContain('Message to lead');

      // Status churn should be deduplicated: at most 1 status_change per agent
      const statusChanges = result.filter((e) => e.actionType === 'status_change');
      const statusAgents = new Set(statusChanges.map((e) => e.agentId));
      expect(statusChanges.length).toBe(statusAgents.size);

      // Total should not exceed limit
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});
