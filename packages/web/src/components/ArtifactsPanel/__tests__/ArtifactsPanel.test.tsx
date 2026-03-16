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

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-testid="md-render">{text}</div>,
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
  artifactBasePath: '/home/user/.flightdeck/artifacts/test-project/sessions',
  groups: [
    {
      agentDir: 'architect-3973583e',
      role: 'architect',
      agentId: '3973583e',
      sessionId: 'abc12345-6789-0abc-def0-123456789abc',
      files: [
        {
          name: 'codebase-audit-report.md',
          path: 'abc12345-6789-0abc-def0-123456789abc/architect-3973583e/codebase-audit-report.md',
          ext: 'md',
          title: 'Codebase Audit Report',
          modifiedAt: '2026-03-07T14:00:00Z',
        },
        {
          name: 'remaining-work.md',
          path: 'abc12345-6789-0abc-def0-123456789abc/architect-3973583e/remaining-work.md',
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
      sessionId: 'def67890-1234-5678-9abc-def012345678',
      files: [
        {
          name: 'navigation-redesign-spec.md',
          path: 'def67890-1234-5678-9abc-def012345678/designer-8baab941/navigation-redesign-spec.md',
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

  it('renders session groups with file counts', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      // Session labels are truncated UUIDs (first 8 hex chars, dashes removed)
      expect(screen.getByText('abc12345')).toBeInTheDocument();
    });
    expect(screen.getByText('def67890')).toBeInTheDocument();
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
      if (url.includes('/artifact-contents')) {
        return Promise.resolve({
          path: 'abc12345-6789-0abc-def0-123456789abc/architect-3973583e/codebase-audit-report.md',
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
      if (url.includes('/artifact-contents')) return Promise.reject(new Error('File not found'));
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

  it('can collapse and expand session groups', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });

    // Collapse architect session group (abc12345)
    fireEvent.click(screen.getByText('abc12345'));
    expect(screen.queryByText('Codebase Audit Report')).not.toBeInTheDocument();

    // Re-expand
    fireEvent.click(screen.getByText('abc12345'));
    expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
  });

  it('shows role icons for artifacts', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });
    // Architect emoji (🏗️) appears per-artifact row
    expect(screen.getAllByText('\u{1F3D7}\u{FE0F}').length).toBeGreaterThanOrEqual(1);
    // Designer emoji (🎨)
    expect(screen.getAllByText('\u{1F3A8}').length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getByText('/home/user/.flightdeck/artifacts/test-project/sessions')).toBeInTheDocument();
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

  // ── Copilot Session Artifacts ─────────────────────────────────

  const copilotSessionGroups = {
    artifactBasePath: '/home/user/.flightdeck/artifacts/test-project/sessions',
    groups: [
      ...artifactGroups.groups,
      {
        agentDir: 'developer-aabb1122',
        role: 'developer',
        agentId: 'aabb1122-ccdd-3344-eeff-556677889900',
        sessionId: 'sess-1111-2222-3333-444455556666',
        source: 'copilot-session' as const,
        files: [
          {
            name: 'plan.md',
            path: 'plan.md',
            ext: 'md',
            title: 'Implementation Plan',
            modifiedAt: '2026-03-09T16:00:00Z',
          },
          {
            name: '001-initial-setup.md',
            path: 'checkpoints/001-initial-setup.md',
            ext: 'md',
            title: 'Initial Setup Complete',
            modifiedAt: '2026-03-09T15:00:00Z',
          },
        ],
      },
    ],
  };

  it('shows Session badge for copilot-session artifacts', async () => {
    mockApiFetch.mockResolvedValue(copilotSessionGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();
    });
    // Session badges appear for copilot-session artifacts
    const badges = screen.getAllByText('Session');
    expect(badges.length).toBe(2);
  });

  it('does not show Session badge for flightdeck artifacts', async () => {
    mockApiFetch.mockResolvedValue(artifactGroups);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Codebase Audit Report')).toBeInTheDocument();
    });
    expect(screen.queryByText('Session')).not.toBeInTheDocument();
  });

  it('uses session-artifact endpoint for copilot-session files', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/artifacts')) return Promise.resolve(copilotSessionGroups);
      if (url.includes('/session-artifact')) {
        return Promise.resolve({
          path: 'plan.md',
          content: '# Implementation Plan\n\nSteps here.',
          size: 38,
          ext: 'md',
        });
      }
      if (url.includes('/artifact-contents')) {
        return Promise.resolve({
          path: 'some/path.md',
          content: '# Flightdeck artifact',
          size: 22,
          ext: 'md',
        });
      }
      return Promise.reject(new Error('Unknown'));
    });

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Implementation Plan')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Implementation Plan'));
    await waitFor(() => {
      expect(screen.getByTestId('md-render')).toBeInTheDocument();
    });

    // Verify the session-artifact endpoint was called with correct params
    const sessionArtifactCall = mockApiFetch.mock.calls.find(
      (c: string[]) => c[0].includes('/session-artifact'),
    );
    expect(sessionArtifactCall).toBeDefined();
    expect(sessionArtifactCall![0]).toContain('agentId=aabb1122-ccdd-3344-eeff-556677889900');
    expect(sessionArtifactCall![0]).toContain('path=plan.md');
  });

  it('uses artifact-contents endpoint for flightdeck files', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/artifacts')) return Promise.resolve(copilotSessionGroups);
      if (url.includes('/artifact-contents')) {
        return Promise.resolve({
          path: 'abc12345-6789-0abc-def0-123456789abc/architect-3973583e/codebase-audit-report.md',
          content: '# Codebase Audit',
          size: 17,
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

    // Verify artifact-contents endpoint was used (not session-artifact)
    const artifactCall = mockApiFetch.mock.calls.find(
      (c: string[]) => c[0].includes('/artifact-contents'),
    );
    expect(artifactCall).toBeDefined();
    expect(mockApiFetch.mock.calls.find((c: string[]) => c[0].includes('/session-artifact'))).toBeUndefined();
  });
});
