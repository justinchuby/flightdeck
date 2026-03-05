import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybookService, type Playbook, type PlaybookInput } from '../coordination/PlaybookService.js';

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

const sampleInput: PlaybookInput = {
  name: 'Feature Sprint',
  description: 'Standard feature development crew',
  roles: [
    { role: 'Architect', model: 'claude-sonnet', instructions: 'Design first' },
    { role: 'Developer', model: 'claude-sonnet' },
    { role: 'Reviewer' },
  ],
  taskTemplates: [
    { title: 'Design architecture', assignRole: 'Architect' },
    { title: 'Implement feature', assignRole: 'Developer', dependsOn: ['Design architecture'] },
  ],
  settings: { maxAgents: 5 },
};

describe('PlaybookService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: PlaybookService;

  beforeEach(() => {
    db = createMockDb();
    service = new PlaybookService(db as any);
  });

  it('list returns empty array with no playbooks', () => {
    expect(service.list()).toEqual([]);
  });

  it('create adds a playbook and returns it with id/timestamps', () => {
    const result = service.create(sampleInput);
    expect(result.id).toBeDefined();
    expect(result.name).toBe('Feature Sprint');
    expect(result.roles).toHaveLength(3);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it('list returns created playbooks', () => {
    service.create(sampleInput);
    const all = service.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Feature Sprint');
  });

  it('get returns playbook by id', () => {
    const created = service.create(sampleInput);
    const found = service.get(created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Feature Sprint');
  });

  it('get returns undefined for unknown id', () => {
    expect(service.get('nonexistent')).toBeUndefined();
  });

  it('create rejects duplicate names', () => {
    service.create(sampleInput);
    expect(() => service.create(sampleInput)).toThrow('already exists');
  });

  it('update modifies playbook fields', () => {
    const created = service.create(sampleInput);
    const updated = service.update(created.id, { description: 'Updated description' });
    expect(updated.description).toBe('Updated description');
    expect(updated.name).toBe('Feature Sprint');
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('update rejects duplicate names', () => {
    service.create(sampleInput);
    const second = service.create({ ...sampleInput, name: 'Bug Fix' });
    expect(() => service.update(second.id, { name: 'Feature Sprint' })).toThrow('already exists');
  });

  it('update throws for unknown id', () => {
    expect(() => service.update('nonexistent', { description: 'x' })).toThrow('not found');
  });

  it('delete removes a playbook', () => {
    const created = service.create(sampleInput);
    expect(service.delete(created.id)).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it('delete returns false for unknown id', () => {
    expect(service.delete('nonexistent')).toBe(false);
  });

  it('apply returns crew config from playbook', () => {
    const created = service.create(sampleInput);
    const config = service.apply(created.id);
    expect(config.roles).toHaveLength(3);
    expect(config.taskTemplates).toHaveLength(2);
    expect(config.settings).toEqual({ maxAgents: 5 });
  });

  it('apply throws for unknown id', () => {
    expect(() => service.apply('nonexistent')).toThrow('not found');
  });

  it('persists data across service instances', () => {
    service.create(sampleInput);
    const service2 = new PlaybookService(db as any);
    expect(service2.list()).toHaveLength(1);
  });
});
