import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from '../Markdown';

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span data-testid="mention-text">{text}</span>,
}));

describe('Markdown', () => {
  it('renders plain text', () => {
    render(<Markdown text="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    const { container } = render(<Markdown text="**bold** and *italic*" />);
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
  });

  it('renders headings', () => {
    const { container } = render(<Markdown text={'# Title\n\n## Subtitle'} />);
    expect(container.querySelector('h1')).toHaveTextContent('Title');
    expect(container.querySelector('h2')).toHaveTextContent('Subtitle');
  });

  it('renders h3 heading', () => {
    const { container } = render(<Markdown text="### Section" />);
    expect(container.querySelector('h3')).toHaveTextContent('Section');
  });

  it('renders code blocks', () => {
    const { container } = render(<Markdown text={'```\nconst x = 1;\n```'} />);
    expect(container.querySelector('pre')).toBeInTheDocument();
    expect(container.querySelector('code')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    const { container } = render(<Markdown text="Use `npm install` to install" />);
    const code = container.querySelector('code');
    expect(code).toHaveTextContent('npm install');
  });

  it('renders code block with language class', () => {
    const { container } = render(<Markdown text={'```js\nconst x = 1;\n```'} />);
    const code = container.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code!.className).toBeTruthy();
  });

  it('renders unordered lists', () => {
    const { container } = render(<Markdown text={'- item one\n- item two'} />);
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
  });

  it('renders ordered lists', () => {
    const { container } = render(<Markdown text="1. first\n2. second" />);
    expect(container.querySelector('ol')).toBeInTheDocument();
  });

  it('renders blockquotes', () => {
    const { container } = render(<Markdown text="> quoted text" />);
    expect(container.querySelector('blockquote')).toBeInTheDocument();
  });

  it('renders links with target _blank and rel noopener', () => {
    const { container } = render(<Markdown text="[GitHub](https://github.com)" />);
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', 'https://github.com');
    expect(link).toHaveTextContent('GitHub');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders horizontal rules', () => {
    const { container } = render(<Markdown text={'above\n\n---\n\nbelow'} />);
    expect(container.querySelector('hr')).toBeInTheDocument();
  });

  it('renders tables (GFM)', () => {
    const table = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<Markdown text={table} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('renders table headers and cells with border classes', () => {
    const md = '| H1 | H2 |\n|---|---|\n| A | B |';
    const { container } = render(<Markdown text={md} />);
    const th = container.querySelector('th');
    expect(th).not.toBeNull();
    expect(th!.className).toContain('border');
    const td = container.querySelector('td');
    expect(td).not.toBeNull();
    expect(td!.className).toContain('border');
  });

  it('renders task list checkboxes', () => {
    const { container } = render(<Markdown text="- [x] Done task" />);
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute('readonly');
  });

  it('renders strikethrough (GFM)', () => {
    const { container } = render(<Markdown text="~~deleted~~" />);
    const del = container.querySelector('del');
    expect(del).toHaveTextContent('deleted');
  });

  it('applies monospace class when monospace prop is true', () => {
    const { container } = render(<Markdown text="mono text" monospace />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('font-mono');
  });

  it('applies custom className', () => {
    const { container } = render(<Markdown text="test" className="my-custom" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom');
  });

  it('wraps content in markdown-content class', () => {
    const { container } = render(<Markdown text="test" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('markdown-content');
  });

  it('renders without mentionAgents', () => {
    render(<Markdown text="No mentions here" />);
    expect(screen.getByText('No mentions here')).toBeInTheDocument();
  });

  it('renders @mention via MentionAwareChildren when agents provided', () => {
    const agents = [
      { id: 'abc12345', role: { id: 'dev', name: 'Developer' }, status: 'running' as const },
    ];
    const { container } = render(
      <Markdown text="Ask @developer about this" mentionAgents={agents} />,
    );
    const mention = container.querySelector('[data-testid="mention-text"]');
    expect(mention).not.toBeNull();
  });

  it('renders list items with mention support when agents provided', () => {
    const agents = [
      { id: 'abc12345', role: { id: 'dev', name: 'Developer' }, status: 'running' as const },
    ];
    const { container } = render(
      <Markdown text={'- Ask @developer\n- No mention here'} mentionAgents={agents} />,
    );
    const mentions = container.querySelectorAll('[data-testid="mention-text"]');
    expect(mentions.length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty text without errors', () => {
    const { container } = render(<Markdown text="" />);
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('handles complex nested markdown', () => {
    const md = [
      '# Title', '', '> A quote with **bold**', '',
      '```python', 'def hello():', '    print("hi")', '```', '',
      '| Col1 | Col2 |', '| --- | --- |', '| val | val |', '',
      '- item with `code`',
    ].join('\n');
    const { container } = render(<Markdown text={md} />);
    expect(container.querySelector('h1')).toBeInTheDocument();
    expect(container.querySelector('blockquote')).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
  });
});
