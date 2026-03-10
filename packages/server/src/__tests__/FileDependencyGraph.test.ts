import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileDependencyGraph } from '../coordination/files/FileDependencyGraph.js';

// Helper: write a file at a path relative to the project root
function write(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(root, relPath.replace(/\/[^/]+$/, '')), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

describe('FileDependencyGraph', () => {
  let root: string;
  let graph: FileDependencyGraph;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dep-graph-'));
    graph = new FileDependencyGraph(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('extracts import paths from TypeScript files', () => {
    write(root, 'src/utils.ts', `export const x = 1;`);
    write(root, 'src/index.ts', `
      import { x } from './utils.js';
      import { y } from './helpers.js';
    `);
    write(root, 'src/helpers.ts', `export const y = 2;`);

    const imports = graph.analyzeFile('src/index.ts');
    expect(imports).toContain('src/utils.ts');
    expect(imports).toContain('src/helpers.ts');
  });

  it('builds reverse dependency graph (importedBy)', () => {
    write(root, 'src/utils.ts', `export const x = 1;`);
    write(root, 'src/index.ts', `import { x } from './utils.js';`);

    graph.analyzeFile('src/index.ts');

    expect(graph.getImportedBy('src/utils.ts')).toContain('src/index.ts');
    expect(graph.getImports('src/index.ts')).toContain('src/utils.ts');
  });

  it('getImpact returns direct and transitive dependents', () => {
    // utils <- index <- app
    write(root, 'src/utils.ts', `export const x = 1;`);
    write(root, 'src/index.ts', `import { x } from './utils.js';`);
    write(root, 'src/app.ts', `import something from './index.js';`);

    graph.analyzeFile('src/index.ts');
    graph.analyzeFile('src/app.ts');

    const impact = graph.getImpact('src/utils.ts');
    expect(impact.directDependents).toContain('src/index.ts');
    expect(impact.transitiveDependents).toContain('src/app.ts');
    expect(impact.depth).toBeGreaterThan(0);
  });

  it('handles circular imports without infinite loop', () => {
    write(root, 'src/a.ts', `import { b } from './b.js';`);
    write(root, 'src/b.ts', `import { a } from './a.js';`);

    graph.analyzeFile('src/a.ts');
    graph.analyzeFile('src/b.ts');

    // Should complete without hanging and return sensible results
    const impact = graph.getImpact('src/a.ts');
    expect(Array.isArray(impact.directDependents)).toBe(true);
    expect(Array.isArray(impact.transitiveDependents)).toBe(true);
  });

  it('resolves relative import paths correctly', () => {
    mkdirSync(join(root, 'src/deep'), { recursive: true });
    write(root, 'src/shared/types.ts', `export type T = string;`);
    write(root, 'src/deep/module.ts', `import type { T } from '../shared/types.js';`);

    const imports = graph.analyzeFile('src/deep/module.ts');
    expect(imports).toContain('src/shared/types.ts');
  });

  it('ignores node_modules imports', () => {
    write(root, 'src/index.ts', `
      import express from 'express';
      import { readFileSync } from 'fs';
      import { x } from './utils.js';
    `);
    write(root, 'src/utils.ts', `export const x = 1;`);

    const imports = graph.analyzeFile('src/index.ts');
    expect(imports).not.toContain('express');
    expect(imports).not.toContain('fs');
    expect(imports).toContain('src/utils.ts');
  });

  it('handles missing files gracefully', () => {
    // File doesn't exist — should return [] without throwing
    const imports = graph.analyzeFile('src/nonexistent.ts');
    expect(imports).toEqual([]);
    expect(graph.nodeCount).toBe(0);
  });

  it('analyzeFile updates existing node when imports change', () => {
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `export const b = 2;`);
    write(root, 'src/index.ts', `import { a } from './a.js';`);

    graph.analyzeFile('src/index.ts');
    expect(graph.getImports('src/index.ts')).toContain('src/a.ts');
    expect(graph.getImportedBy('src/a.ts')).toContain('src/index.ts');

    // Now update index.ts to import b instead of a
    writeFileSync(join(root, 'src/index.ts'), `import { b } from './b.js';`);
    graph.analyzeFile('src/index.ts');

    expect(graph.getImports('src/index.ts')).toContain('src/b.ts');
    expect(graph.getImports('src/index.ts')).not.toContain('src/a.ts');
    // Reverse edge for a.ts should be removed
    expect(graph.getImportedBy('src/a.ts')).not.toContain('src/index.ts');
    expect(graph.getImportedBy('src/b.ts')).toContain('src/index.ts');
  });

  it('getImpact returns empty result for unknown file', () => {
    const impact = graph.getImpact('src/unknown.ts');
    expect(impact.directDependents).toEqual([]);
    expect(impact.transitiveDependents).toEqual([]);
    expect(impact.depth).toBe(0);
  });

  it('analyzeDirectory scans all TS/JS files and skips node_modules', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'src/node_modules'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), `export const a = 1;`);
    writeFileSync(join(root, 'src/b.ts'), `import { a } from './a.js';`);
    writeFileSync(join(root, 'src/node_modules/pkg.ts'), `// should be skipped`);

    const count = graph.analyzeDirectory('src');
    expect(count).toBe(2); // a.ts + b.ts, not node_modules/pkg.ts
    expect(graph.getFiles().some(f => f.includes('node_modules'))).toBe(false);
  });

  it('require() calls are tracked as imports', () => {
    write(root, 'src/dep.ts', `export const x = 1;`);
    write(root, 'src/consumer.ts', `const dep = require('./dep.js');`);

    const imports = graph.analyzeFile('src/consumer.ts');
    expect(imports).toContain('src/dep.ts');
  });

  it('re-export from syntax is tracked', () => {
    write(root, 'src/base.ts', `export const base = 1;`);
    write(root, 'src/barrel.ts', `export { base } from './base.js';`);

    const imports = graph.analyzeFile('src/barrel.ts');
    expect(imports).toContain('src/base.ts');
  });

  it('maxDepth limits transitive traversal', () => {
    // Chain: a <- b <- c <- d <- e <- f (depth 5 from a)
    write(root, 'src/a.ts', `export const a = 1;`);
    write(root, 'src/b.ts', `import { a } from './a.js';`);
    write(root, 'src/c.ts', `import { b } from './b.js';`);
    write(root, 'src/d.ts', `import { c } from './c.js';`);
    write(root, 'src/e.ts', `import { d } from './d.js';`);
    write(root, 'src/f.ts', `import { e } from './e.js';`);

    for (const f of ['b', 'c', 'd', 'e', 'f']) {
      graph.analyzeFile(`src/${f}.ts`);
    }

    const impact1 = graph.getImpact('src/a.ts', 1);
    expect(impact1.transitiveDependents).not.toContain('src/c.ts');

    const impact3 = graph.getImpact('src/a.ts', 3);
    expect(impact3.transitiveDependents).toContain('src/c.ts');
    expect(impact3.transitiveDependents).not.toContain('src/f.ts');
  });
});
