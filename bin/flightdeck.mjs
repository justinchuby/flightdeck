#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const serverDist = resolve(root, 'packages/server/dist/index.js');
const webDist = resolve(root, 'packages/web/dist/index.html');

// Parse CLI args
const args = process.argv.slice(2);
const portArg = args.find(a => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : process.env.PORT || '3001';
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
console.log(`\n🚀 Starting Flightdeck on http://127.0.0.1:${port}\n`);

const server = spawn('node', [serverDist], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

// Open browser after a short delay (unless --no-browser)
if (!noBrowser) {
  setTimeout(() => {
    const url = `http://127.0.0.1:${port}`;
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
