// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { isRealCommandBlock, CollapsibleReasoningBlock, CollapsibleSystemBlock, RichContentBlock, MarkdownTable } from '../ChatRenderers';

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ agents: [], setSelectedAgent: vi.fn() }),
    { getState: () => ({ agents: [], setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  InlineMarkdownWithMentions: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../../utils/commandParser', () => ({
  splitCommandBlocks: (text: string) => [text],
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('isRealCommandBlock', () => {
  it('returns true for ALL_CAPS commands', () => {
    expect(isRealCommandBlock('⟦⟦ COMPLETE_TASK {"summary":"done"} ⟧⟧')).toBe(true);
    expect(isRealCommandBlock('⟦⟦ AGENT_MESSAGE {"to":"x"} ⟧⟧')).toBe(true);
  });

  it('returns false for non-commands', () => {
    expect(isRealCommandBlock('⟦⟦ hello world ⟧⟧')).toBe(false);
    expect(isRealCommandBlock('regular text')).toBe(false);
  });
});

describe('RichContentBlock', () => {
  it('renders image when contentType is image', () => {
    render(<RichContentBlock msg={{ contentType: 'image', data: 'abc123', mimeType: 'image/png' } as never} />);
    const img = screen.getByAltText('Agent image');
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toContain('data:image/png;base64,abc123');
  });

  it('renders audio when contentType is audio', () => {
    const { container } = render(<RichContentBlock msg={{ contentType: 'audio', data: 'audio-data', mimeType: 'audio/wav' } as never} />);
    expect(container.querySelector('audio')).not.toBeNull();
  });

  it('renders resource with URI and text', () => {
    render(<RichContentBlock msg={{ contentType: 'resource', uri: '/path/to/file', text: 'file content' } as never} />);
    expect(screen.getByText('/path/to/file')).toBeDefined();
    expect(screen.getByText('file content')).toBeDefined();
  });

  it('returns null for unknown contentType', () => {
    const { container } = render(<RichContentBlock msg={{ contentType: 'unknown' } as never} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('CollapsibleReasoningBlock', () => {
  it('renders nothing when text is empty', () => {
    const { container } = render(<CollapsibleReasoningBlock text="" timestamp="10:00" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows preview text collapsed', () => {
    render(<CollapsibleReasoningBlock text="Thinking about the problem deeply" timestamp="10:00" />);
    expect(screen.getByText('Reasoning')).toBeDefined();
    expect(screen.getByText(/Thinking about/)).toBeDefined();
  });

  it('expands on click showing full text', () => {
    const fullText = 'A'.repeat(100);
    render(<CollapsibleReasoningBlock text={fullText} timestamp="10:00" />);
    fireEvent.click(screen.getByText('Reasoning'));
    expect(screen.getByText(fullText)).toBeDefined();
  });
});

describe('CollapsibleSystemBlock', () => {
  it('renders nothing when text is empty', () => {
    const { container } = render(<CollapsibleSystemBlock text="" timestamp="10:00" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows first line as preview', () => {
    render(<CollapsibleSystemBlock text="[System] Task completed successfully\nMore details here" timestamp="10:00" />);
    expect(screen.getByText(/Task completed successfully/)).toBeDefined();
  });

  it('expands on click', () => {
    render(<CollapsibleSystemBlock text="[System] Task completed" timestamp="10:00" />);
    fireEvent.click(screen.getByText(/Task completed/));
    // After expansion the full text should be visible
    expect(screen.getByText('[System] Task completed')).toBeDefined();
  });
});

describe('MarkdownTable', () => {
  it('renders table headers and body rows', () => {
    const raw = '| Name | Age |\n|---|---|\n| Alice | 30 |\n| Bob | 25 |';
    render(<MarkdownTable raw={raw} />);
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Age')).toBeDefined();
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
  });

  it('falls back to inline markdown for single line', () => {
    render(<MarkdownTable raw="| just one line |" />);
    expect(screen.getByText('| just one line |')).toBeDefined();
  });
});
