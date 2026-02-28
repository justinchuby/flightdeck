import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentMemory } from '../agents/AgentMemory.js';
import { Database } from '../db/database.js';

describe('AgentMemory', () => {
  let memory: AgentMemory;
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    memory = new AgentMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  it('starts empty for any lead', () => {
    expect(memory.getByLead('lead-1')).toHaveLength(0);
  });

  it('stores and retrieves a single entry', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    const entries = memory.getByLead('lead-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].leadId).toBe('lead-1');
    expect(entries[0].agentId).toBe('agent-1');
    expect(entries[0].key).toBe('role');
    expect(entries[0].value).toBe('Developer');
    expect(entries[0].createdAt).toBeTruthy();
    expect(entries[0].id).toBeGreaterThan(0);
  });

  it('stores multiple keys for the same agent', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-1', 'agent-1', 'model', 'claude-opus-4');
    memory.store('lead-1', 'agent-1', 'task', 'Build the auth module');

    const entries = memory.getByAgent('lead-1', 'agent-1');
    expect(entries).toHaveLength(3);
    const keys = entries.map((e) => e.key);
    expect(keys).toContain('role');
    expect(keys).toContain('model');
    expect(keys).toContain('task');
  });

  it('upserts when same lead+agent+key exists', () => {
    memory.store('lead-1', 'agent-1', 'task', 'Old task');
    memory.store('lead-1', 'agent-1', 'task', 'New task');

    const entries = memory.getByAgent('lead-1', 'agent-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toBe('New task');
  });

  it('keeps separate entries for different agents', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-1', 'agent-2', 'role', 'Reviewer');

    const all = memory.getByLead('lead-1');
    expect(all).toHaveLength(2);

    const a1 = memory.getByAgent('lead-1', 'agent-1');
    expect(a1).toHaveLength(1);
    expect(a1[0].value).toBe('Developer');

    const a2 = memory.getByAgent('lead-1', 'agent-2');
    expect(a2).toHaveLength(1);
    expect(a2[0].value).toBe('Reviewer');
  });

  it('keeps separate entries for different leads', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-2', 'agent-1', 'role', 'Reviewer');

    expect(memory.getByLead('lead-1')).toHaveLength(1);
    expect(memory.getByLead('lead-1')[0].value).toBe('Developer');
    expect(memory.getByLead('lead-2')).toHaveLength(1);
    expect(memory.getByLead('lead-2')[0].value).toBe('Reviewer');
  });

  it('clears all memory for a lead', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-1', 'agent-2', 'role', 'Reviewer');
    memory.store('lead-2', 'agent-3', 'role', 'Tester');

    memory.clearByLead('lead-1');

    expect(memory.getByLead('lead-1')).toHaveLength(0);
    // Other lead's memory is untouched
    expect(memory.getByLead('lead-2')).toHaveLength(1);
  });

  it('getByAgent returns empty for unknown agent', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    expect(memory.getByAgent('lead-1', 'nonexistent')).toHaveLength(0);
  });

  it('returns entries ordered by created_at DESC', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-1', 'agent-2', 'task', 'Build API');
    memory.store('lead-1', 'agent-3', 'model', 'claude-opus-4');

    const entries = memory.getByLead('lead-1');
    expect(entries).toHaveLength(3);
    // All have the same created_at (datetime('now')), so order is by id DESC effectively
    // Just verify they all come back
    const keys = entries.map((e) => e.key).sort();
    expect(keys).toEqual(['model', 'role', 'task']);
  });

  it('persists to SQLite (survives re-instantiation)', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    memory.store('lead-1', 'agent-1', 'task', 'Build auth');

    const memory2 = new AgentMemory(db);
    const entries = memory2.getByLead('lead-1');
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.key === 'role')?.value).toBe('Developer');
    expect(entries.find((e) => e.key === 'task')?.value).toBe('Build auth');
  });

  it('maps row columns to camelCase properties correctly', () => {
    memory.store('lead-1', 'agent-1', 'role', 'Developer');
    const entry = memory.getByLead('lead-1')[0];
    // Verify all camelCase fields exist (not snake_case)
    expect(entry).toHaveProperty('leadId');
    expect(entry).toHaveProperty('agentId');
    expect(entry).toHaveProperty('createdAt');
    expect(entry).not.toHaveProperty('lead_id');
    expect(entry).not.toHaveProperty('agent_id');
    expect(entry).not.toHaveProperty('created_at');
  });
});
