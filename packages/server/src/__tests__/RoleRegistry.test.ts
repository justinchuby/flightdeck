import { describe, it, expect, beforeEach } from 'vitest';
import { RoleRegistry } from '../agents/RoleRegistry.js';

describe('RoleRegistry', () => {
  let registry: RoleRegistry;

  beforeEach(() => {
    registry = new RoleRegistry();
  });

  it('has 12 built-in roles on construction', () => {
    const roles = registry.getAll();
    expect(roles.length).toBe(12);
    expect(roles.every((r) => r.builtIn === true)).toBe(true);
  });

  it('can get a role by id', () => {
    const role = registry.get('architect');
    expect(role).toBeDefined();
    expect(role!.name).toBe('Architect');
    expect(role!.builtIn).toBe(true);
  });

  it('can register a custom role', () => {
    const custom = registry.register({
      id: 'devops',
      name: 'DevOps Engineer',
      description: 'Infrastructure and deployment',
      systemPrompt: 'You are a DevOps engineer.',
      color: '#00ff00',
      icon: '🚀',
    });

    expect(custom.builtIn).toBe(false);
    expect(registry.get('devops')).toEqual(custom);
    expect(registry.getAll().length).toBe(13);
  });

  it('can remove a custom role', () => {
    registry.register({
      id: 'devops',
      name: 'DevOps Engineer',
      description: 'Infrastructure and deployment',
      systemPrompt: 'You are a DevOps engineer.',
      color: '#00ff00',
      icon: '🚀',
    });

    const removed = registry.remove('devops');
    expect(removed).toBe(true);
    expect(registry.get('devops')).toBeUndefined();
    expect(registry.getAll().length).toBe(12);
  });

  it('cannot remove a built-in role', () => {
    const removed = registry.remove('architect');
    expect(removed).toBe(false);
    expect(registry.get('architect')).toBeDefined();
  });

  it('getAll returns all roles', () => {
    registry.register({
      id: 'devops',
      name: 'DevOps Engineer',
      description: 'Infrastructure and deployment',
      systemPrompt: 'You are a DevOps engineer.',
      color: '#00ff00',
      icon: '🚀',
    });

    const all = registry.getAll();
    expect(all.length).toBe(13);
    const ids = all.map((r) => r.id);
    expect(ids).toContain('architect');
    expect(ids).toContain('developer');
    expect(ids).toContain('devops');
  });
});
