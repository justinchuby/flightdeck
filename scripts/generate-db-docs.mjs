#!/usr/bin/env node
/**
 * Auto-generate packages/docs/reference/database.md from the Drizzle schema.
 *
 * Usage:  node scripts/generate-db-docs.mjs
 *
 * Parses packages/server/src/db/schema.ts to extract every table definition,
 * columns (name, type, constraints), indexes, and primary keys. Writes
 * deterministic markdown grouped by functional area.
 *
 * Idempotent — identical output when schema.ts is unchanged.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SCHEMA_FILE = join(ROOT, 'packages/server/src/db/schema.ts');
const OUTPUT = join(ROOT, 'packages/docs/reference/database.md');

// ── Section grouping (matches the comments in schema.ts) ────────────

const SECTION_MAP = [
  { marker: 'Conversations & Messages', label: 'Conversations & Messages', tables: ['conversations', 'messages'] },
  { marker: 'Roles', label: 'Configuration', tables: ['roles', 'settings'] },
  { marker: 'File Locks', label: 'Coordination', tables: ['fileLocks', 'activityLog', 'decisions'] },
  { marker: 'Chat Groups', label: 'Chat Groups', tables: ['chatGroups', 'chatGroupMembers', 'chatGroupMessages'] },
  { marker: 'DAG Tasks', label: 'Planning & Execution', tables: ['dagTasks', 'agentMemory', 'agentPlans'] },
  { marker: 'Projects', label: 'Projects', tables: ['projects', 'projectSessions'] },
  { marker: 'Agent File History', label: 'Agent Registry & Tracking', tables: ['agentRoster', 'activeDelegations', 'agentFileHistory'] },
  { marker: 'Collective Memory', label: 'Knowledge & Memory', tables: ['collectiveMemory', 'knowledge'] },
  { marker: 'Task Cost Records', label: 'Observability', tables: ['taskCostRecords', 'sessionRetros'] },
  { marker: 'Timers', label: 'Infrastructure', tables: ['timers', 'messageQueue'] },
];

// ── Schema parsing ──────────────────────────────────────────────────

/**
 * Parse a Drizzle sqliteTable() definition and extract columns, indexes, PK.
 */
