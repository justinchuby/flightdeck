#!/usr/bin/env node
/**
 * Auto-generate packages/docs/reference/api.md from server route files.
 *
 * Usage:  node scripts/generate-api-docs.mjs
 *
 * Scans packages/server/src/routes/*.ts, extracts every router.<method>() call,
 * groups endpoints by domain, and writes deterministic markdown.
 *
 * Idempotent — identical output when source routes are unchanged.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ROUTES_DIR = join(ROOT, 'packages/server/src/routes');
const OUTPUT = join(ROOT, 'packages/docs/reference/api.md');

// ── Route file → domain label mapping (deterministic order) ──────────

const DOMAIN_ORDER = [
  { file: 'agents.ts', label: 'Agent Management' },
  { file: 'lead.ts', label: 'Lead Agent' },
  { file: 'projects.ts', label: 'Projects' },
  { file: 'tasks.ts', label: 'Tasks' },
  { file: 'decisions.ts', label: 'Decisions' },
  { file: 'coordination.ts', label: 'Coordination' },
  { file: 'crew.ts', label: 'Crews' },
  { file: 'knowledge.ts', label: 'Knowledge' },
  { file: 'comms.ts', label: 'Communications' },
  { file: 'analytics.ts', label: 'Analytics' },
  { file: 'config.ts', label: 'Configuration & System' },
  { file: 'settings.ts', label: 'Provider Settings' },
  { file: 'roles.ts', label: 'Roles' },
  { file: 'search.ts', label: 'Search' },
  { file: 'data.ts', label: 'Data Management' },
  { file: 'db.ts', label: 'Database Browser' },
  { file: 'diff.ts', label: 'Diff' },
  { file: 'integrations.ts', label: 'Integrations' },
  { file: 'nl.ts', label: 'Natural Language Commands' },
  { file: 'notifications.ts', label: 'Notifications (push)' },
  { file: 'predictions.ts', label: 'Predictions' },
  { file: 'replay.ts', label: 'Session Replay' },
  { file: 'shared.ts', label: 'Shared Replay Links' },
  { file: 'services.ts', label: 'Services & Coordination (extended)' },
  { file: 'summary.ts', label: 'Summary & Catch-up' },
  { file: 'browse.ts', label: 'File Browser' },
];

// ── Rate limiter extraction ──────────────────────────────────────────

/**
 * Extract rate limiter definitions from a file.
 * Matches: `const xxxLimiter = rateLimit({ windowMs: N, max: N, ... })`
 * and `spawnLimiter`, `messageLimiter` imports.
 */
function extractRateLimiters(source) {
  const limiters = new Map();
  // Inline definitions
  const re = /const\s+(\w+)\s*=\s*rateLimit\(\s*\{[^}]*windowMs:\s*(\d[\d_]*)[^}]*max:\s*(\d+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const windowMs = parseInt(m[2].replace(/_/g, ''), 10);
    limiters.set(m[1], { window: `${windowMs / 1000} s`, max: parseInt(m[3], 10) });
  }
  return limiters;
}

// ── Endpoint extraction ──────────────────────────────────────────────

const ENDPOINT_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * Extract endpoints from a route file. Returns array sorted by line number.
 */
