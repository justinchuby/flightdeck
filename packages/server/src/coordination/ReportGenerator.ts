// ── ReportGenerator ───────────────────────────────────────────────
// Generates HTML and Markdown session summary reports from structured data.

export interface ReportAgent {
  id: string;
  role: string;
  model: string;
  status: string;
  tokensUsed: number;
}

export interface ReportTask {
  id: string;
  description: string;
  status: string;
  assignee?: string;
}

export interface ReportDecision {
  title: string;
  rationale: string;
  confirmedBy?: string;
}

export interface ReportCommit {
  hash: string;
  message: string;
}

export interface ReportTestResults {
  total: number;
  passed: number;
  failed: number;
}

export interface ReportData {
  projectName: string;
  sessionStart: number;
  sessionEnd: number;
  agents: ReportAgent[];
  tasks: ReportTask[];
  decisions: ReportDecision[];
  commits: ReportCommit[];
  testResults?: ReportTestResults;
  highlights: string[];
}

export class ReportGenerator {
  generateHTML(data: ReportData): string {
    const duration = data.sessionEnd - data.sessionStart;
    const hours = Math.floor(duration / 3_600_000);
    const minutes = Math.floor((duration % 3_600_000) / 60_000);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Crew Session Report — ${escapeHtml(data.projectName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #1a1a2e; line-height: 1.6; padding: 2rem; max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; color: #0f172a; }
    h2 { font-size: 1.25rem; color: #334155; margin: 2rem 0 1rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; }
    .meta { color: #64748b; font-size: 0.875rem; margin-bottom: 2rem; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat { background: white; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #2563eb; }
    .stat-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem; }
    th { background: #f1f5f9; font-weight: 600; }
    .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
    .badge-done { background: #dcfce7; color: #166534; }
    .badge-running { background: #dbeafe; color: #1e40af; }
    .badge-blocked { background: #fee2e2; color: #991b1b; }
    .highlight { background: #fefce8; border-left: 4px solid #eab308; padding: 0.75rem 1rem; margin: 0.5rem 0; border-radius: 4px; }
    .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.75rem; text-align: center; }
    @media (max-width: 768px) { body { padding: 1rem; } .stat-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 480px) { .stat-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>🤖 AI Crew Session Report</h1>
  <div class="meta">
    <strong>${escapeHtml(data.projectName)}</strong> · ${new Date(data.sessionStart).toLocaleDateString()} · ${hours}h ${minutes}m
  </div>

  <div class="stat-grid">
    <div class="stat"><div class="stat-value">${data.agents.length}</div><div class="stat-label">Agents</div></div>
    <div class="stat"><div class="stat-value">${data.tasks.length}</div><div class="stat-label">Tasks</div></div>
    <div class="stat"><div class="stat-value">${data.commits.length}</div><div class="stat-label">Commits</div></div>
    <div class="stat"><div class="stat-value">${data.decisions.length}</div><div class="stat-label">Decisions</div></div>
    ${data.testResults ? `<div class="stat"><div class="stat-value">${data.testResults.passed}/${data.testResults.total}</div><div class="stat-label">Tests Passed</div></div>` : ''}
  </div>

  ${data.highlights.length > 0
    ? `<h2>⭐ Highlights</h2>${data.highlights.map(h => `<div class="highlight">${escapeHtml(h)}</div>`).join('')}`
    : ''}

  <h2>👥 Agent Fleet</h2>
  <table>
    <tr><th>Role</th><th>Model</th><th>Status</th><th>Tokens</th></tr>
    ${data.agents.map(a =>
      `<tr><td>${escapeHtml(a.role)}</td><td>${escapeHtml(a.model)}</td><td><span class="badge badge-${escapeHtml(a.status)}">${escapeHtml(a.status)}</span></td><td>${a.tokensUsed.toLocaleString()}</td></tr>`
    ).join('')}
  </table>

  <h2>📋 Tasks</h2>
  ${data.tasks.length > 0
    ? `<table>
    <tr><th>Description</th><th>Status</th><th>Assignee</th></tr>
    ${data.tasks.map(t =>
      `<tr><td>${escapeHtml(t.description)}</td><td><span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span></td><td>${escapeHtml(t.assignee ?? '—')}</td></tr>`
    ).join('')}
  </table>`
    : '<p style="color:#64748b;font-size:0.875rem">No tasks recorded.</p>'}

  ${data.decisions.length > 0
    ? `<h2>🔨 Decisions</h2><table><tr><th>Decision</th><th>Rationale</th></tr>${data.decisions.map(d =>
        `<tr><td>${escapeHtml(d.title)}</td><td>${escapeHtml(d.rationale)}</td></tr>`
      ).join('')}</table>`
    : ''}

  ${data.commits.length > 0
    ? `<h2>📝 Commits</h2><table><tr><th>Hash</th><th>Message</th></tr>${data.commits.map(c =>
        `<tr><td><code>${escapeHtml(c.hash.slice(0, 8))}</code></td><td>${escapeHtml(c.message)}</td></tr>`
      ).join('')}</table>`
    : ''}

  <div class="footer">Generated by AI Crew · ${new Date().toISOString()}</div>
</body>
</html>`;
  }

  generateMarkdown(data: ReportData): string {
    const durationMin = Math.floor((data.sessionEnd - data.sessionStart) / 60_000);
    let md = `# AI Crew Session Report — ${data.projectName}\n\n`;
    md += `**Duration**: ${durationMin} minutes\n`;
    md += `**Agents**: ${data.agents.length} | **Tasks**: ${data.tasks.length} | **Commits**: ${data.commits.length}\n\n`;

    if (data.highlights.length > 0) {
      md += `## Highlights\n${data.highlights.map(h => `- ${h}`).join('\n')}\n\n`;
    }

    md += `## Agents\n| Role | Model | Status | Tokens |\n|------|-------|--------|--------|\n`;
    for (const a of data.agents) {
      md += `| ${a.role} | ${a.model} | ${a.status} | ${a.tokensUsed.toLocaleString()} |\n`;
    }
    md += '\n';

    if (data.tasks.length > 0) {
      md += `## Tasks\n| Description | Status | Assignee |\n|-------------|--------|----------|\n`;
      for (const t of data.tasks) {
        md += `| ${t.description} | ${t.status} | ${t.assignee ?? '—'} |\n`;
      }
      md += '\n';
    }

    if (data.decisions.length > 0) {
      md += `## Decisions\n| Decision | Rationale |\n|----------|----------|\n`;
      for (const d of data.decisions) {
        md += `| ${d.title} | ${d.rationale} |\n`;
      }
      md += '\n';
    }

    if (data.commits.length > 0) {
      md += `## Commits\n`;
      for (const c of data.commits) {
        md += `- \`${c.hash.slice(0, 8)}\` ${c.message}\n`;
      }
      md += '\n';
    }

    if (data.testResults) {
      md += `## Test Results\n`;
      md += `- **Passed**: ${data.testResults.passed}/${data.testResults.total}\n`;
      md += `- **Failed**: ${data.testResults.failed}\n\n`;
    }

    return md;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
