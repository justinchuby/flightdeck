// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ArtifactsPanel } from '../ArtifactsPanel';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../contexts/ProjectContext', () => ({
  useProjectId: () => 'test-project',
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

vi.mock('../../../utils/markdown', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md-render">{text}</div>,
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ArtifactsPanel />
    </MemoryRouter>,
  );
}

// ── Fixtures ──────────────────────────────────────────────────────

const artifactGroups = {
  sharedPath: '/home/user/project/.flightdeck/shared',
  groups: [
    {
      agentDir: 'architect-3973583e',
      role: 'architect',
      agentId: '3973583e',
      files: [
        {
          name: 'codebase-audit-report.md',
          path: '.flightdeck/shared/architect-3973583e/codebase-audit-report.md',
          ext: 'md',
          title: 'Codebase Audit Report',
          modifiedAt: '2026-03-07T14:00:00Z',
        },
        {
          name: 'remaining-work.md',
          path: '.flightdeck/shared/architect-3973583e/remaining-work.md',
          ext: 'md',
          title: 'Remaining Work Items',
          modifiedAt: '2026-03-06T10:00:00Z',
        },
      ],
    },
    {
      agentDir: 'designer-8baab941',
      role: 'designer',
      agentId: '8baab941',
      files: [
        {
          name: 'navigation-redesign-spec.md',
          path: '.flightdeck/shared/designer-8baab941/navigation-redesign-spec.md',
          ext: 'md',
          title: 'Navigation Redesign Specification',
          modifiedAt: '2026-03-08T12:00:00Z',
        },
      ],
    },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────

describe('ArtifactsPanel', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('renders loading state initially', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/loading artifacts/i)).toBeInTheDocument();
  });

  it('renders empty state when no artifacts', async () => {
    mockApiFetch.mockResolvedValue({ groups: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/no agent artifacts yet/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('artifacts-empty')).toBeInTheDocument();
  });

  it('renders agent groups with file counts', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('architect')).toBeInTheDocument();
    });
    expect(screen.getByText('designer')).toBeInTheDocument();
  });

  it('shows file titles instead of raw filenames', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });
    expect(screen.getByText('Navigation Redesign Specification')).toBeInTheDocument();
  });

  it('shows total artifact count', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
  });

  it('loads and renders markdown preview on file click', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/artifacts')) return Promise.resolve(artifactGroups);
      if (url.includes('/file-contents')) {
        return Promise.resolve({
          path: '.flightdeck/shared/architect-3973583e/codebase-audit-report.md',
          content: '# Codebase Audit\n\nFindings here.',
          size: 34,
          ext: 'md',
        });
      }
      return Promise.reject(new Error('Unknown'));
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Codebase Audit Report'));
    await waitFor(() => {
      expect(screen.getByTestId('md-render')).toBeInTheDocument();
    });
    expect(screen.getByTestId('md-render').textContent).toContain('# Codebase Audit');
  });

  it('shows error when file load fails', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/artifacts')) return Promise.resolve(artifactGroups);
      if (url.includes('/file-contents')) return Promise.reject(new Error('File not found'));
      return Promise.reject(new Error('Unknown'));
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Codebase Audit Report'));
    await waitFor(() => {
      expect(screen.getByText('File not found')).toBeInTheDocument();
    });
  });

  it('can collapse and expand agent groups', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });

    // Collapse architect group
    fireEvent.click(screen.getByText('architect'));
    expect(screen.queryByText('Codebase Audit Report')).not.toBeInTheDocument();

    // Re-expand
    fireEvent.click(screen.getByText('architect'));
    expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
  });

  it('shows role emojis for agent groups', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      // Architect emoji
      expect(screen.getByText('\u{1F3D7}')).toBeInTheDocument();
      // Designer emoji
      expect(screen.getByText('\u{1F3A8}')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows empty state placeholder text', async () => {
    mockApiFetch.mockResolvedValue({ groups: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Agent Artifacts')).toBeInTheDocument();
      expect(screen.getByText(/specs, reports, audits/i)).toBeInTheDocument();
    });
  });

  it('shows artifacts directory path with copy button', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('artifacts-path-bar')).toBeInTheDocument();
    });
    expect(screen.getByText('/home/user/project/.flightdeck/shared')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy artifacts path')).toBeInTheDocument();
  });

  it('does not show path bar when sharedPath is missing', async () => {
    mockApiFetch.mockResolvedValue({ groups: [] });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('artifacts-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('artifacts-path-bar')).not.toBeInTheDocument();
  });
});
