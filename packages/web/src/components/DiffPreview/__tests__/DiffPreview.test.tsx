import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffPreview } from '../DiffPreview';
import type { DiffResult, FileDiff } from '../../../hooks/useFocusAgent';

// Stub clipboard API
beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function makeFile(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: 'src/utils/helper.ts',
    status: 'modified',
    additions: 3,
    deletions: 1,
    diff: '+added line\n-removed line\n context line\n@@hunk@@',
    ...overrides,
  };
}

function makeDiff(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    agentId: 'agent-1',
    files: [makeFile()],
    summary: { filesChanged: 1, additions: 3, deletions: 1 },
    cachedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('DiffPreview', () => {
  it('shows empty state when no files', () => {
    const diff = makeDiff({ files: [], summary: { filesChanged: 0, additions: 0, deletions: 0 } });
    render(<DiffPreview diff={diff} />);
    expect(screen.getByText('No file changes detected')).toBeInTheDocument();
  });

  it('renders summary bar with file count and additions/deletions', () => {
    const diff = makeDiff({
      summary: { filesChanged: 2, additions: 5, deletions: 3 },
      files: [makeFile(), makeFile({ path: 'src/other.ts' })],
    });
    render(<DiffPreview diff={diff} />);
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
    expect(screen.getByText('5 additions')).toBeInTheDocument();
    expect(screen.getByText('3 deletions')).toBeInTheDocument();
  });

  it('uses singular "file" and "addition"/"deletion" for count of 1', () => {
    const diff = makeDiff({
      summary: { filesChanged: 1, additions: 1, deletions: 1 },
    });
    render(<DiffPreview diff={diff} />);
    expect(screen.getByText('1 file changed')).toBeInTheDocument();
    expect(screen.getByText('1 addition')).toBeInTheDocument();
    expect(screen.getByText('1 deletion')).toBeInTheDocument();
  });

  it('hides additions/deletions when zero', () => {
    const diff = makeDiff({
      summary: { filesChanged: 1, additions: 0, deletions: 0 },
      files: [makeFile({ additions: 0, deletions: 0 })],
    });
    render(<DiffPreview diff={diff} />);
    expect(screen.queryByText(/addition/)).not.toBeInTheDocument();
    expect(screen.queryByText(/deletion/)).not.toBeInTheDocument();
  });

  it('shows file name and directory path', () => {
    render(<DiffPreview diff={makeDiff()} />);
    expect(screen.getByText('helper.ts')).toBeInTheDocument();
    expect(screen.getByText('src/utils/')).toBeInTheDocument();
  });

  it('shows status labels for added, deleted, modified', () => {
    const diff = makeDiff({
      files: [
        makeFile({ path: 'a.ts', status: 'added' }),
        makeFile({ path: 'b.ts', status: 'deleted' }),
        makeFile({ path: 'c.ts', status: 'modified' }),
      ],
      summary: { filesChanged: 3, additions: 3, deletions: 3 },
    });
    render(<DiffPreview diff={diff} />);
    expect(screen.getByText('New file')).toBeInTheDocument();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  it('expands the first file by default and collapses others', () => {
    const diff = makeDiff({
      files: [
        makeFile({ path: 'first.ts', diff: '+first file line' }),
        makeFile({ path: 'second.ts', diff: '+second file line' }),
      ],
      summary: { filesChanged: 2, additions: 6, deletions: 2 },
    });
    render(<DiffPreview diff={diff} />);
    // First file expanded — its diff content visible
    expect(screen.getByText('+first file line')).toBeInTheDocument();
    // Second file collapsed — diff content not visible
    expect(screen.queryByText('+second file line')).not.toBeInTheDocument();
  });

  it('does not expand first file when defaultExpandFirst is false', () => {
    const diff = makeDiff({ files: [makeFile({ diff: '+special line' })] });
    render(<DiffPreview diff={diff} defaultExpandFirst={false} />);
    expect(screen.queryByText('+special line')).not.toBeInTheDocument();
  });

  it('toggles file section expansion on click', () => {
    const diff = makeDiff({
      files: [makeFile({ path: 'toggle.ts', diff: '+toggled content' })],
    });
    render(<DiffPreview diff={diff} defaultExpandFirst={false} />);
    expect(screen.queryByText('+toggled content')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('toggle.ts'));
    expect(screen.getByText('+toggled content')).toBeInTheDocument();

    // Click to collapse
    fireEvent.click(screen.getByText('toggle.ts'));
    expect(screen.queryByText('+toggled content')).not.toBeInTheDocument();
  });

  it('shows Copy path button when expanded and copies on click', () => {
    render(<DiffPreview diff={makeDiff()} />);
    const copyBtn = screen.getByText('Copy path');
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('src/utils/helper.ts');
  });

  it('handles file with no directory in path', () => {
    const diff = makeDiff({
      files: [makeFile({ path: 'README.md' })],
    });
    render(<DiffPreview diff={diff} />);
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });
});
