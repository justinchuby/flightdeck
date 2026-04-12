#!/usr/bin/env node

/**
 * flightdeck-mcp — MCP server for Flightdeck
 *
 * Usage:
 *   flightdeck-mcp                          # connects to http://127.0.0.1:3001
 *   FLIGHTDECK_URL=http://host:3001 flightdeck-mcp
 *   flightdeck-mcp --url http://host:3001
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse --url flag
const args = process.argv.slice(2);
let baseUrl;

if (args.includes('--help') || args.includes('-h')) {
  console.error(`flightdeck-mcp — MCP server for Flightdeck

Usage:
  flightdeck-mcp [--url <flightdeck-url>]

Options:
  --url <url>   Flightdeck base URL (default: http://127.0.0.1:3001)
                Also settable via FLIGHTDECK_URL env var.
  -h, --help    Show this help message
  -v, --version Show version`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  const { readFileSync } = await import('fs');
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
  console.error(pkg.version);
  process.exit(0);
}

const urlIdx = args.indexOf('--url');
if (urlIdx !== -1 && args[urlIdx + 1]) {
  baseUrl = args[urlIdx + 1];
}

// Import and start
const { createServer } = await import('../dist/server.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

const server = createServer({ baseUrl });
const transport = new StdioServerTransport();
await server.connect(transport);
