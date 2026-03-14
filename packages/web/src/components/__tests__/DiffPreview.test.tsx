import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffPreview } from '../DiffPreview/DiffPreview';
import type { DiffResult } from '../../hooks/useFocusAgent';

// Mock apiFetch for DiffBadge (useDiffSummary)
vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({ filesChanged: 0, additions: 0, deletions: 0 }),
}));

const sampleDiff: DiffResult = {
  agentId: 'agent-abc12345',
  files: [
    {
      path: 'packages/web/src/App.tsx',
      status: 'modified',
      additions: 5,
      deletions: 2,
      diff: [
        '@@ -10,7 +10,10 @@',
        ' import { Sidebar } from "./Sidebar";',
        '-import { OldComponent } from "./OldComponent";',
        '+import { NewComponent } from "./NewComponent";',
        '+import { AnotherComponent } from "./AnotherComponent";',
        ' ',
        ' export function App() {',
      ].join('\n'),
    },
    {
      path: 'packages/web/src/components/NewFile.tsx',
      status: 'added',
      additions: 12,
      deletions: 0,
      diff: '+export function NewFile() {\n+  return <div>Hello</div>;\n+}',
    },
    {
      path: 'packages/web/src/old/Removed.tsx',
      status: 'deleted',
      additions: 0,
      deletions: 8,
      diff: '-export function Removed() {\n-  return null;\n-}',
    },
  ],
  summary: { filesChanged: 3, additions: 17, deletions: 10 },
  cachedAt: new Date().toISOString(),
};

describe('DiffPreview', () => {
  it('renders summary bar with file count and line changes', () => {
    render(<DiffPreview diff={sampleDiff} />);
    expect(screen.getByText('3 files changed')).toBeDefined();
    expect(screen.getByText(/17 addition/)).toBeDefined();
    expect(screen.getByText(/10 deletion/)).toBeDefined();
  });

  it('renders all file headers', () => {
    render(<DiffPreview diff={sampleDiff} />);
    expect(screen.getByText('App.tsx')).toBeDefined();
    expect(screen.getByText('NewFile.tsx')).toBeDefined();
    expect(screen.getByText('Removed.tsx')).toBeDefined();
  });

  it('shows file status labels', () => {
    render(<DiffPreview diff={sampleDiff} />);
    expect(screen.getByText('Modified')).toBeDefined();
    expect(screen.getByText('New file')).toBeDefined();
    expect(screen.getByText('Deleted')).toBeDefined();
  });

  it('expands first file by default when defaultExpandFirst is true', () => {
    render(<DiffPreview diff={sampleDiff} defaultExpandFirst={true} />);
    // First file's diff content should be visible
    expect(screen.getByText(/OldComponent/)).toBeDefined();
    expect(screen.getByText(/NewComponent/)).toBeDefined();
  });

  it('collapses all files when defaultExpandFirst is false', () => {
    render(<DiffPreview diff={sampleDiff} defaultExpandFirst={false} />);
    expect(screen.queryByText(/OldComponent/)).toBeNull();
  });

  it('toggles file expansion on click', () => {
    render(<DiffPreview diff={sampleDiff} defaultExpandFirst={false} />);
    // Click first file header to expand
    const appFileButton = screen.getByText('App.tsx').closest('button');
    fireEvent.click(appFileButton!);
    expect(screen.getByText(/OldComponent/)).toBeDefined();
    // Click again to collapse
    fireEvent.click(appFileButton!);
    expect(screen.queryByText(/OldComponent/)).toBeNull();
  });

  it('renders empty state when no files changed', () => {
    const emptyDiff: DiffResult = {
      agentId: 'test',
      files: [],
      summary: { filesChanged: 0, additions: 0, deletions: 0 },
      cachedAt: new Date().toISOString(),
    };
    render(<DiffPreview diff={emptyDiff} />);
    expect(screen.getByText('No file changes detected')).toBeDefined();
  });

  it('colors addition lines green and deletion lines red', () => {
    render(<DiffPreview diff={sampleDiff} defaultExpandFirst={true} />);
    // Addition line should exist
    const addLine = screen.getByText(/\+import \{ NewComponent \}/);
    expect(addLine.className).toContain('text-green-400');
    // Deletion line should exist
    const delLine = screen.getByText(/-import \{ OldComponent \}/);
    expect(delLine.className).toContain('text-red-400');
  });

  it('renders directory path separately from filename', () => {
    render(<DiffPreview diff={sampleDiff} />);
    // The dir path segment should be visible
    expect(screen.getByText('packages/web/src/')).toBeDefined();
    expect(screen.getByText('App.tsx')).toBeDefined();
  });
});
