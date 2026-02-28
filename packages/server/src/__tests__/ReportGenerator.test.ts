import { describe, it, expect } from 'vitest';
import { ReportGenerator, escapeHtml, type ReportData } from '../coordination/ReportGenerator.js';

// ── Fixtures ──────────────────────────────────────────────────────

function makeData(overrides: Partial<ReportData> = {}): ReportData {
  const now = Date.now();
  return {
    projectName: 'Test Project',
    sessionStart: now - 3_600_000, // 1 hour ago
    sessionEnd: now,
    agents: [
      { id: 'a1', role: 'lead', model: 'claude-3-5-sonnet', status: 'done', tokensUsed: 12_345 },
      { id: 'a2', role: 'developer', model: 'gpt-4o', status: 'running', tokensUsed: 6_789 },
    ],
    tasks: [
      { id: 't1', description: 'Build feature X', status: 'done', assignee: 'developer' },
      { id: 't2', description: 'Write tests', status: 'running' },
    ],
    decisions: [
      { title: 'Use PostgreSQL', rationale: 'Better scaling', confirmedBy: 'lead' },
    ],
    commits: [
      { hash: 'abc1234567890', message: 'feat: add login page' },
      { hash: 'def0987654321', message: 'fix: resolve memory leak' },
    ],
    testResults: { total: 50, passed: 48, failed: 2 },
    highlights: ['Completed auth module', 'Resolved critical bug'],
    ...overrides,
  };
}

// ── HTML generation ───────────────────────────────────────────────

describe('ReportGenerator.generateHTML', () => {
  it('returns a valid HTML document with doctype and charset', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<meta name="viewport"');
  });

  it('includes project name in title and meta section', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ projectName: 'My Cool App' }));

    expect(html).toContain('My Cool App');
    // Appears at least in <title> and in .meta
    const titleMatch = html.match(/<title>.*My Cool App.*<\/title>/s);
    expect(titleMatch).not.toBeNull();
  });

  it('renders duration in hours and minutes', () => {
    const gen = new ReportGenerator();
    // 90 minutes
    const now = Date.now();
    const html = gen.generateHTML(makeData({ sessionStart: now - 90 * 60_000, sessionEnd: now }));

    expect(html).toContain('1h 30m');
  });

  it('renders stat grid with correct counts', () => {
    const gen = new ReportGenerator();
    const data = makeData();
    const html = gen.generateHTML(data);

    // agent count
    expect(html).toMatch(/stat-value">2<\/div>[\s\S]*stat-label">Agents/);
    // task count
    expect(html).toMatch(/stat-value">2<\/div>[\s\S]*stat-label">Tasks/);
    // commit count
    expect(html).toMatch(/stat-value">2<\/div>[\s\S]*stat-label">Commits/);
    // decision count
    expect(html).toMatch(/stat-value">1<\/div>[\s\S]*stat-label">Decisions/);
  });

  it('renders test results stat when provided', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ testResults: { total: 100, passed: 95, failed: 5 } }));

    expect(html).toContain('95/100');
    expect(html).toContain('Tests Passed');
  });

  it('omits test results stat when not provided', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ testResults: undefined }));

    expect(html).not.toContain('Tests Passed');
  });

  it('renders highlights section when highlights are present', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ highlights: ['Big win', 'Another win'] }));

    expect(html).toContain('Highlights');
    expect(html).toContain('Big win');
    expect(html).toContain('Another win');
  });

  it('omits highlights section when no highlights', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ highlights: [] }));

    expect(html).not.toContain('Highlights');
  });

  it('renders agent fleet table with role, model, status, tokens', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('Agent Fleet');
    expect(html).toContain('claude-3-5-sonnet');
    expect(html).toContain('gpt-4o');
    expect(html).toContain('12,345');
    expect(html).toContain('6,789');
    // badge classes
    expect(html).toContain('badge-done');
    expect(html).toContain('badge-running');
  });

  it('renders tasks table with assignee and status badge', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('Build feature X');
    expect(html).toContain('Write tests');
    expect(html).toContain('developer');
    expect(html).toContain('—'); // task without assignee
  });

  it('renders decisions table when decisions are present', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('Decisions');
    expect(html).toContain('Use PostgreSQL');
    expect(html).toContain('Better scaling');
  });

  it('omits decisions section when no decisions', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ decisions: [] }));

    // The stat grid still shows "Decisions" count (0), but the <h2> table section should be absent
    expect(html).not.toContain('🔨 Decisions');
  });

  it('renders commits table truncated to 8 chars', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('Commits');
    expect(html).toContain('abc12345'); // first 8 chars of 'abc1234567890'
    expect(html).not.toContain('abc1234567890'); // full hash should not appear in code element
    expect(html).toContain('feat: add login page');
  });

  it('omits commits section when no commits', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ commits: [] }));

    // The stat grid still shows "Commits" count (0), but the <h2> table section should be absent
    expect(html).not.toContain('📝 Commits');
  });

  it('includes footer with Generated by AI Crew', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('Generated by AI Crew');
  });

  it('includes responsive meta viewport tag', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData());

    expect(html).toContain('width=device-width, initial-scale=1.0');
  });
});

