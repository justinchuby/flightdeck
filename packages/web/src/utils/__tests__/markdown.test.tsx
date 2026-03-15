import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { idColor, AgentIdBadge, InlineMarkdown, InlineMarkdownWithMentions, MarkdownContent } from '../markdown';

// ── idColor ──────────────────────────────────────────────────────────

describe('idColor', () => {
  it('returns an HSL color string', () => {
    const color = idColor('abc123');
    expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
  });

  it('returns consistent color for same input', () => {
    expect(idColor('agent-1')).toBe(idColor('agent-1'));
    expect(idColor('xyz789')).toBe(idColor('xyz789'));
  });

  it('returns different colors for different inputs', () => {
    // Very unlikely to collide with different IDs
    const colors = new Set([idColor('aaa'), idColor('bbb'), idColor('ccc'), idColor('ddd')]);
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it('handles empty string', () => {
    const color = idColor('');
    expect(color).toMatch(/^hsl\(\d+, 65%, 65%\)$/);
  });

  it('produces hue in 0-359 range', () => {
    // Test many inputs to verify hue stays in range
    const inputs = ['a', 'bb', 'ccc', 'dddd', '12345', 'very-long-agent-identifier'];
    for (const input of inputs) {
      const match = idColor(input).match(/hsl\((\d+),/);
      expect(match).not.toBeNull();
      const hue = parseInt(match![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

// ── AgentIdBadge ─────────────────────────────────────────────────────

describe('AgentIdBadge', () => {
  it('renders a badge with shortened agent ID', () => {
    const { container } = render(<AgentIdBadge id="abc12345deadbeef" />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    // shortAgentId truncates to first 8 chars
    expect(span!.textContent).toBe('abc12345');
  });

  it('uses consistent color from idColor', () => {
    const { container } = render(<AgentIdBadge id="abc12345" />);
    const span = container.querySelector('span');
    // jsdom converts HSL to RGB, so just verify a color is set
    expect(span!.style.color).toBeTruthy();
  });

  it('sets title to full ID', () => {
    const { container } = render(<AgentIdBadge id="abc12345deadbeef" />);
    const span = container.querySelector('span');
    expect(span!.title).toBe('abc12345deadbeef');
  });

  it('applies custom className', () => {
    const { container } = render(<AgentIdBadge id="abc123" className="ml-2" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('ml-2');
  });

  it('includes monospace font class', () => {
    const { container } = render(<AgentIdBadge id="abc123" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('font-mono');
  });
});

// ── InlineMarkdown ───────────────────────────────────────────────────

describe('InlineMarkdown', () => {
  it('renders plain text without formatting', () => {
    const { container } = render(<InlineMarkdown text="hello world" />);
    expect(container.textContent).toBe('hello world');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });

  it('renders **bold** text', () => {
    const { container } = render(<InlineMarkdown text="This is **bold** text" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  it('renders *italic* text', () => {
    const { container } = render(<InlineMarkdown text="This is *italic* text" />);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('italic');
  });

  it('renders `code` text', () => {
    const { container } = render(<InlineMarkdown text="Use `myFunc()` here" />);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('myFunc()');
  });

  it('renders mixed formatting in one line', () => {
    const { container } = render(
      <InlineMarkdown text="**bold** and *italic* and `code`" />,
    );
    expect(container.querySelector('strong')!.textContent).toBe('bold');
    expect(container.querySelector('em')!.textContent).toBe('italic');
    expect(container.querySelector('code')!.textContent).toBe('code');
  });

  it('renders multiple bold segments', () => {
    const { container } = render(
      <InlineMarkdown text="**first** then **second**" />,
    );
    const strongs = container.querySelectorAll('strong');
    expect(strongs).toHaveLength(2);
    expect(strongs[0].textContent).toBe('first');
    expect(strongs[1].textContent).toBe('second');
  });
});

// ── InlineMarkdownWithMentions ───────────────────────────────────────

describe('InlineMarkdownWithMentions', () => {
  const agents = [
    { id: 'abc12345deadbeef', role: { id: 'developer', name: 'Developer' }, status: 'running' as const },
  ];

  it('renders inline markdown without agents', () => {
    const { container } = render(
      <InlineMarkdownWithMentions text="**bold** and `code`" />,
    );
    expect(container.querySelector('strong')!.textContent).toBe('bold');
    expect(container.querySelector('code')!.textContent).toBe('code');
  });

  it('renders @mentions when agents are provided', () => {
    const { container } = render(
      <InlineMarkdownWithMentions
        text="Ask @developer about this"
        mentionAgents={agents}
      />,
    );
    // Should resolve @developer to the agent
    const mention = container.querySelector('.bg-blue-500\\/20');
    expect(mention).not.toBeNull();
  });

  it('renders **bold** and @mentions in same text', () => {
    const { container } = render(
      <InlineMarkdownWithMentions
        text="**Important**: ask @developer"
        mentionAgents={agents}
      />,
    );
    expect(container.querySelector('strong')!.textContent).toBe('Important');
    const mention = container.querySelector('.bg-blue-500\\/20');
    expect(mention).not.toBeNull();
  });
});

// ── MarkdownContent — tables ─────────────────────────────────────────

describe('MarkdownContent — tables', () => {
  it('renders a markdown table with headers and rows', () => {
    const text = [
      '| Name | Status |',
      '| --- | --- |',
      '| Alice | Active |',
      '| Bob | Idle |',
    ].join('\n');

    const { container } = render(<MarkdownContent text={text} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    const headers = table!.querySelectorAll('th');
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe('Name');
    expect(headers[1].textContent).toBe('Status');

    const rows = table!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
  });

  it('renders a table without separator row', () => {
    const text = [
      '| Header1 | Header2 |',
      '| Value1 | Value2 |',
      '| Value3 | Value4 |',
    ].join('\n');

    const { container } = render(<MarkdownContent text={text} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    // First row is header, remaining are body
    const headers = table!.querySelectorAll('th');
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toBe('Header1');

    const bodyRows = table!.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
  });

  it('renders text before and after table', () => {
    const text = 'Before table\n| A | B |\n| --- | --- |\n| 1 | 2 |\nAfter table';
    const { container } = render(<MarkdownContent text={text} />);
    expect(container.textContent).toContain('Before table');
    expect(container.textContent).toContain('After table');
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('renders markdown formatting inside table cells', () => {
    const text = '| **Bold** | `code` |\n| --- | --- |\n| *italic* | plain |';
    const { container } = render(<MarkdownContent text={text} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('strong')!.textContent).toBe('Bold');
    expect(table!.querySelector('code')!.textContent).toBe('code');
    expect(table!.querySelector('em')!.textContent).toBe('italic');
  });
});

// ── MarkdownContent — combined features ──────────────────────────────

describe('MarkdownContent — combined features', () => {
  it('renders text with both code blocks and tables', () => {
    const text = [
      'Some text',
      '```',
      'const x = 1;',
      '```',
      '',
      '| Col |',
      '| --- |',
      '| Val |',
    ].join('\n');

    const { container } = render(<MarkdownContent text={text} />);
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('renders plain text without special formatting', () => {
    const { container } = render(<MarkdownContent text="Just plain text" />);
    expect(container.textContent).toBe('Just plain text');
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('handles empty text', () => {
    const { container } = render(<MarkdownContent text="" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders with mention agents when provided', () => {
    const agents = [
      { id: 'abc12345', role: { id: 'dev', name: 'Developer' }, status: 'running' as const },
    ];
    const { container } = render(
      <MarkdownContent text="Ask @developer about this" mentionAgents={agents} />,
    );
    const mention = container.querySelector('.bg-blue-500\\/20');
    expect(mention).not.toBeNull();
  });
});
