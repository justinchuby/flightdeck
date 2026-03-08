/**
 * DependencyScanner — reads package.json files in the workspace and surfaces
 * basic dependency information (name, version, type).
 *
 * This is a *static* scanner — it reads from disk only and does not perform
 * network requests.  Version-outdatedness checking (e.g. against the npm
 * registry) is intentionally left outside this module's scope; the `outdated`
 * field on `DependencyInfo` is reserved for callers that want to populate it
 * via an external source.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Types ─────────────────────────────────────────────────────────────

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'production' | 'dev';
  /** Optional: populated externally when outdatedness is known. */
  outdated?: boolean;
}

// ── DependencyScanner ─────────────────────────────────────────────────

export class DependencyScanner {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Parse the `package.json` at `packagePath` (defaults to
   * `<projectRoot>/package.json`) and return all dependencies.
   *
   * Returns an empty array when the file is missing or malformed.
   */
  scan(packagePath?: string): DependencyInfo[] {
    const pkgPath = packagePath ?? join(this.projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return [];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps: DependencyInfo[] = [];

      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        deps.push({ name, version: version as string, type: 'production' });
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        deps.push({ name, version: version as string, type: 'dev' });
      }

      return deps;
    } catch {
      return [];
    }
  }

  /**
   * Scan every workspace package under `packages/` as well as the root,
   * returning a map keyed by `'root'` or `'packages/<dir>'`.
   */
  scanWorkspaces(): Record<string, DependencyInfo[]> {
    const results: Record<string, DependencyInfo[]> = {};

    // Root package.json
    results['root'] = this.scan();

    // Sub-packages
    const packagesDir = join(this.projectRoot, 'packages');
    if (existsSync(packagesDir)) {
      try {
        for (const dir of readdirSync(packagesDir)) {
          const pkgPath = join(packagesDir, dir, 'package.json');
          if (existsSync(pkgPath)) {
            results[`packages/${dir}`] = this.scan(pkgPath);
          }
        }
      } catch {
        // Ignore — partial results are still useful.
      }
    }

    return results;
  }

  /**
   * Count production vs. dev dependencies in the root `package.json`.
   */
  getDependencyCount(): { production: number; dev: number; total: number } {
    const deps = this.scan();
    const production = deps.filter((d) => d.type === 'production').length;
    const dev = deps.filter((d) => d.type === 'dev').length;
    return { production, dev, total: deps.length };
  }

  /**
   * Find a specific dependency by name across all workspace packages.
   * Returns a map of `packageKey → DependencyInfo` for each workspace that
   * declares the dependency.
   */
  findDependency(name: string): Record<string, DependencyInfo> {
    const workspaces = this.scanWorkspaces();
    const found: Record<string, DependencyInfo> = {};

    for (const [pkg, deps] of Object.entries(workspaces)) {
      const match = deps.find((d) => d.name === name);
      if (match) found[pkg] = match;
    }

    return found;
  }
}