// ── Markdown generation ───────────────────────────────────────────

describe('ReportGenerator.generateMarkdown', () => {
  it('returns a markdown string with H1 heading', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ projectName: 'Alpha Project' }));

    expect(md).toContain('# AI Crew Session Report — Alpha Project');
  });

  it('includes duration in minutes', () => {
    const gen = new ReportGenerator();
    const now = Date.now();
    const md = gen.generateMarkdown(makeData({ sessionStart: now - 45 * 60_000, sessionEnd: now }));

    expect(md).toContain('45 minutes');
  });

  it('includes agent, task and commit summary line', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData());

    expect(md).toContain('**Agents**: 2');
    expect(md).toContain('**Tasks**: 2');
    expect(md).toContain('**Commits**: 2');
  });

  it('renders highlights as a bullet list', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ highlights: ['win one', 'win two'] }));

    expect(md).toContain('## Highlights');
    expect(md).toContain('- win one');
    expect(md).toContain('- win two');
  });

  it('omits highlights section when empty', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ highlights: [] }));

    expect(md).not.toContain('## Highlights');
  });

  it('renders agent table with pipe-delimited rows', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData());

    expect(md).toContain('## Agents');
    expect(md).toContain('| Role | Model | Status | Tokens |');
    expect(md).toContain('| lead | claude-3-5-sonnet | done |');
    expect(md).toContain('| developer | gpt-4o | running |');
  });

  it('renders tasks table when tasks exist', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData());

    expect(md).toContain('## Tasks');
    expect(md).toContain('| Description | Status | Assignee |');
    expect(md).toContain('Build feature X');
  });

  it('omits tasks section when no tasks', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ tasks: [] }));

    expect(md).not.toContain('## Tasks');
  });

  it('renders decisions table when decisions exist', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData());

    expect(md).toContain('## Decisions');
    expect(md).toContain('Use PostgreSQL');
  });

  it('omits decisions section when no decisions', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ decisions: [] }));

    expect(md).not.toContain('## Decisions');
  });

  it('renders commits as a bullet list with truncated hash', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData());

    expect(md).toContain('## Commits');
    expect(md).toContain('`abc12345`');
    expect(md).toContain('feat: add login page');
  });

  it('renders test results section when provided', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ testResults: { total: 20, passed: 18, failed: 2 } }));

    expect(md).toContain('## Test Results');
    expect(md).toContain('**Passed**: 18/20');
    expect(md).toContain('**Failed**: 2');
  });

  it('omits test results section when not provided', () => {
    const gen = new ReportGenerator();
    const md = gen.generateMarkdown(makeData({ testResults: undefined }));

    expect(md).not.toContain('## Test Results');
  });
});

// ── escapeHtml XSS prevention ─────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes less-than and greater-than', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('leaves safe characters unchanged', () => {
    expect(escapeHtml('hello world 123 !@#$%^*()')).toBe('hello world 123 !@#$%^*()');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles string with multiple special chars', () => {
    expect(escapeHtml('<a href="test&amp;">link</a>')).toBe(
      '&lt;a href=&quot;test&amp;amp;&quot;&gt;link&lt;/a&gt;',
    );
  });
});

// ── HTML injection prevention (integration) ───────────────────────

describe('ReportGenerator XSS safety', () => {
  it('HTML-encodes project name with XSS payload', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ projectName: '<script>alert("xss")</script>' }));

    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('HTML-encodes agent role with XSS payload', () => {
    const gen = new ReportGenerator();
    const data = makeData({
      agents: [{ id: 'a1', role: '<img onerror=alert(1)>', model: 'gpt-4o', status: 'done', tokensUsed: 0 }],
    });
    const html = gen.generateHTML(data);

    expect(html).not.toContain('<img onerror=alert(1)>');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('HTML-encodes task description with XSS payload', () => {
    const gen = new ReportGenerator();
    const data = makeData({
      tasks: [{ id: 't1', description: '"><script>evil()</script>', status: 'done' }],
    });
    const html = gen.generateHTML(data);

    expect(html).not.toContain('"><script>evil()</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('HTML-encodes highlight content', () => {
    const gen = new ReportGenerator();
    const html = gen.generateHTML(makeData({ highlights: ['<b>bold hack</b>'] }));

    expect(html).not.toContain('<b>bold hack</b>');
    expect(html).toContain('&lt;b&gt;bold hack&lt;/b&gt;');
  });

  it('HTML-encodes commit messages', () => {
    const gen = new ReportGenerator();
    const data = makeData({
      commits: [{ hash: 'abc123', message: 'fix: <injection attempt>' }],
    });
    const html = gen.generateHTML(data);

    expect(html).not.toContain('<injection attempt>');
    expect(html).toContain('&lt;injection attempt&gt;');
  });
});
