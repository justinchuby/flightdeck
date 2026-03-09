import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReadOnlySession } from '../ReadOnlySession';

// Mock LeadDashboard to verify readOnly prop is passed
const mockLeadDashboard = vi.fn();
vi.mock('../LeadDashboard', () => ({
  LeadDashboard: (props: any) => {
    mockLeadDashboard(props);
    return <div data-testid="lead-dashboard" data-readonly={props.readOnly} />;
  },
}));

// Mock leadStore
const mockSelectLead = vi.fn();
const mockAddProject = vi.fn();
const mockSetMessages = vi.fn();
const mockSetDecisions = vi.fn();
const mockSetGroups = vi.fn();
const mockSetDagStatus = vi.fn();
const mockSetProgress = vi.fn();

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({
        projects: {},
        selectedLeadId: null,
        selectLead: mockSelectLead,
        addProject: mockAddProject,
        setMessages: mockSetMessages,
        setDecisions: mockSetDecisions,
        setGroups: mockSetGroups,
        setDagStatus: mockSetDagStatus,
        setProgress: mockSetProgress,
      }),
    }
  ),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ReadOnlySession', () => {
  const mockApi = {};
  const mockWs = { subscribe: vi.fn(), unsubscribe: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ messages: [] }),
    });
  });

  function renderWithRoute(leadId: string) {
    return render(
      <MemoryRouter initialEntries={[`/projects/proj-1/sessions/${leadId}`]}>
        <Routes>
          <Route
            path="/projects/:id/sessions/:leadId"
            element={<ReadOnlySession api={mockApi} ws={mockWs} />}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders LeadDashboard with readOnly=true', () => {
    renderWithRoute('lead-abc-123');
    expect(screen.getByTestId('lead-dashboard')).toBeInTheDocument();
    expect(mockLeadDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true })
    );
  });

  it('selects the historical lead in store', () => {
    renderWithRoute('lead-abc-123');
    expect(mockAddProject).toHaveBeenCalledWith('lead-abc-123');
    expect(mockSelectLead).toHaveBeenCalledWith('lead-abc-123');
  });

  it('fetches historical messages', async () => {
    mockFetch.mockResolvedValue({
      json: () =>
        Promise.resolve({
          messages: [
            { content: 'Hello', sender: 'user', timestamp: '2026-03-08T10:00:00Z' },
            { content: 'Hi back', sender: 'agent', timestamp: '2026-03-08T10:00:01Z' },
          ],
        }),
    });

    renderWithRoute('lead-abc-123');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/agents/lead-abc-123/messages?limit=1000&includeSystem=true',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it('fetches historical decisions, groups, DAG, and progress', async () => {
    renderWithRoute('lead-abc-123');

    await waitFor(() => {
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0]);
      expect(urls).toContain('/api/agents/lead-abc-123/messages?limit=1000&includeSystem=true');
      expect(urls).toContain('/api/lead/lead-abc-123/decisions');
      expect(urls).toContain('/api/lead/lead-abc-123/groups');
      expect(urls).toContain('/api/lead/lead-abc-123/dag');
      expect(urls).toContain('/api/lead/lead-abc-123/progress');
    });
  });
});
