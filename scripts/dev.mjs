#!/usr/bin/env node
/**
 * Sequential dev launcher — starts the Express server first, waits for it
 * to print FLIGHTDECK_PORT=NNNN, then spawns Vite with that port as env.
 * This eliminates the race condition where Vite's proxy target is wrong.
 */
import { spawn } from 'child_process';

const SERVER_READY_RE = /^FLIGHTDECK_PORT=(\d+)$/m;
const TIMEOUT_MS = 30_000;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'dev', '--workspace=packages/server'], {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env },
    });

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Server did not emit FLIGHTDECK_PORT within 30s'));
      }
    }, TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const match = text.match(SERVER_READY_RE);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ proc, port: match[1] });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timer); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

function startVite(serverPort) {
  return spawn('npm', ['run', 'dev', '--workspace=packages/web'], {
    stdio: 'inherit',
    env: { ...process.env, SERVER_PORT: serverPort },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────

const children = [];

function cleanup() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

try {
  console.log('🚀 Starting server...');
  const { proc: serverProc, port } = await startServer();
  children.push(serverProc);
  console.log(`✅ Server ready on port ${port}`);

  console.log('🌐 Starting Vite dev server...');
  const viteProc = startVite(port);
  children.push(viteProc);

  viteProc.on('exit', (code) => { cleanup(); process.exit(code ?? 0); });
  serverProc.on('exit', (code) => { cleanup(); process.exit(code ?? 1); });
} catch (err) {
  console.error(`❌ ${err.message}`);
  cleanup();
  process.exit(1);
}
