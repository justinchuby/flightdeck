import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeTransfer } from '../coordination/knowledge/KnowledgeTransfer.js';
import type { KnowledgeCategory } from '../coordination/knowledge/KnowledgeTransfer.js';

describe('KnowledgeTransfer', () => {
  let kb: KnowledgeTransfer;

  beforeEach(() => {
    kb = new KnowledgeTransfer();
  });

  // ── capture ────────────────────────────────────────────────────────────────

  it('capture stores an entry and returns it with id, createdAt, useCount=0', () => {
    const entry = kb.capture({
      projectId: 'proj-1',
      category: 'pattern',
      title: 'Repository pattern',
      content: 'Use repositories to abstract DB access',
      tags: ['db', 'architecture'],
    });

    expect(entry.id).toMatch(/^kb-/);
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.useCount).toBe(0);
    expect(entry.projectId).toBe('proj-1');
    expect(entry.category).toBe('pattern');
    expect(entry.title).toBe('Repository pattern');
  });

  it('capture increments size correctly', () => {
    expect(kb.size()).toBe(0);
    kb.capture({ projectId: 'p', category: 'tool', title: 'A', content: 'B', tags: [] });
    kb.capture({ projectId: 'p', category: 'tool', title: 'C', content: 'D', tags: [] });
    expect(kb.size()).toBe(2);
  });

  it('each captured entry gets a unique ID', () => {
    const a = kb.capture({ projectId: 'p', category: 'pattern', title: 'A', content: '', tags: [] });
    const b = kb.capture({ projectId: 'p', category: 'pattern', title: 'B', content: '', tags: [] });
    expect(a.id).not.toBe(b.id);
  });

  // ── getAll ────────────────────────────────────────────────────────────────

  it('getAll returns all captured entries', () => {
    kb.capture({ projectId: 'p1', category: 'pitfall', title: 'T1', content: '', tags: [] });
    kb.capture({ projectId: 'p2', category: 'tool', title: 'T2', content: '', tags: [] });
    expect(kb.getAll()).toHaveLength(2);
  });

  it('getAll returns a copy — mutating it does not affect internal state', () => {
    kb.capture({ projectId: 'p', category: 'pattern', title: 'X', content: '', tags: [] });
    const all = kb.getAll();
    all.pop();
    expect(kb.size()).toBe(1);
  });

  // ── getEntry ──────────────────────────────────────────────────────────────

  it('getEntry returns the entry by ID', () => {
    const saved = kb.capture({ projectId: 'p', category: 'process', title: 'Retro', content: 'Hold weekly retros', tags: ['process'] });
    expect(kb.getEntry(saved.id)).toEqual(saved);
  });

  it('getEntry returns undefined for unknown ID', () => {
    expect(kb.getEntry('kb-unknown')).toBeUndefined();
  });

  // ── search ────────────────────────────────────────────────────────────────

  it('search returns matching entries (single term)', () => {
    kb.capture({ projectId: 'p', category: 'pattern', title: 'React hooks', content: 'Use hooks for state', tags: [] });
    kb.capture({ projectId: 'p', category: 'pitfall', title: 'Memory leak',  content: 'Clean up subscriptions', tags: [] });
    const results = kb.search('hooks');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('React hooks');
  });

  it('search requires all terms to match (AND semantics)', () => {
    kb.capture({ projectId: 'p', category: 'tool', title: 'Docker setup', content: 'Use compose for local dev', tags: [] });
    kb.capture({ projectId: 'p', category: 'tool', title: 'Docker tips',   content: 'Use multi-stage builds', tags: [] });
    const results = kb.search('docker compose');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Docker setup');
  });

  it('search matches content and tags as well as title', () => {
    kb.capture({ projectId: 'p', category: 'architecture', title: 'Caching',  content: 'Use Redis for caching hot data', tags: ['redis'] });
    expect(kb.search('redis')).toHaveLength(1);
    expect(kb.search('hot data')).toHaveLength(1);
  });

  it('search sorts results by useCount descending', () => {
    const a = kb.capture({ projectId: 'p', category: 'tool', title: 'alpha', content: 'shared', tags: [] });
    const b = kb.capture({ projectId: 'p', category: 'tool', title: 'beta',  content: 'shared', tags: [] });
    kb.recordUse(b.id);
    kb.recordUse(b.id);
    kb.recordUse(a.id);
    const results = kb.search('shared');
    expect(results[0].id).toBe(b.id); // b has higher useCount
  });

  it('search returns empty array for empty query', () => {
    kb.capture({ projectId: 'p', category: 'pattern', title: 'X', content: 'Y', tags: [] });
    expect(kb.search('')).toHaveLength(0);
  });

  it('search returns empty array when nothing matches', () => {
    kb.capture({ projectId: 'p', category: 'pattern', title: 'X', content: 'Y', tags: [] });
    expect(kb.search('zzznomatch')).toHaveLength(0);
  });

  // ── getByProject ──────────────────────────────────────────────────────────

  it('getByProject filters entries by projectId', () => {
    kb.capture({ projectId: 'proj-A', category: 'pattern', title: 'P1', content: '', tags: [] });
    kb.capture({ projectId: 'proj-B', category: 'pattern', title: 'P2', content: '', tags: [] });
    kb.capture({ projectId: 'proj-A', category: 'tool',    title: 'T1', content: '', tags: [] });
    expect(kb.getByProject('proj-A')).toHaveLength(2);
    expect(kb.getByProject('proj-B')).toHaveLength(1);
    expect(kb.getByProject('proj-C')).toHaveLength(0);
  });

  // ── getByCategory ─────────────────────────────────────────────────────────

  it('getByCategory returns only entries of the requested category', () => {
    const cats: KnowledgeCategory[] = ['pattern', 'pitfall', 'tool', 'architecture', 'process'];
    for (const cat of cats) {
      kb.capture({ projectId: 'p', category: cat, title: `${cat} entry`, content: '', tags: [] });
    }
    for (const cat of cats) {
      const results = kb.getByCategory(cat);
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe(cat);
    }
  });

  // ── getByTag ──────────────────────────────────────────────────────────────

  it('getByTag returns entries containing the tag', () => {
    kb.capture({ projectId: 'p', category: 'tool', title: 'ESLint', content: '', tags: ['lint', 'dx'] });
    kb.capture({ projectId: 'p', category: 'tool', title: 'Prettier', content: '', tags: ['format', 'dx'] });
    kb.capture({ projectId: 'p', category: 'tool', title: 'Jest', content: '', tags: ['test'] });
    expect(kb.getByTag('dx')).toHaveLength(2);
    expect(kb.getByTag('lint')).toHaveLength(1);
    expect(kb.getByTag('missing')).toHaveLength(0);
  });

  // ── recordUse ─────────────────────────────────────────────────────────────

  it('recordUse increments the useCount of the entry', () => {
    const entry = kb.capture({ projectId: 'p', category: 'pattern', title: 'X', content: '', tags: [] });
    expect(entry.useCount).toBe(0);
    kb.recordUse(entry.id);
    kb.recordUse(entry.id);
    expect(kb.getEntry(entry.id)!.useCount).toBe(2);
  });

  it('recordUse does nothing for unknown IDs', () => {
    expect(() => kb.recordUse('kb-ghost')).not.toThrow();
  });

  // ── getPopular ────────────────────────────────────────────────────────────

  it('getPopular returns entries sorted by useCount descending', () => {
    const a = kb.capture({ projectId: 'p', category: 'pattern', title: 'A', content: '', tags: [] });
    const b = kb.capture({ projectId: 'p', category: 'pattern', title: 'B', content: '', tags: [] });
    const c = kb.capture({ projectId: 'p', category: 'pattern', title: 'C', content: '', tags: [] });
    kb.recordUse(c.id); kb.recordUse(c.id); kb.recordUse(c.id);
    kb.recordUse(a.id);
    const popular = kb.getPopular(3);
    expect(popular[0].id).toBe(c.id);
    expect(popular[1].id).toBe(a.id);
    expect(popular[2].id).toBe(b.id);
  });

  it('getPopular respects the limit parameter', () => {
    for (let i = 0; i < 15; i++) {
      kb.capture({ projectId: 'p', category: 'tool', title: `Tool ${i}`, content: '', tags: [] });
    }
    expect(kb.getPopular(5)).toHaveLength(5);
    expect(kb.getPopular(10)).toHaveLength(10);
  });

  it('getPopular defaults to 10 entries', () => {
    for (let i = 0; i < 12; i++) {
      kb.capture({ projectId: 'p', category: 'tool', title: `T${i}`, content: '', tags: [] });
    }
    expect(kb.getPopular()).toHaveLength(10);
  });

  it('getPopular does not mutate internal entry list order', () => {
    const a = kb.capture({ projectId: 'p', category: 'pattern', title: 'A', content: '', tags: [] });
    const b = kb.capture({ projectId: 'p', category: 'pattern', title: 'B', content: '', tags: [] });
    kb.recordUse(b.id);
    kb.getPopular(); // call once to sort
    // insertion order in getAll should be unchanged
    const all = kb.getAll();
    expect(all[0].id).toBe(a.id);
    expect(all[1].id).toBe(b.id);
  });
});
