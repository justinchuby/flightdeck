import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const { join, dirname, resolve, relative, isAbsolute } = path;

interface FileNode {
  path: string;
  imports: string[];      // files this file imports
  importedBy: string[];   // files that import this file
  lastAnalyzed: number;
}

export interface ImpactAnalysis {
  directDependents: string[];     // files that directly import the changed file
  transitiveDependents: string[]; // all files affected (recursive)
  depth: number;                  // max depth of impact chain
}

export class FileDependencyGraph {
  private graph: Map<string, FileNode> = new Map();
  private projectRoot: string;
  private static readonly MAX_NODES = 5_000;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /** Analyze a single file and update the graph */
  analyzeFile(filePath: string): string[] {
    const absPath = this.resolvePath(filePath);
    if (!existsSync(absPath)) return [];

    try {
      const content = readFileSync(absPath, 'utf-8');
      const imports = this.extractImports(content, dirname(absPath));

      // Update this file's node
      const node = this.getOrCreate(filePath);
      const oldImports = [...node.imports];
      node.imports = imports;
      node.lastAnalyzed = Date.now();

      // Remove old reverse edges
      for (const imp of oldImports) {
        const impNode = this.graph.get(imp);
        if (impNode) {
          impNode.importedBy = impNode.importedBy.filter(p => p !== filePath);
        }
      }

      // Add new reverse edges
      for (const imp of imports) {
        const impNode = this.getOrCreate(imp);
        if (!impNode.importedBy.includes(filePath)) {
          impNode.importedBy.push(filePath);
        }
      }

      return imports;
    } catch (err: any) {
      logger.warn('dep-graph', `Failed to analyze ${filePath}: ${err.message}`);
      return [];
    }
  }

  /** Get impact analysis for a changed file */
  getImpact(filePath: string, maxDepth: number = 5): ImpactAnalysis {
    const node = this.graph.get(filePath);
    if (!node) return { directDependents: [], transitiveDependents: [], depth: 0 };

    const directDependents = [...node.importedBy];
    const visited = new Set<string>([filePath]);
    const transitive: string[] = [];
    let currentDepth = 0;

    let frontier = [...directDependents];
    while (frontier.length > 0 && currentDepth < maxDepth) {
      currentDepth++;
      const nextFrontier: string[] = [];
      for (const dep of frontier) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        transitive.push(dep);
        const depNode = this.graph.get(dep);
        if (depNode) {
          nextFrontier.push(...depNode.importedBy);
        }
      }
      frontier = nextFrontier;
    }

    return { directDependents, transitiveDependents: transitive, depth: currentDepth };
  }

  /** Extract import paths from file content */
  private extractImports(content: string, fileDir: string): string[] {
    const imports: string[] = [];
    // Match: import ... from '...', import '...', require('...'), export ... from '...'
    const patterns = [
      /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const importPath = match[1];
        // Only track relative imports (project files, not node_modules)
        if (importPath.startsWith('.')) {
          const resolved = this.resolveImport(importPath, fileDir);
          if (resolved) imports.push(resolved);
        }
      }
    }

    return [...new Set(imports)];
  }

  /** Resolve a relative import to a project-relative path (always POSIX slashes) */
  private resolveImport(importPath: string, fromDir: string): string | null {
    // Remove .js/.ts extension for normalization
    const clean = importPath.replace(/\.(js|ts|tsx|jsx)$/, '');
    const absPath = resolve(fromDir, clean);
    const relPath = relative(this.projectRoot, absPath).replace(/\\/g, '/');

    // Try common extensions
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      if (existsSync(absPath + ext)) return relPath + ext;
    }
    // Try index file
    for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
      if (existsSync(join(absPath, 'index' + ext))) return path.posix.join(relPath, 'index' + ext);
    }
    return relPath + '.ts'; // Default assumption
  }

  /** Analyze all TS/JS files in a directory recursively */
  analyzeDirectory(dir: string): number {
    let count = 0;

    const walk = (d: string) => {
      try {
        for (const entry of readdirSync(d)) {
          if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
          const full = join(d, entry);
          const stat = statSync(full);
          if (stat.isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
            this.analyzeFile(relative(this.projectRoot, full).replace(/\\/g, '/'));
            count++;
          }
        }
      } catch { /* skip unreadable dirs */ }
    };

    walk(join(this.projectRoot, dir));
    return count;
  }

  /** Get all files in the graph */
  getFiles(): string[] {
    return [...this.graph.keys()];
  }

  /** Get direct imports of a file */
  getImports(filePath: string): string[] {
    return this.graph.get(filePath)?.imports ?? [];
  }

  /** Get files that import this file */
  getImportedBy(filePath: string): string[] {
    return this.graph.get(filePath)?.importedBy ?? [];
  }

  get nodeCount(): number {
    return this.graph.size;
  }

  private getOrCreate(path: string): FileNode {
    let node = this.graph.get(path);
    if (!node) {
      // Evict stalest entry if at capacity
      if (this.graph.size >= FileDependencyGraph.MAX_NODES) {
        let stalestKey: string | null = null;
        let stalestTime = Infinity;
        for (const [key, n] of this.graph) {
          if (n.lastAnalyzed < stalestTime) { stalestTime = n.lastAnalyzed; stalestKey = key; }
        }
        if (stalestKey) this.graph.delete(stalestKey);
      }
      node = { path, imports: [], importedBy: [], lastAnalyzed: 0 };
      this.graph.set(path, node);
    }
    return node;
  }

  private resolvePath(filePath: string): string {
    return isAbsolute(filePath) ? filePath : join(this.projectRoot, filePath);
  }
}
