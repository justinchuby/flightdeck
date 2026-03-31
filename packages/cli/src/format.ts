/**
 * Output formatting helpers for the CLI.
 */

// ── ANSI colors ──────────────────────────────────────────────────

const isColor = process.stdout.isTTY && !process.env.NO_COLOR && !process.env.FLIGHTDECK_CLI_NO_COLOR;

const c = (code: string, text: string) => (isColor ? `${code}${text}\x1b[0m` : text);

export const colors = {
  cyan: (s: string) => c('\x1b[38;5;80m', s),
  green: (s: string) => c('\x1b[38;5;78m', s),
  red: (s: string) => c('\x1b[38;5;196m', s),
  yellow: (s: string) => c('\x1b[38;5;220m', s),
  gray: (s: string) => c('\x1b[38;5;245m', s),
  dim: (s: string) => c('\x1b[2m', s),
  bold: (s: string) => c('\x1b[1m', s),
  cyanBold: (s: string) => c('\x1b[38;5;80m\x1b[1m', s),
};

// ── JSON vs human output ─────────────────────────────────────────

export function output(data: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    for (const item of data) printRecord(item as Record<string, unknown>);
  } else if (typeof data === 'object' && data !== null) {
    printRecord(data as Record<string, unknown>);
  } else {
    console.log(String(data));
  }
}

function printRecord(record: Record<string, unknown>, indent = 0): void {
  const prefix = '  '.repeat(indent);
  for (const [k, v] of Object.entries(record)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      console.log(`${prefix}${colors.gray(k + ':')} `);
      printRecord(v as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(v)) {
      console.log(`${prefix}${colors.gray(k + ':')} [${v.length} items]`);
    } else {
      console.log(`${prefix}${colors.gray(k + ':')} ${v}`);
    }
  }
  if (indent === 0) console.log();
}

// ── Table rendering ──────────────────────────────────────────────

export function table(headers: string[], rows: string[][], maxWidth = 40): void {
  if (!headers.length) return;

  const widths = headers.map((h, i) => {
    const cellMax = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.min(Math.max(h.length, cellMax), maxWidth);
  });

  const headerLine = headers.map((h, i) => colors.cyanBold(h.padEnd(widths[i]))).join(colors.dim(' │ '));
  console.log(`  ${headerLine}`);

  const sep = widths.map(w => '─'.repeat(w)).join('───');
  console.log(`  ${colors.dim(sep)}`);

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const s = (cell || '').slice(0, widths[i]).padEnd(widths[i]);
      return s;
    }).join(colors.dim(' │ '));
    console.log(`  ${line}`);
  }
}

// ── Formatters ───────────────────────────────────────────────────

export function formatProjectSummary(p: Record<string, unknown>) {
  return {
    id: String(p.id || ''),
    name: String(p.name || 'Unnamed'),
    status: String(p.status || 'unknown'),
    running: Number(p.runningAgentCount || 0),
    idle: Number(p.idleAgentCount || 0),
    failed: Number(p.failedAgentCount || 0),
  };
}

export function formatAgentSummary(a: Record<string, unknown>) {
  const role = a.role;
  const roleName = (role && typeof role === 'object')
    ? String((role as Record<string, unknown>).name || (role as Record<string, unknown>).id || 'unknown')
    : String(role || 'unknown');
  return {
    id: String(a.id || ''),
    role: roleName,
    model: String(a.model || 'unknown'),
    provider: String(a.provider || ''),
    status: String(a.status || 'unknown'),
    task: String(a.currentTask || a.task || '').slice(0, 80),
  };
}

export function formatTaskSummary(t: Record<string, unknown>) {
  return {
    id: String(t.taskId || t.id || ''),
    description: String(t.description || '').slice(0, 80),
    status: String((t as Record<string, unknown>).dagStatus || t.status || 'unknown'),
    role: String(t.role || ''),
    agent: String(t.assignedAgentId || ''),
  };
}

export function formatDecisionSummary(d: Record<string, unknown>) {
  return {
    id: String(d.id || ''),
    title: String(d.title || ''),
    status: String(d.status || 'pending'),
    agent: String(d.agentId || ''),
    role: String(d.agentRole || ''),
    rationale: String(d.rationale || '').slice(0, 100),
  };
}

export function computeTaskStats(tasks: Record<string, unknown>[]) {
  const byStatus: Record<string, number> = {};
  for (const t of tasks) {
    const s = String((t as Record<string, unknown>).dagStatus || t.status || 'unknown');
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  return {
    total: tasks.length,
    by_status: byStatus,
    done: byStatus['done'] || 0,
    running: byStatus['running'] || 0,
    pending: byStatus['pending'] || 0,
    failed: byStatus['failed'] || 0,
  };
}
