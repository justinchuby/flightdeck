#!/usr/bin/env npx tsx
/**
 * ACP Provider Capability Probe
 *
 * Spawns each available ACP provider binary, performs the ACP initialize
 * handshake using the official SDK, and captures the real agentCapabilities
 * response. Results are printed as a comparison table and saved to
 * acp-capability-results.json.
 *
 * Usage:
 *   npx tsx scripts/query-acp-capabilities.ts
 *   npx tsx scripts/query-acp-capabilities.ts --provider copilot
 *   npx tsx scripts/query-acp-capabilities.ts --timeout 15000
 */

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Readable, Writable } from 'stream';
import * as acp from '@agentclientprotocol/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Provider Definitions ────────────────────────────────────────

interface ProviderDef {
  id: string;
  name: string;
  binary: string;
  args: string[];
}

const PROVIDERS: ProviderDef[] = [
  { id: 'copilot', name: 'GitHub Copilot', binary: 'copilot', args: ['--acp', '--stdio'] },
  { id: 'claude', name: 'Claude Code', binary: 'claude-agent-acp', args: [] },
  { id: 'gemini', name: 'Gemini CLI', binary: 'gemini', args: ['--acp'] },
  { id: 'codex', name: 'Codex CLI', binary: 'codex-acp', args: [] },
  { id: 'cursor', name: 'Cursor Agent', binary: 'agent', args: ['acp'] },
  { id: 'opencode', name: 'OpenCode', binary: 'opencode', args: ['acp'] },
];

// ── Result Types ────────────────────────────────────────────────

interface ProbeResult {
  providerId: string;
  providerName: string;
  binary: string;
  installed: boolean;
  error?: string;
  protocolVersion?: number;
  agentInfo?: Record<string, unknown>;
  agentCapabilities?: Record<string, unknown>;
  authMethods?: unknown[];
  rawResponse?: Record<string, unknown>;
  durationMs?: number;
}

// ── Binary Detection ────────────────────────────────────────────