function extractEndpoints(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const limiters = extractRateLimiters(source);
  const endpoints = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`](.*)$/);
    if (!match) continue;

    const method = match[1].toUpperCase();
    const path = match[2];
    const rest = match[3];

    // Detect middleware on the same line (limiter names, validateBody)
    const middlewares = [];
    const seenLimiters = new Set();
    const limiterMatches = rest.matchAll(/(\w+Limiter)/g);
    for (const lm of limiterMatches) {
      const name = lm[1];
      if (seenLimiters.has(name)) continue;
      seenLimiters.add(name);
      const info = limiters.get(name);
      middlewares.push(info ? `${name} (${info.window}, max ${info.max})` : name);
    }
    if (/validateBody/.test(rest)) middlewares.push('body validation');

    // Extract query params from the handler body (scan next ~30 lines)
    const queryParams = [];
    const bodyParams = [];
    const pathParams = (path.match(/:(\w+)/g) || []).map((p) => p.slice(1));

    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const bodyLine = lines[j];
      // Stop at next endpoint or function
      if (/^\s*router\.(get|post|put|patch|delete)\(/.test(bodyLine)) break;
      if (/^}\);/.test(bodyLine.trim())) break;

      // Query params: req.query.xxx
      const qMatches = bodyLine.matchAll(/req\.query\.(\w+)/g);
      for (const qm of qMatches) {
        if (!queryParams.includes(qm[1])) queryParams.push(qm[1]);
      }
      // Also: `const { x, y } = req.query`
      const destructQ = bodyLine.match(/(?:const|let)\s*\{([^}]+)\}\s*=\s*req\.query/);
      if (destructQ) {
        destructQ[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
          .forEach((p) => { if (!queryParams.includes(p)) queryParams.push(p); });
      }

      // Body params: req.body.xxx or destructured
      const destructB = bodyLine.match(/(?:const|let)\s*\{([^}]+)\}\s*=\s*req\.body/);
      if (destructB) {
        destructB[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)
          .forEach((p) => { if (!bodyParams.includes(p)) bodyParams.push(p); });
      }
    }

    // Extract status codes from response
    const statusCodes = [];
    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const bodyLine = lines[j];
      if (/^\s*router\.(get|post|put|patch|delete)\(/.test(bodyLine)) break;
      const statusMatch = bodyLine.match(/\.status\((\d+)\)/);
      if (statusMatch && !statusCodes.includes(statusMatch[1])) {
        statusCodes.push(statusMatch[1]);
      }
    }

    endpoints.push({
      method,
      path,
      line: i + 1,
      middlewares,
      queryParams,
      bodyParams,
      pathParams,
      statusCodes,
    });
  }

  return endpoints;
}

// ── Description heuristics ──────────────────────────────────────────

function describeEndpoint(method, path) {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  const hasId = parts.some((p) => p.startsWith(':'));

  if (method === 'GET' && !hasId) return `List ${parts[0] || 'resources'}`;
  if (method === 'GET' && hasId && parts.length === 2) return `Get ${parts[0].replace(/s$/, '')} by ID`;
  if (method === 'POST' && !hasId && parts.length === 1) return `Create ${parts[0].replace(/s$/, '')}`;
  if (method === 'DELETE' && hasId) return `Delete ${parts[0].replace(/s$/, '')}`;
  if (method === 'PATCH' && hasId) return `Update ${parts[0].replace(/s$/, '')}`;
  if (method === 'PUT') return `Set ${last || parts[0]}`;
  if (method === 'POST' && last && !last.startsWith(':')) return `${last.replace(/-/g, ' ')}`;

  return '';
}

// ── Markdown generation ─────────────────────────────────────────────

function generateMarkdown(domainEndpoints) {
  const lines = [];

  lines.push('# Flightdeck — REST API Reference');
  lines.push('');
  lines.push('::: warning Auto-Generated');
  lines.push('This file is auto-generated by `scripts/generate-api-docs.mjs`. Do not edit manually.');
  lines.push('Run `npm run docs:generate-api` to regenerate.');
  lines.push(':::');
  lines.push('');
  lines.push('> **Base URL**: `http://localhost:3001/api`');
  lines.push('> **Authentication**: Bearer token (auto-generated on server start)');
  lines.push('> **Content-Type**: `application/json` for all request bodies');
  lines.push('> **Timestamps**: ISO 8601 throughout (e.g. `2025-03-01T10:30:00Z`)');
  lines.push('');

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');
  for (const { label, endpoints } of domainEndpoints) {
    if (endpoints.length === 0) continue;
    const anchor = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    lines.push(`- [${label}](#${anchor}) (${endpoints.length} endpoints)`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  let totalEndpoints = 0;

  for (const { label, endpoints } of domainEndpoints) {
    if (endpoints.length === 0) continue;
    totalEndpoints += endpoints.length;

    lines.push(`## ${label}`);
    lines.push('');

    for (const ep of endpoints) {
      const desc = describeEndpoint(ep.method, ep.path);
      lines.push(`### \`${ep.method} ${ep.path}\``);
      lines.push('');
      if (desc) {
        lines.push(desc);
        lines.push('');
      }

      // Middleware badges
      if (ep.middlewares.length > 0) {
        lines.push(`> Rate limited: ${ep.middlewares.join(', ')}`);
        lines.push('');
      }

      // Parameters table
      const allParams = [
        ...ep.pathParams.map((p) => ({ name: p, location: 'path', required: 'yes' })),
        ...ep.queryParams.map((p) => ({ name: p, location: 'query', required: 'no' })),
        ...ep.bodyParams.map((p) => ({ name: p, location: 'body', required: '—' })),
      ];

      if (allParams.length > 0) {
        lines.push('| Name | In | Required |');
        lines.push('|------|----|----------|');
        for (const p of allParams) {
          lines.push(`| \`${p.name}\` | ${p.location} | ${p.required} |`);
        }
        lines.push('');
      }

      // Status codes
      if (ep.statusCodes.length > 0) {
        const codes = ep.statusCodes.map((c) => `\`${c}\``).join(' · ');
        lines.push(`**Status codes**: ${codes}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  // Footer
  lines.push(`*${totalEndpoints} endpoints across ${domainEndpoints.filter((d) => d.endpoints.length > 0).length} domains. Generated from \`packages/server/src/routes/\`.*`);
  lines.push('');

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const allFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.endsWith('.ts') && !f.includes('.test.') && f !== 'index.ts',
  );

  // Build lookup: filename → endpoints
  const fileEndpoints = new Map();
  for (const file of allFiles) {
    const endpoints = extractEndpoints(join(ROUTES_DIR, file));
    fileEndpoints.set(file, endpoints);
  }

  // Assemble in domain order; any files not in DOMAIN_ORDER go at the end
  const domainEndpoints = [];
  const seen = new Set();

  for (const { file, label } of DOMAIN_ORDER) {
    if (fileEndpoints.has(file)) {
      domainEndpoints.push({ label, file, endpoints: fileEndpoints.get(file) });
      seen.add(file);
    }
  }

  // Catch any route files not in the mapping
  for (const [file, endpoints] of fileEndpoints) {
    if (!seen.has(file) && endpoints.length > 0) {
      const label = basename(file, '.ts').replace(/^\w/, (c) => c.toUpperCase());
      domainEndpoints.push({ label, file, endpoints });
    }
  }

  const markdown = generateMarkdown(domainEndpoints);
  writeFileSync(OUTPUT, markdown, 'utf-8');

  const totalEndpoints = domainEndpoints.reduce((sum, d) => sum + d.endpoints.length, 0);
  console.log(`✅ Generated ${OUTPUT}`);
  console.log(`   ${totalEndpoints} endpoints across ${domainEndpoints.filter((d) => d.endpoints.length > 0).length} domains`);
}

main();
