import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { DependencyScanner } from '../coordination/files/DependencyScanner.js';

// ── Fixture helpers ───────────────────────────────────────────────────

const TMP_ROOT = join('/tmp', `dependency-scanner-test-${process.pid}`);

interface PkgSpec {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function writePackageJson(dir: string, spec: PkgSpec): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(spec, null, 2), 'utf-8');
}

// ── Suite ─────────────────────────────────────────────────────────────

describe('DependencyScanner', () => {
  let scanner: DependencyScanner;

  beforeAll(() => {
    // Root package with both production and dev deps
    writePackageJson(TMP_ROOT, {
      name: 'test-root',
      dependencies: {
        express: '^5.0.0',
        zod: '^4.0.0',
      },
      devDependencies: {
        typescript: '^5.0.0',
        vitest: '^3.0.0',
        tsx: '^4.0.0',
      },
    });

    // packages/server
    writePackageJson(join(TMP_ROOT, 'packages', 'server'), {
      name: '@test/server',
      dependencies: { ws: '^8.0.0' },
      devDependencies: { '@types/ws': '^8.0.0' },
    });

    // packages/web
    writePackageJson(join(TMP_ROOT, 'packages', 'web'), {
      name: '@test/web',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    });
  });

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    scanner = new DependencyScanner(TMP_ROOT);
  });

  // ── scan ──────────────────────────────────────────────────────────

  it('returns empty array when package.json does not exist', () => {
    const s = new DependencyScanner('/tmp/definitely-does-not-exist-xyz');
    expect(s.scan()).toEqual([]);
  });

  it('returns empty array for an explicit missing path', () => {
    expect(scanner.scan('/tmp/no-pkg.json')).toEqual([]);
  });

  it('parses production dependencies correctly', () => {
    const deps = scanner.scan();
    const prod = deps.filter((d) => d.type === 'production');
    expect(prod.map((d) => d.name).sort()).toEqual(['express', 'zod']);
    expect(prod.find((d) => d.name === 'express')?.version).toBe('^5.0.0');
  });

  it('parses dev dependencies correctly', () => {
    const deps = scanner.scan();
    const dev = deps.filter((d) => d.type === 'dev');
    expect(dev.map((d) => d.name).sort()).toEqual(['tsx', 'typescript', 'vitest']);
  });

  it('returns empty array for malformed JSON', () => {
    const badPath = join(TMP_ROOT, 'bad.json');
    writeFileSync(badPath, 'not { valid json', 'utf-8');
    expect(scanner.scan(badPath)).toEqual([]);
  });

  it('handles a package with no dependencies gracefully', () => {
    const emptyDir = join(TMP_ROOT, 'empty-pkg');
    writePackageJson(emptyDir, { name: 'empty' });
    expect(scanner.scan(join(emptyDir, 'package.json'))).toEqual([]);
  });

  // ── getDependencyCount ────────────────────────────────────────────

  it('getDependencyCount returns correct breakdown', () => {
    const counts = scanner.getDependencyCount();
    expect(counts.production).toBe(2); // express, zod
    expect(counts.dev).toBe(3);        // typescript, vitest, tsx
    expect(counts.total).toBe(5);
  });

  // ── scanWorkspaces ────────────────────────────────────────────────

  it('scanWorkspaces includes root', () => {
    const ws = scanner.scanWorkspaces();
    expect(ws['root']).toBeDefined();
    expect(ws['root'].length).toBeGreaterThan(0);
  });

  it('scanWorkspaces discovers packages/ sub-packages', () => {
    const ws = scanner.scanWorkspaces();
    expect(ws['packages/server']).toBeDefined();
    expect(ws['packages/web']).toBeDefined();
  });

  it('scanWorkspaces lists deps in sub-packages', () => {
    const ws = scanner.scanWorkspaces();
    const serverDeps = ws['packages/server'];
    expect(serverDeps.some((d) => d.name === 'ws' && d.type === 'production')).toBe(true);
    expect(serverDeps.some((d) => d.name === '@types/ws' && d.type === 'dev')).toBe(true);
  });

  it('scanWorkspaces returns empty array for packages without package.json', () => {
    // Create a dir inside packages/ but without a package.json
    const emptyPkgDir = join(TMP_ROOT, 'packages', 'orphan');
    mkdirSync(emptyPkgDir, { recursive: true });
    const ws = scanner.scanWorkspaces();
    // 'packages/orphan' should not appear because it has no package.json
    expect(ws['packages/orphan']).toBeUndefined();
  });

  // ── findDependency ────────────────────────────────────────────────

  it('findDependency locates a dep across workspaces', () => {
    const found = scanner.findDependency('ws');
    expect(found['packages/server']).toBeDefined();
    expect(found['packages/server'].version).toBe('^8.0.0');
  });

  it('findDependency returns empty object when dep is not found', () => {
    const found = scanner.findDependency('does-not-exist');
    expect(Object.keys(found)).toHaveLength(0);
  });

  it('findDependency searches the root too', () => {
    const found = scanner.findDependency('express');
    expect(found['root']).toBeDefined();
    expect(found['root'].type).toBe('production');
  });
});
