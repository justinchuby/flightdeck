/**
 * ComplexityMonitor — analyses TypeScript/JavaScript source files for size and
 * structural complexity, surfaces alerts when files exceed configurable thresholds.
 *
 * Metrics collected per file:
 *   - lines        : total line count (split on '\n')
 *   - size         : byte length of source content
 *   - importCount  : number of top-level `import` statements
 *   - exportCount  : number of top-level `export` declarations
 *   - functionCount: heuristic count of function definitions and array callbacks
 *
 * Complexity tier:
 *   critical  → lines > LINE_CRITICAL (600)
 *   high      → lines > LINE_WARNING (300) OR imports > IMPORT_WARNING (20)
 *   medium    → lines > 150 OR functions > 15
 *   low       → everything else
 */

import { readFileSync } from 'fs';
import { isAbsolute, join } from 'path';

// ── Types ─────────────────────────────────────────────────────────────

export interface FileComplexity {
  path: string;
  lines: number;
  size: number; // bytes
  importCount: number;
  exportCount: number;
  functionCount: number;
  complexity: 'low' | 'medium' | 'high' | 'critical';
  lastChecked: number;
}

export interface ComplexityAlert {
  path: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

// ── ComplexityMonitor ─────────────────────────────────────────────────

export class ComplexityMonitor {
  private files: Map<string, FileComplexity> = new Map();
  private projectRoot: string;
  private static readonly MAX_FILES = 5_000;

  // Configurable thresholds (exposed as statics for testability)
  static LINE_WARNING = 300;
  static LINE_CRITICAL = 600;
  static IMPORT_WARNING = 20;
  static FUNCTION_WARNING = 25;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Read and analyse `filePath`.  Relative paths are resolved from `projectRoot`.
   * Returns `null` if the file cannot be read (e.g. does not exist).
   * The result is stored in the internal map and can be retrieved later.
   */
  analyzeFile(filePath: string): FileComplexity | null {
    try {
      const fullPath = isAbsolute(filePath) ? filePath : join(this.projectRoot, filePath);
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;
      const size = Buffer.byteLength(content);

      // Count top-level import / export keywords at the start of a line.
      const importCount = (content.match(/^import\s/gm) ?? []).length;
      const exportCount = (content.match(/^export\s/gm) ?? []).length;

      // Heuristic: named functions, arrow functions, and common array callbacks.
      const functionCount = (
        content.match(
          /(?:function\s+\w|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*\{|\.(?:map|filter|reduce|forEach)\()/gm,
        ) ?? []
      ).length;

      const complexity: FileComplexity['complexity'] =
        lines > ComplexityMonitor.LINE_CRITICAL
          ? 'critical'
          : lines > ComplexityMonitor.LINE_WARNING || importCount > ComplexityMonitor.IMPORT_WARNING
            ? 'high'
            : lines > 150 || functionCount > 15
              ? 'medium'
              : 'low';

      const result: FileComplexity = {
        path: filePath,
        lines,
        size,
        importCount,
        exportCount,
        functionCount,
        complexity,
        lastChecked: Date.now(),
      };

      this.files.set(filePath, result);

      // Evict stalest entry if at capacity
      if (this.files.size > ComplexityMonitor.MAX_FILES) {
        let stalestKey: string | null = null;
        let stalestTime = Infinity;
        for (const [key, f] of this.files) {
          if (f.lastChecked < stalestTime) { stalestTime = f.lastChecked; stalestKey = key; }
        }
        if (stalestKey) this.files.delete(stalestKey);
      }

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Return all alerts for files whose metrics exceed thresholds.
   * Each file can produce multiple alerts (e.g. both lines and imports).
   */
  getAlerts(): ComplexityAlert[] {
    const alerts: ComplexityAlert[] = [];

    for (const file of this.files.values()) {
      if (file.lines > ComplexityMonitor.LINE_CRITICAL) {
        alerts.push({
          path: file.path,
          metric: 'lines',
          value: file.lines,
          threshold: ComplexityMonitor.LINE_CRITICAL,
          severity: 'critical',
        });
      } else if (file.lines > ComplexityMonitor.LINE_WARNING) {
        alerts.push({
          path: file.path,
          metric: 'lines',
          value: file.lines,
          threshold: ComplexityMonitor.LINE_WARNING,
          severity: 'warning',
        });
      }

      if (file.importCount > ComplexityMonitor.IMPORT_WARNING) {
        alerts.push({
          path: file.path,
          metric: 'imports',
          value: file.importCount,
          threshold: ComplexityMonitor.IMPORT_WARNING,
          severity: 'warning',
        });
      }

      if (file.functionCount > ComplexityMonitor.FUNCTION_WARNING) {
        alerts.push({
          path: file.path,
          metric: 'functions',
          value: file.functionCount,
          threshold: ComplexityMonitor.FUNCTION_WARNING,
          severity: 'warning',
        });
      }
    }

    return alerts;
  }

  /** All analysed files. */
  getFiles(): FileComplexity[] {
    return [...this.files.values()];
  }

  /** Look up a previously analysed file by path. */
  getFile(path: string): FileComplexity | undefined {
    return this.files.get(path);
  }

  /** Files rated `high` or `critical`. */
  getHighComplexity(): FileComplexity[] {
    return this.getFiles().filter((f) => f.complexity === 'high' || f.complexity === 'critical');
  }

  /** Remove a file from the internal map (e.g. after deletion). */
  removeFile(path: string): boolean {
    return this.files.delete(path);
  }

  /** Discard all stored analysis results. */
  clear(): void {
    this.files.clear();
  }
}