function isBinaryInstalled(binary: string): boolean {
  try {
    execFileSync('which', [binary], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── Probe a Single Provider (using ACP SDK) ─────────────────────

async function probeProvider(def: ProviderDef, timeoutMs: number): Promise<ProbeResult> {
  const result: ProbeResult = {
    providerId: def.id,
    providerName: def.name,
    binary: def.binary,
    installed: false,
  };

  if (!isBinaryInstalled(def.binary)) {
    result.error = `Binary '${def.binary}' not found in PATH`;
    return result;
  }
  result.installed = true;

  const startTime = Date.now();
  let proc: ChildProcess | null = null;

  try {
    const initPromise = new Promise<ProbeResult>((resolve, reject) => {
      let stderr = '';

      proc = spawn(def.binary, def.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      proc.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('error', (err: Error) => {
        reject(new Error(`Spawn error: ${err.message}`));
      });

      // Use the same SDK approach as AcpAdapter.ts
      const output = Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>;
      const input = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>;
      const stream = acp.ndJsonStream(output, input);

      // Minimal client — just auto-approve permissions, ignore session updates
      const client: acp.Client = {
        requestPermission: async (params) => {
          const allow = params.options.find(
            (o: acp.PermissionOption) => o.kind === 'allow_once'
          );
          return {
            outcome: allow
              ? { outcome: 'selected', optionId: allow.optionId }
              : { outcome: 'cancelled' },
          };
        },
        sessionUpdate: async () => { /* ignore */ },
      };

      const connection = new acp.ClientSideConnection((_agent) => client, stream);

      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      }).then((initResult) => {
        result.durationMs = Date.now() - startTime;
        result.protocolVersion = initResult.protocolVersion;
        result.agentInfo = initResult.agentInfo as Record<string, unknown> | undefined;
        result.agentCapabilities = initResult.agentCapabilities as Record<string, unknown> | undefined;
        result.authMethods = initResult.authMethods as unknown[] | undefined;
        result.rawResponse = initResult as unknown as Record<string, unknown>;
        resolve(result);
      }).catch((err: Error) => {
        result.durationMs = Date.now() - startTime;
        result.error = `Init failed: ${err.message}${stderr ? ` (stderr: ${stderr.slice(0, 200)})` : ''}`;
        resolve(result);
      });
    });

    // Race against timeout
    const timeoutPromise = new Promise<ProbeResult>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return await Promise.race([initPromise, timeoutPromise]);

  } catch (err) {
    result.durationMs = Date.now() - startTime;
    result.error = (err as Error).message;
    return result;
  } finally {
    // Clean up process
    if (proc && !proc.killed) {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => {
        try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }
  }
}

// ── Table Formatting ────────────────────────────────────────────

function formatTable(results: ProbeResult[]): string {
  const lines: string[] = [];
  const divider = '─'.repeat(80);

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════════════════╗');
  lines.push('║                    ACP Provider Capability Matrix                           ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════════╝');
  lines.push('');

  for (const r of results) {
    lines.push(`┌${divider}┐`);
    lines.push(`│ ${r.providerName} (${r.binary})`.padEnd(80) + '│');
    lines.push(`├${divider}┤`);

    if (!r.installed) {
      lines.push(`│   ❌ Not installed`.padEnd(80) + '│');
      lines.push(`└${divider}┘`);
      lines.push('');
      continue;
    }

    if (r.error && !r.agentCapabilities) {
      lines.push(`│   ⚠️  Error: ${r.error.slice(0, 60)}`.padEnd(80) + '│');
      lines.push(`└${divider}┘`);
      lines.push('');
      continue;
    }

    const status = r.agentCapabilities ? '✅ Connected' : '⚠️  Partial';
    lines.push(`│   Status: ${status}  (${r.durationMs}ms)`.padEnd(80) + '│');

    if (r.protocolVersion != null) {
      lines.push(`│   Protocol Version: ${r.protocolVersion}`.padEnd(80) + '│');
    }

    if (r.agentInfo) {
      const info = r.agentInfo;
      lines.push(`│   Agent: ${info.name ?? '?'} v${info.version ?? '?'}`.padEnd(80) + '│');
    }

    if (r.agentCapabilities) {
      lines.push(`│   Capabilities:`.padEnd(80) + '│');
      const caps = r.agentCapabilities;
      formatCapability(lines, 'Session Resume', caps.sessionCapabilities);
      formatCapability(lines, 'Prompt (images)', caps.promptCapabilities);
      formatCapability(lines, 'Streaming', caps.streamingCapabilities);
      formatCapability(lines, 'Extensions', caps.extensionCapabilities);
      formatCapability(lines, 'Context', caps.contextCapabilities);
      // Show any other capabilities not in the known set
      const known = new Set(['sessionCapabilities', 'promptCapabilities', 'streamingCapabilities', 'extensionCapabilities', 'contextCapabilities']);
      for (const [key, val] of Object.entries(caps)) {
        if (!known.has(key)) {
          formatCapability(lines, key, val);
        }
      }
    }

    if (r.authMethods && r.authMethods.length > 0) {
      lines.push(`│   Auth Methods: ${JSON.stringify(r.authMethods)}`.padEnd(80) + '│');
    }

    if (r.error) {
      lines.push(`│   Note: ${r.error.slice(0, 65)}`.padEnd(80) + '│');
    }

    lines.push(`└${divider}┘`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatCapability(lines: string[], label: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'object') {
    lines.push(`│     ${label}:`.padEnd(80) + '│');
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const display = typeof v === 'object' ? JSON.stringify(v) : String(v);
      lines.push(`│       ${k}: ${display}`.padEnd(80) + '│');
    }
  } else {
    lines.push(`│     ${label}: ${value}`.padEnd(80) + '│');
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const timeoutIdx = args.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1] || '10000', 10) : 10000;
  const providerIdx = args.indexOf('--provider');
  const filterProvider = providerIdx >= 0 ? args[providerIdx + 1] : null;

  const providers = filterProvider
    ? PROVIDERS.filter((p) => p.id === filterProvider)
    : PROVIDERS;

  if (providers.length === 0) {
    console.error(`Unknown provider: ${filterProvider}`);
    console.error(`Available: ${PROVIDERS.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`Probing ${providers.length} ACP providers (timeout: ${timeoutMs}ms)...\n`);

  const results: ProbeResult[] = [];
  for (const def of providers) {
    process.stdout.write(`  ${def.name} (${def.binary})... `);
    const result = await probeProvider(def, timeoutMs);
    if (!result.installed) {
      console.log('⏭️  not installed');
    } else if (result.error && !result.agentCapabilities) {
      console.log(`⚠️  ${result.error.slice(0, 60)}`);
    } else {
      console.log(`✅ ${result.durationMs}ms`);
    }
    results.push(result);
  }

  // Print comparison table
  console.log(formatTable(results));

  // Save raw results
  const outPath = join(__dirname, 'acp-capability-results.json');
  const output = {
    timestamp: new Date().toISOString(),
    timeoutMs,
    results: results.map((r) => ({
      ...r,
      // Include raw response for full inspection
    })),
  };
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nRaw results saved to: ${outPath}`);

  // Force exit — spawned provider processes may keep event loop alive
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
