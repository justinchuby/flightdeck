#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Parse CLI args early — handle --help and --version before any startup logic
const args = process.argv.slice(2);

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Flightdeck v${pkg.version} — Multi-agent Copilot CLI orchestrator with real-time web UI

Usage: flightdeck [options]

Options:
  --port=<number>    Port to listen on (default: 3001, or PORT env)
  --host=<addr>      Host to bind to (default: 127.0.0.1, or HOST env)
  --no-browser       Don't open browser on start
  -v, --version      Show version number
  -h, --help         Show this help message`);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

const serverDist = resolve(root, 'packages/server/dist/index.js');
const webDist = resolve(root, 'packages/web/dist/index.html');

const portArg = args.find(a => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : process.env.PORT || '3001';
const hostArg = args.find(a => a.startsWith('--host='));
const host = hostArg ? hostArg.split('=')[1] : process.env.HOST || '127.0.0.1';
const noBrowser = args.includes('--no-browser');

if (!host) {
  console.error('❌ --host requires a value (e.g., --host=127.0.0.1)');
  process.exit(1);
}
if (!port) {
  console.error('❌ --port requires a value (e.g., --port=3001)');
  process.exit(1);
}

// Format host for use in URLs (IPv6 needs brackets, wildcard addresses use localhost)
function formatHost(h) {
  if (h === '0.0.0.0' || h === '::') return 'localhost';
  return h.includes(':') ? `[${h}]` : h;
}

// Check if builds exist, build if needed
if (!existsSync(serverDist) || !existsSync(webDist)) {
  console.log('📦 Building flightdeck (first run)...');
  try {
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  } catch (err) {
    console.error('❌ Build failed. Run `npm install` first, then try again.');
    process.exit(1);
  }
}

// Set environment
process.env.PORT = port;

// Start the server
console.log(`\n🚀 Starting Flightdeck on http://${formatHost(host)}:${port}\n`);

const server = spawn('node', [serverDist], {
  cwd: process.cwd(),
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, PORT: port, HOST: host },
});

// Pipe server stdout to terminal while capturing the actual port
const PORT_RE = /^FLIGHTDECK_PORT=(\d+)$/m;
let browserOpened = false;

server.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  if (!browserOpened && !noBrowser) {
    const match = text.match(PORT_RE);
    if (match) {
      browserOpened = true;
      const actualPort = match[1];
      const browserHost = formatHost(host);
      const url = `http://${browserHost}:${actualPort}`;
      openBrowser(url);
    }
  }
});

function openBrowser(url) {
  const platform = process.platform;
  try {
    let child;
    if (platform === 'darwin') child = spawn('open', [url], { stdio: 'ignore', detached: true });
    else if (platform === 'win32') child = spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true });
    else child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      console.log(`🌐 Open ${url} in your browser`);
    });
    child.unref();
  } catch {
    console.log(`🌐 Open ${url} in your browser`);
  }
}

// Forward signals for graceful shutdown
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));

server.on('error', (err) => {
  console.error(`❌ Failed to start server: ${err.message}`);
  process.exit(1);
});

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
