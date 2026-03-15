import { describe, it, expect } from 'vitest';
import { deriveAgentsFromKeyframes } from '../useHistoricalAgents';
import type { ReplayKeyframe } from '../useSessionReplay';

function kf(type: ReplayKeyframe['type'], label: string, ts = '2024-01-01T00:00:00Z', agentId?: string): ReplayKeyframe {
  return { type, label, timestamp: ts, ...(agentId ? { agentId } : {}) };
}

describe('deriveAgentsFromKeyframes', () => {
  it('returns empty array for no keyframes', () => {
    expect(deriveAgentsFromKeyframes([])).toEqual([]);
  });

  it('creates agents from spawn events', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: working on feature', undefined, 'a1'),
      kf('spawn', 'Spawned Architect: designing system', undefined, 'a2'),
    ]);
    expect(agents).toHaveLength(2);
    expect(agents[0].role.name).toBe('Developer');
    expect(agents[1].role.name).toBe('Architect');
    expect(agents[0].status).toBe('idle'); // not exited
  });

  it('marks exited agents as terminated', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: task A', undefined, 'a1'),
      kf('spawn', 'Spawned QA Tester: testing', undefined, 'a2'),
      kf('agent_exit', 'Terminated Developer (abc123)'),
    ]);
    expect(agents).toHaveLength(2);
    expect(agents[0].role.name).toBe('Developer');
    expect(agents[0].status).toBe('terminated');
    expect(agents[1].role.name).toBe('QA Tester');
    expect(agents[1].status).toBe('idle'); // still alive
  });

  it('ignores non-spawn/exit keyframes', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('delegation', 'Delegated task to Developer'),
      kf('spawn', 'Spawned Lead: managing', undefined, 'a1'),
      kf('milestone', 'Phase 1 complete'),
      kf('task', 'Task finished'),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0].role.name).toBe('Lead');
  });

  it('assigns known role icons', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'a1'),
      kf('spawn', 'Spawned Architect: design', undefined, 'a2'),
      kf('spawn', 'Spawned Unknown Role: mystery', undefined, 'a3'),
    ]);
    expect(agents[0].role.icon).toBe('💻');
    expect(agents[1].role.icon).toBe('🏗️');
    expect(agents[2].role.icon).toBe('🤖'); // fallback for unknown roles
  });

  it('handles multiple exits of same role', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: task A', undefined, 'a1'),
      kf('spawn', 'Spawned Developer: task B', undefined, 'a2'),
      kf('agent_exit', 'Terminated Developer (aaa)'),
    ]);
    expect(agents).toHaveLength(2);
    // First Developer gets marked terminated, second stays idle
    expect(agents[0].status).toBe('terminated');
    expect(agents[1].status).toBe('idle');
  });

  it('uses real agentId from keyframe when available', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'abc-123-real'),
      kf('spawn', 'Spawned Architect: design', undefined, 'def-456-real'),
    ]);
    expect(agents[0].id).toBe('abc-123-real');
    expect(agents[1].id).toBe('def-456-real');
  });

  it('skips spawn events without agentId', () => {
    const agents = deriveAgentsFromKeyframes([
      kf('spawn', 'Spawned Developer: code', undefined, 'abc-123'),
      kf('spawn', 'Spawned Architect: design'), // no agentId — skipped
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('abc-123');
  });
});
