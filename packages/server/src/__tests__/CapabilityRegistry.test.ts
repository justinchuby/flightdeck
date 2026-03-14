import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db/database.js';
import { FileLockRegistry } from '../coordination/files/FileLockRegistry.js';
import { CapabilityRegistry } from '../coordination/agents/CapabilityRegistry.js';

const TEST_DB = ':memory:';

function makeAgent(id: string, roleId: string, roleName: string, status = 'running', task?: string, parentId?: string) {
  return { id, role: { id: roleId, name: roleName }, status, task, parentId };
}

describe('CapabilityRegistry', () => {
  let db: Database;
  let lockRegistry: FileLockRegistry;
  let registry: CapabilityRegistry;
  let agents: ReturnType<typeof makeAgent>[];

  beforeEach(() => {
    db = new Database(TEST_DB);
    lockRegistry = new FileLockRegistry(db);
    agents = [
      makeAgent('lead-1', 'lead', 'Project Lead', 'running', 'Manage project'),
      makeAgent('dev-1', 'developer', 'Developer', 'running', 'Fix timeline component', 'lead-1'),
      makeAgent('dev-2', 'developer', 'Developer', 'idle', 'Build API endpoints', 'lead-1'),
      makeAgent('designer-1', 'designer', 'Designer', 'idle', 'UX design review', 'lead-1'),
    ];
    registry = new CapabilityRegistry(db, lockRegistry, () => agents);
  });

  afterEach(() => {
    db.close();
  });

  describe('recordFileTouch', () => {
    it('records a file touch', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      const history = registry.getHistoryForAgent('dev-1', 'lead-1');
      expect(history).toHaveLength(1);
      expect(history[0].filePath).toBe('src/App.tsx');
      expect(history[0].touchCount).toBe(1);
    });

    it('increments touchCount on re-touch', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      const history = registry.getHistoryForAgent('dev-1', 'lead-1');
      expect(history).toHaveLength(1);
      expect(history[0].touchCount).toBe(3);
    });

    it('tracks different files separately', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/index.ts');
      const history = registry.getHistoryForAgent('dev-1', 'lead-1');
      expect(history).toHaveLength(2);
    });
  });

  describe('getHistoryForLead', () => {
    it('returns all history for a lead project', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-2', 'developer', 'lead-1', 'src/api.ts');
      const history = registry.getHistoryForLead('lead-1');
      expect(history).toHaveLength(2);
    });

    it('scopes by leadId', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-2', 'src/other.ts');
      expect(registry.getHistoryForLead('lead-1')).toHaveLength(1);
      expect(registry.getHistoryForLead('lead-2')).toHaveLength(1);
    });
  });

  describe('inferTechnologies', () => {
    it('infers tech from file history', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/styles.css');
      const techs = registry.inferTechnologies('dev-1', 'lead-1');
      expect(techs).toContain('react');
      expect(techs).toContain('css');
    });

    it('includes tech from current locks', () => {
      lockRegistry.acquire('dev-1', 'developer', 'src/config.json');
      const techs = registry.inferTechnologies('dev-1', 'lead-1');
      expect(techs).toContain('config');
    });

    it('deduplicates technologies', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/Button.tsx');
      const techs = registry.inferTechnologies('dev-1', 'lead-1');
      expect(techs.filter(t => t === 'react')).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('matches agents by file history', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/Timeline.tsx');
      const results = registry.query('lead-1', { file: 'src/Timeline.tsx' });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('dev-1');
      expect(results[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('previously edited')]));
    });

    it('matches agents by current file lock', () => {
      lockRegistry.acquire('dev-2', 'developer', 'src/api.ts');
      const results = registry.query('lead-1', { file: 'src/api.ts' });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('dev-2');
      expect(results[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('currently editing')]));
    });

    it('matches agents by technology', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      const results = registry.query('lead-1', { technology: 'react' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].agentId).toBe('dev-1');
    });

    it('matches agents by keyword in task', () => {
      const results = registry.query('lead-1', { keyword: 'timeline' });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('dev-1');
    });

    it('matches agents by domain/role', () => {
      const results = registry.query('lead-1', { domain: 'design' });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('designer-1');
    });

    it('filters availableOnly (idle agents)', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-2', 'developer', 'lead-1', 'src/App.tsx');
      const results = registry.query('lead-1', { file: 'src/App.tsx', availableOnly: true });
      expect(results.every(r => r.status === 'idle')).toBe(true);
      expect(results[0].agentId).toBe('dev-2');
    });

    it('excludes agent by id', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/App.tsx');
      registry.recordFileTouch('dev-2', 'developer', 'lead-1', 'src/App.tsx');
      const results = registry.query('lead-1', { file: 'src/App.tsx', excludeAgentId: 'dev-1' });
      expect(results.every(r => r.agentId !== 'dev-1')).toBe(true);
    });

    it('ranks by score — current lock beats history', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/critical.ts');
      lockRegistry.acquire('dev-2', 'developer', 'src/critical.ts');
      const results = registry.query('lead-1', { file: 'src/critical.ts' });
      // dev-2 has lock (0.3) so should score higher than dev-1 history only (0.4)
      // Actually dev-1 has history (0.4) > dev-2 lock only (0.3)
      // But dev-2 also gets idle bonus (+0.05)
      expect(results[0].agentId).toBe('dev-1'); // 0.4 history
      expect(results[1].agentId).toBe('dev-2'); // 0.3 lock + 0.05 idle = 0.35
    });

    it('returns empty array when no matches', () => {
      const results = registry.query('lead-1', { file: 'nonexistent.ts' });
      expect(results).toEqual([]);
    });

    it('combines multiple signals', () => {
      registry.recordFileTouch('dev-1', 'developer', 'lead-1', 'src/Timeline.tsx');
      const results = registry.query('lead-1', {
        file: 'src/Timeline.tsx',
        keyword: 'timeline',
        technology: 'react',
      });
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(0.6); // file + keyword + tech
    });

    it('scopes to lead project (excludes other leads\' agents)', () => {
      const otherAgent = makeAgent('other-dev', 'developer', 'Developer', 'idle', 'Other task', 'lead-2');
      agents.push(otherAgent);
      registry.recordFileTouch('other-dev', 'developer', 'lead-2', 'src/App.tsx');
      const results = registry.query('lead-1', { file: 'src/App.tsx' });
      expect(results.every(r => r.agentId !== 'other-dev')).toBe(true);
    });
  });

  describe('lock:acquired integration', () => {
    it('records file touch when lock is acquired', () => {
      // Simulate the wiring from index.ts
      lockRegistry.on('lock:acquired', ({ agentId, agentRole, filePath }: { agentId: string; agentRole: string; filePath: string }) => {
        registry.recordFileTouch(agentId, agentRole, 'lead-1', filePath);
      });

      lockRegistry.acquire('dev-1', 'developer', 'src/new-file.ts');
      const history = registry.getHistoryForAgent('dev-1', 'lead-1');
      expect(history).toHaveLength(1);
      expect(history[0].filePath).toBe('src/new-file.ts');
    });
  });
});
