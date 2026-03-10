import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { ComplexityMonitor } from '../coordination/code-quality/ComplexityMonitor.js';

// ── Fixture helpers ───────────────────────────────────────────────────

const TMP_ROOT = join('/tmp', `complexity-monitor-test-${process.pid}`);

/** Generate a TypeScript source string with `n` lines of content. */
function generateSource(opts: {
  lines?: number;
  imports?: number;
  exports?: number;
  functions?: number;
}): string {
  const parts: string[] = [];

  const imports = opts.imports ?? 0;
  for (let i = 0; i < imports; i++) {
    parts.push(`import { thing${i} } from './module${i}.js';`);
  }

  const exports = opts.exports ?? 0;
  for (let i = 0; i < exports; i++) {
    parts.push(`export const val${i} = ${i};`);
  }

  const functions = opts.functions ?? 0;
  for (let i = 0; i < functions; i++) {
    parts.push(`function fn${i}() { return ${i}; }`);
  }

  // Pad to the requested line count with blank comment lines.
  const target = opts.lines ?? parts.length;
  while (parts.length < target) {
    parts.push('// padding');
  }

  return parts.join('\n');
}

function writeFixture(name: string, content: string): string {
  const path = join(TMP_ROOT, name);
  writeFileSync(path, content, 'utf-8');
  return name; // return relative path (relative to TMP_ROOT)
}

// ── Suite ─────────────────────────────────────────────────────────────