function parseSchema(source) {
  const tables = [];

  // Match: export const tableName = sqliteTable('sql_name', { ... }, (table) => [...])
  // We use a state-machine approach to handle nested braces correctly.
  const tableStartRe = /export const (\w+)\s*=\s*sqliteTable\(\s*'([^']+)'/g;
  let tableMatch;

  while ((tableMatch = tableStartRe.exec(source)) !== null) {
    const varName = tableMatch[1];
    const sqlName = tableMatch[2];
    const startPos = tableMatch.index + tableMatch[0].length;

    // Find the columns block (first { ... })
    const columnsBlock = extractBalancedBlock(source, startPos, '{', '}');
    if (!columnsBlock) continue;

    // Parse columns from the block
    const columns = parseColumns(columnsBlock.content);

    // Check for indexes block (second argument to sqliteTable — a function returning array)
    let indexes = [];
    let primaryKeyColumns = [];
    const afterColumns = source.slice(columnsBlock.endPos);
    const indexBlockMatch = afterColumns.match(/^\s*,\s*\((\w+)\)\s*=>\s*\[/);
    if (indexBlockMatch) {
      const indexStart = columnsBlock.endPos + indexBlockMatch.index + indexBlockMatch[0].length;
      const indexBlock = extractBalancedBlock(source, indexStart - 1, '[', ']');
      if (indexBlock) {
        indexes = parseIndexes(indexBlock.content);
        // Check for composite primaryKey
        const pkMatch = indexBlock.content.match(/primaryKey\(\s*\{\s*columns:\s*\[([^\]]+)\]/);
        if (pkMatch) {
          primaryKeyColumns = pkMatch[1]
            .split(',')
            .map((s) => s.trim().match(/\.(\w+)/)?.[1])
            .filter(Boolean);
        }
      }
    }

    // Determine primary key
    let pk;
    if (primaryKeyColumns.length > 0) {
      pk = `(${primaryKeyColumns.join(', ')}) composite`;
    } else {
      const pkCol = columns.find((c) => c.primaryKey);
      pk = pkCol ? `${pkCol.name}${pkCol.autoIncrement ? ' (auto-increment)' : ''}` : '—';
    }

    tables.push({ varName, sqlName, columns, indexes, pk });
  }

  return tables;
}

/**
 * Extract a balanced block of delimiters starting from `pos` in `source`.
 */
function extractBalancedBlock(source, pos, open, close) {
  let idx = source.indexOf(open, pos);
  if (idx === -1) return null;

  let depth = 0;
  const start = idx + 1;
  for (let i = idx; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) {
      depth--;
      if (depth === 0) {
        return { content: source.slice(start, i), endPos: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Parse column definitions from a Drizzle table columns block.
 */
function parseColumns(block) {
  const columns = [];
  // Match: name: type('sql_name')...
  const colRe = /(\w+)\s*:\s*(text|integer|real)\(\s*'([^']+)'\s*\)([^,\n]*(?:\n[^,\n]*)*?)(?=,\s*\n\s*\w+\s*:|$)/g;
  let m;
  while ((m = colRe.exec(block)) !== null) {
    const varName = m[1];
    const colType = m[2];
    const sqlName = m[3];
    const chain = m[4] || '';

    const col = {
      name: sqlName,
      varName,
      type: colType,
      primaryKey: /\.primaryKey/.test(chain),
      autoIncrement: /autoIncrement/.test(chain),
      notNull: /\.notNull/.test(chain),
      hasDefault: /\.default\(/.test(chain),
      defaultValue: extractDefault(chain),
      references: null,
      unique: false,
    };

    const refMatch = chain.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)\)/);
    if (refMatch) col.references = `${refMatch[1]}.${refMatch[2]}`;

    columns.push(col);
  }
  return columns;
}

/**
 * Extract the default value from a Drizzle column chain.
 */
function extractDefault(chain) {
  const match = chain.match(/\.default\(([^)]+)\)/);
  if (!match) return null;
  const val = match[1].trim();
  if (val === 'utcNow') return 'UTC now';
  if (val.startsWith("'") || val.startsWith('"')) return val.replace(/['"]/g, '');
  return val;
}

/**
 * Parse index definitions from the indexes block.
 */
function parseIndexes(block) {
  const indexes = [];
  const idxRe = /(uniqueIndex|index)\(\s*'([^']+)'\s*\)\s*\.on\(([^)]+)\)/g;
  let m;
  while ((m = idxRe.exec(block)) !== null) {
    const unique = m[1] === 'uniqueIndex';
    const name = m[2];
    const cols = m[3]
      .split(',')
      .map((s) => s.trim().match(/\.(\w+)/)?.[1])
      .filter(Boolean);
    indexes.push({ name, unique, columns: cols });
  }
  return indexes;
}

// ── Markdown generation ─────────────────────────────────────────────

function drizzleTypeToSql(type) {
  switch (type) {
    case 'text': return 'TEXT';
    case 'integer': return 'INTEGER';
    case 'real': return 'REAL';
    default: return type.toUpperCase();
  }
}

function generateMarkdown(tables) {
  const lines = [];

  lines.push('# Database Schema Reference');
  lines.push('');
  lines.push('::: warning Auto-Generated');
  lines.push('This file is auto-generated by `scripts/generate-db-docs.mjs`. Do not edit manually.');
  lines.push('Run `npm run docs:generate-db` to regenerate.');
  lines.push(':::');
  lines.push('');
  lines.push('SQLite database using [Drizzle ORM](https://orm.drizzle.team/) over `better-sqlite3`.');
  lines.push('Schema source: `packages/server/src/db/schema.ts`');
  lines.push('');

  // Pragmas section
  lines.push('## SQLite Pragmas');
  lines.push('');
  lines.push('| Pragma | Value | Purpose |');
  lines.push('|--------|-------|---------|');
  lines.push('| `journal_mode` | WAL | Concurrent reads during writes |');
  lines.push('| `foreign_keys` | ON | Enforce referential integrity |');
  lines.push('| `synchronous` | NORMAL | ~10x write speedup vs FULL |');
  lines.push('| `busy_timeout` | 5000 | 5s wait on write lock contention |');
  lines.push('| `cache_size` | -64000 | 64MB page cache |');
  lines.push('');

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');

  const tableByVar = new Map(tables.map((t) => [t.varName, t]));
  const seen = new Set();

  for (const section of SECTION_MAP) {
    const anchor = section.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const count = section.tables.filter((v) => tableByVar.has(v)).length;
    if (count > 0) {
      lines.push(`- [${section.label}](#${anchor}) (${count} tables)`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Sections
  for (const section of SECTION_MAP) {
    const sectionTables = section.tables.map((v) => tableByVar.get(v)).filter(Boolean);
    if (sectionTables.length === 0) continue;

    lines.push(`## ${section.label}`);
    lines.push('');

    for (const table of sectionTables) {
      seen.add(table.varName);
      lines.push(`### \`${table.sqlName}\``);
      lines.push('');
      lines.push(`**Primary key**: ${table.pk}`);
      lines.push('');

      // Columns table
      lines.push('| Column | Type | Nullable | Default | Notes |');
      lines.push('|--------|------|----------|---------|-------|');
      for (const col of table.columns) {
        const nullable = col.notNull || col.primaryKey ? 'NOT NULL' : 'nullable';
        const def = col.defaultValue ?? '—';
        const notes = [];
        if (col.primaryKey) notes.push('PK');
        if (col.autoIncrement) notes.push('auto-increment');
        if (col.references) notes.push(`FK → \`${col.references}\``);
        lines.push(`| \`${col.name}\` | ${drizzleTypeToSql(col.type)} | ${nullable} | ${def} | ${notes.join(', ') || '—'} |`);
      }
      lines.push('');

      // Indexes
      if (table.indexes.length > 0) {
        lines.push('**Indexes:**');
        lines.push('');
        for (const idx of table.indexes) {
          const cols = idx.columns.map((c) => `\`${c}\``).join(', ');
          const uniq = idx.unique ? ' (unique)' : '';
          lines.push(`- \`${idx.name}\`${uniq} on ${cols}`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  // Any tables not in sections
  const unsectioned = tables.filter((t) => !seen.has(t.varName));
  if (unsectioned.length > 0) {
    lines.push('## Other Tables');
    lines.push('');
    for (const table of unsectioned) {
      lines.push(`### \`${table.sqlName}\``);
      lines.push('');
      lines.push(`**Primary key**: ${table.pk}`);
      lines.push('');
      lines.push('| Column | Type | Nullable | Default | Notes |');
      lines.push('|--------|------|----------|---------|-------|');
      for (const col of table.columns) {
        const nullable = col.notNull || col.primaryKey ? 'NOT NULL' : 'nullable';
        const def = col.defaultValue ?? '—';
        const notes = [];
        if (col.primaryKey) notes.push('PK');
        if (col.autoIncrement) notes.push('auto-increment');
        if (col.references) notes.push(`FK → \`${col.references}\``);
        lines.push(`| \`${col.name}\` | ${drizzleTypeToSql(col.type)} | ${nullable} | ${def} | ${notes.join(', ') || '—'} |`);
      }
      lines.push('');
      if (table.indexes.length > 0) {
        lines.push('**Indexes:**');
        lines.push('');
        for (const idx of table.indexes) {
          const cols = idx.columns.map((c) => `\`${c}\``).join(', ');
          const uniq = idx.unique ? ' (unique)' : '';
          lines.push(`- \`${idx.name}\`${uniq} on ${cols}`);
        }
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  // Footer
  lines.push(`*${tables.length} tables. Generated from \`packages/server/src/db/schema.ts\`.*`);
  lines.push('');

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const source = readFileSync(SCHEMA_FILE, 'utf-8');
  const tables = parseSchema(source);

  const markdown = generateMarkdown(tables);
  writeFileSync(OUTPUT, markdown, 'utf-8');

  console.log(`✅ Generated ${OUTPUT}`);
  console.log(`   ${tables.length} tables documented`);
}

main();
