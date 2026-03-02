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
console.log(`\n🚀 Starting Flightdeck on http://${host}:${port}\n`);

const server = spawn('node', [serverDist], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: port, HOST: host },
});

// Open browser after a short delay (unless --no-browser)
if (!noBrowser) {
  setTimeout(() => {
    const browserHost = (host === '0.0.0.0' || host === '::') ? 'localhost' : host;
    const url = `http://${browserHost}:${port}`;
    const platform = process.platform;
    try {
      if (platform === 'darwin') execSync(`open "${url}"`);
      else if (platform === 'win32') execSync(`start "${url}"`);
      else execSync(`xdg-open "${url}"`);
    } catch {
      console.log(`🌐 Open ${url} in your browser`);
    }
  }, 1500);
}

// Forward signals for graceful shutdown
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