describe('ComplexityMonitor', () => {
  let monitor: ComplexityMonitor;

  beforeAll(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    monitor = new ComplexityMonitor(TMP_ROOT);
  });

  // ── analyzeFile ───────────────────────────────────────────────────

  it('returns null for a non-existent file', () => {
    const result = monitor.analyzeFile('does-not-exist.ts');
    expect(result).toBeNull();
  });

  it('analyses a simple low-complexity file', () => {
    const path = writeFixture('low.ts', generateSource({ lines: 50 }));
    const result = monitor.analyzeFile(path);
    expect(result).not.toBeNull();
    expect(result!.lines).toBeGreaterThanOrEqual(50);
    expect(result!.complexity).toBe('low');
  });

  it('rates a file with >150 lines as medium', () => {
    const path = writeFixture('medium.ts', generateSource({ lines: 200 }));
    const result = monitor.analyzeFile(path);
    expect(result!.complexity).toBe('medium');
  });

  it('rates a file with >300 lines as high', () => {
    const path = writeFixture('high-lines.ts', generateSource({ lines: 350 }));
    const result = monitor.analyzeFile(path);
    expect(result!.complexity).toBe('high');
  });

  it('rates a file with >20 imports as high regardless of line count', () => {
    const path = writeFixture('high-imports.ts', generateSource({ lines: 100, imports: 25 }));
    const result = monitor.analyzeFile(path);
    expect(result!.importCount).toBe(25);
    expect(result!.complexity).toBe('high');
  });

  it('rates a file with >600 lines as critical', () => {
    const path = writeFixture('critical.ts', generateSource({ lines: 700 }));
    const result = monitor.analyzeFile(path);
    expect(result!.complexity).toBe('critical');
  });

  it('counts export declarations', () => {
    const path = writeFixture('exports.ts', generateSource({ exports: 5, lines: 10 }));
    const result = monitor.analyzeFile(path);
    expect(result!.exportCount).toBe(5);
  });

  it('counts function definitions', () => {
    const src = Array.from({ length: 10 }, (_, i) => `function fn${i}() {}`).join('\n');
    const path = writeFixture('funcs.ts', src);
    const result = monitor.analyzeFile(path);
    expect(result!.functionCount).toBe(10);
  });

  it('stores result in internal map', () => {
    const path = writeFixture('stored.ts', generateSource({ lines: 20 }));
    monitor.analyzeFile(path);
    expect(monitor.getFile(path)).toBeDefined();
  });

  it('accepts absolute paths', () => {
    const absPath = join(TMP_ROOT, 'absolute.ts');
    writeFileSync(absPath, generateSource({ lines: 30 }), 'utf-8');
    const result = monitor.analyzeFile(absPath);
    expect(result).not.toBeNull();
    expect(result!.lines).toBeGreaterThanOrEqual(30);
  });

  // ── getAlerts ─────────────────────────────────────────────────────

  it('produces no alerts for low-complexity files', () => {
    writeFixture('no-alert.ts', generateSource({ lines: 50 }));
    monitor.analyzeFile('no-alert.ts');
    expect(monitor.getAlerts()).toHaveLength(0);
  });

  it('produces a warning alert for lines > LINE_WARNING', () => {
    const path = writeFixture('warn-lines.ts', generateSource({ lines: 400 }));
    monitor.analyzeFile(path);
    const alerts = monitor.getAlerts();
    const lineAlert = alerts.find((a) => a.metric === 'lines' && a.severity === 'warning');
    expect(lineAlert).toBeDefined();
    expect(lineAlert!.threshold).toBe(ComplexityMonitor.LINE_WARNING);
  });

  it('produces a critical alert for lines > LINE_CRITICAL', () => {
    const path = writeFixture('crit-lines.ts', generateSource({ lines: 700 }));
    monitor.analyzeFile(path);
    const alerts = monitor.getAlerts();
    const crit = alerts.find((a) => a.metric === 'lines' && a.severity === 'critical');
    expect(crit).toBeDefined();
    expect(crit!.value).toBeGreaterThan(ComplexityMonitor.LINE_CRITICAL);
  });

  it('does NOT produce both a warning and critical lines alert for the same file', () => {
    const path = writeFixture('only-crit.ts', generateSource({ lines: 700 }));
    monitor.analyzeFile(path);
    const lineAlerts = monitor.getAlerts().filter((a) => a.metric === 'lines');
    expect(lineAlerts).toHaveLength(1);
    expect(lineAlerts[0].severity).toBe('critical');
  });

  it('produces an imports warning when imports > IMPORT_WARNING', () => {
    const path = writeFixture('many-imports.ts', generateSource({ imports: 30, lines: 60 }));
    monitor.analyzeFile(path);
    const importAlert = monitor.getAlerts().find((a) => a.metric === 'imports');
    expect(importAlert).toBeDefined();
    expect(importAlert!.severity).toBe('warning');
  });

  it('produces a functions warning when functions > FUNCTION_WARNING', () => {
    const src = Array.from({ length: 30 }, (_, i) => `function f${i}() {}`).join('\n');
    const path = writeFixture('many-funcs.ts', src);
    monitor.analyzeFile(path);
    const fnAlert = monitor.getAlerts().find((a) => a.metric === 'functions');
    expect(fnAlert).toBeDefined();
  });

  it('getAlerts can surface multiple alerts for the same file', () => {
    // >600 lines and >20 imports simultaneously
    const path = writeFixture('multi-alert.ts', generateSource({ lines: 700, imports: 25 }));
    monitor.analyzeFile(path);
    const alerts = monitor.getAlerts().filter((a) => a.path === path);
    // At minimum: critical lines + import warning
    expect(alerts.length).toBeGreaterThanOrEqual(2);
  });

  // ── getFiles / getHighComplexity ──────────────────────────────────

  it('getFiles returns all analysed files', () => {
    writeFixture('f1.ts', generateSource({ lines: 10 }));
    writeFixture('f2.ts', generateSource({ lines: 10 }));
    monitor.analyzeFile('f1.ts');
    monitor.analyzeFile('f2.ts');
    expect(monitor.getFiles()).toHaveLength(2);
  });

  it('getHighComplexity returns only high/critical files', () => {
    writeFixture('low2.ts', generateSource({ lines: 50 }));
    writeFixture('high2.ts', generateSource({ lines: 400 }));
    writeFixture('crit2.ts', generateSource({ lines: 700 }));
    monitor.analyzeFile('low2.ts');
    monitor.analyzeFile('high2.ts');
    monitor.analyzeFile('crit2.ts');

    const hc = monitor.getHighComplexity();
    expect(hc.some((f) => f.complexity === 'low')).toBe(false);
    expect(hc.length).toBe(2);
  });

  // ── removeFile / clear ────────────────────────────────────────────

  it('removeFile removes the entry from the map', () => {
    const path = writeFixture('remove-me.ts', generateSource({ lines: 10 }));
    monitor.analyzeFile(path);
    expect(monitor.getFile(path)).toBeDefined();
    monitor.removeFile(path);
    expect(monitor.getFile(path)).toBeUndefined();
  });

  it('clear() resets all stored results', () => {
    writeFixture('cl1.ts', generateSource({ lines: 10 }));
    writeFixture('cl2.ts', generateSource({ lines: 10 }));
    monitor.analyzeFile('cl1.ts');
    monitor.analyzeFile('cl2.ts');
    monitor.clear();
    expect(monitor.getFiles()).toHaveLength(0);
    expect(monitor.getAlerts()).toHaveLength(0);
  });
});
