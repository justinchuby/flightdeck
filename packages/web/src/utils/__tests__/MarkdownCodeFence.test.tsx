import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownContent, InlineMarkdown } from '../markdown';

describe('MarkdownContent — code fences', () => {
  it('renders a fenced code block as <pre>', () => {
    const text = 'Before\n```\nconst x = 1;\n```\nAfter';
    const { container } = render(<MarkdownContent text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('const x = 1;');
  });

  it('strips the language hint from the rendered content', () => {
    const text = '```typescript\nconst x: number = 1;\nconsole.log(x);\n```';
    const { container } = render(<MarkdownContent text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).not.toContain('typescript');
    expect(pre!.textContent).toContain('const x: number = 1;');
    expect(pre!.textContent).toContain('console.log(x);');
  });

  it('renders multiline code blocks preserving whitespace', () => {
    const text = '```\nfunction hello() {\n  return "world";\n}\n```';
    const { container } = render(<MarkdownContent text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    const content = pre!.textContent!;
    expect(content).toContain('function hello()');
    expect(content).toContain('  return "world";');
    expect(content).toContain('}');
  });

  it('renders multiple code blocks in one message', () => {
    const text = 'First:\n```\nblock 1\n```\nSecond:\n```\nblock 2\n```';
    const { container } = render(<MarkdownContent text={text} />);
    const pres = container.querySelectorAll('pre');
    expect(pres).toHaveLength(2);
    expect(pres[0].textContent).toContain('block 1');
    expect(pres[1].textContent).toContain('block 2');
  });

  it('renders inline code alongside fenced blocks', () => {
    const text = 'Use `myFunc()` like:\n```\nmyFunc(42);\n```';
    const { container } = render(<MarkdownContent text={text} />);
    const code = container.querySelector('code');
    const pre = container.querySelector('pre');
    expect(code).not.toBeNull();
    expect(pre).not.toBeNull();
  });

  it('handles code blocks with nested indentation', () => {
    const text = '```python\ndef greet(name):\n    if name:\n        print(f"Hello {name}")\n    else:\n        print("Hello world")\n```';
    const { container } = render(<MarkdownContent text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain('    if name:');
    expect(pre!.textContent).toContain('        print');
  });

  it('does not render incomplete code fences as blocks', () => {
    const text = 'Some text with ``` but no closing fence';
    const { container } = render(<MarkdownContent text={text} />);
    const pre = container.querySelector('pre');
    expect(pre).toBeNull();
  });
});

describe('InlineMarkdown', () => {
  it('renders inline code with <code> tag', () => {
    const { container } = render(<InlineMarkdown text="Use `myVar` here" />);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('myVar');
  });

  it('renders bold text', () => {
    const { container } = render(<InlineMarkdown text="This is **bold** text" />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('bold');
  });

  it('renders italic text', () => {
    const { container } = render(<InlineMarkdown text="This is *italic* text" />);
    const em = container.querySelector('em');
    expect(em).not.toBeNull();
    expect(em!.textContent).toBe('italic');
  });
});
